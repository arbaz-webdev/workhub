'use client';

import { hasRole, PLAN_INFO, type DashboardDto, type OnboardingDto, type Presence, type SubscriptionDto } from '@workhub/shared';
import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PRESENCE_LABELS } from '@/components/inbox/bits';
import { AnimatedNumber } from '@/components/motion';
import { amounts } from '@/components/reports/shared';
import { PageHeader, Skeleton } from '@/components/ui';
import { useInboxEvents } from '@/lib/inbox';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

const STEPS = [
  { href: '/app/people#invite', title: 'Invite your team', body: 'Send email invites or share a join link.', minRole: 'admin' as const },
  { href: '/app/teams', title: 'Create teams', body: 'Group people by department, e.g. Design, Sales, Support.', minRole: 'manager' as const },
  { href: '/app/settings', title: 'Check your settings', body: 'Time zone, currency and working days.', minRole: 'admin' as const },
];

const PRESENCE_ORDER: Presence[] = ['in', 'break', 'out', 'leave', 'away'];
const PRESENCE_COLOR: Record<Presence, string> = { in: 'bg-ink', break: 'bg-amber-400', out: 'bg-ink/25', leave: 'bg-violet-400', away: 'bg-white/70' };

/** The round arrow in a card's corner; turns lime when the card is hovered. */
function Arrow() {
  return (
    <span
      aria-hidden="true"
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gray-100 text-gray-600 transition duration-300 group-hover:rotate-45 group-hover:bg-lime group-hover:text-ink"
    >
      <ArrowUpRight size={16} strokeWidth={1.75} />
    </span>
  );
}

