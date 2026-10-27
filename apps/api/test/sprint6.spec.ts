import type { INestApplication } from '@nestjs/common';
import {
  WORKSPACE_HEADER,
  type AttendanceDayDto,
  type CorrectionDto,
  type HolidayDto,
  type LeaveCalendarDto,
  type LeaveRequestDto,
  type LeaveTypeDto,
  type MyLeaveDto,
  type TimerDto,
  type TimesheetDto,
  type TimesheetSummaryDto,
} from '@workhub/shared';
import { addDays, zonedParts, zonedTime } from '../src/attendance/zoned';
import { weekStart } from '../src/leave/leave-rules';
import { createApp, signUp, withAdmin } from './helpers';

const PK = 'Asia/Karachi';
let app: INestApplication;
let owner: Awaited<ReturnType<typeof signUp>>;
let manager: Awaited<ReturnType<typeof signUp>>;
let member: Awaited<ReturnType<typeof signUp>>;
let rival: Awaited<ReturnType<typeof signUp>>;
let ws: string;
const H = () => ({ [WORKSPACE_HEADER]: ws });

const today = () => zonedParts(new Date(), PK).date;
/** The Monday two weeks back: a full past working week, whatever today is. */
const pastMonday = () => addDays(weekStart(today()), -14);
const year = () => Number(pastMonday().slice(0, 4));

async function join_(person: typeof owner, role: string, joined?: string) {
  await withAdmin((db) =>
    db.query('insert into memberships (workspace_id, user_id, role, created_at) values ($1, $2, $3, coalesce($4::timestamptz, now()))', [ws, person.user.id, role, joined ?? null]),
  );
}

async function notificationTitles(agent: typeof owner.agent) {
  return (await agent.get('/notifications').set(H()).expect(200)).body.items.map((n: { title: string }) => n.title) as string[];
}

beforeAll(async () => {
  app = await createApp();
  owner = await signUp(app, 'owner', 'Leave Co');
  ws = owner.workspace.id;
  manager = await signUp(app, 'manager', 'M home');
  member = await signUp(app, 'member', 'Mem home');
  rival = await signUp(app, 'rival', 'Rival Co');
  // Everyone joined well before the dates these tests use.
  const longAgo = `${year() - 1}-01-01`;
  await join_(manager, 'manager', longAgo);
  await join_(member, 'member', longAgo);
  await withAdmin((db) => db.query('update memberships set created_at = $1 where workspace_id = $2 and user_id = $3', [longAgo, ws, owner.user.id]));
  // Attendance has been tracked since then too (it starts with the first shift).
  const shift = await owner.agent.post('/attendance/shifts').set(H()).send({ name: 'Office', startTime: '09:00', endTime: '18:00' }).expect(201);
  await withAdmin((db) => db.query('update shifts set created_at = $1 where id = $2', [longAgo, shift.body.id]));
});

afterAll(async () => {
  await app.close();
});

