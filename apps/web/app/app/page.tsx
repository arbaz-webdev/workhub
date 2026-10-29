'use client';

import { hasRole, PLAN_INFO, type DashboardDto, type OnboardingDto, type Presence, type SubscriptionDto } from '@workhub/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PRESENCE_LABELS } from '@/components/inbox/bits';
import { amounts } from '@/components/reports/shared';
import { PageHeader } from '@/components/ui';
import { useInboxEvents } from '@/lib/inbox';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

const STEPS = [
  { href: '/app/people#invite', title: 'Invite your team', body: 'Send email invites or share a join link.', minRole: 'admin' as const },
  { href: '/app/teams', title: 'Create teams', body: 'Group people by department, e.g. Design, Sales, Support.', minRole: 'manager' as const },
  { href: '/app/settings', title: 'Check your settings', body: 'Time zone, currency and working days.', minRole: 'admin' as const },
];

const PRESENCE_ORDER: Presence[] = ['in', 'break', 'out', 'leave', 'away'];
const PRESENCE_COLOR: Record<Presence, string> = { in: 'bg-emerald-500', break: 'bg-amber-400', out: 'bg-gray-300', leave: 'bg-violet-400', away: 'bg-gray-100' };

function Tile({ label, value, href, tone, hint }: { label: string; value: string | number; href?: string; tone?: 'bad'; hint?: string }) {
  const body = (
    <>
      <p className="text-xs text-gray-500">{label}</p>
      {/* Money in two currencies is long: smaller, and allowed to wrap. */}
      <p className={`mt-0.5 break-words font-semibold ${String(value).length > 10 ? 'text-lg leading-snug' : 'text-2xl'} ${tone === 'bad' ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
      {hint && <p className="truncate text-xs text-gray-500">{hint}</p>}
    </>
  );
  const cls = 'block rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm';
  return href ? (
    <Link href={href} className={`${cls} hover:border-brand-500`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

export default function Home() {
  const { me, workspace } = useWorkspace();
  const api = useWorkspaceApi();
  const [data, setData] = useState<DashboardDto>();
  const steps = STEPS.filter((s) => hasRole(workspace.role, s.minRole));
  const staff = hasRole(workspace.role, 'member');
  const admin = hasRole(workspace.role, 'admin');
  const router = useRouter();
  const [plan, setPlan] = useState<SubscriptionDto>();

  // A client's contact starts on their portal.
  useEffect(() => {
    if (workspace.role === 'guest' && workspace.clientCompanyId) router.replace('/app/portal');
  }, [workspace.role, workspace.clientCompanyId, router]);

  // A new workspace starts in the setup wizard; and admins hear about their plan here.
  useEffect(() => {
    if (!admin) return;
    api<OnboardingDto>('/onboarding')
      .then((o) => !o.done && router.replace('/app/onboarding'))
      .catch(() => {});
    api<SubscriptionDto>('/billing/subscription')
      .then(setPlan)
      .catch(() => {});
  }, [api, admin, router]);

  useEffect(() => {
    api<DashboardDto>('/dashboard')
      .then(setData)
      .catch(() => {});
  }, [api]);

  // Keep "who's in" current as people check in and out.
  useInboxEvents((s) => {
    if (s.type !== 'presence.changed' || !data?.team) return;
    api<DashboardDto>('/dashboard')
      .then(setData)
      .catch(() => {});
  });

  const team = data?.team;
  const total = team ? PRESENCE_ORDER.reduce((n, p) => n + team.attendance[p], 0) : 0;
  const maxHours = team ? Math.max(1, ...team.hoursThisWeekByClient.map((c) => c.hours)) : 1;

  return (
    <>
      <PageHeader title={`${greeting()}, ${me.user.name.split(' ')[0]}`} description={workspace.name} />
      {plan && <PlanBanner plan={plan} />}

      {data && (
        <div className="space-y-6">
          <section aria-label="Your day">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Your day</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile label="Tasks due today" value={data.me.tasksDueToday} href="/app/my-work" />
              <Tile label="Overdue tasks" value={data.me.tasksOverdue} href="/app/my-work" tone={data.me.tasksOverdue ? 'bad' : undefined} />
              {staff && <Tile label="Follow-ups due" value={data.me.followUpsDue} href="/app/crm/follow-ups" tone={data.me.followUpsDue ? 'bad' : undefined} />}
              {staff && <Tile label="Hours this week" value={`${data.me.hoursThisWeek} h`} href="/app/timesheets" />}
            </div>
            {data.me.myOverdue.length > 0 && (
              <ul className="mt-3 divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white px-4">
                {data.me.myOverdue.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-x-3 py-2 text-sm">
                    <Link href={`/app/projects/${t.projectId}?task=${t.id}`} className="font-medium text-gray-900 hover:underline">
                      {t.title}
                    </Link>
                    <span className="text-gray-500">{t.projectName}</span>
                    <span className="ms-auto text-xs font-medium text-red-600">Due {new Date(`${t.dueDate}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {team && (
            <section aria-label="Your team today">
              <h2 className="mb-3 text-sm font-semibold text-gray-700">Your team today</h2>
              <div className="grid gap-3 lg:grid-cols-3">
                <Link href="/app/attendance/team" className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm hover:border-brand-500 lg:col-span-1">
                  <p className="text-xs text-gray-500">Attendance</p>
                  <p className="mt-0.5 text-2xl font-semibold text-gray-900">
                    {team.attendance.in + team.attendance.break} <span className="text-base font-normal text-gray-500">of {total} in</span>
                  </p>
                  <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                    {PRESENCE_ORDER.map((p) => (team.attendance[p] ? <div key={p} className={PRESENCE_COLOR[p]} style={{ width: `${(team.attendance[p] / Math.max(total, 1)) * 100}%` }} /> : null))}
                  </div>
                  <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
                    {PRESENCE_ORDER.filter((p) => team.attendance[p] > 0).map((p) => (
                      <li key={p} className="flex items-center gap-1">
                        <span className={`h-2 w-2 rounded-full ${p === 'away' ? 'border border-gray-300 bg-white' : PRESENCE_COLOR[p]}`} />
                        {PRESENCE_LABELS[p]}: {team.attendance[p]}
                      </li>
                    ))}
                  </ul>
                </Link>
                <div className="grid grid-cols-2 gap-3 lg:col-span-2">
                  <Tile label="Active projects" value={team.activeProjects} href="/app/projects" />
                  <Tile label="Overdue tasks (all projects)" value={team.overdueTasks} tone={team.overdueTasks ? 'bad' : undefined} href="/app/projects" />
                  <Tile label="Open pipeline" value={amounts(team.openPipeline)} href="/app/crm/deals" />
                  <Tile label="Overdue follow-ups" value={team.followUpsOverdue} tone={team.followUpsOverdue ? 'bad' : undefined} href="/app/crm/follow-ups" />
                </div>
              </div>

              <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Hours this week by client</h3>
                  <Link href="/app/reports" className="text-sm text-brand-700 hover:underline">
                    Reports
                  </Link>
                </div>
                {team.hoursThisWeekByClient.length === 0 ? (
                  <p className="text-sm text-gray-500">No time logged yet this week.</p>
                ) : (
                  <ul className="space-y-2">
                    {team.hoursThisWeekByClient.map((c) => (
                      <li key={c.client?.id ?? 'none'} className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-3 text-sm">
                        <span className="truncate">{c.client?.name ?? 'Internal'}</span>
                        <span className="h-2 rounded-full bg-gray-100">
                          <span className="block h-full rounded-full bg-brand-500" style={{ width: `${(c.hours / maxHours) * 100}%` }} />
                        </span>
                        <span className="w-14 text-end tabular-nums text-gray-700">{c.hours} h</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          {steps.length > 0 && (
            <section aria-label="Getting started">
              <h2 className="mb-3 text-sm font-semibold text-gray-700">Getting started</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {steps.map((s) => (
                  <Link key={s.href} href={s.href} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-brand-500">
                    <p className="font-semibold">{s.title}</p>
                    <p className="mt-1 text-sm text-gray-500">{s.body}</p>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      <p className="mt-8 text-sm text-gray-500">
        Tip: press <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 text-xs">Ctrl K</kbd> anywhere to jump to a page or person.
      </p>
    </>
  );
}

/** For admins: a trial running out, a lapsed plan, or a full Free plan. */
function PlanBanner({ plan }: { plan: SubscriptionDto }) {
  if (!plan.enforced) return null;
  const days = plan.trialEndsAt ? Math.ceil((new Date(plan.trialEndsAt).getTime() - Date.now()) / 86_400_000) : 0;
  let text: string | null = null;
  if (plan.status === 'trial' && days <= 7) text = `Your free trial ends in ${days} day${days === 1 ? '' : 's'}. Choose a plan to keep client profitability, custom fields and more.`;
  else if (plan.status === 'grace') text = `Your ${PLAN_INFO[plan.plan].name} plan has ended. Renew in the next few days to keep it.`;
  else if (plan.seatLimit !== null && plan.seatsUsed >= plan.seatLimit) text = `You’ve reached the Free plan’s ${plan.seatLimit} people. Upgrade to add more.`;
  if (!text) return null;
  return (
    <div role="status" className="mb-6 flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <span className="flex-1">{text}</span>
      <Link href="/app/settings/billing" className="font-semibold underline">
        Plans and billing
      </Link>
    </div>
  );
}
