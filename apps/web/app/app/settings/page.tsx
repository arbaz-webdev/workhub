'use client';

import {
  CURRENCIES,
  hasRole,
  updateWorkspaceSchema,
  WEEKDAYS,
  type WorkspaceSettingsDto,
} from '@workhub/shared';
import { useEffect, useMemo, useState } from 'react';
import { SettingsTabs } from '@/components/settings/tabs';
import { TwoFactorRule } from '@/components/settings/two-factor-rule';
import { Alert, Card, PageHeader, btn, input, Loading } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

const COMMON_ZONES = ['Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'UTC'];

export default function SettingsPage() {
  const { workspace, refresh } = useWorkspace();
  const api = useWorkspaceApi();
  const canEdit = hasRole(workspace.role, 'admin');
  const [settings, setSettings] = useState<WorkspaceSettingsDto>();
  const [days, setDays] = useState<number[]>([]);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ kind: 'error' | 'success'; message: string }>();

  const zones = useMemo(() => {
    const all = Intl.supportedValuesOf('timeZone');
    return [...COMMON_ZONES, ...all.filter((z) => !COMMON_ZONES.includes(z))];
  }, []);

  useEffect(() => {
    api<WorkspaceSettingsDto>('/workspaces/current')
      .then((s) => {
        setSettings(s);
        setDays(s.workingDays);
      })
      .catch(() => setResult({ kind: 'error', message: 'Could not load settings.' }));
  }, [api]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const parsed = updateWorkspaceSchema.safeParse({
      name: form.get('name'),
      timezone: form.get('timezone'),
      currency: form.get('currency'),
      workingDays: days,
    });
    if (!parsed.success) {
      setResult({ kind: 'error', message: parsed.error.issues[0]?.message ?? 'Check the form' });
      return;
    }
    setPending(true);
    setResult(undefined);
    try {
      setSettings(await api<WorkspaceSettingsDto>('/workspaces/current', { method: 'PATCH', body: parsed.data }));
      setResult({ kind: 'success', message: 'Settings saved.' });
      void refresh(); // the name shows in the top bar
    } catch (err) {
      setResult({ kind: 'error', message: err instanceof ApiError ? err.message : 'Could not save settings.' });
    } finally {
      setPending(false);
    }
  }

  const toggleDay = (d: number) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));

  return (
    <>
      <PageHeader title="Settings" description="These settings apply to everyone in the workspace." />
      <SettingsTabs />
      {!settings ? (
        <Loading />
      ) : (
        <Card>
          <form onSubmit={onSubmit} className="space-y-5">
            <fieldset disabled={!canEdit || pending} className="space-y-5">
              <label className="block max-w-md">
                <span className="text-sm font-medium text-gray-700">Company name</span>
                <input name="name" defaultValue={settings.name} className={`mt-1 ${input}`} />
              </label>
              <div className="grid max-w-md gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Time zone</span>
                  <select name="timezone" defaultValue={settings.timezone} className={`mt-1 ${input}`}>
                    {zones.map((z) => (
                      <option key={z} value={z}>
                        {z.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Currency</span>
                  <select name="currency" defaultValue={settings.currency} className={`mt-1 ${input}`}>
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
              <fieldset>
                <legend className="text-sm font-medium text-gray-700">Working days</legend>
                <p className="text-xs text-gray-500">Used for attendance: days off aren&apos;t counted as absent.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {WEEKDAYS.map((d) => {
                    const on = days.includes(d.value);
                    return (
                      <button
                        key={d.value}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleDay(d.value)}
                        className={`w-12 rounded-lg border py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${
                          on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-300 text-gray-600'
                        }`}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            </fieldset>
            {result && <Alert kind={result.kind}>{result.message}</Alert>}
            {canEdit ? (
              <button type="submit" disabled={pending} className={btn.primary}>
                {pending ? 'Saving…' : 'Save changes'}
              </button>
            ) : (
              <p className="text-sm text-gray-500">Only admins and the owner can change these settings.</p>
            )}
          </form>
        </Card>
      )}
      {workspace.role === 'owner' && <TwoFactorRule />}
    </>
  );
}
