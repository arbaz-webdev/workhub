// The numbers behind the reports. Each runs inside the caller's tenant transaction.
import type { CompanyDto, DashboardDto, LeadSource, MoneyDto, PersonDto, Presence, ProfitabilityDto, ProfitRow, SalesReportDto, UtilisationDto, UtilisationRow } from '@workhub/shared';
import { sql } from 'drizzle-orm';
import { peopleAttendance } from '../attendance/attendance';
import { holidayMap, leaveMap, workingDaysOf } from '../attendance/calendar';
import { addDays, isoWeekday, zonedParts } from '../attendance/zoned';
import type { Tx } from '../db/db.service';
import { sumByCurrency } from '../crm/deals';
import { presenceFor } from '../inbox/presence';

/** A day's working hours, for capacity. */
export const HOURS_PER_DAY = 8;

interface CostInfo {
  currency: string;
  timezone: string;
  workingDays: number[];
  monthlyHours: number;
  fxRates: Record<string, number>;
}

export async function costInfo(tx: Tx, workspaceId: string): Promise<CostInfo> {
  const { rows } = await tx.execute<{ currency: string; timezone: string; working_days: number[]; monthly_hours: number; fx_rates: Record<string, number> }>(
    sql`select currency, timezone, working_days, monthly_hours, fx_rates from workspaces where id = ${workspaceId}::uuid`,
  );
  const w = rows[0]!;
  return { currency: w.currency, timezone: w.timezone, workingDays: w.working_days, monthlyHours: w.monthly_hours, fxRates: w.fx_rates ?? {} };
}

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const hours = (minutes: number) => round(minutes / 60, 1);

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export const lastDayOf = (month: string) => addDays(`${addDays(`${month}-01`, 32).slice(0, 7)}-01`, -1);

function row(revenue: number, cost: number, minutes: number, billable: number): ProfitRow {
  const profit = revenue - cost;
  return { revenue: round(revenue), cost: round(cost), profit: round(profit), margin: revenue > 0 ? round((profit / revenue) * 100, 1) : null, hours: hours(minutes), billableHours: hours(billable) };
}

/**
 * Revenue against the cost of time, per client and month, in the workspace currency.
 * Revenue: won deals (in the month won) and, for projects with an hourly rate, billable
 * hours × rate (a deal that started such a project isn't counted again). Cost: hours
 * logged × each person's monthly cost ÷ the workspace's monthly hours.
 */