describe('holidays', () => {
  it('loads Pakistan’s holidays once, with Eid estimated and editable', async () => {
    await member.agent.post('/holidays/load-pakistan').set(H()).send({ year: 2026 }).expect(403);
    const loaded = (await owner.agent.post('/holidays/load-pakistan').set(H()).send({ year: 2026 }).expect(201)).body as HolidayDto[];
    expect(loaded.find((h) => h.date === '2026-03-23')).toMatchObject({ name: 'Pakistan Day', kind: 'public', estimated: false });
    const eid = loaded.find((h) => h.name === 'Eid ul-Fitr (day 1)')!;
    expect(eid).toMatchObject({ date: '2026-03-20', estimated: true });
    const again = (await owner.agent.post('/holidays/load-pakistan').set(H()).send({ year: 2026 }).expect(201)).body as HolidayDto[];
    expect(again).toHaveLength(loaded.length);

    // The announced date replaces the estimate, and reloading doesn't undo the edit.
    const moved = await owner.agent.patch(`/holidays/${eid.id}`).set(H()).send({ date: '2026-03-21', name: 'Eid ul-Fitr (day 1)' }).expect(200);
    expect(moved.body).toMatchObject({ date: '2026-03-21', estimated: false });
    const third = (await owner.agent.post('/holidays/load-pakistan').set(H()).send({ year: 2026 }).expect(201)).body as HolidayDto[];
    expect(third.find((h) => h.id === eid.id)!.date).toBe('2026-03-21');

    const listed = (await member.agent.get('/holidays').query({ year: 2026 }).set(H()).expect(200)).body as HolidayDto[];
    expect(listed).toHaveLength(loaded.length);
    expect((await rival.agent.get('/holidays').query({ year: 2026 }).set(WORKSPACE_HEADER, rival.workspace.id).expect(200)).body).toEqual([]);
  });

  it('lets admins add and remove company holidays', async () => {
    await member.agent.post('/holidays').set(H()).send({ date: '2026-12-31', name: 'Year end' }).expect(403);
    const h = await owner.agent.post('/holidays').set(H()).send({ date: '2026-12-31', name: 'Year end' }).expect(201);
    expect(h.body).toMatchObject({ kind: 'company', estimated: false });
    await owner.agent.delete(`/holidays/${h.body.id}`).set(H()).expect(204);
  });
});

describe('leave types', () => {
  it('starts with sensible defaults that admins can change', async () => {
    const types = (await member.agent.get('/leave/types').set(H()).expect(200)).body as LeaveTypeDto[];
    expect(types.map((t) => t.name)).toEqual(['Annual', 'Casual', 'Sick', 'Unpaid']);
    expect(types.find((t) => t.name === 'Unpaid')).toMatchObject({ paid: false, daysPerYear: null });
    await member.agent.post('/leave/types').set(H()).send({ name: 'Hajj', paid: true, daysPerYear: 30, accrual: 'yearly' }).expect(403);
    const hajj = await owner.agent.post('/leave/types').set(H()).send({ name: 'Hajj', paid: true, daysPerYear: 30, accrual: 'yearly', color: 'teal' }).expect(201);
    await owner.agent.post('/leave/types').set(H()).send({ name: 'hajj', paid: true, daysPerYear: 5, accrual: 'yearly' }).expect(409);
    await owner.agent.delete(`/leave/types/${hajj.body.id}`).set(H()).expect(204);
    expect(((await member.agent.get('/leave/types').set(H())).body as LeaveTypeDto[]).map((t) => t.name)).not.toContain('Hajj');
  });
});

