'use client';

import { hasRole, type MoneyDto, type Role } from '@workhub/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWorkspace } from '@/lib/workspace';

const TABS: { href: string; label: string; minRole: Role }[] = [
  { href: '/app/reports/profitability', label: 'Client profitability', minRole: 'admin' },
  { href: '/app/reports/utilisation', label: 'Team utilisation', minRole: 'manager' },
  { href: '/app/reports/sales', label: 'Sales', minRole: 'manager' },
  { href: '/app/reports/costs', label: 'Costs and rates', minRole: 'admin' },
];

export function ReportTabs() {
  const pathname = usePathname();
  const { workspace } = useWorkspace();
  return (
    <nav aria-label="Reports" className="mb-8 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-white p-1 shadow-sm [scrollbar-width:none]">
      {TABS.filter((t) => hasRole(workspace.role, t.minRole)).map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm transition-colors duration-200 ${active ? 'bg-ink font-medium text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-ink'}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export const firstReport = (role: Role) => (hasRole(role, 'admin') ? '/app/reports/profitability' : '/app/reports/utilisation');

export function amount(value: number, currency?: string) {
  const n = value.toLocaleString('en', { maximumFractionDigits: 0 });
  return currency ? `${currency} ${n}` : n;
}

export function amounts(list: MoneyDto[]) {
  return list.length ? list.map((m) => amount(m.value, m.currency)).join(' + ') : '—';
}

export const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-3xl bg-white p-5 shadow-sm">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`mt-3 truncate text-2xl font-light tracking-tight ${tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-600' : 'text-ink'}`} title={value}>
        {value}
      </p>
      {hint && <p className="truncate text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

/** A horizontal bar for a share of something (0–100+). */
export function Meter({ value, label, warnAbove }: { value: number | null; label: string; warnAbove?: number }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const color = warnAbove !== undefined && (value ?? 0) > warnAbove ? 'bg-amber-400' : 'bg-brand-500';
  return (
    <div className="h-2 w-full min-w-16 overflow-hidden rounded-full bg-gray-100" role="meter" aria-valuenow={value ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={`h-full origin-left animate-grow-x rounded-full ${color}`} style={{ width: `${v}%` }} />
    </div>
  );
}

/** Downloads rows as a CSV that Excel opens correctly (UTF-8 with a byte-order mark). */
export function downloadCsv(fileName: string, rows: (string | number | null)[][]) {
  const cell = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    // Keep spreadsheet formulas from running, and quote what needs quoting.
    const safe = /^[=+\-@]/.test(s) && typeof v === 'string' ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const text = String.fromCharCode(0xfeff) + rows.map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
