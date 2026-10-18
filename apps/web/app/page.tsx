import type { Metadata } from 'next';
import Link from 'next/link';
import { BetaForm } from '@/components/landing/beta-form';

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

const MODULES = [
  {
    title: 'Time & attendance',
    body: 'One-tap check-in with a selfie, GPS or office-IP rules, night shifts that cross midnight, leave and timesheets.',
  },
  {
    title: 'Project boards',
    body: 'Kanban boards as easy as Trello. Every project belongs to a client, and every card shows estimate vs actual hours.',
  },
  {
    title: 'CRM',
    body: 'Leads from Upwork, LinkedIn, WhatsApp and referrals in one pipeline. A won deal becomes a project in one click.',
  },
  {
    title: 'Team chat',
    body: 'Channels, direct messages and announcements, linked to your tasks and clients instead of lost in WhatsApp groups.',
  },
];

const LOCAL = [
  'Billed in PKR: card, JazzCash, Easypaisa or bank transfer',
  'Night shifts for US clients count as one workday',
  'Pakistani public holidays built in',
  'Works on slow internet; check-ins sync when you are back online',
  'Support on WhatsApp from people in your time zone',
];

const PLANS = [
  { name: 'Free', price: '0', note: 'Up to 10 users', features: ['Attendance with selfie check-in', 'Boards (3 projects)', 'Team chat (90-day history)'] },
  { name: 'Starter', price: '699', note: 'per user / month', features: ['Unlimited projects', 'Leave, shifts and timesheets', 'Full chat history'] },
  {
    name: 'Business',
    price: '1,299',
    note: 'per user / month',
    features: ['Everything in Starter', 'CRM and client 360', 'Client Profitability and utilisation reports'],
    highlight: true,
  },
  { name: 'Pro', price: '1,999', note: 'per user / month · later in 2027', features: ['Everything in Business', 'Consent-based activity tracking', 'Client portal and automations'] },
];

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
    a: 'Yes. Prices are in PKR and you can pay by card, JazzCash, Easypaisa or bank transfer. No dollar card needed.',
  },
];

function Logo() {
  return (
    <span className="flex items-center gap-2 text-lg font-semibold text-gray-900">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">W</span>
      WorkHub
    </span>
  );
}

