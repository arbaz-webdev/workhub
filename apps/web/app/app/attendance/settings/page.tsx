'use client';

import {
  hasRole,
  shiftSchema,
  siteSchema,
  WEEKDAYS,
  type AttendanceSettingsDto,
  type ShiftBreak,
  type ShiftDto,
  type SiteDto,
} from '@workhub/shared';
import { useCallback, useEffect, useState } from 'react';
import { shiftHours } from '@/components/attendance/labels';
import { AttendanceTabs } from '@/components/attendance/tabs';
import { Alert, Card, PageHeader, btn, input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

const errorText = (err: unknown, fallback: string) =>
  err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : fallback;

export default function AttendanceSettingsPage() {
  const { workspace } = useWorkspace();
  const api = useWorkspaceApi();
  const [s, setS] = useState<AttendanceSettingsDto>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(() => {
    api<AttendanceSettingsDto>('/attendance/settings')
      .then(setS)
      .catch(() => setError('Could not load attendance settings.'));
  }, [api]);
  useEffect(load, [load]);

  const done = (message: string) => {
    setError(undefined);
    setNotice(message);
    setTimeout(() => setNotice(undefined), 4000);
  };

  if (!hasRole(workspace.role, 'admin')) {
    return (
      <>
        <PageHeader title="Attendance" />
        <AttendanceTabs />
        <Alert>Only admins can change shifts and offices.</Alert>
      </>
    );
  }

  async function patch(path: string, body: unknown, message: string) {
    try {
      setS(await api<AttendanceSettingsDto>(path, { method: 'PATCH', body }));
      done(message);
    } catch (err) {
      setError(errorText(err, 'Could not save.'));
    }
  }

  return (
    <>
      <PageHeader title="Attendance" description="Shifts, breaks, office locations and who works when." />
      <AttendanceTabs />
      <div className="mb-4 space-y-2" aria-live="polite">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}
      </div>
      {!s ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="space-y-6">
          <Card title="Check-in rules">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-brand-600"
                checked={s.requireSelfie}
                onChange={(e) => patch('/attendance/settings', { requireSelfie: e.target.checked }, 'Saved.')}
              />
              <span>
                <span className="font-medium text-gray-900">Ask for a selfie at check-in and check-out</span>
                <span className="block text-gray-500">Selfies are deleted after 30 days. People can see their own; managers and admins can see everyone&apos;s.</span>
              </span>
            </label>
            <p className="mt-3 text-xs text-gray-500">Times use the workspace time zone ({s.timezone}), which you can change in Settings.</p>
          </Card>

          <Shifts shifts={s.shifts} onChange={() => load()} onDone={done} onError={setError} />
          <Sites sites={s.sites} onChange={() => load()} onDone={done} onError={setError} />

          <Card title="Who works which shift" description="A person's own shift wins; otherwise their team's; otherwise the default shift.">
            {s.shifts.length === 0 ? (
              <p className="text-sm text-gray-500">Add a shift first.</p>
            ) : (
              <>
                {s.teams.length > 0 && (
                  <div className="mb-6">
                    <h3 className="mb-2 text-sm font-semibold">Teams</h3>
                    <ul className="divide-y divide-gray-100">
                      {s.teams.map((t) => (
                        <li key={t.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                          <span className="flex-1 font-medium">{t.name}</span>
                          <select
                            aria-label={`Shift for ${t.name}`}
                            value={t.shiftId ?? ''}
                            onChange={(e) => patch(`/attendance/teams/${t.id}`, { shiftId: e.target.value || null }, `${t.name} updated.`)}
                            className="rounded-lg border border-gray-300 px-2 py-1"
                          >
                            <option value="">Default shift</option>
                            {s.shifts.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </select>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <h3 className="mb-2 text-sm font-semibold">People</h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="text-start text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="py-2 pe-2 font-medium">Person</th>
                        <th className="py-2 pe-2 font-medium">Team</th>
                        <th className="py-2 pe-2 font-medium">Shift</th>
                        <th className="py-2 font-medium">Remote</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {s.people.map((p) => {
                        const effective = s.shifts.find((x) => x.id === p.effectiveShiftId);
                        return (
                          <tr key={p.userId}>
                            <td className="py-2 pe-2">
                              <p className="font-medium">{p.name}</p>
                              <p className="text-xs text-gray-500">{p.email}</p>
                            </td>
                            <td className="py-2 pe-2">
                              <select
                                aria-label={`Team for ${p.name}`}
                                value={p.teamId ?? ''}
                                onChange={(e) => patch(`/attendance/people/${p.userId}`, { teamId: e.target.value || null }, `${p.name} updated.`)}
                                className="rounded-lg border border-gray-300 px-2 py-1"
                              >
                                <option value="">No team</option>
                                {s.teams.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="py-2 pe-2">
                              <select
                                aria-label={`Shift for ${p.name}`}
                                value={p.shiftId ?? ''}
                                onChange={(e) => patch(`/attendance/people/${p.userId}`, { shiftId: e.target.value || null }, `${p.name} updated.`)}
                                className="rounded-lg border border-gray-300 px-2 py-1"
                              >
                                <option value="">{p.shiftId ? 'Team or default' : `Team or default (${effective?.name ?? 'none'})`}</option>
                                {s.shifts.map((x) => (
                                  <option key={x.id} value={x.id}>
                                    {x.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="py-2">
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 accent-brand-600"
                                  checked={p.remote}
                                  onChange={(e) => patch(`/attendance/people/${p.userId}`, { remote: e.target.checked }, `${p.name} updated.`)}
                                />
                                <span className="text-gray-600">Works remotely</span>
                              </label>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-gray-500">Remote people are never flagged for checking in away from an office.</p>
              </>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

// ---- Shifts -----------------------------------------------------------------------------

const NOT_FRIDAY = [1, 2, 3, 4, 6, 7];

/** Which preset a break's days match, for the "Which days" menu. */
function breakDays(days: number[]): 'all' | 'fri' | 'notfri' | 'custom' {
  if (days.length === 0) return 'all';
  if (days.length === 1 && days[0] === 5) return 'fri';
  if (days.join() === NOT_FRIDAY.join()) return 'notfri';
  return 'custom';
}

// Zuhr gives way to Jumu'ah on Fridays.
const PRAYER_BREAKS: ShiftBreak[] = [
  { name: 'Zuhr', minutes: 15, paid: true, days: NOT_FRIDAY },
  { name: 'Asr', minutes: 15, paid: true, days: [] },
  { name: "Jumu'ah", minutes: 60, paid: true, days: [5] },
];

function Shifts({ shifts, onChange, onDone, onError }: { shifts: ShiftDto[]; onChange: () => void; onDone: (m: string) => void; onError: (m: string) => void }) {
  const api = useWorkspaceApi();
  const [editing, setEditing] = useState<ShiftDto | 'new' | null>(null);

  async function remove(x: ShiftDto) {
    if (!window.confirm(`Delete the shift "${x.name}"? Past days keep their record; people on it move to their team's or the default shift.`)) return;
    try {
      await api(`/attendance/shifts/${x.id}`, { method: 'DELETE' });
      onChange();
      onDone(`Deleted ${x.name}.`);
    } catch (err) {
      onError(errorText(err, 'Could not delete the shift.'));
    }
  }

  return (
    <Card title="Shifts" description="A shift that ends after midnight (e.g. 18:00–03:00) counts as one workday, dated by its start.">
      {shifts.length === 0 && editing === null && <p className="mb-3 text-sm text-gray-500">No shifts yet. Without one, attendance just records who checked in and for how long.</p>}
      <ul className="divide-y divide-gray-100">
        {shifts.map((x) =>
          editing !== 'new' && editing?.id === x.id ? (
            <li key={x.id} className="py-3">
              <ShiftForm shift={x} onCancel={() => setEditing(null)} onSaved={(m) => (setEditing(null), onChange(), onDone(m))} onError={onError} />
            </li>
          ) : (
            <li key={x.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {x.name} {x.isDefault && <span className="ms-1 rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">Default</span>}
                </p>
                <p className="text-gray-500">
                  {shiftHours(x)} · {WEEKDAYS.filter((d) => x.workingDays.includes(d.value)).map((d) => d.label).join(', ')} · {x.graceMinutes} min grace
                  {x.breaks.length > 0 && ` · ${x.breaks.map((b) => `${b.name} ${b.minutes}m`).join(', ')}`}
                </p>
              </div>
              <button type="button" className={btn.ghost} onClick={() => setEditing(x)}>
                Edit
              </button>
              <button type="button" className={btn.danger} onClick={() => remove(x)}>
                Delete
              </button>
            </li>
          ),
        )}
      </ul>
      {editing === 'new' ? (
        <div className="mt-3 border-t border-gray-100 pt-4">
          <ShiftForm onCancel={() => setEditing(null)} onSaved={(m) => (setEditing(null), onChange(), onDone(m))} onError={onError} />
        </div>
      ) : (
        <button type="button" className={`${btn.secondary} mt-3`} onClick={() => setEditing('new')}>
          Add shift
        </button>
      )}
    </Card>
  );
}

function ShiftForm({ shift, onCancel, onSaved, onError }: { shift?: ShiftDto; onCancel: () => void; onSaved: (m: string) => void; onError: (m: string) => void }) {
  const api = useWorkspaceApi();
  const [name, setName] = useState(shift?.name ?? '');
  const [startTime, setStart] = useState(shift?.startTime ?? '09:00');
  const [endTime, setEnd] = useState(shift?.endTime ?? '18:00');
  const [grace, setGrace] = useState(String(shift?.graceMinutes ?? 15));
  const [fullHours, setFull] = useState(String((shift?.fullDayMinutes ?? 480) / 60));
  const [halfHours, setHalf] = useState(String((shift?.halfDayMinutes ?? 240) / 60));
  const [days, setDays] = useState<number[]>(shift?.workingDays ?? [1, 2, 3, 4, 5]);
  const [breaks, setBreaks] = useState<ShiftBreak[]>(shift?.breaks ?? [{ name: 'Lunch', minutes: 45, paid: false, days: [] }]);
  const [isDefault, setDefault] = useState(shift?.isDefault ?? false);
  const [saving, setSaving] = useState(false);
  const overnight = endTime <= startTime;

  const setBreak = (i: number, b: Partial<ShiftBreak>) => setBreaks((cur) => cur.map((x, j) => (j === i ? { ...x, ...b } : x)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = shiftSchema.safeParse({
      name,
      startTime,
      endTime,
      graceMinutes: Number(grace),
      fullDayMinutes: Math.round(Number(fullHours) * 60),
      halfDayMinutes: Math.round(Number(halfHours) * 60),
      workingDays: days,
      breaks,
      isDefault,
    });
    if (!parsed.success) return onError(parsed.error.issues[0]?.message ?? 'Check the shift.');
    setSaving(true);
    try {
      await api(shift ? `/attendance/shifts/${shift.id}` : '/attendance/shifts', { method: shift ? 'PATCH' : 'POST', body: parsed.data });
      onSaved(shift ? `Saved ${name}.` : `Added ${name}.`);
    } catch (err) {
      onError(errorText(err, 'Could not save the shift.'));
    } finally {
      setSaving(false);
    }
  }

  const label = 'text-sm font-medium text-gray-700';
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-4">
        <label className="block sm:col-span-2">
          <span className={label}>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. US night shift" className={`mt-1 ${input}`} required maxLength={60} />
        </label>
        <label className="block">
          <span className={label}>Starts</span>
          <input type="time" value={startTime} onChange={(e) => setStart(e.target.value)} className={`mt-1 ${input}`} required />
        </label>
        <label className="block">
          <span className={label}>Ends {overnight && <span className="font-normal text-brand-700">(next day)</span>}</span>
          <input type="time" value={endTime} onChange={(e) => setEnd(e.target.value)} className={`mt-1 ${input}`} required />
        </label>
        <label className="block">
          <span className={label}>Grace period (min)</span>
          <input type="number" min={0} max={240} value={grace} onChange={(e) => setGrace(e.target.value)} className={`mt-1 ${input}`} />
        </label>
        <label className="block">
          <span className={label}>Full day (hours)</span>
          <input type="number" min={0.5} max={24} step={0.5} value={fullHours} onChange={(e) => setFull(e.target.value)} className={`mt-1 ${input}`} />
        </label>
        <label className="block">
          <span className={label}>Half day (hours)</span>
          <input type="number" min={0} max={24} step={0.5} value={halfHours} onChange={(e) => setHalf(e.target.value)} className={`mt-1 ${input}`} />
        </label>
      </div>
      <fieldset>
        <legend className={label}>Working days</legend>
        <div className="mt-1 flex flex-wrap gap-1">
          {WEEKDAYS.map((d) => (
            <label key={d.value} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${days.includes(d.value) ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-gray-300 text-gray-600'}`}>
              <input
                type="checkbox"
                className="sr-only"
                checked={days.includes(d.value)}
                onChange={(e) => setDays((cur) => (e.target.checked ? [...cur, d.value].sort() : cur.filter((x) => x !== d.value)))}
              />
              {d.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className={label}>Breaks</legend>
        <p className="text-xs text-gray-500">Paid breaks count as work up to their length. Going over any break is flagged.</p>
        <ul className="mt-2 space-y-2">
          {breaks.map((b, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <input value={b.name} onChange={(e) => setBreak(i, { name: e.target.value })} aria-label="Break name" className={`${input} !w-36`} maxLength={40} />
              <input type="number" min={1} max={240} value={b.minutes} onChange={(e) => setBreak(i, { minutes: Number(e.target.value) })} aria-label="Minutes" className={`${input} !w-20`} />
              <span className="text-gray-500">min</span>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={b.paid} onChange={(e) => setBreak(i, { paid: e.target.checked })} />
                Paid
              </label>
              <select
                aria-label="Which days"
                value={breakDays(b.days)}
                onChange={(e) => setBreak(i, { days: e.target.value === 'fri' ? [5] : e.target.value === 'notfri' ? [...NOT_FRIDAY] : [] })}
                className="rounded-lg border border-gray-300 px-2 py-1.5"
              >
                <option value="all">Every working day</option>
                <option value="fri">Fridays only</option>
                <option value="notfri">Not on Fridays</option>
                {breakDays(b.days) === 'custom' && <option value="custom">Some days</option>}
              </select>
              <button type="button" className="text-gray-400 hover:text-red-600" aria-label={`Remove ${b.name}`} onClick={() => setBreaks((cur) => cur.filter((_, j) => j !== i))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={btn.ghost} onClick={() => setBreaks((cur) => [...cur, { name: '', minutes: 15, paid: false, days: [] }])}>
            + Break
          </button>
          <button
            type="button"
            className={btn.ghost}
            onClick={() => setBreaks((cur) => [...cur, ...PRAYER_BREAKS.filter((p) => !cur.some((c) => c.name.toLowerCase() === p.name.toLowerCase()))])}
          >
            + Prayer breaks (Zuhr, Asr, Jumu&apos;ah)
          </button>
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isDefault} onChange={(e) => setDefault(e.target.checked)} className="h-4 w-4 accent-brand-600" />
        Default shift for anyone without a team or own shift
      </label>
      <div className="flex gap-2">
        <button type="submit" className={btn.primary} disabled={saving}>
          {saving ? 'Saving…' : shift ? 'Save shift' : 'Add shift'}
        </button>
        <button type="button" className={btn.ghost} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---- Sites -----------------------------------------------------------------------------

function Sites({ sites, onChange, onDone, onError }: { sites: SiteDto[]; onChange: () => void; onDone: (m: string) => void; onError: (m: string) => void }) {
  const api = useWorkspaceApi();
  const [editing, setEditing] = useState<SiteDto | 'new' | null>(null);

  async function remove(x: SiteDto) {
    if (!window.confirm(`Delete "${x.name}"?`)) return;
    try {
      await api(`/attendance/sites/${x.id}`, { method: 'DELETE' });
      onChange();
      onDone(`Deleted ${x.name}.`);
    } catch (err) {
      onError(errorText(err, 'Could not delete the office.'));
    }
  }

  return (
    <Card title="Offices" description="Check-ins away from every office are flagged for a manager, never blocked. With no offices set, location isn't checked.">
      <ul className="divide-y divide-gray-100">
        {sites.map((x) =>
          editing !== 'new' && editing?.id === x.id ? (
            <li key={x.id} className="py-3">
              <SiteForm site={x} onCancel={() => setEditing(null)} onSaved={(m) => (setEditing(null), onChange(), onDone(m))} onError={onError} />
            </li>
          ) : (
            <li key={x.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{x.name}</p>
                <p className="text-gray-500">
                  {x.latitude !== null && `Within ${x.radiusMeters} m of ${x.latitude.toFixed(5)}, ${x.longitude!.toFixed(5)}`}
                  {x.latitude !== null && x.ipRanges.length > 0 && ' · '}
                  {x.ipRanges.length > 0 && `Network ${x.ipRanges.join(', ')}`}
                </p>
              </div>
              <button type="button" className={btn.ghost} onClick={() => setEditing(x)}>
                Edit
              </button>
              <button type="button" className={btn.danger} onClick={() => remove(x)}>
                Delete
              </button>
            </li>
          ),
        )}
      </ul>
      {editing === 'new' ? (
        <div className="mt-3 border-t border-gray-100 pt-4">
          <SiteForm onCancel={() => setEditing(null)} onSaved={(m) => (setEditing(null), onChange(), onDone(m))} onError={onError} />
        </div>
      ) : (
        <button type="button" className={`${btn.secondary} mt-3`} onClick={() => setEditing('new')}>
          Add office
        </button>
      )}
    </Card>
  );
}

function SiteForm({ site, onCancel, onSaved, onError }: { site?: SiteDto; onCancel: () => void; onSaved: (m: string) => void; onError: (m: string) => void }) {
  const api = useWorkspaceApi();
  const [name, setName] = useState(site?.name ?? '');
  const [lat, setLat] = useState(site?.latitude?.toString() ?? '');
  const [lng, setLng] = useState(site?.longitude?.toString() ?? '');
  const [radius, setRadius] = useState(site?.radiusMeters?.toString() ?? '150');
  const [ips, setIps] = useState(site?.ipRanges.join('\n') ?? '');
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);

  function here() {
    if (!('geolocation' in navigator)) return onError('This browser can’t share its location.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(p.coords.latitude.toFixed(6));
        setLng(p.coords.longitude.toFixed(6));
        setLocating(false);
      },
      () => {
        onError('Allow location access to use your current position.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const hasGps = lat.trim() !== '' || lng.trim() !== '';
    const parsed = siteSchema.safeParse({
      name,
      latitude: hasGps ? Number(lat) : null,
      longitude: hasGps ? Number(lng) : null,
      radiusMeters: hasGps ? Number(radius) : null,
      ipRanges: ips
        .split(/[\s,]+/)
        .map((x) => x.trim())
        .filter(Boolean),
    });
    if (!parsed.success) return onError(parsed.error.issues[0]?.message ?? 'Check the office.');
    setSaving(true);
    try {
      await api(site ? `/attendance/sites/${site.id}` : '/attendance/sites', { method: site ? 'PATCH' : 'POST', body: parsed.data });
      onSaved(site ? `Saved ${name}.` : `Added ${name}.`);
    } catch (err) {
      onError(errorText(err, 'Could not save the office.'));
    } finally {
      setSaving(false);
    }
  }

  const label = 'text-sm font-medium text-gray-700';
  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className={label}>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lahore office" className={`mt-1 ${input}`} required maxLength={80} />
      </label>
      <fieldset className="grid gap-4 sm:grid-cols-4">
        <legend className={`${label} mb-1 sm:col-span-4`}>Location (optional)</legend>
        <label className="block">
          <span className="text-xs text-gray-600">Latitude</span>
          <input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="31.5204" className={`mt-1 ${input}`} />
        </label>
        <label className="block">
          <span className="text-xs text-gray-600">Longitude</span>
          <input inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="74.3587" className={`mt-1 ${input}`} />
        </label>
        <label className="block">
          <span className="text-xs text-gray-600">Radius (metres)</span>
          <input type="number" min={20} max={50000} value={radius} onChange={(e) => setRadius(e.target.value)} className={`mt-1 ${input}`} />
        </label>
        <div className="flex items-end">
          <button type="button" className={btn.ghost} onClick={here} disabled={locating}>
            {locating ? 'Locating…' : 'Use where I am now'}
          </button>
        </div>
      </fieldset>
      <label className="block">
        <span className={label}>Office network (optional)</span>
        <textarea
          value={ips}
          onChange={(e) => setIps(e.target.value)}
          rows={2}
          placeholder="203.0.113.0/24"
          className={`mt-1 ${input} font-mono`}
        />
        <span className="mt-1 block text-xs text-gray-500">Public IP addresses or ranges, one per line. Check-ins from these count as in the office even without GPS.</span>
      </label>
      <div className="flex gap-2">
        <button type="submit" className={btn.primary} disabled={saving}>
          {saving ? 'Saving…' : site ? 'Save office' : 'Add office'}
        </button>
        <button type="button" className={btn.ghost} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
