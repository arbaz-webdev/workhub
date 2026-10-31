import type { Metadata } from 'next';
import { FOUNDING_DISCOUNT, PLAN_INFO, type PlanKey } from '@workhub/shared';
import { ArrowUpRight, ChartPie, Clock, FolderKanban, Handshake, MessagesSquare, Plus } from 'lucide-react';
import Link from 'next/link';
import { BetaForm } from '@/components/landing/beta-form';
import { PLAN_HIGHLIGHTS } from '@/components/landing/plans';
import { SiteFooter, SiteHeader } from '@/components/landing/site';

export const metadata: Metadata = {
  title: 'WorkHub: attendance, projects, clients and team chat in one place',
  description:
    'One workspace for remote and hybrid teams in Pakistan. See who is working, on what, and which clients make you money. Priced in rupees. Join the free beta.',
};

const PROFIT_ROWS = [
  { client: 'Northwind (US)', hours: 312, margin: 46 },
  { client: 'Bluefin Retail', hours: 188, margin: 31 },
  { client: 'Atlas Logistics', hours: 240, margin: 12 },
  { client: 'Crescent Foods', hours: 96, margin: -8 },
];

const WEEK = [
  { day: 'Mon', hours: 62 },
  { day: 'Tue', hours: 71 },
  { day: 'Wed', hours: 58 },
  { day: 'Thu', hours: 80 },
  { day: 'Fri', hours: 66 },
  { day: 'Sat', hours: 24 },
];

const MODULES = [
  {
    icon: Clock,
    title: 'Time & attendance',
    body: 'One-tap check-in with a selfie, GPS or office-IP rules, night shifts that cross midnight, leave and timesheets.',
  },
  {
    icon: FolderKanban,
    title: 'Project boards',
    body: 'Kanban boards as easy as Trello. Every project belongs to a client, and every card shows estimate vs actual hours.',
  },
  {
    icon: Handshake,
    title: 'CRM',
    body: 'Leads from Upwork, LinkedIn, WhatsApp and referrals in one pipeline. A won deal becomes a project in one click.',
  },
  {
    icon: MessagesSquare,
    title: 'Team chat',
    body: 'Channels, direct messages and announcements, linked to your tasks and clients instead of lost in WhatsApp groups.',
  },
];

const LOCAL = [
  'Billed in PKR with sales tax invoices; no dollar card needed',
  'Night shifts for US clients count as one workday',
  'Pakistani public holidays built in',
  'Works on slow internet; check-ins sync when you are back online',
  'Support on WhatsApp from people in your time zone',
];

const PLANS: PlanKey[] = ['free', 'starter', 'business'];

const FAQ = [
  {
    q: 'When can I use it?',
    a: 'The free beta opens in February 2027 for everyone on the list. Paid plans start in May 2027, and beta teams keep 40% off for life.',
  },
  {
    q: 'Is my company’s data safe?',
    a: 'Each company’s data is kept separate at the database level, every connection is encrypted, passwords are stored with Argon2id, and you can export all of your data at any time.',
  },
  {
    q: 'Do you spy on employees?',
    a: 'No. Activity tracking comes later, is off by default, needs each employee’s consent, only runs during work hours, and employees can see everything recorded about them. We never log keystrokes.',
  },
  {
    q: 'Can I pay in rupees?',
    a: 'Yes. Prices are in PKR, with sales tax invoices. Pay by bank transfer, or by card, JazzCash or Easypaisa once paid plans open. No dollar card needed.',
  },
];

const TAGS = ['Attendance', 'Projects', 'CRM', 'Team chat', 'Reports', 'Payroll export'];