export async function profitability(tx: Tx, workspaceId: string, from: string, to: string): Promise<ProfitabilityDto> {
  const info = await costInfo(tx, workspaceId);
  const months = monthsBetween(from, to);
  const start = `${from}-01`;
  const end = lastDayOf(to);
  const missing = new Set<string>();
  const convert = (value: number, currency: string | null): number | null => {
    if (!currency || currency === info.currency) return value;
    const rate = info.fxRates[currency];
    if (!rate) {
      missing.add(currency);
      return null;
    }
    return value * rate;
  };

  // Totals per client per month.
  type Cell = { revenue: number; cost: number; minutes: number; billable: number };
  const cells = new Map<string, Map<string, Cell>>();
  const cell = (client: string, month: string) => {
    const byMonth = cells.get(client) ?? new Map<string, Cell>();
    cells.set(client, byMonth);
    const c = byMonth.get(month) ?? { revenue: 0, cost: 0, minutes: 0, billable: 0 };
    byMonth.set(month, c);
    return c;
  };

  const time = await tx.execute<{ client_id: string | null; user_id: string; month: string; minutes: number; billable: number; hourly_rate: string | null; rate_currency: string | null; monthly_cost: string | null; name: string; email: string }>(sql`
    select p.client_id, t.user_id, to_char(t.work_date, 'YYYY-MM') as month,
      sum(t.minutes)::int as minutes, (sum(t.minutes) filter (where t.billable))::int as billable,
      p.hourly_rate, p.rate_currency, m.monthly_cost, u.name, u.email
    from time_entries t
    join projects p on p.id = t.project_id
    join users u on u.id = t.user_id
    left join memberships m on m.workspace_id = t.workspace_id and m.user_id = t.user_id
    where t.workspace_id = ${workspaceId}::uuid and t.work_date between ${start}::date and ${end}::date
    group by p.id, p.client_id, t.user_id, month, p.hourly_rate, p.rate_currency, m.monthly_cost, u.name, u.email
  `);
  const noCost = new Map<string, PersonDto>();
  for (const r of time.rows) {
    const c = cell(r.client_id ?? '', r.month);
    const billable = r.billable ?? 0;
    c.minutes += r.minutes;
    c.billable += billable;
    if (r.monthly_cost === null) noCost.set(r.user_id, { id: r.user_id, name: r.name, email: r.email });
    else c.cost += (Number(r.monthly_cost) / info.monthlyHours) * (r.minutes / 60);
    if (r.hourly_rate !== null) {
      const value = convert(Number(r.hourly_rate) * (billable / 60), r.rate_currency ?? info.currency);
      if (value !== null) c.revenue += value;
    }
  }

  const won = await tx.execute<{ company_id: string | null; month: string; value: string; currency: string }>(sql`
    select d.company_id, to_char(d.won_at at time zone ${info.timezone}, 'YYYY-MM') as month, d.value, d.currency
    from deals d
    left join projects p on p.id = d.project_id
    where d.workspace_id = ${workspaceId}::uuid and d.status = 'won' and d.deleted_at is null and d.value is not null
      and p.hourly_rate is null
      and to_char(d.won_at at time zone ${info.timezone}, 'YYYY-MM') between ${from} and ${to}
  `);
  for (const d of won.rows) {
    const value = convert(Number(d.value), d.currency);
    if (value !== null) cell(d.company_id ?? '', d.month).revenue += value;
  }

  const ids = [...cells.keys()].filter(Boolean);
  const names = ids.length
    ? (await tx.execute<{ id: string; name: string }>(sql`select id, name from companies where id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`)).rows
    : [];
  const client = (id: string): CompanyDto | null => (id ? (names.find((n) => n.id === id) ?? { id, name: 'Deleted company' }) : null);

  const sum = (list: Cell[]) => list.reduce((a, c) => ({ revenue: a.revenue + c.revenue, cost: a.cost + c.cost, minutes: a.minutes + c.minutes, billable: a.billable + c.billable }), { revenue: 0, cost: 0, minutes: 0, billable: 0 });
  const toRow = (c: Cell) => row(c.revenue, c.cost, c.minutes, c.billable);
  const clients = [...cells].map(([id, byMonth]) => ({
    client: client(id),
    ...toRow(sum([...byMonth.values()])),
    byMonth: months.map((month) => ({ month, ...toRow(byMonth.get(month) ?? { revenue: 0, cost: 0, minutes: 0, billable: 0 }) })),
  }));
  clients.sort((a, b) => b.profit - a.profit || b.revenue - a.revenue);
  const all = [...cells.values()];
  return {
    currency: info.currency,
    months,
    clients,
    total: {
      ...toRow(sum(all.flatMap((m) => [...m.values()]))),
      byMonth: months.map((month) => ({ month, ...toRow(sum(all.map((m) => m.get(month)).filter((c): c is Cell => !!c))) })),
    },
    missingRates: [...missing].sort(),
    peopleWithoutCost: [...noCost.values()],
  };
}