describe('leave requests', () => {
  let casual: LeaveTypeDto;
  let unpaid: LeaveTypeDto;

  beforeAll(async () => {
    const types = (await member.agent.get('/leave/types').set(H())).body as LeaveTypeDto[];
    casual = types.find((t) => t.name === 'Casual')!;
    unpaid = types.find((t) => t.name === 'Unpaid')!;
  });

  it('counts only working days and skips holidays', async () => {
    const mon = pastMonday();
    const preview = await member.agent.get('/leave/preview').query({ startDate: addDays(mon, -3), endDate: mon }).set(H()).expect(200);
    expect(preview.body.days).toBe(2); // Friday and Monday
    const pakistanDay = await member.agent.get('/leave/preview').query({ startDate: '2026-03-23', endDate: '2026-03-24' }).set(H()).expect(200);
    expect(pakistanDay.body).toMatchObject({ days: 1, dates: ['2026-03-24'] });
    await member.agent.post('/leave/requests').set(H()).send({ leaveTypeId: unpaid.id, startDate: '2026-03-23', endDate: '2026-03-23' }).expect(400);
  });

  it('asks a manager, checks the balance, and notifies both ways', async () => {
    const mon = pastMonday();
    const r = await member.agent
      .post('/leave/requests')
      .set(H())
      .send({ leaveTypeId: casual.id, startDate: mon, endDate: addDays(mon, 2), reason: 'Family wedding' })
      .expect(201);
    expect(r.body).toMatchObject({ status: 'pending', days: 3, reason: 'Family wedding' });
    expect(await notificationTitles(manager.agent)).toContain('member asked for 3 days of casual leave');

    const mine = (await member.agent.get('/leave/me').query({ year: year() }).set(H()).expect(200)).body as MyLeaveDto;
    expect(mine.balances.find((b) => b.leaveType.name === 'Casual')).toMatchObject({ entitled: 10, pending: 3, used: 0, available: 7 });

    // Not more than is left, and not twice for the same days.
    await member.agent.post('/leave/requests').set(H()).send({ leaveTypeId: casual.id, startDate: `${year()}-11-02`, endDate: `${year()}-11-13` }).expect(400);
    await member.agent.post('/leave/requests').set(H()).send({ leaveTypeId: unpaid.id, startDate: addDays(mon, 1), endDate: addDays(mon, 1) }).expect(409);

    await member.agent.post(`/leave/requests/${r.body.id}/approve`).set(H()).send({}).expect(403);
    const approved = await manager.agent.post(`/leave/requests/${r.body.id}/approve`).set(H()).send({ note: 'Enjoy' }).expect(200);
    expect(approved.body).toMatchObject({ status: 'approved', decidedByName: 'manager', decisionNote: 'Enjoy' });
    await manager.agent.post(`/leave/requests/${r.body.id}/reject`).set(H()).send({}).expect(409);
    expect((await notificationTitles(member.agent)).some((t) => t.startsWith('Your leave') && t.endsWith('was approved'))).toBe(true);
    const after = (await member.agent.get('/leave/me').query({ year: year() }).set(H())).body as MyLeaveDto;
    expect(after.balances.find((b) => b.leaveType.name === 'Casual')).toMatchObject({ used: 3, pending: 0, available: 7 });

    // Leave that has started can't be withdrawn by the employee.
    await member.agent.post(`/leave/requests/${r.body.id}/cancel`).set(H()).send({}).expect(409);
  });

  it('shows leave in attendance, without reasons in the team calendar', async () => {
    const mon = pastMonday();
    const days = (await member.agent.get('/attendance/me').query({ month: mon.slice(0, 7) }).set(H()).expect(200)).body as AttendanceDayDto[];
    const onLeave = days.find((d) => d.date === mon)!;
    expect(onLeave).toMatchObject({ status: 'on_leave', leave: { typeName: 'Casual', fraction: 1, paid: true } });

    const cal = (await manager.agent.get('/leave/calendar').query({ month: mon.slice(0, 7) }).set(H()).expect(200)).body as LeaveCalendarDto;
    const row = cal.people.find((p) => p.userId === member.user.id)!;
    expect(row.entries.find((e) => e.date === mon)).toMatchObject({ typeName: 'Casual', status: 'approved', fraction: 1 });
    expect(JSON.stringify(cal)).not.toContain('Family wedding');
  });

  it('half a day off: the other half is still owed', async () => {
    const thu = addDays(pastMonday(), 3);
    const r = await member.agent.post('/leave/requests').set(H()).send({ leaveTypeId: casual.id, startDate: thu, endDate: thu, halfDay: 'first' }).expect(201);
    expect(r.body.days).toBe(0.5);
    await owner.agent.post(`/leave/requests/${r.body.id}/approve`).set(H()).send({}).expect(200);
    const days = (await member.agent.get('/attendance/me').query({ month: thu.slice(0, 7) }).set(H())).body as AttendanceDayDto[];
    expect(days.find((d) => d.date === thu)).toMatchObject({ status: 'absent', flags: ['half_day_leave'], leave: { fraction: 0.5 } });
  });

  it('only owners approve their own leave; others need someone else', async () => {
    // A future date that takes a day of leave (not a weekend or a holiday such as Iqbal Day).
    let future = addDays(weekStart(today()), 21);
    while ((await manager.agent.get('/leave/preview').query({ startDate: future, endDate: future }).set(H())).body.days !== 1) future = addDays(future, 1);
    const mine = await manager.agent.post('/leave/requests').set(H()).send({ leaveTypeId: unpaid.id, startDate: future, endDate: future }).expect(201);
    await manager.agent.post(`/leave/requests/${mine.body.id}/approve`).set(H()).send({}).expect(403);
    const own = await owner.agent.post('/leave/requests').set(H()).send({ leaveTypeId: unpaid.id, startDate: future, endDate: future }).expect(201);
    await owner.agent.post(`/leave/requests/${own.body.id}/approve`).set(H()).send({}).expect(200);
    // Future leave can still be withdrawn.
    const cancelled = await owner.agent.post(`/leave/requests/${own.body.id}/cancel`).set(H()).send({}).expect(200);
    expect(cancelled.body.status).toBe('cancelled');
    const pending = (await owner.agent.get('/leave/requests').query({ status: 'pending' }).set(H()).expect(200)).body as LeaveRequestDto[];
    expect(pending.map((p) => p.id)).toContain(mine.body.id);
    await member.agent.get('/leave/requests').set(H()).expect(403);
  });

  it('applies manual adjustments to the balance', async () => {
    await member.agent.post('/leave/adjustments').set(H()).send({ userId: member.user.id, leaveTypeId: casual.id, year: year(), days: 2, reason: 'Carried over' }).expect(403);
    const balances = await owner.agent
      .post('/leave/adjustments')
      .set(H())
      .send({ userId: member.user.id, leaveTypeId: casual.id, year: year(), days: 2, reason: 'Carried over' })
      .expect(201);
    expect(balances.body.find((b: { leaveType: { name: string } }) => b.leaveType.name === 'Casual')).toMatchObject({ adjustments: 2, available: 8.5 });
    await owner.agent.post('/leave/adjustments').set(H()).send({ userId: rival.user.id, leaveTypeId: casual.id, year: year(), days: 2, reason: 'x' }).expect(400);
  });
});