function Stat({ label, value, href, alert, suffix }: { label: string; value: number | string; href: string; alert?: string; suffix?: string }) {
  // Money in two currencies is long: smaller, and allowed to wrap.
  const long = typeof value === 'string' && value.length > 12;
  return (
    <Link href={href} className="group lift flex min-h-36 flex-col rounded-3xl bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-gray-600">{label}</p>
        <Arrow />
      </div>
      <p className={`mt-auto break-words pt-4 font-light tracking-tight text-ink ${long ? 'text-xl leading-snug' : 'text-[40px] leading-none'}`}>
        {typeof value === 'number' ? <AnimatedNumber value={value} decimals={Number.isInteger(value) ? 0 : 1} /> : value}
        {suffix && <span className="ml-1 text-lg text-gray-400">{suffix}</span>}
      </p>
      {alert && (
        <span className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-red-500" />
          {alert}
        </span>
      )}
    </Link>
  );
}

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between px-1">
      <h2 className="text-lg font-normal tracking-tight">{children}</h2>
      {action}
    </div>
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
  const present = team ? team.attendance.in + team.attendance.break : 0;
  const maxHours = team ? Math.max(1, ...team.hoursThisWeekByClient.map((c) => c.hours)) : 1;
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <PageHeader title={`${greeting()}, ${me.user.name.split(' ')[0]}`} description={`${workspace.name} · ${today}`} />
      {plan && <PlanBanner plan={plan} />}

      {!data ? (
        <div role="status" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <span className="sr-only">Loading your dashboard…</span>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="min-h-36 rounded-3xl bg-white p-5 shadow-sm">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="mt-12 h-9 w-1/3" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-10">
          <section aria-label="Your day">
            <SectionTitle>Your day</SectionTitle>
            <div className="stagger grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat label="Tasks due today" value={data.me.tasksDueToday} href="/app/my-work" />
              <Stat label="Overdue tasks" value={data.me.tasksOverdue} href="/app/my-work" alert={data.me.tasksOverdue ? 'Needs attention' : undefined} />
              {staff && <Stat label="Follow-ups due" value={data.me.followUpsDue} href="/app/crm/follow-ups" alert={data.me.followUpsDue ? 'Due now' : undefined} />}
              {staff && <Stat label="Hours this week" value={data.me.hoursThisWeek} suffix="h" href="/app/timesheets" />}
            </div>
            {data.me.myOverdue.length > 0 && (
              <ul className="mt-4 divide-y divide-gray-100 rounded-3xl bg-white px-5 shadow-sm">
                {data.me.myOverdue.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-x-3 py-3 text-sm">
                    <Link href={`/app/projects/${t.projectId}?task=${t.id}`} className="font-medium text-ink hover:underline">
                      {t.title}
                    </Link>
                    <span className="text-gray-500">{t.projectName}</span>
                    <span className="ml-auto rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">
                      Due {new Date(`${t.dueDate}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {team && (
            <section aria-label="Your team today">
              <SectionTitle>Your team today</SectionTitle>
              <div className="stagger grid gap-4 lg:grid-cols-3">
                {/* The day's headline: who is in, on lime like the reference's featured card. */}
                <Link href="/app/attendance/team" className="group lift flex flex-col rounded-3xl bg-lime p-6 text-ink shadow-sm">
                  <div className="flex items-start justify-between">
                    <p className="text-sm font-medium">Attendance today</p>
                    <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-full bg-ink text-lime transition duration-300 group-hover:rotate-45">
                      <ArrowUpRight size={16} strokeWidth={1.75} />
                    </span>
                  </div>
                  <p className="mt-6 text-[56px] font-light leading-none tracking-tight">
                    <AnimatedNumber value={present} />
                    <span className="ml-2 text-xl text-ink/60">of {total} in</span>
                  </p>
                  <div className="mt-6 flex h-2.5 gap-1" aria-hidden="true">
                    {PRESENCE_ORDER.map((p) =>
                      team.attendance[p] ? (
                        <div key={p} className={`animate-grow-x origin-left rounded-full ${PRESENCE_COLOR[p]}`} style={{ width: `${(team.attendance[p] / Math.max(total, 1)) * 100}%` }} />
                      ) : null,
                    )}
                  </div>
                  <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/75">
                    {PRESENCE_ORDER.filter((p) => team.attendance[p] > 0).map((p) => (
                      <li key={p} className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${PRESENCE_COLOR[p]} ${p === 'away' ? 'ring-1 ring-ink/30' : ''}`} />
                        {PRESENCE_LABELS[p]}: {team.attendance[p]}
                      </li>
                    ))}
                  </ul>
                </Link>
                <div className="grid grid-cols-2 gap-4 lg:col-span-2">
                  <Stat label="Active projects" value={team.activeProjects} href="/app/projects" />
                  <Stat label="Overdue tasks, all projects" value={team.overdueTasks} href="/app/projects" alert={team.overdueTasks ? 'Needs attention' : undefined} />
                  <Stat label="Open pipeline" value={amounts(team.openPipeline)} href="/app/crm/deals" />
                  <Stat label="Overdue follow-ups" value={team.followUpsOverdue} href="/app/crm/follow-ups" alert={team.followUpsOverdue ? 'Needs attention' : undefined} />
                </div>
              </div>

              <div className="mt-4 rounded-3xl bg-white p-6 shadow-sm">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <h3 className="text-lg font-normal tracking-tight">Hours this week by client</h3>
                  <Link href="/app/reports" className="group flex items-center gap-2 rounded-full bg-gray-100 py-1.5 pl-4 pr-1.5 text-sm transition hover:bg-gray-200">
                    Reports
                    <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full bg-white transition group-hover:bg-lime">
                      <ArrowUpRight size={14} strokeWidth={1.75} />
                    </span>
                  </Link>
                </div>
                {team.hoursThisWeekByClient.length === 0 ? (
                  <p className="text-sm text-gray-500">No time logged yet this week.</p>
                ) : (
                  <ul className="space-y-3">
                    {team.hoursThisWeekByClient.map((c, i) => (
                      <li key={c.client?.id ?? 'none'} className="grid grid-cols-[minmax(6rem,11rem)_1fr_auto] items-center gap-4 text-sm">
                        <span className="truncate text-gray-700">{c.client?.name ?? 'Internal'}</span>
                        <span className="h-7 overflow-hidden rounded-full bg-gray-50">
                          <span
                            className={`block h-full origin-left animate-grow-x rounded-full ${i === 0 ? 'bg-lime' : 'hatch'}`}
                            style={{ width: `${Math.max(4, (c.hours / maxHours) * 100)}%`, animationDelay: `${i * 80}ms` }}
                          />
                        </span>
                        <span className="w-16 text-right text-base font-light tabular-nums">{c.hours} h</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          {steps.length > 0 && (
            <section aria-label="Getting started">
              <SectionTitle>Getting started</SectionTitle>
              <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {steps.map((s, i) => (
                  <Link key={s.href} href={s.href} className="group lift flex flex-col rounded-3xl bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between">
                      <span className="grid h-9 w-9 place-items-center rounded-full bg-gray-100 text-sm font-medium tabular-nums">{i + 1}</span>
                      <Arrow />
                    </div>
                    <p className="mt-6 font-medium">{s.title}</p>
                    <p className="mt-1 text-sm text-gray-500">{s.body}</p>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      <p className="mt-10 text-center text-sm text-gray-500">
        Tip: press <kbd className="rounded-full bg-white px-2 py-0.5 font-sans text-xs shadow-sm">Ctrl K</kbd> anywhere to jump to a page or person.
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
    <div role="status" className="mb-6 flex flex-wrap items-center gap-3 rounded-3xl bg-amber-50 px-5 py-4 text-sm text-amber-900">
      <span className="flex-1">{text}</span>
      <Link href="/app/settings/billing" className="rounded-full bg-amber-900 px-4 py-1.5 font-medium text-white transition hover:bg-amber-950">
        Plans and billing
      </Link>
    </div>
  );
}