/** Billable and total hours against working capacity, per person and team. */
export async function utilisation(tx: Tx, workspaceId: string, from: string, to: string): Promise<UtilisationDto> {
  const info = await costInfo(tx, workspaceId);
  const staff = await tx.execute<{ user_id: string; name: string; email: string; team_id: string | null; team_name: string | null }>(sql`
    select m.user_id, u.name, u.email, m.team_id, t.name as team_name
    from memberships m join users u on u.id = m.user_id left join teams t on t.id = m.team_id and t.deleted_at is null
    where m.workspace_id = ${workspaceId}::uuid and m.role <> 'guest'
    order by u.name
  `);
  const people = await peopleAttendance(tx, workspaceId);
  const holidays = await holidayMap(tx, workspaceId, from, to);
  const ws = { id: workspaceId, timezone: info.timezone, workingDays: info.workingDays, requireSelfie: false };
  const leave = await leaveMap(tx, ws, people, from, to, holidays);
  const time = await tx.execute<{ user_id: string; minutes: number; billable: number }>(sql`
    select user_id, sum(minutes)::int as minutes, (sum(minutes) filter (where billable))::int as billable
    from time_entries where workspace_id = ${workspaceId}::uuid and work_date between ${from}::date and ${to}::date
    group by user_id
  `);

  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const make = (minutes: number, billable: number, capacity: number): UtilisationRow => ({
    hours: hours(minutes),
    billableHours: hours(billable),
    capacityHours: round(capacity, 1),
    utilisation: capacity > 0 ? round((billable / 60 / capacity) * 100, 1) : null,
  });

  const rows = staff.rows.map((s) => {
    const days = workingDaysOf(people.get(s.user_id), ws);
    const away = leave.get(s.user_id);
    const capacity = dates.reduce((n, d) => (days.includes(isoWeekday(d)) && !holidays.has(d) ? n + HOURS_PER_DAY * (1 - (away?.get(d)?.fraction ?? 0)) : n), 0);
    const t = time.rows.find((r) => r.user_id === s.user_id);
    return { person: { id: s.user_id, name: s.name, email: s.email }, team: s.team_id && s.team_name ? { id: s.team_id, name: s.team_name } : null, minutes: t?.minutes ?? 0, billable: t?.billable ?? 0, capacity };
  });

  const teams = new Map<string, typeof rows>();
  for (const r of rows) teams.set(r.team?.id ?? '', [...(teams.get(r.team?.id ?? '') ?? []), r]);
  const add = (list: typeof rows) => make(
    list.reduce((n, r) => n + r.minutes, 0),
    list.reduce((n, r) => n + r.billable, 0),
    list.reduce((n, r) => n + r.capacity, 0),
  );
  return {
    from,
    to,
    people: rows.map((r) => ({ person: r.person, team: r.team, ...make(r.minutes, r.billable, r.capacity) })),
    teams: [...teams.values()].map((list) => ({ team: list[0]!.team, people: list.length, ...add(list) })).sort((a, b) => (a.team?.name ?? '~').localeCompare(b.team?.name ?? '~')),
    total: add(rows),
  };
}

const money = (rows: { value: string | number | null; currency: string; weight?: number }[]): MoneyDto[] =>
  sumByCurrency(rows.map((r) => ({ value: r.value === null ? null : Number(r.value), currency: r.currency, weight: r.weight })));