/** A small round arrow, as on the reference's cards. */
function ArrowDot({ dark = false }: { dark?: boolean }) {
  return (
    <span aria-hidden="true" className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${dark ? 'bg-ink text-lime' : 'bg-gray-100 text-gray-600'}`}>
      <ArrowUpRight size={16} strokeWidth={1.75} />
    </span>
  );
}

/** The hero picture: a few WorkHub cards inside a dark device frame. Example data only. */
function DashboardMock() {
  const maxWeek = Math.max(...WEEK.map((d) => d.hours));
  return (
    <div className="relative mx-auto max-w-5xl text-left" aria-label="Example WorkHub dashboard with sample data" role="img">
      <div className="rounded-[2.25rem] bg-ink p-2.5 shadow-lg sm:p-3">
        <div className="overflow-hidden rounded-[1.75rem] bg-canvas p-4 sm:p-6">
          {/* App bar */}
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-[30%] bg-ink text-xs font-semibold text-lime">W</span>
            <span className="rounded-full bg-ink px-3 py-1.5 text-[11px] font-medium text-white">Dashboard</span>
            <span className="hidden rounded-full bg-white px-3 py-1.5 text-[11px] text-gray-600 sm:inline">Projects</span>
            <span className="hidden rounded-full bg-white px-3 py-1.5 text-[11px] text-gray-600 sm:inline">CRM</span>
            <span className="hidden rounded-full bg-white px-3 py-1.5 text-[11px] text-gray-600 md:inline">Reports</span>
            <span className="ml-auto flex -space-x-2">
              {['AK', 'SR', 'HM'].map((i, n) => (
                <span key={i} className={`grid h-7 w-7 place-items-center rounded-full text-[10px] font-semibold ring-2 ring-canvas ${n === 0 ? 'bg-lime text-ink' : 'bg-white text-gray-700'}`}>
                  {i}
                </span>
              ))}
            </span>
          </div>
          <p className="mt-5 text-2xl font-light tracking-tight text-ink sm:text-3xl">Agency performance</p>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {/* Attendance */}
            <div className="flex flex-col rounded-3xl bg-lime p-4 text-ink">
              <div className="flex items-start justify-between">
                <p className="text-xs font-medium">In today</p>
                <ArrowDot dark />
              </div>
              <p className="mt-6 text-5xl font-light leading-none tracking-tight">
                18<span className="ml-1 text-base text-ink/60">of 22</span>
              </p>
              <div className="mt-4 flex h-2 gap-1">
                <span className="w-[72%] rounded-full bg-ink" />
                <span className="w-[10%] rounded-full bg-amber-400" />
                <span className="w-[18%] rounded-full bg-ink/25" />
              </div>
            </div>

            {/* Hours this week */}
            <div className="rounded-3xl bg-white p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-gray-500">Hours this week</p>
                  <p className="mt-1 text-3xl font-light tracking-tight">361</p>
                </div>
                <ArrowDot />
              </div>
              <div className="mt-3 flex h-24 items-end gap-1.5">
                {WEEK.map((d) => (
                  <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                    <span
                      className={`w-full origin-bottom animate-grow-y rounded-xl ${d.day === 'Thu' ? 'bg-lime' : 'hatch'}`}
                      style={{ height: `${(d.hours / maxWeek) * 72}px` }}
                    />
                    <span className="text-[9px] text-gray-400">{d.day}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Profitability */}
            <div className="rounded-3xl bg-white p-4">
              <div className="flex items-start justify-between">
                <p className="text-xs text-gray-500">Margin by client</p>
                <ArrowDot />
              </div>
              <ul className="mt-3 space-y-2.5">
                {PROFIT_ROWS.map((r) => (
                  <li key={r.client} className="text-[11px]">
                    <div className="flex justify-between">
                      <span className="truncate text-gray-700">{r.client}</span>
                      <span className={`tabular-nums ${r.margin < 0 ? 'font-semibold text-red-600' : 'text-gray-700'}`}>{r.margin}%</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
                      <div className={`h-full origin-left animate-grow-x rounded-full ${r.margin >= 0 ? 'bg-ink' : 'bg-red-500'}`} style={{ width: `${Math.min(100, Math.abs(r.margin) * 2)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Floating notes over the frame */}
      <div className="float absolute -left-3 -top-7 hidden rounded-2xl bg-white px-4 py-3 shadow-lg md:block lg:-left-8">
        <p className="text-[11px] text-gray-500">Deal won</p>
        <p className="text-sm font-medium">Northwind ERP · USD 12,000</p>
      </div>
      <div className="float absolute -bottom-7 -right-3 hidden rounded-2xl bg-white px-4 py-3 shadow-lg [animation-delay:-3s] md:block lg:-right-8">
        <p className="text-[11px] text-red-600">Losing money</p>
        <p className="text-sm font-medium">Crescent Foods · −8% margin</p>
      </div>
    </div>
  );
}