describe('attendance corrections', () => {
  let yesterday: string;

  beforeAll(async () => {
    // A real (offline-synced) check-in yesterday at 10:00 to be corrected.
    const at = zonedTime(addDays(today(), -1), 10 * 60, PK);
    const r = await member.agent.post('/attendance/events').set(H()).send({ type: 'check_in', occurredAt: at.toISOString() });
    if (r.status !== 200) {
      // Selfies are required by default in this workspace.
      await owner.agent.patch('/attendance/settings').set(H()).send({ requireSelfie: false }).expect(200);
      await member.agent.post('/attendance/events').set(H()).send({ type: 'check_in', occurredAt: at.toISOString() }).expect(200);
    }
    yesterday = addDays(today(), -1);
  });

  const times = (date: string, inAt = 9 * 60, outAt = 18 * 60) => ({ checkInAt: zonedTime(date, inAt, PK).toISOString(), checkOutAt: zonedTime(date, outAt, PK).toISOString() });

  it('replaces the day when approved, keeping the original in the audit log', async () => {
    const asked = await member.agent.post('/attendance/corrections').set(H()).send({ date: yesterday, ...times(yesterday), reason: 'Forgot to check in on time' }).expect(201);
    expect(asked.body).toMatchObject({ status: 'pending', requestedByName: 'member' });
    expect(await notificationTitles(manager.agent)).toContain(`member asked to correct ${yesterday}`);
    await member.agent.post('/attendance/corrections').set(H()).send({ date: yesterday, ...times(yesterday), reason: 'again' }).expect(409);
    await member.agent.post(`/attendance/corrections/${asked.body.id}/approve`).set(H()).send({}).expect(403);

    const done = (await manager.agent.post(`/attendance/corrections/${asked.body.id}/approve`).set(H()).send({ note: 'OK' }).expect(200)).body as CorrectionDto;
    expect(done.status).toBe('approved');
    const days = (await member.agent.get('/attendance/me').query({ month: yesterday.slice(0, 7) }).set(H())).body as AttendanceDayDto[];
    const day = days.find((d) => d.date === yesterday)!;
    expect(day.events.map((e) => [e.type, e.flags])).toEqual([
      ['check_in', ['corrected']],
      ['check_out', ['corrected']],
    ]);
    expect(day.checkInAt).toBe(times(yesterday).checkInAt.replace('.000', '.000'));
    expect(day.flags).toContain('corrected');

    const log = await withAdmin(async (db) =>
      (await db.query(`select metadata from audit_logs where workspace_id = $1 and action = 'attendance.corrected' order by created_at desc limit 1`, [ws])).rows[0].metadata,
    );
    expect(log.original).toEqual([expect.objectContaining({ type: 'check_in', occurredAt: zonedTime(yesterday, 10 * 60, PK).toISOString() })]);
    const voided = await withAdmin(async (db) => (await db.query('select count(*)::int as n from attendance_events where user_id = $1 and voided_at is not null', [member.user.id])).rows[0].n);
    expect(voided).toBe(1);
  });

  it('managers correct others directly; nobody approves their own (except the owner)', async () => {
    const d = addDays(today(), -2);
    const direct = await manager.agent.post('/attendance/corrections').set(H()).send({ date: d, ...times(d), reason: 'Card reader was down', userId: member.user.id }).expect(201);
    expect(direct.body.status).toBe('approved');
    await member.agent.post('/attendance/corrections').set(H()).send({ date: d, ...times(d), reason: 'x', userId: manager.user.id }).expect(403);
    const self = await manager.agent.post('/attendance/corrections').set(H()).send({ date: d, ...times(d), reason: 'Mine' }).expect(201);
    expect(self.body.status).toBe('pending');
    await manager.agent.post(`/attendance/corrections/${self.body.id}/approve`).set(H()).send({}).expect(403);
    const rejected = await owner.agent.post(`/attendance/corrections/${self.body.id}/reject`).set(H()).send({ note: 'No' }).expect(200);
    expect(rejected.body.status).toBe('rejected');
    const ownerSelf = await owner.agent.post('/attendance/corrections').set(H()).send({ date: d, ...times(d), reason: 'Owner day' }).expect(201);
    expect(ownerSelf.body.status).toBe('approved');
  });

  it('refuses future days and times outside the day', async () => {
    const tomorrow = addDays(today(), 1);
    await member.agent.post('/attendance/corrections').set(H()).send({ date: tomorrow, ...times(tomorrow), reason: 'x' }).expect(400);
    const d = addDays(today(), -3);
    await member.agent.post('/attendance/corrections').set(H()).send({ date: d, ...times(addDays(d, -2)), reason: 'x' }).expect(400);
    const mine = (await member.agent.get('/attendance/corrections').set(H()).expect(200)).body as CorrectionDto[];
    expect(mine.every((c) => c.user.id === member.user.id)).toBe(true);
  });
});