/** Pipeline value, win rate, where deals come from and what each salesperson did. */
export async function salesReport(tx: Tx, workspaceId: string, from: string, to: string): Promise<SalesReportDto> {
  const info = await costInfo(tx, workspaceId);
  const tz = info.timezone;
  const inRange = (col: string) => sql`(${sql.raw(col)} at time zone ${tz})::date between ${from}::date and ${to}::date`;

  const open = await tx.execute<{ value: string | null; currency: string; probability: number; stage: string; position: number; is_default: boolean }>(sql`
    select d.value, d.currency, s.probability, s.name as stage, s.position, p.is_default
    from deals d join pipeline_stages s on s.id = d.stage_id join pipelines p on p.id = d.pipeline_id
    where d.workspace_id = ${workspaceId}::uuid and d.status = 'open' and d.deleted_at is null
  `);
  const closed = await tx.execute<{ status: 'won' | 'lost'; value: string | null; currency: string; owner_id: string | null; source: LeadSource | null; days: number; lost_reason: string | null }>(sql`
    select d.status, d.value, d.currency, d.owner_id, l.source, extract(epoch from (d.won_at - d.created_at)) / 86400 as days, d.lost_reason
    from deals d left join leads l on l.id = d.lead_id
    where d.workspace_id = ${workspaceId}::uuid and d.deleted_at is null
      and ((d.status = 'won' and ${inRange('d.won_at')}) or (d.status = 'lost' and ${inRange('d.lost_at')}))
  `);
  const won = closed.rows.filter((r) => r.status === 'won');
  const lost = closed.rows.filter((r) => r.status === 'lost');

  const leadRows = await tx.execute<{ source: LeadSource; leads: number; converted: number }>(sql`
    select source, count(*)::int as leads, (count(*) filter (where status = 'converted'))::int as converted
    from leads where workspace_id = ${workspaceId}::uuid and deleted_at is null and ${inRange('created_at')}
    group by source
  `);
  const sources = new Map<LeadSource | 'direct', SalesReportDto['sources'][number]>();
  for (const l of leadRows.rows) sources.set(l.source, { source: l.source, leads: l.leads, converted: l.converted, won: 0, wonValue: [] });
  for (const s of new Set(won.map((w) => w.source ?? 'direct'))) {
    const mine = won.filter((w) => (w.source ?? 'direct') === s);
    const current = sources.get(s) ?? { source: s, leads: 0, converted: 0, won: 0, wonValue: [] };
    sources.set(s, { ...current, won: mine.length, wonValue: money(mine) });
  }

  const staff = await tx.execute<{ user_id: string; name: string; email: string; activities: number; calls: number; meetings: number; open: number }>(sql`
    select m.user_id, u.name, u.email,
      (select count(*) from activities a where a.workspace_id = m.workspace_id and a.created_by = m.user_id and ${inRange('a.created_at')})::int as activities,
      (select count(*) from activities a where a.workspace_id = m.workspace_id and a.created_by = m.user_id and a.kind = 'call' and ${inRange('a.created_at')})::int as calls,
      (select count(*) from activities a where a.workspace_id = m.workspace_id and a.created_by = m.user_id and a.kind = 'meeting' and ${inRange('a.created_at')})::int as meetings,
      (select count(*) from deals d where d.workspace_id = m.workspace_id and d.owner_id = m.user_id and d.status = 'open' and d.deleted_at is null)::int as open
    from memberships m join users u on u.id = m.user_id
    where m.workspace_id = ${workspaceId}::uuid and m.role <> 'guest'
    order by u.name
  `);
  const people = staff.rows
    .map((s) => {
      const mine = won.filter((w) => w.owner_id === s.user_id);
      return { person: { id: s.user_id, name: s.name, email: s.email }, activities: s.activities, calls: s.calls, meetings: s.meetings, won: mine.length, wonValue: money(mine), open: s.open };
    })
    .filter((p) => p.activities || p.won || p.open);

  // The default pipeline's open stages, in order.
  const stageMap = new Map<string, { stage: string; probability: number; position: number; rows: typeof open.rows }>();
  for (const r of open.rows.filter((o) => o.is_default)) {
    const s = stageMap.get(r.stage) ?? { stage: r.stage, probability: r.probability, position: r.position, rows: [] };
    s.rows.push(r);
    stageMap.set(r.stage, s);
  }
  const reasons = new Map<string, number>();
  for (const l of lost) reasons.set(l.lost_reason?.trim() || 'No reason given', (reasons.get(l.lost_reason?.trim() || 'No reason given') ?? 0) + 1);

  return {
    from,
    to,
    currency: info.currency,
    open: money(open.rows),
    weighted: money(open.rows.map((r) => ({ ...r, weight: r.probability / 100 }))),
    won: { count: won.length, value: money(won) },
    lost: { count: lost.length },
    winRate: won.length + lost.length > 0 ? round((won.length / (won.length + lost.length)) * 100, 1) : null,
    avgDaysToWin: won.length ? round(won.reduce((n, w) => n + Number(w.days), 0) / won.length, 1) : null,
    stages: [...stageMap.values()].sort((a, b) => a.position - b.position).map((s) => ({ stage: s.stage, probability: s.probability, count: s.rows.length, value: money(s.rows) })),
    sources: [...sources.values()].sort((a, b) => b.won - a.won || b.leads - a.leads),
    people,
    lostReasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  };
}

