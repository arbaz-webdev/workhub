'use client';

import { hasRole, MAX_IMPORT_ROWS, type CrmEntity, type ImportMode, type ImportPreviewDto, type ImportReportDto } from '@workhub/shared';
import { useCallback, useEffect, useState } from 'react';
import { CrmTabs, errorText } from '@/components/crm/shared';
import { Alert, Card, PageHeader, btn, input, timeAgo } from '@/components/ui';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

const ENTITY_LABEL: Record<CrmEntity, string> = { lead: 'Leads', contact: 'Contacts', company: 'Companies' };
const MODE_LABEL: Record<ImportMode, string> = {
  skip: 'Skip them (keep what’s in the CRM)',
  update: 'Update them with the file’s values',
  create: 'Add them anyway, as new records',
};

export default function ImportPage() {
  const { workspace } = useWorkspace();
  const api = useWorkspaceApi();
  const [entity, setEntity] = useState<CrmEntity>('lead');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<ImportMode>('skip');
  const [report, setReport] = useState<ImportReportDto | null>(null);
  const [history, setHistory] = useState<ImportReportDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const loadHistory = useCallback(() => {
    api<ImportReportDto[]>('/crm/import/history')
      .then(setHistory)
      .catch(() => {});
  }, [api]);
  useEffect(loadHistory, [loadHistory]);

  if (!hasRole(workspace.role, 'manager')) {
    return (
      <>
        <PageHeader title="CRM" />
        <CrmTabs />
        <Alert>Only managers can import.</Alert>
      </>
    );
  }

  async function read(f: File) {
    setFile(f);
    setReport(null);
    setError(undefined);
    setBusy(true);
    const form = new FormData();
    form.set('entity', entity);
    form.set('file', f);
    try {
      const p = await api<ImportPreviewDto>('/crm/import/preview', { method: 'POST', body: form });
      setPreview(p);
      setMapping(p.suggested);
    } catch (err) {
      setPreview(null);
      setError(errorText(err, 'Could not read the file.'));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    const form = new FormData();
    form.set('entity', entity);
    form.set('mode', mode);
    form.set('mapping', JSON.stringify(mapping));
    form.set('file', file);
    try {
      setReport(await api<ImportReportDto>('/crm/import', { method: 'POST', body: form }));
      setPreview(null);
      setFile(null);
      loadHistory();
    } catch (err) {
      setError(errorText(err, 'The import failed. Nothing was saved.'));
    } finally {
      setBusy(false);
    }
  }

  const used = Object.values(mapping).filter(Boolean);

  return (
    <>
      <PageHeader title="CRM" description={`Bring in leads, contacts or companies from a spreadsheet saved as CSV (up to ${MAX_IMPORT_ROWS.toLocaleString()} rows).`} />
      <CrmTabs />
      <div className="space-y-6">
        {error && <Alert>{error}</Alert>}

        {report && (
          <Card title="Import finished">
            <ReportSummary r={report} />
          </Card>
        )}

        <Card title="1. Choose a file">
          <div className="flex flex-wrap items-end gap-4">
            <label className="block text-sm">
              <span className="text-gray-700">Import as</span>
              <select
                value={entity}
                onChange={(e) => {
                  setEntity(e.target.value as CrmEntity);
                  setPreview(null);
                  setFile(null);
                }}
                className={`mt-1 ${input} !w-44`}
              >
                {(['lead', 'contact', 'company'] as const).map((e) => (
                  <option key={e} value={e}>
                    {ENTITY_LABEL[e]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-gray-700">CSV file</span>
              <input
                type="file"
                accept=".csv,.txt,.tsv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void read(f);
                  e.target.value = '';
                }}
                className="mt-1 block text-sm file:me-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:font-medium file:text-brand-700"
              />
            </label>
            {busy && !preview && <span className="pb-2 text-sm text-gray-500">Reading…</span>}
          </div>
          <p className="mt-3 text-xs text-gray-500">From Excel or Google Sheets: File → Download / Save as → CSV. The first row must be the column names.</p>
        </Card>

        {preview && file && (
          <Card title={`2. Match the columns (${preview.total.toLocaleString()} rows in ${file.name})`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-start text-xs font-medium text-gray-500">
                  <tr>
                    <th className="py-2 pe-3">Column in the file</th>
                    <th className="py-2 pe-3">Example</th>
                    <th className="py-2">Goes into</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.headers.map((h, i) => (
                    <tr key={h} className="border-t border-gray-100">
                      <td className="py-2 pe-3 font-medium">{h}</td>
                      <td className="max-w-48 truncate py-2 pe-3 text-gray-500">{preview.sample.map((r) => r[i]).find((v) => v?.trim()) ?? '—'}</td>
                      <td className="py-2">
                        <select value={mapping[h] ?? ''} onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })} aria-label={`Field for ${h}`} className={`${input} !w-52`}>
                          <option value="">Don’t import</option>
                          {preview.targets.map((t) => (
                            <option key={t.key} value={t.key} disabled={used.includes(t.key) && mapping[h] !== t.key}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <fieldset className="mt-5 space-y-2 text-sm">
              <legend className="mb-1 font-medium text-gray-800">If someone is already in the CRM (same email or phone{entity === 'company' ? ', or same website or name' : ''})</legend>
              {(['skip', 'update', 'create'] as const).map((m) => (
                <label key={m} className="flex items-center gap-2">
                  <input type="radio" checked={mode === m} onChange={() => setMode(m)} className="accent-brand-600" />
                  {MODE_LABEL[m]}
                </label>
              ))}
            </fieldset>
            <div className="mt-5 flex gap-2">
              <button type="button" className={btn.primary} disabled={busy} onClick={() => void run()}>
                {busy ? 'Importing…' : `Import ${preview.total.toLocaleString()} rows`}
              </button>
              <button
                type="button"
                className={btn.ghost}
                onClick={() => {
                  setPreview(null);
                  setFile(null);
                }}
              >
                Cancel
              </button>
            </div>
          </Card>
        )}

        {history.length > 0 && (
          <Card title="Earlier imports">
            <ul className="divide-y divide-gray-100">
              {history.map((h) => (
                <li key={h.id} className="py-3">
                  <p className="text-sm font-medium">
                    {h.fileName} <span className="font-normal text-gray-500">· {ENTITY_LABEL[h.entity]} · {timeAgo(h.createdAt)}</span>
                  </p>
                  <ReportSummary r={h} compact />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

function ReportSummary({ r, compact = false }: { r: ImportReportDto; compact?: boolean }) {
  return (
    <div className="text-sm">
      <p className="flex flex-wrap gap-x-4 gap-y-1">
        <span className="text-emerald-700">{r.created} added</span>
        <span className="text-sky-700">{r.updated} updated</span>
        <span className="text-gray-600">{r.skipped} skipped</span>
        <span className={r.failed ? 'text-red-600' : 'text-gray-600'}>{r.failed} with problems</span>
      </p>
      {r.problems.length > 0 && (
        <details className="mt-2" open={!compact && r.failed > 0}>
          <summary className="cursor-pointer text-gray-600">Row by row</summary>
          <ul className="mt-2 max-h-60 space-y-0.5 overflow-y-auto text-xs text-gray-700">
            {r.problems.map((p, i) => (
              <li key={i}>
                Row {p.row}: {p.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
