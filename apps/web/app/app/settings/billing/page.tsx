'use client';

import {
  ANNUAL_MONTHS_CHARGED,
  planCost,
  billingDetailsSchema,
  hasRole,
  PLAN_INFO,
  PROVINCE_LABELS,
  PROVINCES,
  type BillingCycle,
  type InvoiceDto,
  type PaidPlan,
  type PlanKey,
  type SubscriptionDto,
} from '@workhub/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { pkr, SettingsTabs } from '@/components/settings/tabs';
import { Alert, Card, PageHeader, btn, input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

const STATUS: Record<InvoiceDto['status'], [string, string]> = {
  open: ['Unpaid', 'bg-amber-100 text-amber-800'],
  pending_review: ['Checking transfer', 'bg-sky-100 text-sky-800'],
  paid: ['Paid', 'bg-emerald-100 text-emerald-800'],
  void: ['Replaced', 'bg-gray-100 text-gray-500'],
};

const date = (d: string) => new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function BillingPage() {
  const { workspace } = useWorkspace();
  const api = useWorkspaceApi();
  const router = useRouter();
  const canManage = hasRole(workspace.role, 'admin');
  const [sub, setSub] = useState<SubscriptionDto>();
  const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
  const [cycle, setCycle] = useState<BillingCycle>('annual');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<PaidPlan | null>(null);

  const load = useCallback(() => {
    api<SubscriptionDto>('/billing/subscription')
      .then(setSub)
      .catch(() => setError('Could not load your plan.'));
    if (canManage)
      api<InvoiceDto[]>('/billing/invoices')
        .then(setInvoices)
        .catch(() => {});
  }, [api, canManage]);
  useEffect(load, [load]);

  async function choose(plan: PaidPlan) {
    setBusy(plan);
    setError(undefined);
    try {
      const invoice = await api<InvoiceDto>('/billing/checkout', { method: 'POST', body: { plan, cycle } });
      router.push(`/app/settings/billing/invoices/${invoice.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the invoice.');
      setBusy(null);
    }
  }

  if (!sub) {
    return (
      <>
        <PageHeader title="Settings" />
        <SettingsTabs />
        {error ? <Alert>{error}</Alert> : <p className="text-sm text-gray-500">Loading…</p>}
      </>
    );
  }

  const trialDays = sub.trialEndsAt ? Math.max(0, Math.ceil((new Date(sub.trialEndsAt).getTime() - Date.now()) / 86_400_000)) : 0;
  const statusLine =
    !sub.enforced
      ? 'WorkHub is free during the beta. Every feature is open, for any number of people.'
      : sub.status === 'trial'
        ? `Free trial of Business: ${trialDays} day${trialDays === 1 ? '' : 's'} left. Choose a plan before it ends to keep everything.`
        : sub.status === 'active'
          ? `Paid until ${date(sub.paidUntil!)} (${sub.billingCycle}).`
          : sub.status === 'grace'
            ? `Your ${PLAN_INFO[sub.plan].name} plan ended on ${date(sub.paidUntil!)}. Renew within a few days to keep it.`
            : 'The Free plan: everything for up to 10 people.';
  const details = sub.details.billingName && sub.details.province;

  return (
    <>
      <PageHeader title="Settings" description={workspace.name} />
      <SettingsTabs />
      <div className="space-y-6">
        {error && <Alert>{error}</Alert>}
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">
              {PLAN_INFO[sub.plan].name}
              {sub.status === 'trial' && <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 align-middle text-xs font-medium text-brand-700">Trial</span>}
            </h2>
            <p className="text-sm text-gray-600">
              {sub.seatsUsed} {sub.seatsUsed === 1 ? 'person' : 'people'}
              {sub.seatLimit !== null && ` of ${sub.seatLimit}`} · guests are free
            </p>
          </div>
          <p className="mt-1 text-sm text-gray-600">{statusLine}</p>
          {sub.discount && <p className="mt-2 inline-block rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">{sub.discount.label}</p>}
          {sub.seatLimit !== null && (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100" role="meter" aria-valuenow={sub.seatsUsed} aria-valuemin={0} aria-valuemax={sub.seatLimit} aria-label="People on the plan">
              <div className={`h-full ${sub.seatsUsed >= sub.seatLimit ? 'bg-red-500' : 'bg-brand-500'}`} style={{ width: `${Math.min(100, (sub.seatsUsed / sub.seatLimit) * 100)}%` }} />
            </div>
          )}
        </section>

        {canManage && sub.enforced && (
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Plans</h2>
              <div className="flex rounded-lg border border-gray-300 p-0.5 text-sm" role="radiogroup" aria-label="Billing">
                {(['monthly', 'annual'] as const).map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={cycle === c} onClick={() => setCycle(c)} className={`rounded-md px-3 py-1 font-medium ${cycle === c ? 'bg-brand-50 text-brand-700' : 'text-gray-600'}`}>
                    {c === 'monthly' ? 'Monthly' : `Yearly (${12 - ANNUAL_MONTHS_CHARGED} months free)`}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {(['free', 'starter', 'business'] as PlanKey[]).map((key) => {
                const p = PLAN_INFO[key];
                const current = sub.plan === key && sub.status !== 'trial';
                const off = sub.discount?.percent ?? 0;
                const perMonth = planCost(p.pricePerUser, cycle, 1, off).net / (cycle === 'annual' ? 12 : 1);
                const estimate = planCost(p.pricePerUser, cycle, Math.max(1, sub.seatsUsed), off).net;
                return (
                  <div key={key} className={`flex flex-col rounded-2xl border bg-white p-5 shadow-sm ${key === 'business' ? 'border-brand-500 ring-1 ring-brand-100' : 'border-gray-200'}`}>
                    <h3 className="font-semibold">{p.name}</h3>
                    <p className="mt-2 text-2xl font-semibold">
                      {p.pricePerUser === 0 ? 'Free' : pkr(Math.round(perMonth))}
                      {p.pricePerUser > 0 && <span className="text-sm font-normal text-gray-500"> per person / month</span>}
                    </p>
                    {off > 0 && p.pricePerUser > 0 && <p className="text-xs text-gray-500 line-through">{pkr(Math.round(planCost(p.pricePerUser, cycle, 1).net / (cycle === 'annual' ? 12 : 1)))}</p>}
                    <p className="mt-2 flex-1 text-sm text-gray-600">{p.blurb}</p>
                    {key === 'free' ? (
                      <p className="mt-4 text-sm text-gray-500">{current ? 'Your plan' : 'Up to 10 people'}</p>
                    ) : (
                      <>
                        <p className="mt-4 text-xs text-gray-500">
                          For your {Math.max(1, sub.seatsUsed)} {sub.seatsUsed === 1 ? 'person' : 'people'}: {pkr(estimate)} {cycle === 'annual' ? 'a year' : 'a month'}, plus sales tax
                        </p>
                        <button type="button" className={`${key === 'business' ? btn.primary : btn.secondary} mt-2`} disabled={!details || busy !== null} onClick={() => void choose(key as PaidPlan)}>
                          {busy === key ? 'Preparing invoice…' : current ? 'Renew' : `Choose ${p.name}`}
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            {!details && <p className="mt-2 text-sm text-amber-700">Add your billing details below to choose a plan.</p>}
          </section>
        )}

        {canManage && <BillingDetails sub={sub} onSaved={load} />}

        {canManage && invoices.length > 0 && (
          <Card title="Invoices">
            <ul className="divide-y divide-gray-100">
              {invoices.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <Link href={`/app/settings/billing/invoices/${i.id}`} className="font-medium text-gray-900 hover:underline">
                    {i.number}
                  </Link>
                  <span className="text-gray-500">
                    {PLAN_INFO[i.plan].name}, {i.billingCycle} · {date(i.issuedAt)}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[i.status][1]}`}>{STATUS[i.status][0]}</span>
                  <span className="ml-auto tabular-nums">{pkr(i.total)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

function BillingDetails({ sub, onSaved }: { sub: SubscriptionDto; onSaved: () => void }) {
  const api = useWorkspaceApi();
  const { workspace, me } = useWorkspace();
  const [f, setF] = useState({
    billingName: sub.details.billingName ?? workspace.name,
    billingEmail: sub.details.billingEmail ?? me.user.email,
    ntn: sub.details.ntn ?? '',
    province: sub.details.province ?? '',
    address: sub.details.address ?? '',
  });
  const [result, setResult] = useState<{ kind: 'error' | 'success'; text: string }>();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = billingDetailsSchema.safeParse(f);
    if (!parsed.success) return setResult({ kind: 'error', text: parsed.error.issues[0]?.message ?? 'Check the details.' });
    try {
      await api('/billing/details', { method: 'PATCH', body: parsed.data });
      setResult({ kind: 'success', text: 'Saved.' });
      onSaved();
    } catch (err) {
      setResult({ kind: 'error', text: err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : 'Could not save.' });
    }
  }

  return (
    <Card title="Billing details" description="Who invoices are made out to. The province decides the sales tax on the invoice.">
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        {result && (
          <div className="sm:col-span-2">
            <Alert kind={result.kind}>{result.text}</Alert>
          </div>
        )}
        <label className="block text-sm">
          <span className="text-gray-700">Company or person</span>
          <input value={f.billingName} onChange={set('billingName')} required maxLength={150} className={`mt-1 ${input}`} />
        </label>
        <label className="block text-sm">
          <span className="text-gray-700">Invoice email</span>
          <input type="email" value={f.billingEmail} onChange={set('billingEmail')} required className={`mt-1 ${input}`} />
        </label>
        <label className="block text-sm">
          <span className="text-gray-700">NTN or CNIC (optional)</span>
          <input value={f.ntn} onChange={set('ntn')} placeholder="1234567-8" className={`mt-1 ${input}`} />
        </label>
        <label className="block text-sm">
          <span className="text-gray-700">Province</span>
          <select value={f.province} onChange={set('province')} required className={`mt-1 ${input}`}>
            <option value="">Choose…</option>
            {PROVINCES.map((p) => (
              <option key={p} value={p}>
                {PROVINCE_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-gray-700">Address (optional)</span>
          <input value={f.address} onChange={set('address')} maxLength={300} className={`mt-1 ${input}`} />
        </label>
        <div className="sm:col-span-2">
          <button type="submit" className={btn.primary}>
            Save details
          </button>
        </div>
      </form>
    </Card>
  );
}