export default function Landing() {
  return (
    <div>
      <SiteHeader />

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-14 text-center md:pt-20">
          <p className="mx-auto inline-flex animate-rise items-center gap-2 rounded-full bg-white px-4 py-1.5 text-sm text-gray-600 shadow-sm">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-lime ring-4 ring-lime/30" />
            For remote and hybrid teams in Pakistan
          </p>
          <h1 className="mx-auto mt-6 max-w-4xl animate-rise text-[2.6rem] font-light leading-[1.05] tracking-tight text-ink [animation-delay:80ms] sm:text-6xl md:text-7xl">
            Know who&apos;s working, on what, and which clients make you{' '}
            <span className="relative inline-block rounded-full bg-lime px-4 pb-1 font-normal">money.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl animate-rise text-lg text-gray-600 [animation-delay:160ms]">
            WorkHub puts attendance, project boards, clients and team chat in one workspace. Every hour your team works rolls up to a client, so profit per
            client is on one screen.
          </p>
          <div className="mt-8 flex animate-rise flex-wrap justify-center gap-3 [animation-delay:240ms]">
            <a href="#beta" className="group inline-flex items-center gap-3 rounded-full bg-ink py-2 pl-6 pr-2 text-sm font-medium text-white shadow-md transition hover:bg-black active:scale-[0.97]">
              Join the free beta
              <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-full bg-lime text-ink transition duration-300 group-hover:rotate-45">
                <ArrowUpRight size={16} strokeWidth={2} />
              </span>
            </a>
            <a href="#features" className="inline-flex items-center rounded-full bg-white px-6 py-3 text-sm font-medium text-ink shadow-sm transition hover:shadow-md active:scale-[0.97]">
              See what&apos;s inside
            </a>
          </div>
          <p className="mt-4 animate-rise text-sm text-gray-500 [animation-delay:300ms]">Free for teams up to 10. Priced in rupees.</p>
          <ul className="mx-auto mt-8 flex max-w-2xl animate-rise flex-wrap justify-center gap-2 [animation-delay:360ms]" aria-label="What's included">
            {TAGS.map((t) => (
              <li key={t} className="rounded-full bg-white/70 px-4 py-1.5 text-xs text-gray-600">
                {t}
              </li>
            ))}
          </ul>
          <div className="mt-14 animate-rise [animation-delay:420ms]">
            <DashboardMock />
          </div>
        </section>

        {/* In numbers */}
        <section className="reveal mx-auto grid max-w-6xl gap-4 px-4 py-10 sm:grid-cols-3">
          {[
            { n: '4', label: 'tools in one workspace' },
            { n: '10', label: 'people free, for good' },
            { n: `${FOUNDING_DISCOUNT.percent}%`, label: 'off for life for beta teams' },
          ].map((s) => (
            <div key={s.label} className="rounded-3xl bg-white p-6 shadow-sm">
              <p className="text-6xl font-light tracking-tight text-ink">{s.n}</p>
              <p className="mt-2 text-gray-500">{s.label}</p>
            </div>
          ))}
        </section>

        {/* Replace the tool pile */}
        <section className="reveal mx-auto max-w-6xl px-4 py-10">
          <div className="grid items-center gap-6 rounded-[2rem] bg-white p-8 shadow-sm md:grid-cols-[1fr_2fr] md:p-12">
            <p className="text-sm font-medium uppercase tracking-wide text-gray-400">Replace the tool pile</p>
            <p className="text-2xl font-light leading-snug tracking-tight text-ink md:text-3xl">
              Trello + HubSpot + Slack + Hubstaff + an attendance spreadsheet, billed in dollars on five cards.{' '}
              <span className="rounded-lg bg-lime-pale px-1.5">One WorkHub bill in PKR, at a fraction of the cost.</span>
            </p>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16">
          <div className="reveal grid gap-6 md:grid-cols-2 md:items-end">
            <h2 className="text-4xl font-light tracking-tight md:text-5xl">Four tools, one connected workspace</h2>
            <p className="text-gray-600">
              Separate apps can&apos;t tell you which client is losing you money. WorkHub can, because attendance, tasks and clients share one database.
            </p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {MODULES.map((m) => (
              <div key={m.title} className="reveal group lift rounded-3xl bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gray-100 text-ink transition group-hover:bg-lime">
                    <m.icon aria-hidden="true" size={22} strokeWidth={1.6} />
                  </span>
                  <ArrowDot />
                </div>
                <h3 className="mt-8 text-xl font-normal tracking-tight">{m.title}</h3>
                <p className="mt-2 text-sm leading-6 text-gray-600">{m.body}</p>
              </div>
            ))}
          </div>
          <div className="reveal mt-4 flex flex-col gap-6 rounded-3xl bg-lime p-8 text-ink md:flex-row md:items-center">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-ink text-lime">
              <ChartPie aria-hidden="true" size={22} strokeWidth={1.6} />
            </span>
            <div>
              <h3 className="text-xl font-normal tracking-tight">Reports that connect it all</h3>
              <p className="mt-1 text-sm leading-6 text-ink/75">
                Client profitability, team utilisation (billable vs total hours), late and absent trends, and your sales pipeline, exportable to Excel for
                payroll and accounts.
              </p>
            </div>
          </div>
        </section>

        {/* Local */}
        <section className="px-4 py-10">
          <div className="reveal mx-auto grid max-w-6xl gap-10 rounded-[2rem] bg-ink p-8 text-white md:grid-cols-2 md:p-14">
            <div>
              <h2 className="text-4xl font-light tracking-tight md:text-5xl">Built for how Pakistani teams actually work</h2>
              <p className="mt-4 text-gray-400">Foreign tools assume a dollar card, a 9-to-5 day and fast internet. WorkHub doesn&apos;t.</p>
            </div>
            <ul className="space-y-3">
              {LOCAL.map((item) => (
                <li key={item} className="flex items-start gap-3 rounded-2xl bg-white/5 px-4 py-3 text-gray-100">
                  <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-lime" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16">
          <div className="reveal text-center">
            <h2 className="text-4xl font-light tracking-tight md:text-5xl">Simple pricing in rupees</h2>
            <p className="mx-auto mt-4 max-w-2xl text-gray-600">
              Per person, monthly or yearly (2 months free). Guests are free. Beta teams keep {FOUNDING_DISCOUNT.percent}% off for life.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {PLANS.map((key) => {
              const p = PLAN_INFO[key];
              const featured = key === 'business';
              return (
                <div key={key} className={`reveal lift flex flex-col rounded-3xl p-7 shadow-sm ${featured ? 'bg-ink text-white' : 'bg-white'}`}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-normal">{p.name}</h3>
                    {featured && <span className="rounded-full bg-lime px-3 py-1 text-xs font-medium text-ink">Most popular</span>}
                  </div>
                  <p className="mt-6">
                    {p.pricePerUser === 0 ? (
                      <span className="text-5xl font-light tracking-tight">Free</span>
                    ) : (
                      <>
                        <span className={`text-sm ${featured ? 'text-gray-400' : 'text-gray-500'}`}>PKR </span>
                        <span className="text-5xl font-light tracking-tight">{p.pricePerUser.toLocaleString('en-PK')}</span>
                      </>
                    )}
                  </p>
                  <p className={`text-xs ${featured ? 'text-gray-400' : 'text-gray-500'}`}>{p.pricePerUser === 0 ? 'for up to 10 people' : 'per person / month'}</p>
                  <ul className={`mt-6 space-y-2.5 text-sm ${featured ? 'text-gray-200' : 'text-gray-700'}`}>
                    {PLAN_HIGHLIGHTS[key].map((f) => (
                      <li key={f} className="flex gap-2.5">
                        <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${featured ? 'bg-lime' : 'bg-ink'}`} />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
          <p className="mt-8 text-center">
            <Link href="/pricing" className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-medium shadow-sm transition hover:shadow-md">
              Compare plans and work out your price
              <ArrowUpRight aria-hidden="true" size={15} strokeWidth={1.75} />
            </Link>
          </p>
        </section>

        {/* Beta */}
        <section id="beta" className="scroll-mt-24 px-4 py-16">
          <div className="reveal mx-auto max-w-3xl">
            <h2 className="text-center text-4xl font-light tracking-tight md:text-5xl">Join the free beta</h2>
            <p className="mt-4 text-center text-gray-600">
              The beta opens in February 2027. Tell us a little about your team and we&apos;ll set WorkHub up around how you work.
            </p>
            <div className="mt-10">
              <BetaForm />
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="mx-auto max-w-3xl scroll-mt-24 px-4 pb-20 pt-6">
          <h2 className="reveal text-4xl font-light tracking-tight md:text-5xl">Questions</h2>
          <div className="mt-8 space-y-3">
            {FAQ.map((f) => (
              <details key={f.q} className="reveal group rounded-3xl bg-white px-6 py-1 shadow-sm open:pb-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-medium [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gray-100 transition duration-300 group-open:rotate-45 group-open:bg-lime">
                    <Plus size={16} strokeWidth={1.75} />
                  </span>
                </summary>
                <p className="text-sm leading-6 text-gray-600">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
