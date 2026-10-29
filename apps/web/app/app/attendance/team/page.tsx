'use client';

import { hasRole, type AttendanceStatus, type TeamAttendanceDto } from '@workhub/shared';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { clock, duration, Flags, INFO_FLAGS, prettyDate, STATUS_LABEL, StatusBadge } from '@/components/attendance/labels';
import { CorrectionDialog } from '@/components/attendance/correction-dialog';
import { AttendanceTabs } from '@/components/attendance/tabs';
import { Alert, PageHeader, btn } from '@/components/ui';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

const SUMMARY_ORDER: AttendanceStatus[] = ['present', 'late', 'half_day', 'absent', 'not_started', 'on_leave', 'holiday', 'weekend'];

function shift(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function TeamAttendancePage() {
  const { workspace, me } = useWorkspace();
  const api = useWorkspaceApi();
  const [date, setDate] = useState<string>();
  const [data, setData] = useState<TeamAttendanceDto>();
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState<AttendanceStatus | 'flagged' | ''>('');
  const [notice, setNotice] = useState<string>();
  const [correcting, setCorrecting] = useState<TeamAttendanceDto['rows'][number] | null>(null);

  const load = useCallback(() => {
    setError(undefined);
    api<TeamAttendanceDto>(`/attendance/team${date ? `?date=${date}` : ''}`)
      .then((d) => {
        setData(d);
        setDate((cur) => cur ?? d.date);
      })
      .catch(() => setError('Could not load the team’s attendance.'));
  }, [api, date]);

  useEffect(load, [load]);

  const tz = data?.timezone ?? 'Asia/Karachi';
  const rows = useMemo(() => {
    if (!data) return [];
    if (filter === 'flagged') return data.rows.filter((r) => r.day.flags.some((f) => f !== 'late' && !INFO_FLAGS.has(f)));
    return filter ? data.rows.filter((r) => r.day.status === filter) : data.rows;
  }, [data, filter]);

  if (!hasRole(workspace.role, 'manager')) {
    return (
      <>
        <PageHeader title="Attendance" />
        <AttendanceTabs />
        <Alert>Only managers can see the team&apos;s attendance.</Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Attendance" description="Who's in, who's late, and anything that needs a look." />
      <AttendanceTabs />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" className={btn.ghost} onClick={() => date && setDate(shift(date, -1))} aria-label="Previous day">
          ←
        </button>
        <input type="date" value={date ?? ''} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
        <button type="button" className={btn.ghost} onClick={() => date && setDate(shift(date, 1))} aria-label="Next day">
          →
        </button>
        {data && <span className="text-sm font-medium text-gray-700">{prettyDate(data.date, { weekday: 'long', day: 'numeric', month: 'long' })}</span>}
        <span className="ms-auto flex flex-wrap items-center gap-2">
          {data && (
            <>
              <a className={btn.secondary} href={`/api/attendance/export?month=${data.date.slice(0, 7)}&workspace=${workspace.id}`} download>
                Export month (Excel)
              </a>
              <a className={btn.ghost} href={`/api/attendance/export?month=${data.date.slice(0, 7)}&format=csv&workspace=${workspace.id}`} download>
                CSV
              </a>
            </>
          )}
          <button type="button" className={btn.ghost} onClick={load}>
            Refresh
          </button>
        </span>
      </div>
      {notice && (
        <div className="mb-4">
          <Alert kind="success">{notice}</Alert>
        </div>
      )}

      {error && <Alert>{error}</Alert>}
      {data && (
        <>
          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
            <Chip active={filter === ''} onClick={() => setFilter('')}>
              Everyone <b>{data.rows.length}</b>
            </Chip>
            {SUMMARY_ORDER.filter((s) => data.summary[s] > 0).map((s) => (
              <Chip key={s} active={filter === s} onClick={() => setFilter(filter === s ? '' : s)}>
                {STATUS_LABEL[s]} <b>{data.summary[s]}</b>
              </Chip>
            ))}
            <Chip active={filter === 'flagged'} onClick={() => setFilter(filter === 'flagged' ? '' : 'flagged')}>
              Needs a look <b>{data.rows.filter((r) => r.day.flags.some((f) => f !== 'late' && !INFO_FLAGS.has(f))).length}</b>
            </Chip>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-start text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Person</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Shift</th>
                  <th className="px-3 py-2">In</th>
                  <th className="px-3 py-2">Out</th>
                  <th className="px-3 py-2 text-end">Worked</th>
                  <th className="px-3 py-2">Selfies</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const selfies = r.day.events.filter((e) => e.selfieUrl);
                  const firstIn = r.day.events.find((e) => e.type === 'check_in');
                  return (
                    <tr key={r.userId} className="border-b border-gray-100 align-top last:border-0">
                      <td className="px-3 py-2">
                        <p className="font-medium text-gray-900">{r.name}</p>
                        <p className="text-xs text-gray-500">
                          {r.teamName ?? 'No team'}
                          {r.remote && ' · Remote'}
                        </p>
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex flex-wrap items-center gap-1">
                          <StatusBadge status={r.day.status} />
                          {r.day.holidayName && <span className="text-xs text-rose-700">{r.day.holidayName}</span>}
                          {r.day.leave && <span className="text-xs text-violet-700">{r.day.leave.typeName}{r.day.leave.fraction < 1 && ' (half)'}</span>}
                          {r.day.onBreak && <span className="text-xs text-gray-500">On break</span>}
                          {r.day.lateMinutes > 0 && <span className="text-xs text-amber-700">{duration(r.day.lateMinutes)} late</span>}
                        </span>
                        <div className="mt-1">
                          <Flags flags={r.day.flags} />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-gray-600">{r.day.shiftName ?? '—'}</td>
                      <td className="px-3 py-2 tabular-nums text-gray-600">
                        {clock(r.day.checkInAt, tz)}
                        {firstIn && (firstIn.device || firstIn.siteName) && (
                          <p className="text-xs text-gray-400">{[firstIn.siteName, firstIn.device].filter(Boolean).join(' · ')}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-gray-600">{r.day.open ? <span className="text-green-700">Working</span> : clock(r.day.checkOutAt, tz)}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{r.day.workedMinutes > 0 ? duration(r.day.workedMinutes) : '—'}</td>
                      <td className="px-3 py-2">
                        <span className="flex gap-1">
                          {selfies.map((e) => (
                            <a key={e.id} href={`/api${e.selfieUrl}`} target="_blank" rel="noopener" title={`${e.type === 'check_in' ? 'Check-in' : 'Check-out'} ${clock(e.occurredAt, tz)}`}>
                              <img src={`/api${e.selfieUrl}`} alt={`${r.name} at ${clock(e.occurredAt, tz)}`} className="h-8 w-8 rounded-full object-cover" loading="lazy" />
                            </a>
                          ))}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-end">
                        {/* Nobody corrects their own day directly, except the owner. */}
                        {r.day.status !== 'not_started' && !r.day.open && (r.userId !== me.user.id || workspace.role === 'owner') && (
                          <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setCorrecting(r)}>
                            Correct
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-10 text-center text-gray-500">
                      Nobody matches this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {correcting && data && (
            <CorrectionDialog
              date={data.date}
              timeZone={tz}
              userId={correcting.userId}
              personName={correcting.name}
              direct
              current={correcting.day}
              onClose={() => setCorrecting(null)}
              onDone={(m) => {
                setCorrecting(null);
                setNotice(`${m} ${correcting.name} has been told.`);
                load();
              }}
            />
          )}
          <p className="mt-3 text-xs text-gray-500">
            Corrections people ask for are on the <Link href="/app/leave/approvals" className="underline">Approvals</Link> page.
          </p>
          {hasRole(workspace.role, 'admin') && (
            <p className="mt-3 text-xs text-gray-500">
              Set shifts, breaks and office locations in <Link href="/app/attendance/settings" className="underline">Shifts and offices</Link>.
            </p>
          )}
        </>
      )}
    </>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm ${active ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
    >
      {children}
    </button>
  );
}