describe('timer and timesheets', () => {
  let taskA: string;
  let taskB: string;

  beforeAll(async () => {
    const p = await owner.agent.post('/projects').set(H()).send({ name: 'Client work' }).expect(201);
    taskA = (await owner.agent.post(`/projects/${p.body.id}/tasks`).set(H()).send({ title: 'Design' }).expect(201)).body.id;
    taskB = (await owner.agent.post(`/projects/${p.body.id}/tasks`).set(H()).send({ title: 'Build' }).expect(201)).body.id;
  });

  it('runs one timer at a time and logs it when stopped', async () => {
    const t = (await member.agent.post(`/tasks/${taskA}/timer/start`).set(H()).expect(200)).body as TimerDto;
    expect(t).toMatchObject({ taskId: taskA, taskTitle: 'Design', projectName: 'Client work' });
    // Pretend it has been running for 90 minutes.
    await withAdmin((db) => db.query(`update task_timers set started_at = now() - interval '90 minutes' where user_id = $1`, [member.user.id]));
    const switched = (await member.agent.post(`/tasks/${taskB}/timer/start`).set(H()).expect(200)).body as TimerDto;
    expect(switched.taskId).toBe(taskB);
    const stopped = await member.agent.post('/timer/stop').set(H()).expect(200);
    expect(stopped.body).toEqual({ loggedMinutes: 0, taskId: taskB }); // under a minute: not logged
    expect((await member.agent.get('/timer').set(H()).expect(200)).body).toEqual({});

    const sheet = (await member.agent.get('/timesheets/me').set(H()).expect(200)).body as TimesheetDto;
    expect(sheet).toMatchObject({ status: 'draft', fromTimer: 90, total: 90 });
    expect(sheet.rows.find((r) => r.taskId === taskA)!.total).toBe(90);
  });

  it('needs a reason for time typed in for an earlier day', async () => {
    await member.agent.post(`/tasks/${taskA}/time`).set(H()).send({ minutes: 30 }).expect(201);
    const earlier = addDays(today(), -1);
    const res = await member.agent.post(`/tasks/${taskA}/time`).set(H()).send({ minutes: 15, workDate: earlier }).expect(400);
    expect(res.body.errors[0].path).toBe('note');
    await member.agent.post(`/tasks/${taskA}/time`).set(H()).send({ minutes: 15, workDate: earlier, note: 'Client call' }).expect(201);
    await member.agent.post(`/tasks/${taskA}/time`).set(H()).send({ minutes: 15, workDate: addDays(today(), 1), note: 'x' }).expect(400);
  });

  it('submits, locks, sends back and approves a week', async () => {
    const week = weekStart(today());
    await member.agent.post(`/tasks/${taskB}/timer/start`).set(H()).expect(200);
    await member.agent.post('/timesheets/submit').set(H()).send({ weekStart: week }).expect(409); // timer still running
    await member.agent.post('/timer/stop').set(H()).expect(200);

    const submitted = (await member.agent.post('/timesheets/submit').set(H()).send({ weekStart: week }).expect(200)).body as TimesheetDto;
    expect(submitted.status).toBe('submitted');
    expect(submitted.manual).toBeGreaterThanOrEqual(30);
    expect(await notificationTitles(manager.agent)).toEqual(expect.arrayContaining([expect.stringMatching(/^member submitted a timesheet/)]));

    // Locked: no new time, no deletions.
    await member.agent.post(`/tasks/${taskA}/time`).set(H()).send({ minutes: 10 }).expect(409);
    const entryId = await withAdmin(async (db) => (await db.query('select id from time_entries where user_id = $1 and source = $2 limit 1', [member.user.id, 'manual'])).rows[0].id);
    await member.agent.delete(`/tasks/${taskA}/time/${entryId}`).set(H()).expect(409);
    await member.agent.post('/timesheets/submit').set(H()).send({ weekStart: week }).expect(409);

    const list = (await manager.agent.get('/timesheets').query({ week }).set(H()).expect(200)).body as TimesheetSummaryDto[];
    const mine = list.find((s) => s.user.id === member.user.id)!;
    expect(mine).toMatchObject({ status: 'submitted' });
    expect(list.find((s) => s.user.id === owner.user.id)!.status).toBe('draft');
    await member.agent.get('/timesheets').set(H()).expect(403);

    const back = await manager.agent.post(`/timesheets/${mine.timesheetId}/reject`).set(H()).send({ note: 'Split the client call' }).expect(200);
    expect(back.body).toMatchObject({ status: 'rejected', decisionNote: 'Split the client call' });
    await member.agent.post(`/tasks/${taskA}/time`).set(H()).send({ minutes: 10 }).expect(201); // open again

    await member.agent.post('/timesheets/submit').set(H()).send({ weekStart: week }).expect(200);
    await member.agent.post(`/timesheets/${mine.timesheetId}/approve`).set(H()).send({}).expect(403);
    const ok = await manager.agent.post(`/timesheets/${mine.timesheetId}/approve`).set(H()).send({}).expect(200);
    expect(ok.body.status).toBe('approved');
    await member.agent.post(`/tasks/${taskA}/time`).set(H()).send({ minutes: 10 }).expect(409);
    // A timer stopped into an approved week doesn't sneak time in either.
    await member.agent.post(`/tasks/${taskA}/timer/start`).set(H()).expect(200);
    await withAdmin((db) => db.query(`update task_timers set started_at = now() - interval '20 minutes' where user_id = $1`, [member.user.id]));
    const refused = await member.agent.post('/timer/stop').set(H()).expect(409);
    expect(refused.body.message).toMatch(/stopped without logging/);
    expect((await member.agent.get('/timer').set(H()).expect(200)).body).toEqual({}); // not stuck running
  });

  it('refuses an empty week, and managers can’t approve their own', async () => {
    await member.agent.post('/timesheets/submit').set(H()).send({ weekStart: addDays(weekStart(today()), -28) }).expect(400);
    await manager.agent.post(`/tasks/${taskA}/time`).set(H()).send({ minutes: 45 }).expect(201);
    const sheet = (await manager.agent.post('/timesheets/submit').set(H()).send({ weekStart: weekStart(today()) }).expect(200)).body as TimesheetDto;
    await manager.agent.post(`/timesheets/${sheet.id}/approve`).set(H()).send({}).expect(403);
  });
});

