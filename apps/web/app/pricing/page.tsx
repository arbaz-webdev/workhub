import { FOUNDING_DISCOUNT, LAUNCH_DATE, PLAN_INFO, TRIAL_DAYS, type PlanKey } from '@workhub/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { COMPARISON } from '@/components/landing/plans';
import { PriceCalculator } from '@/components/landing/price-calculator';
import { SiteFooter, SiteHeader } from '@/components/landing/site';

export const metadata: Metadata = {
  title: 'Pricing · WorkHub',
  description: `Free for up to 10 people. Starter PKR ${PLAN_INFO.starter.pricePerUser} and Business PKR ${PLAN_INFO.business.pricePerUser.toLocaleString('en-PK')} per person a month, billed in rupees. Two months free on yearly plans.`,
};

const PLANS: PlanKey[] = ['free', 'starter', 'business'];

const LAUNCH = new Date(`${LAUNCH_DATE}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const FAQ = [
  { q: 'Who counts as a person?', a: 'Everyone in your workspace except guests. Guests (clients and freelancers you share a project with) are always free.' },
  { q: 'What does the founding price mean?', a: `Teams that join before ${LAUNCH} keep ${FOUNDING_DISCOUNT.percent}% off every plan for as long as they stay with us, including when you add people or move to Business.` },
  { q: 'Is sales tax extra?', a: 'Yes. Provincial sales tax on services is added to the invoice according to your province, and shown as its own line. Invoices carry your NTN.' },
  { q: 'How can I pay?', a: 'By bank transfer (IBFT) for yearly plans today. Card, JazzCash and Easypaisa payments open with paid plans at launch. No dollar card needed.' },
  { q: 'What happens when the trial ends?', a: `Every new workspace gets ${TRIAL_DAYS} days of Business. After that you choose a plan, or stay on Free if you have up to 10 people. Nothing is deleted.` },
  { q: 'Can I change plans?', a: 'Any time, from Settings → Billing. Yearly plans get two months free.' },
];

function Cell({ value }: { value: boolean | string }) {
  if (value === true) return <span className="text-brand-600" aria-label="Included">✓</span>;
  if (value === false) return <span className="text-gray-300" aria-label="Not included">–</span>;
  return <span className="text-gray-700">{value}</span>;
}

export default function PricingPage() {
  return (
    <div className="bg-white">
      <SiteHeader />
      <main>
        <section className="bg-gray-50 px-4 py-16">
          <div className="mx-auto max-w-6xl">
            <div className="text-center">
              <h1 className="text-4xl font-bold tracking-tight">Simple pricing in rupees</h1>
              <p className="mx-auto mt-3 max-w-2xl text-gray-600">Pay per person, monthly or yearly. Free for small teams, and every feature on the Business trial.</p>
              <p className="mx-auto mt-4 inline-block rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-800">
                Founding customers: {FOUNDING_DISCOUNT.percent}% off for life when you join before {LAUNCH}
              </p>
            </div>
            <div className="mt-10">
              <PriceCalculator />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-bold tracking-tight">Compare plans</h2>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left">
                  <th className="py-3 pr-4 font-medium text-gray-500">
                    <span className="sr-only">Feature</span>
                  </th>
                  {PLANS.map((p) => (
                    <th key={p} className="w-36 py-3 text-center font-semibold">
                      {PLAN_INFO[p].name}
                    </th>
                  ))}
                </tr>
              </thead>
              {COMPARISON.map((g) => (
                <tbody key={g.group}>
                  <tr>
                    <th colSpan={4} className="pt-6 pb-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {g.group}
                    </th>
                  </tr>
                  {g.rows.map((r) => (
                    <tr key={r.label} className="border-t border-gray-100">
                      <th scope="row" className="py-2.5 pr-4 text-left font-normal text-gray-800">
                        {r.label}
                      </th>
                      {PLANS.map((p) => (
                        <td key={p} className="py-2.5 text-center">
                          <Cell value={r.plans[p]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 pb-20">
          <h2 className="text-2xl font-bold tracking-tight">Pricing questions</h2>
          <dl className="mt-6 divide-y divide-gray-200">
            {FAQ.map((f) => (
              <div key={f.q} className="py-5">
                <dt className="font-semibold">{f.q}</dt>
                <dd className="mt-2 text-sm leading-6 text-gray-600">{f.a}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 text-sm text-gray-600">
            More in the <Link href="/help" className="text-brand-700 underline">help centre</Link>, or message us on WhatsApp.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