function ProfitabilityMock() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-lg" aria-label="Example Client Profitability report">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold">Client profitability · September</p>
        <p className="text-xs text-gray-400">example data</p>
      </div>
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500">
            <th className="pb-2 font-medium">Client</th>
            <th className="pb-2 text-right font-medium">Hours</th>
            <th className="pb-2 pl-4 font-medium">Margin</th>
          </tr>
        </thead>
        <tbody>
          {PROFIT_ROWS.map((r) => (
            <tr key={r.client} className="border-t border-gray-100">
              <td className="py-2.5">{r.client}</td>
              <td className="py-2.5 text-right tabular-nums text-gray-600">{r.hours}</td>
              <td className="py-2.5 pl-4">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-20 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full ${r.margin >= 0 ? 'bg-brand-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(100, Math.abs(r.margin) * 2)}%` }}
                    />
                  </div>
                  <span className={`tabular-nums ${r.margin >= 0 ? 'text-gray-700' : 'font-semibold text-red-600'}`}>
                    {r.margin}%
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
        Crescent Foods cost more in hours than it paid last month.
      </p>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="bg-white">
      <header className="sticky top-0 z-10 border-b border-gray-100 bg-white/90 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
          <Logo />
          <div className="ml-auto hidden items-center gap-6 text-sm text-gray-600 md:flex">
            <a href="#features" className="hover:text-gray-900">Features</a>
            <a href="#pricing" className="hover:text-gray-900">Pricing</a>
            <a href="#faq" className="hover:text-gray-900">FAQ</a>
          </div>
          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <Link href="/sign-in" className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">
              Sign in
            </Link>
            <a href="#beta" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700">
              Join the beta
            </a>
          </div>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 md:grid-cols-2 md:py-24">
          <div>
            <p className="text-sm font-semibold text-brand-700">For remote and hybrid teams in Pakistan</p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight text-gray-900 md:text-5xl">
              Know who&apos;s working, on what, and which clients make you money.
            </h1>
            <p className="mt-5 text-lg text-gray-600">
              WorkHub puts attendance, project boards, clients and team chat in one workspace. Every hour your team works
              rolls up to a client, so profit per client is on one screen.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#beta" className="rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white hover:bg-brand-700">
                Join the free beta
              </a>
              <a href="#features" className="rounded-lg border border-gray-300 px-5 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50">
                See what&apos;s inside
              </a>
            </div>
            <p className="mt-4 text-sm text-gray-500">Free for teams up to 10. Priced in rupees.</p>
          </div>
          <ProfitabilityMock />
        </section>

        <section className="border-y border-gray-100 bg-gray-50">
          <div className="mx-auto max-w-6xl px-4 py-12 text-center">
            <p className="text-sm font-semibold uppercase tracking-wide text-gray-500">Replace the tool pile</p>
            <p className="mx-auto mt-3 max-w-3xl text-xl text-gray-800">
              Trello + HubSpot + Slack + Hubstaff + an attendance spreadsheet, billed in dollars on five cards.
              <span className="font-semibold"> One WorkHub bill in PKR, at a fraction of the cost.</span>
            </p>
          </div>
        </section>

        <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20">
          <h2 className="text-3xl font-bold tracking-tight">Four tools, one connected workspace</h2>
          <p className="mt-3 max-w-2xl text-gray-600">
            Separate apps can&apos;t tell you which client is losing you money. WorkHub can, because attendance, tasks and
            clients share one database.
          </p>
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {MODULES.map((m) => (
              <div key={m.title} className="rounded-2xl border border-gray-200 p-6">
                <h3 className="text-lg font-semibold">{m.title}</h3>
                <p className="mt-2 text-sm leading-6 text-gray-600">{m.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-2xl border border-brand-100 bg-brand-50 p-6">
            <h3 className="text-lg font-semibold text-brand-700">Reports that connect it all</h3>
            <p className="mt-2 text-sm leading-6 text-gray-700">
              Client profitability, team utilisation (billable vs total hours), late and absent trends, and your sales
              pipeline, exportable to Excel for payroll and accounts.
            </p>
          </div>
        </section>

        <section className="bg-gray-900 text-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-2">
            <div>
              <h2 className="text-3xl font-bold tracking-tight">Built for how Pakistani teams actually work</h2>
              <p className="mt-3 text-gray-300">
                Foreign tools assume a dollar card, a 9-to-5 day and fast internet. WorkHub doesn&apos;t.
              </p>
            </div>
            <ul className="space-y-3">
              {LOCAL.map((item) => (
                <li key={item} className="flex gap-3 text-gray-100">
                  <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20">
          <h2 className="text-3xl font-bold tracking-tight">Simple pricing in rupees</h2>
          <p className="mt-3 text-gray-600">Billed annually. No seat minimums. Beta teams get 40% off for life.</p>
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {PLANS.map((p) => (
              <div
                key={p.name}
                className={`rounded-2xl border p-6 ${p.highlight ? 'border-brand-500 ring-2 ring-brand-100' : 'border-gray-200'}`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{p.name}</h3>
                  {p.highlight && (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">Most popular</span>
                  )}
                </div>
                <p className="mt-4">
                  <span className="text-sm text-gray-500">PKR </span>
                  <span className="text-3xl font-bold">{p.price}</span>
                </p>
                <p className="text-xs text-gray-500">{p.note}</p>
                <ul className="mt-5 space-y-2 text-sm text-gray-700">
                  {p.features.map((f) => (
                    <li key={f}>· {f}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section id="beta" className="scroll-mt-20 border-t border-gray-100 bg-gray-50">
          <div className="mx-auto max-w-3xl px-4 py-20">
            <h2 className="text-center text-3xl font-bold tracking-tight">Join the free beta</h2>
            <p className="mt-3 text-center text-gray-600">
              The beta opens in February 2027. Tell us a little about your team and we&apos;ll set WorkHub up around how you
              work.
            </p>
            <div className="mt-10">
              <BetaForm />
            </div>
          </div>
        </section>

        <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-20">
          <h2 className="text-3xl font-bold tracking-tight">Questions</h2>
          <dl className="mt-8 divide-y divide-gray-200">
            {FAQ.map((f) => (
              <div key={f.q} className="py-5">
                <dt className="font-semibold">{f.q}</dt>
                <dd className="mt-2 text-sm leading-6 text-gray-600">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>

      <footer className="border-t border-gray-100">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-gray-500">
          <Logo />
          <p>© 2026 WorkHub · Made in Pakistan</p>
        </div>
      </footer>
    </div>
  );
}
