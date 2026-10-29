'use client';

import {
  PAYROLL_FIELDS,
  type DeviceImportPreviewDto,
  type DeviceImportResultDto,
  type MemberCodesDto,
  type PayrollColumn,
  type PayrollField,
  type PayrollTemplateDto,
} from '@workhub/shared';
import { useEffect, useState } from 'react';
import { Alert, Card, btn, input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { localToday } from '@/lib/time';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

const message = (err: unknown, fallback: string) => (err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : fallback);
const FIELDS = Object.entries(PAYROLL_FIELDS) as [PayrollField, string][];

/** Download a month's attendance in a template's layout. */
export function PayrollExport({ templates }: { templates: PayrollTemplateDto[] }) {
  const { workspace } = useWorkspace();
  const [month, setMonth] = useState(localToday().slice(0, 7));
  const [template, setTemplate] = useState('standard');
  const href = (format: 'xlsx' | 'csv') => `/api/attendance/export?month=${month}&template=${encodeURIComponent(template)}${format === 'csv' ? '&format=csv' : ''}&workspace=${workspace.id}`;
  const chosen = templates.find((t) => t.id === template);
  return (
    <Card title="Export for payroll" description="A row per person for the month: payable days, absences, leave, lateness and hours. Excel also has a sheet of every day.">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="text-gray-700">Month</span>
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={`mt-1 ${input} !w-44`} />
        </label>
        <label className="block min-w-0 flex-1 text-sm sm:max-w-xs">
          <span className="text-gray-700">Layout</span>
          <select value={template} onChange={(e) => setTemplate(e.target.value)} className={`mt-1 ${input}`}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <a className={btn.primary} href={href('xlsx')} download>
          Excel
        </a>
        <a className={btn.secondary} href={href('csv')} download>
          CSV
        </a>
      </div>
      {chosen && (
        <p className="mt-3 text-xs text-gray-500">
          {chosen.description ? `${chosen.description} ` : ''}Columns: {chosen.columns.map((c) => c.header).join(', ')}.
        </p>
      )}
    </Card>
  );
}

/** Saved layouts: pick columns, order them and name their headings to match your payroll software. */
export function PayrollTemplates({ templates, onChanged }: { templates: PayrollTemplateDto[]; onChanged: () => void }) {
  const api = useWorkspaceApi();
  const [editing, setEditing] = useState<{ id: string | null; name: string; columns: PayrollColumn[] } | null>(null);
  const [result, setResult] = useState<{ kind: 'error' | 'success'; text: string }>();
  const saved = templates.filter((t) => !t.builtIn);

  async function save() {
    if (!editing) return;
    setResult(undefined);
    try {
      await api(editing.id ? `/attendance/payroll/templates/${editing.id}` : '/attendance/payroll/templates', { method: editing.id ? 'PATCH' : 'POST', body: { name: editing.name, columns: editing.columns } });
      setEditing(null);
      setResult({ kind: 'success', text: 'Template saved.' });
      onChanged();
    } catch (err) {
      setResult({ kind: 'error', text: message(err, 'Could not save the template.') });
    }
  }

  const setCol = (i: number, patch: Partial<PayrollColumn>) => editing && setEditing({ ...editing, columns: editing.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const moveCol = (i: number, by: number) => {
    if (!editing) return;
    const cols = [...editing.columns];
    const [c] = cols.splice(i, 1);
    cols.splice(i + by, 0, c!);
    setEditing({ ...editing, columns: cols });
  };

  return (
    <Card title="Export layouts" description="Match the columns and headings your payroll software or accountant expects.">
      <div className="space-y-4" aria-live="polite">
        {result && <Alert kind={result.kind}>{result.text}</Alert>}
        {saved.length > 0 && (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
            {saved.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="font-medium">{t.name}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-gray-500">{t.columns.map((c) => c.header).join(', ')}</span>
                <button type="button" className={btn.ghost} onClick={() => setEditing({ id: t.id, name: t.name, columns: t.columns })}>
                  Edit
                </button>
                <button
                  type="button"
                  className={btn.danger}
                  onClick={() =>
                    confirm(`Delete “${t.name}”?`) &&
                    void api(`/attendance/payroll/templates/${t.id}`, { method: 'DELETE' })
                      .then(onChanged)
                      .catch((err) => setResult({ kind: 'error', text: message(err, 'Could not delete it.') }))
                  }
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}

        {editing ? (
          <div className="space-y-3 rounded-xl border border-gray-200 p-4">
            <label className="block text-sm">
              <span className="text-gray-700">Name</span>
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={80} placeholder="e.g. For our accountant" className={`mt-1 ${input} sm:!w-80`} />
            </label>
            <ol className="space-y-2">
              {editing.columns.map((c, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <span className="w-5 text-right text-xs text-gray-400">{i + 1}</span>
                  <select aria-label={`Column ${i + 1}`} value={c.field} onChange={(e) => setCol(i, { field: e.target.value as PayrollField, header: PAYROLL_FIELDS[e.target.value as PayrollField] })} className={`${input} !w-44`}>
                    {FIELDS.map(([f, label]) => (
                      <option key={f} value={f}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <input aria-label={`Column ${i + 1} heading`} value={c.header} onChange={(e) => setCol(i, { header: e.target.value })} maxLength={60} className={`${input} min-w-0 flex-1 sm:max-w-xs`} />
                  <button type="button" className={btn.ghost} aria-label="Move up" disabled={i === 0} onClick={() => moveCol(i, -1)}>
                    ↑
                  </button>
                  <button type="button" className={btn.ghost} aria-label="Move down" disabled={i === editing.columns.length - 1} onClick={() => moveCol(i, 1)}>
                    ↓
                  </button>
                  <button type="button" className={btn.ghost} aria-label="Remove column" disabled={editing.columns.length === 1} onClick={() => setEditing({ ...editing, columns: editing.columns.filter((_, j) => j !== i) })}>
                    ✕
                  </button>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btn.secondary} onClick={() => setEditing({ ...editing, columns: [...editing.columns, { field: 'payableDays', header: PAYROLL_FIELDS.payableDays }] })}>
                Add a column
              </button>
              <button type="button" className={btn.primary} disabled={!editing.name.trim()} onClick={() => void save()}>
                Save layout
              </button>
              <button type="button" className={btn.ghost} onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className={btn.secondary} onClick={() => setEditing({ id: null, name: '', columns: [{ field: 'employeeCode', header: 'Employee code' }, { field: 'name', header: 'Employee' }, { field: 'payableDays', header: 'Payable days' }] })}>
            New layout
          </button>
        )}
      </div>
    </Card>
  );
}

/** Employee codes for payroll, and each person's number on the attendance device. */
export function MemberCodes({ codes, onChanged }: { codes: MemberCodesDto[]; onChanged: (c: MemberCodesDto[]) => void }) {
  const api = useWorkspaceApi();
  const [error, setError] = useState<string>();

  async function save(c: MemberCodesDto, patch: Partial<Pick<MemberCodesDto, 'employeeCode' | 'deviceUserId'>>) {
    setError(undefined);
    const next = { employeeCode: c.employeeCode, deviceUserId: c.deviceUserId, ...patch };
    if (next.employeeCode === c.employeeCode && next.deviceUserId === c.deviceUserId) return;
    try {
      onChanged(await api<MemberCodesDto[]>(`/attendance/payroll/codes/${c.userId}`, { method: 'PATCH', body: next }));
    } catch (err) {
      setError(`${c.name}: ${message(err, 'Could not save.')}`);
    }
  }

  return (
    <Card title="Employee codes" description="The code payroll software knows each person by, and their user number on the fingerprint device (filled in when you import).">
      {error && (
        <div className="mb-3">
          <Alert>{error}</Alert>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-sm">
          <thead className="text-left text-xs text-gray-500">
            <tr>
              <th className="py-1.5 font-medium">Person</th>
              <th className="py-1.5 font-medium">Employee code</th>
              <th className="py-1.5 font-medium">Device number</th>
            </tr>
          </thead>
          <tbody>
            {codes.map((c) => (
              <tr key={c.userId} className="border-t border-gray-100">
                <td className="py-1.5 pr-3">
                  {c.name}
                  <span className="block text-xs text-gray-500">{c.email}</span>
                </td>
                <td className="py-1.5 pr-3">
                  <input key={`e-${c.employeeCode}`} defaultValue={c.employeeCode ?? ''} aria-label={`${c.name}’s employee code`} maxLength={40} onBlur={(e) => void save(c, { employeeCode: e.target.value.trim() || null })} className={`${input} !w-32`} />
                </td>
                <td className="py-1.5">
                  <input key={`d-${c.deviceUserId}`} defaultValue={c.deviceUserId ?? ''} aria-label={`${c.name}’s device number`} maxLength={40} onBlur={(e) => void save(c, { deviceUserId: e.target.value.trim() || null })} className={`${input} !w-28`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Import punches from a ZKTeco (or compatible) fingerprint or face device. */
export function DeviceImport({ codes, onImported }: { codes: MemberCodesDto[]; onImported: () => void }) {
  const api = useWorkspaceApi();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<DeviceImportPreviewDto>();
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<DeviceImportResultDto>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!preview) return;
    setMapping(Object.fromEntries(preview.people.map((p) => [p.deviceUserId, p.userId ?? ''])));
  }, [preview]);

  async function read(f: File) {
    setFile(f);
    setPreview(undefined);
    setResult(undefined);
    setError(undefined);
    setBusy(true);
    const form = new FormData();
    form.set('file', f);
    try {
      setPreview(await api<DeviceImportPreviewDto>('/attendance/payroll/device-import/preview', { method: 'POST', body: form }));
    } catch (err) {
      setError(message(err, 'Could not read that file.'));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    const form = new FormData();
    form.set('file', file);
    form.set('mapping', JSON.stringify(Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, v || null]))));
    try {
      setResult(await api<DeviceImportResultDto>('/attendance/payroll/device-import', { method: 'POST', body: form }));
      setPreview(undefined);
      setFile(null);
      onImported();
    } catch (err) {
      setError(message(err, 'Could not import.'));
    } finally {
      setBusy(false);
    }
  }

  const used = Object.values(mapping).filter(Boolean);
  const matched = preview?.people.filter((p) => mapping[p.deviceUserId]).length ?? 0;

  return (
    <Card title="Import from a fingerprint device" description="For ZKTeco and compatible machines. Use attlog.dat from the device's USB download, or a CSV export from ZKTime or ZKBio.">
      <div className="space-y-4" aria-live="polite">
        {error && <Alert>{error}</Alert>}
        {result && (
          <Alert kind="success">
            Imported {result.days} {result.days === 1 ? 'day' : 'days'}
            {result.singlePunchDays > 0 && ` (${result.singlePunchDays} with one punch: checked in, no check-out)`}.
            {result.keptExisting > 0 && ` Kept ${result.keptExisting} ${result.keptExisting === 1 ? 'day' : 'days'} already recorded in WorkHub.`}
            {result.alreadyImported > 0 && ` ${result.alreadyImported} ${result.alreadyImported === 1 ? 'day was' : 'days were'} already imported.`}
            {result.unmatchedPunches > 0 && ` Skipped ${result.unmatchedPunches} ${result.unmatchedPunches === 1 ? 'punch' : 'punches'} from device users you didn’t match.`}
            {result.futurePunches > 0 && ` Ignored ${result.futurePunches} ${result.futurePunches === 1 ? 'punch' : 'punches'} dated in the future (check the device clock).`}
          </Alert>
        )}
        <label className="block text-sm">
          <span className="text-gray-700">File</span>
          <input type="file" accept=".dat,.txt,.csv,text/plain,text/csv" disabled={busy} onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} className="mt-1 block text-sm" />
        </label>
        {busy && !preview && <p className="text-sm text-gray-500">Reading…</p>}

        {preview && (
          <>
            <p className="text-sm text-gray-700">
              {preview.punches.toLocaleString()} punches from {preview.people.length} device {preview.people.length === 1 ? 'user' : 'users'}, {preview.from} to {preview.to}.
              {preview.unreadable > 0 && <span className="text-amber-700"> {preview.unreadable} lines couldn’t be read{preview.examples[0] ? `, such as “${preview.examples[0].slice(0, 60)}”` : ''}.</span>}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[26rem] text-sm">
                <thead className="text-left text-xs text-gray-500">
                  <tr>
                    <th className="py-1.5 font-medium">Device number</th>
                    <th className="py-1.5 font-medium">Punches</th>
                    <th className="py-1.5 font-medium">Is</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.people.map((p) => (
                    <tr key={p.deviceUserId} className="border-t border-gray-100">
                      <td className="py-1.5 pr-3 font-mono">
                        {p.deviceUserId}
                        {p.name && <span className="block font-sans text-xs text-gray-500">{p.name}</span>}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums">{p.punches}</td>
                      <td className="py-1.5">
                        <select aria-label={`Who is device user ${p.deviceUserId}`} value={mapping[p.deviceUserId] ?? ''} onChange={(e) => setMapping({ ...mapping, [p.deviceUserId]: e.target.value })} className={`${input} !w-56`}>
                          <option value="">Skip</option>
                          {codes.map((c) => (
                            <option key={c.userId} value={c.userId} disabled={used.includes(c.userId) && mapping[p.deviceUserId] !== c.userId}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={btn.primary} disabled={busy || matched === 0} onClick={() => void run()}>
                {busy ? 'Importing…' : `Import for ${matched} ${matched === 1 ? 'person' : 'people'}`}
              </button>
              <p className="text-xs text-gray-500">Each workday’s first punch becomes the check-in and its last the check-out. Days already recorded in WorkHub stay as they are. Matches are remembered.</p>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
