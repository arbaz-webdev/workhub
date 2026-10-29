'use client';

import type { LeaveCalendarDto } from '@workhub/shared';
import { useEffect, useMemo, useState } from 'react';
import { prettyDate } from '@/components/attendance/labels';
import { LEAVE_COLOR, LeaveTabs } from '@/components/leave/tabs';
import { Alert, PageHeader, btn } from '@/components/ui';
import { useLocale, useT } from '@/lib/i18n';
import { useWorkspaceApi } from '@/lib/workspace';

function shiftMonth(month: string, by: number) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

export default function LeaveCalendarPage() {
  const api = useWorkspaceApi();
  const t = useT();
  const locale = useLocale();
  const [month, setMonth] = useState<string>();
  const [data, setData] = useState<LeaveCalendarDto>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api<LeaveCalendarDto>(`/leave/calendar${month ? `?month=${month}` : ''}`)
      .then((d) => {
        setData(d);
        setMonth((m) => m ?? d.month);
      })
      .catch(() => setError(t('leave.calendar.loadError')));
  }, [api, month, t]);

  const dates = useMemo(() => {
    if (!data) return [];
    const [y, m] = data.month.split('-').map(Number) as [number, number];
    const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return Array.from({ length: count }, (_, i) => `${data.month}-${String(i + 1).padStart(2, '0')}`);
  }, [data]);
  const holidays = useMemo(() => new Map(data?.holidays.map((h) => [h.date, h.name]) ?? []), [data]);
  const weekend = (d: string) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

  return (
    <>
      <PageHeader title={t('leave.title')} description={t('leave.calendar.description')} />
      <LeaveTabs />
      {error && <Alert>{error}</Alert>}
      <div className="mb-4 flex items-center gap-2">
        <button type="button" className={btn.ghost} aria-label={t('leave.calendar.prev')} onClick={() => month && setMonth(shiftMonth(month, -1))}>
          <span className="inline-block rtl:rotate-180" aria-hidden="true">
            ←
          </span>
        </button>
        <span className="min-w-36 text-center font-medium">{data && prettyDate(`${data.month}-01`, { month: 'long', year: 'numeric' }, locale)}</span>
        <button type="button" className={btn.ghost} aria-label={t('leave.calendar.next')} onClick={() => month && setMonth(shiftMonth(month, 1))}>
          <span className="inline-block rtl:rotate-180" aria-hidden="true">
            →
          </span>
        </button>
      </div>
      {data && (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="sticky start-0 z-10 min-w-40 bg-white px-3 py-2 text-start font-medium text-gray-500">{t('leave.calendar.person')}</th>
                  {dates.map((d) => (
                    <th
                      key={d}
                      title={holidays.get(d)}
                      className={`w-8 min-w-8 px-0 py-2 text-center font-medium ${holidays.has(d) ? 'bg-rose-50 text-rose-700' : weekend(d) ? 'bg-gray-50 text-gray-400' : 'text-gray-500'}`}
                    >
                      {Number(d.slice(8))}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.people.map((p) => {
                  const byDate = new Map(p.entries.map((e) => [e.date, e]));
                  return (
                    <tr key={p.userId} className="border-t border-gray-100">
                      <td className="sticky start-0 z-10 bg-white px-3 py-1.5 text-sm text-gray-800">{p.name}</td>
                      {dates.map((d) => {
                        const e = byDate.get(d);
                        return (
                          <td key={d} className={`h-8 p-0.5 ${holidays.has(d) ? 'bg-rose-50' : weekend(d) ? 'bg-gray-50' : ''}`}>
                            {e && (
                              <span
                                title={`${e.typeName}${e.fraction < 1 ? t('leave.calendar.halfDay') : ''}${e.status === 'pending' ? t('leave.calendar.pending') : ''}`}
                                className={`block h-full rounded ${LEAVE_COLOR[e.color]?.split(' ')[0]} ${e.status === 'pending' ? 'opacity-50 [background-image:repeating-linear-gradient(45deg,transparent_0,transparent_3px,rgba(255,255,255,.7)_3px,rgba(255,255,255,.7)_6px)]' : ''} ${e.fraction < 1 ? 'w-1/2' : ''}`}
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-gray-500">{t('leave.calendar.legend')}</p>
          {data.holidays.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2 text-xs">
              {data.holidays.map((h) => (
                <li key={h.id} className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-700">
                  {Number(h.date.slice(8))} · {h.name}
                  {h.estimated && t('leave.calendar.estimated')}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
