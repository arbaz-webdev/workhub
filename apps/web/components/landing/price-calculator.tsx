'use client';

import { FOUNDING_DISCOUNT, PLAN_INFO, planCost, TRIAL_DAYS, type BillingCycle, type PlanKey } from '@workhub/shared';
import Link from 'next/link';
import { useState } from 'react';
import { PLAN_HIGHLIGHTS } from './plans';

const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString('en-PK')}`;

/** Plan cards with a team-size and billing switch, and the founding discount shown alongside. */
export function PriceCalculator() {
  const [cycle, setCycle] = useState<BillingCycle>('annual');
  const [people, setPeople] = useState(15);
  const [founding, setFounding] = useState(true);
  const off = founding ? FOUNDING_DISCOUNT.percent : 0;

  return (
    <div>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
        <div className="flex rounded-lg border border-gray-300 bg-white p-0.5 text-sm" role="radiogroup" aria-label="Billing">
          {(['monthly', 'annual'] as const).map((c) => (
            <button key={c} type="button" role="radio" aria-checked={cycle === c} onClick={() => setCycle(c)} className={`rounded-md px-3 py-1.5 font-medium ${cycle === c ? 'bg-brand-50 text-brand-700' : 'text-gray-600'}`}>
              {c === 'monthly' ? 'Monthly' : 'Yearly · 2 months free'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Team of
          <input
            type="number"
            min={1}
            max={1000}
            value={people}
            onChange={(e) => setPeople(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
            className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-center tabular-nums"
          />
          people
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={founding} onChange={(e) => setFounding(e.target.checked)} />
          Founding price ({FOUNDING_DISCOUNT.percent}% off)
        </label>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {(['free', 'starter', 'business'] as PlanKey[]).map((key) => {
          const plan = PLAN_INFO[key];
          const tooBig = plan.maxUsers !== null && people > plan.maxUsers;
          const perPerson = planCost(plan.pricePerUser, cycle, 1, off).net / (cycle === 'annual' ? 12 : 1);
          const listPerPerson = planCost(plan.pricePerUser, cycle, 1).net / (cycle === 'annual' ? 12 : 1);
          const total = planCost(plan.pricePerUser, cycle, people, off).net;
          return (
            <div key={key} className={`flex flex-col rounded-2xl border bg-white p-6 ${key === 'business' ? 'border-brand-500 ring-2 ring-brand-100' : 'border-gray-200'}`}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{plan.name}</h3>
                {key === 'business' && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">Most popular</span>}
              </div>
              <p className="mt-4">
                {plan.pricePerUser === 0 ? (
                  <span className="text-3xl font-bold">Free</span>
                ) : (
                  <>
                    <span className="text-3xl font-bold tabular-nums">{pkr(perPerson)}</span>
                    {off > 0 && <span className="ms-2 text-sm text-gray-400 line-through tabular-nums">{pkr(listPerPerson)}</span>}
                  </>
                )}
              </p>
              <p className="text-xs text-gray-500">{plan.pricePerUser === 0 ? 'for up to 10 people' : 'per person a month, plus sales tax'}</p>
              <p className="mt-3 text-sm text-gray-600">{plan.blurb}</p>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-gray-700">
                {PLAN_HIGHLIGHTS[key].map((f) => (
                  <li key={f} className="flex gap-2">
                    <span aria-hidden="true" className="text-brand-600">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <p className="mt-5 rounded-lg bg-gray-50 px-3 py-2 text-sm tabular-nums text-gray-700" aria-live="polite">
                {tooBig
                  ? `Free is for up to ${plan.maxUsers} people.`
                  : plan.pricePerUser === 0
                    ? `${people} ${people === 1 ? 'person' : 'people'}: free`
                    : `${people} ${people === 1 ? 'person' : 'people'}: ${pkr(total)} ${cycle === 'annual' ? 'a year' : 'a month'}`}
              </p>
            </div>
          );
        })}
      </div>
      <p className="mt-6 text-center text-sm text-gray-500">
        Every new workspace starts with {TRIAL_DAYS} days of Business, free. No card needed. <Link href="/#beta" className="text-brand-700 underline">Join the beta</Link>
      </p>
    </div>
  );
}
