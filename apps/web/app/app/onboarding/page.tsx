'use client';

import { CURRENCIES, INDUSTRIES, INDUSTRY_LABELS, onboardingSchema, WEEKDAYS, type Industry, type OnboardingDto, type OnboardingResultDto } from '@workhub/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Alert, btn, input, Loading } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

const STEPS = ['Your business', 'Working hours', 'Teams', 'Extras', 'Invite your team'];
const INDUSTRY_HINTS: Record<Industry, string> = {
  software_house: 'Projects for clients, sprints, hourly or fixed-price work',
  agency: 'Campaigns, content and retainers for brands',
  bpo: 'Shifts (often at night), attendance and team leads',
  consultancy: 'Engagements, time on clients and proposals',
  other: 'A general setup you can change later',
};

/** The 15-minute setup: everything here can be changed later in Settings. */
export default function OnboardingPage() {
  const { workspace } = useWorkspace();
  const api = useWorkspaceApi();
  const router = useRouter();
  const [status, setStatus] = useState<OnboardingDto>();
  const [step, setStep] = useState(0);
  const [industry, setIndustry] = useState<Industry>('software_house');
  const [timezone, setTimezone] = useState('Asia/Karachi');
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>('PKR');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [useShift, setUseShift] = useState(true);
  const [shift, setShift] = useState({ name: 'Office hours', startTime: '09:00', endTime: '18:00' });
  const [teams, setTeams] = useState<string[]>([]);
  const [newTeam, setNewTeam] = useState('');
  const [loadHolidays, setLoadHolidays] = useState(true);
  const [sampleProject, setSampleProject] = useState(true);
  const [emails, setEmails] = useState('');
  const [result, setResult] = useState<OnboardingResultDto | null>(null);
  const [invited, setInvited] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const zones = useMemo(() => ['Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh', 'Europe/London', 'America/New_York', 'UTC', ...Intl.supportedValuesOf('timeZone')], []);

  useEffect(() => {
    api<OnboardingDto>('/onboarding')
      .then((s) => {
        setStatus(s);
        if (s.industry) setIndustry(s.industry);
      })
      .catch(() => setError('Could not load the setup.'));
  }, [api]);

  // Choosing an industry fills in its suggestions.
  function pick(i: Industry) {
    setIndustry(i);
    const p = status?.presets[i];
    if (!p) return;
    setShift(p.shift);
    setDays(p.workingDays);
    setTeams(p.teams);
    setSampleProject(!!p.template);
  }

  async function finish() {
    const body = { industry, timezone, currency, workingDays: days, shift: useShift ? shift : null, teams, loadHolidays, sampleProject: sampleProject && !!status?.presets[industry].template };
    const parsed = onboardingSchema.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setBusy(true);
    setError(undefined);
    try {
      setResult(await api<OnboardingResultDto>('/onboarding', { method: 'POST', body: parsed.data }));
      setStep(4);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not finish the setup.');
    } finally {
      setBusy(false);
    }
  }

  async function invite() {
    const list = [...new Set(emails.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@')))];
    if (list.length === 0) return router.push('/app');
    setBusy(true);
    setError(undefined);
    try {
      const res = await api<{ invited: unknown[] }>('/invitations', { method: 'POST', body: { emails: list, role: 'member' } });
      setInvited(res.invited.length);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the invitations.');
    } finally {
      setBusy(false);
    }
  }

  if (!status) return error ? <Alert>{error}</Alert> : <Loading />;

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-sm text-gray-500">Set up {workspace.name}</p>
      <h1 className="mt-1 text-2xl font-semibold">{STEPS[step]}</h1>
      <ol className="mt-4 flex gap-1.5" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-brand-600' : 'bg-gray-200'}`}>
            <span className="sr-only">
              {s}
              {i < step ? ' (done)' : i === step ? ' (current)' : ''}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-6 rounded-3xl bg-white p-6 shadow-sm">
        {error && (
          <div className="mb-4">
            <Alert>{error}</Alert>
          </div>
        )}

        {step === 0 && (
          <fieldset>
            <legend className="mb-3 text-sm text-gray-600">What does your company do? We’ll suggest teams, hours and a sales pipeline to match.</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {INDUSTRIES.map((i) => (
                <label key={i} className={`cursor-pointer rounded-xl border p-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500 ${industry === i ? 'border-brand-600 bg-brand-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                  <input type="radio" name="industry" className="sr-only" checked={industry === i} onChange={() => pick(i)} />
                  <span className="block font-medium text-gray-900">{INDUSTRY_LABELS[i]}</span>
                  <span className="block text-gray-500">{INDUSTRY_HINTS[i]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-gray-700">Time zone</span>
                <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={`mt-1 ${input}`}>
                  {[...new Set(zones)].map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-gray-700">Currency</span>
                <select value={currency} onChange={(e) => setCurrency(e.target.value as typeof currency)} className={`mt-1 ${input}`}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset>
              <legend className="text-sm text-gray-700">Working days</legend>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {WEEKDAYS.map((d) => (
                  <label key={d.value} className={`cursor-pointer rounded-full border px-3 py-1 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500 ${days.includes(d.value) ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-gray-300 text-gray-600'}`}>
                    <input type="checkbox" className="sr-only" checked={days.includes(d.value)} onChange={() => setDays(days.includes(d.value) ? days.filter((x) => x !== d.value) : [...days, d.value].sort())} />
                    {d.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={useShift} onChange={(e) => setUseShift(e.target.checked)} className="h-4 w-4 accent-brand-600" />
              Set up a shift for attendance
            </label>
            {useShift && (
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-sm">
                  <span className="text-gray-700">Name</span>
                  <input value={shift.name} onChange={(e) => setShift({ ...shift, name: e.target.value })} className={`mt-1 ${input}`} />
                </label>
                <label className="block text-sm">
                  <span className="text-gray-700">Starts</span>
                  <input type="time" value={shift.startTime} onChange={(e) => setShift({ ...shift, startTime: e.target.value })} className={`mt-1 ${input}`} />
                </label>
                <label className="block text-sm">
                  <span className="text-gray-700">Ends {shift.endTime <= shift.startTime && <span className="text-brand-700">(next day)</span>}</span>
                  <input type="time" value={shift.endTime} onChange={(e) => setShift({ ...shift, endTime: e.target.value })} className={`mt-1 ${input}`} />
                </label>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">Teams group people for attendance, leave approvals, announcements and reports.</p>
            <ul className="flex flex-wrap gap-2">
              {teams.map((t) => (
                <li key={t} className="flex items-center gap-1 rounded-full bg-gray-100 py-1 pl-3 pr-1 text-sm">
                  {t}
                  <button type="button" aria-label={`Remove ${t}`} onClick={() => setTeams(teams.filter((x) => x !== t))} className="grid h-5 w-5 place-items-center rounded-full text-gray-500 hover:bg-gray-200">
                    ×
                  </button>
                </li>
              ))}
              {teams.length === 0 && <li className="text-sm text-gray-500">No teams yet.</li>}
            </ul>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const t = newTeam.trim();
                if (t && !teams.some((x) => x.toLowerCase() === t.toLowerCase())) setTeams([...teams, t]);
                setNewTeam('');
              }}
            >
              <input value={newTeam} onChange={(e) => setNewTeam(e.target.value)} placeholder="Add a team" aria-label="Team name" maxLength={80} className={input} />
              <button type="submit" className={btn.secondary}>
                Add
              </button>
            </form>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 text-sm">
            <label className="flex items-start gap-3">
              <input type="checkbox" checked={loadHolidays} onChange={(e) => setLoadHolidays(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
              <span>
                <span className="font-medium text-gray-900">Load Pakistan’s public holidays</span>
                <span className="block text-gray-500">Including Eid dates, marked as estimated until they’re announced.</span>
              </span>
            </label>
            {status.presets[industry].template && (
              <label className="flex items-start gap-3">
                <input type="checkbox" checked={sampleProject} onChange={(e) => setSampleProject(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
                <span>
                  <span className="font-medium text-gray-900">Add a sample project</span>
                  <span className="block text-gray-500">A board with tasks to see how things work. Delete it any time.</span>
                </span>
              </label>
            )}
            <p className="text-gray-500">
              Your sales pipeline will use these stages: {status.presets[industry].stages.map((s) => s.name).join(' → ')} → Won / Lost.
            </p>
          </div>
        )}

        {step === 4 && result && (
          <div className="space-y-4">
            <Alert kind="success">
              You’re set up{result.teams ? `: ${result.teams} teams` : ''}
              {result.holidays ? `, ${result.holidays} holidays` : ''}
              {result.projectId ? ' and a sample project' : ''}.
            </Alert>
            {invited !== null ? (
              <>
                <p className="text-sm text-gray-700">
                  {invited} invitation{invited === 1 ? '' : 's'} sent. You can also share a join link from{' '}
                  <Link href="/app/people" className="text-brand-700 underline">
                    People
                  </Link>
                  .
                </p>
                <button type="button" className={btn.primary} onClick={() => router.push('/app')}>
                  Go to WorkHub
                </button>
              </>
            ) : (
              <>
                <label className="block text-sm">
                  <span className="text-gray-700">Email addresses of your team, separated by commas or new lines</span>
                  <textarea value={emails} onChange={(e) => setEmails(e.target.value)} rows={4} placeholder="ali@company.pk, sara@company.pk" className={`mt-1 ${input}`} />
                </label>
                <div className="flex gap-2">
                  <button type="button" className={btn.primary} disabled={busy} onClick={() => void invite()}>
                    {busy ? 'Sending…' : emails.trim() ? 'Send invitations' : 'Skip for now'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {step < 4 && (
          <div className="mt-6 flex items-center gap-2 border-t border-gray-100 pt-4">
            {step > 0 && (
              <button type="button" className={btn.ghost} onClick={() => setStep(step - 1)}>
                Back
              </button>
            )}
            {step < 3 ? (
              <button
                type="button"
                className={`${btn.primary} ml-auto`}
                onClick={() => {
                  if (step === 0 && teams.length === 0) pick(industry);
                  setStep(step + 1);
                }}
              >
                Next
              </button>
            ) : (
              <button type="button" className={`${btn.primary} ml-auto`} disabled={busy} onClick={() => void finish()}>
                {busy ? 'Setting up…' : 'Finish setup'}
              </button>
            )}
          </div>
        )}
      </div>
      {step < 4 && (
        <p className="mt-4 text-center text-sm text-gray-500">
          <Link href="/app" className="hover:underline">
            Skip and set up later
          </Link>
        </p>
      )}
    </div>
  );
}
