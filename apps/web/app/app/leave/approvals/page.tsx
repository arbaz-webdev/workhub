'use client';

import { hasRole, type CorrectionDto, type LeaveRequestDto } from '@workhub/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { clock } from '@/components/attendance/labels';
import { LEAVE_COLOR, LeaveTabs, rangeLabel } from '@/components/leave/tabs';
import { Alert, Card, PageHeader, btn, input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages/en';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

export default function ApprovalsPage() {
  const { workspace, me } = useWorkspace();
  const api = useWorkspaceApi();
  const t = useT();
  const locale = useLocale();
  const [leave, setLeave] = useState<LeaveRequestDto[]>();
  const [corrections, setCorrections] = useState<CorrectionDto[]>();
  const [tz, setTz] = useState('Asia/Karachi');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(() => {
    api<LeaveRequestDto[]>('/leave/requests?status=pending')
      .then(setLeave)
      .catch(() => setError(t('leave.approvals.loadLeaveError')));
    api<CorrectionDto[]>('/attendance/corrections?status=pending')
      .then(setCorrections)
      .catch(() => setError(t('leave.approvals.loadCorrectionsError')));
    api<{ timezone: string }>('/workspaces/current')
      .then((w) => setTz(w.timezone))
      .catch(() => {});
  }, [api, t]);
  useEffect(load, [load]);

  if (!hasRole(workspace.role, 'manager')) {
    return (
      <>
        <PageHeader title={t('leave.title')} />
        <LeaveTabs />
        <Alert>{t('leave.approvals.managersOnly')}</Alert>
      </>
    );
  }

  async function decide(path: string, decision: 'approve' | 'reject', note: string, done: MessageKey, name: string) {
    setError(undefined);
    try {
      await api(`${path}/${decision}`, { method: 'POST', body: { note: note || undefined } });
      setNotice(t(done, { name }));
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('leave.approvals.decisionFailed'));
    }
  }

  // Your own requests wait for someone else, unless you're the owner.
  const mayDecide = (userId: string) => userId !== me.user.id || workspace.role === 'owner';
  const [timesheetsBefore, timesheetsAfter] = t('leave.approvals.timesheets').split('{link}');

  return (
    <>
      <PageHeader title={t('leave.title')} description={t('leave.approvals.description')} />
      <LeaveTabs />
      <div className="mb-4 space-y-2" aria-live="polite">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}
      </div>
      <div className="space-y-6">
        <Card title={t('leave.approvals.leaveRequests')}>
          {!leave ? (
            <p className="text-sm text-gray-500">{t('common.loading')}</p>
          ) : leave.length === 0 ? (
            <p className="text-sm text-gray-500">{t('leave.approvals.nothing')}</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {leave.map((r) => (
                <Decision
                  key={r.id}
                  canDecide={mayDecide(r.user.id)}
                  onDecide={(d, note) =>
                    decide(`/leave/requests/${r.id}`, d, note, d === 'approve' ? 'leave.approvals.leaveApproved' : 'leave.approvals.leaveRejected', r.user.name)
                  }
                >
                  <p className="font-medium">
                    {r.user.name}{' '}
                    <span className={`ms-1 rounded px-1.5 py-0.5 text-xs font-medium ${LEAVE_COLOR[r.leaveType.color]}`}>{r.leaveType.name}</span>
                  </p>
                  <p className="text-gray-600">
                    {rangeLabel(r.startDate, r.endDate, r.halfDay, locale)} · {r.days === 1 ? t('common.days.one') : t('common.days.many', { n: r.days })}
                    {r.reason && <span className="text-gray-500"> · “{r.reason}”</span>}
                  </p>
                </Decision>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t('leave.approvals.corrections')}>
          {!corrections ? (
            <p className="text-sm text-gray-500">{t('common.loading')}</p>
          ) : corrections.length === 0 ? (
            <p className="text-sm text-gray-500">{t('leave.approvals.nothing')}</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {corrections.map((c) => (
                <Decision
                  key={c.id}
                  canDecide={mayDecide(c.user.id)}
                  onDecide={(d, note) =>
                    decide(`/attendance/corrections/${c.id}`, d, note, d === 'approve' ? 'leave.approvals.correctionApproved' : 'leave.approvals.correctionRejected', c.user.name)
                  }
                >
                  <p className="font-medium">{c.user.name}</p>
                  <p className="text-gray-600">
                    {t('leave.approvals.correctionTimes', { date: rangeLabel(c.date, c.date, undefined, locale), in: clock(c.checkInAt, tz, locale), out: clock(c.checkOutAt, tz, locale) })}
                    <span className="text-gray-500"> · “{c.reason}”</span>
                  </p>
                </Decision>
              ))}
            </ul>
          )}
        </Card>

        <p className="text-sm text-gray-600">
          {timesheetsBefore}
          <Link href="/app/timesheets/approvals" className="underline">
            {t('leave.approvals.timesheetsLink')}
          </Link>
          {timesheetsAfter}
        </p>
      </div>
    </>
  );
}

function Decision({ children, canDecide, onDecide }: { children: React.ReactNode; canDecide: boolean; onDecide: (d: 'approve' | 'reject', note: string) => Promise<void> }) {
  const t = useT();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (d: 'approve' | 'reject') => {
    setBusy(true);
    await onDecide(d, note);
    setBusy(false);
  };
  return (
    <li className="flex flex-wrap items-start gap-3 py-3 text-sm">
      <div className="min-w-0 flex-1">{children}</div>
      {canDecide ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('leave.approvals.notePlaceholder')}
            aria-label={t('leave.approvals.note')}
            maxLength={500}
            className={`${input} !w-48 !py-1.5`}
          />
          <button type="button" className={`${btn.primary} !py-1.5`} disabled={busy} onClick={() => go('approve')}>
            {t('leave.approvals.approve')}
          </button>
          <button type="button" className={btn.danger} disabled={busy} onClick={() => go('reject')}>
            {t('leave.approvals.reject')}
          </button>
        </div>
      ) : (
        <span className="text-xs text-gray-500">{t('leave.approvals.own')}</span>
      )}
    </li>
  );
}