/** The home page: the team's day for managers, and everyone's own. */
export async function dashboard(tx: Tx, workspaceId: string, userId: string, seesTeam: boolean, now = new Date()): Promise<DashboardDto> {
  const info = await costInfo(tx, workspaceId);
  const today = zonedParts(now, info.timezone).date;
  const monday = addDays(today, 1 - isoWeekday(today));

  const mine = await tx.execute<{ due_today: number; overdue: number; follow_ups: number; minutes: number }>(sql`
    select
      (select count(*) from tasks t join task_assignees a on a.task_id = t.id
        where a.user_id = ${userId}::uuid and t.workspace_id = ${workspaceId}::uuid and t.deleted_at is null and t.completed_at is null and t.due_date = ${today}::date)::int as due_today,
      (select count(*) from tasks t join task_assignees a on a.task_id = t.id
        where a.user_id = ${userId}::uuid and t.workspace_id = ${workspaceId}::uuid and t.deleted_at is null and t.completed_at is null and t.due_date < ${today}::date)::int as overdue,
      (select count(*) from activities where workspace_id = ${workspaceId}::uuid and owner_id = ${userId}::uuid and done_at is null and due_at <= ${now.toISOString()}::timestamptz)::int as follow_ups,
      (select coalesce(sum(minutes), 0) from time_entries where workspace_id = ${workspaceId}::uuid and user_id = ${userId}::uuid and work_date >= ${monday}::date)::int as minutes
  `);
  const overdueList = await tx.execute<{ id: string; title: string; project_id: string; project_name: string; due_date: string }>(sql`
    select t.id, t.title, t.project_id, p.name as project_name, t.due_date::text
    from tasks t join task_assignees a on a.task_id = t.id join projects p on p.id = t.project_id
    where a.user_id = ${userId}::uuid and t.workspace_id = ${workspaceId}::uuid and t.deleted_at is null and t.completed_at is null and t.due_date < ${today}::date
    order by t.due_date limit 5
  `);
  const m = mine.rows[0]!;
  const me: DashboardDto['me'] = {
    tasksDueToday: m.due_today,
    tasksOverdue: m.overdue,
    followUpsDue: m.follow_ups,
    hoursThisWeek: hours(m.minutes),
    myOverdue: overdueList.rows.map((r) => ({ id: r.id, title: r.title, projectId: r.project_id, projectName: r.project_name, dueDate: r.due_date })),
  };
  if (!seesTeam) return { team: null, me };

  const attendance: Record<Presence, number> = { in: 0, break: 0, out: 0, leave: 0, away: 0 };
  for (const p of await presenceFor(tx, workspaceId, now)) attendance[p.presence] += 1;
  const counts = await tx.execute<{ projects: number; overdue: number; follow_ups: number }>(sql`
    select
      (select count(*) from projects where workspace_id = ${workspaceId}::uuid and status = 'active')::int as projects,
      (select count(*) from tasks t join projects p on p.id = t.project_id
        where t.workspace_id = ${workspaceId}::uuid and t.deleted_at is null and t.completed_at is null and t.due_date < ${today}::date and p.status = 'active')::int as overdue,
      (select count(*) from activities where workspace_id = ${workspaceId}::uuid and done_at is null and due_at < ${now.toISOString()}::timestamptz)::int as follow_ups
  `);
  const pipeline = await tx.execute<{ value: string | null; currency: string }>(sql`
    select value, currency from deals where workspace_id = ${workspaceId}::uuid and status = 'open' and deleted_at is null
  `);
  const byClient = await tx.execute<{ client_id: string | null; client_name: string | null; minutes: number }>(sql`
    select p.client_id, c.name as client_name, sum(t.minutes)::int as minutes
    from time_entries t join projects p on p.id = t.project_id left join companies c on c.id = p.client_id
    where t.workspace_id = ${workspaceId}::uuid and t.work_date >= ${monday}::date
    group by p.client_id, c.name order by minutes desc limit 8
  `);
  const c = counts.rows[0]!;
  return {
    me,
    team: {
      attendance,
      activeProjects: c.projects,
      overdueTasks: c.overdue,
      openPipeline: money(pipeline.rows),
      hoursThisWeekByClient: byClient.rows.map((r) => ({ client: r.client_id ? { id: r.client_id, name: r.client_name ?? 'Deleted company' } : null, hours: hours(r.minutes) })),
      followUpsOverdue: c.follow_ups,
    },
  };
}