describe('monthly export', () => {
  it('gives managers an Excel file and a CSV for payroll', async () => {
    const month = pastMonday().slice(0, 7);
    await member.agent.get('/attendance/export').query({ month }).set(H()).expect(403);
    await manager.agent.get('/attendance/export').query({ month: '2026-13' }).set(H()).expect(400);

    const xlsx = await manager.agent
      .get('/attendance/export')
      .query({ month })
      .set(H())
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(xlsx.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(xlsx.headers['content-disposition']).toBe(`attachment; filename="attendance-${month}.xlsx"`);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK'); // a zip, as .xlsx files are

    const csv = await manager.agent.get('/attendance/export').query({ month, format: 'csv' }).set(H()).expect(200);
    expect(csv.text.charCodeAt(0)).toBe(0xfeff);
    const [header, ...rows] = csv.text.slice(1).trim().split('\r\n');
    expect(header!.split(',')).toEqual(expect.arrayContaining(['Employee', 'Paid leave', 'Unpaid leave', 'Payable days']));
    const memberRow = rows.find((r) => r.startsWith('member,'))!.split(',');
    const col = (name: string) => Number(memberRow[header!.split(',').indexOf(name)]);
    expect(col('Paid leave')).toBeGreaterThanOrEqual(3); // the approved casual leave
    expect(col('Payable days')).toBeLessThanOrEqual(col('Days counted'));
    expect(rows.some((r) => r.startsWith('rival,'))).toBe(false);
  });
});

describe('RLS on the new tables', () => {
  it('keeps one workspace’s leave and timesheets away from another', async () => {
    const rivalCal = (await rival.agent.get('/leave/calendar').set(WORKSPACE_HEADER, rival.workspace.id).expect(200)).body as LeaveCalendarDto;
    expect(rivalCal.people.map((p) => p.userId)).toEqual([rival.user.id]);
    expect(rivalCal.people[0]!.entries).toEqual([]);
    const someRequest = await withAdmin(async (db) => (await db.query('select id from leave_requests where workspace_id = $1 limit 1', [ws])).rows[0].id);
    await rival.agent.post(`/leave/requests/${someRequest}/approve`).set(WORKSPACE_HEADER, rival.workspace.id).send({}).expect(404);
  });
});

