'use client';

import type { AttendanceDayDto, AttendanceEventType, AttendanceTodayDto } from '@workhub/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AttendanceTabs } from '@/components/attendance/tabs';
import { clock, duration, Flags, prettyDate, shiftHours, StatusBadge } from '@/components/attendance/labels';
import { CorrectionDialog } from '@/components/attendance/correction-dialog';
import { SelfieCamera } from '@/components/attendance/selfie-camera';
import { Alert, Card, PageHeader, btn } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { deviceId, enqueue, flush, isNetworkError, queued, send, type QueuedEvent } from '@/lib/attendance-queue';
import { useLocale, useT } from '@/lib/i18n';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

/** Best-effort location: a few seconds at most, and nothing if it's refused. */
function locate(): Promise<GeolocationPosition | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 }),
  );
}

type Pending = { type: AttendanceEventType; breakName?: string };

export default function AttendancePage() {
  const { workspace } = useWorkspace();
  const api = useWorkspaceApi();
  const t = useT();
  const locale = useLocale();
  const [today, setToday] = useState<AttendanceTodayDto>();
  const [waiting, setWaiting] = useState<QueuedEvent[]>([]);
  const [camera, setCamera] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [online, setOnline] = useState(true);
  const [historyVersion, setHistoryVersion] = useState(0);

  const refreshQueue = useCallback(() => queued(workspace.id).then(setWaiting).catch(() => setWaiting([])), [workspace.id]);

  const load = useCallback(() => {
    api<AttendanceTodayDto>('/attendance/today')
      .then(setToday)
      .catch((err) => {
        if (!isNetworkError(err)) setError(t('att.loadError'));
      });
  }, [api, t]);

  // Send anything recorded offline, then show the result.
  const sync = useCallback(async () => {
    const r = await flush(workspace.id).catch(() => null);
    await refreshQueue();
    if (!r) return;
    if (r.latest) setToday(r.latest);
    if (r.sent > 0) {
      setNotice(r.sent === 1 ? t('att.syncedOne') : t('att.syncedMany', { n: r.sent }));
      setHistoryVersion((v) => v + 1);
    }
    if (r.rejected.length > 0) setError(t('att.syncFailed', { message: r.rejected[0]!.message }));
  }, [workspace.id, refreshQueue, t]);

  useEffect(() => {
    load();
    void sync();
    setOnline(navigator.onLine);
    const up = () => {
      setOnline(true);
      void sync();
    };
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    // Retry now and then too: "online" isn't always reported when a connection recovers.
    const timer = setInterval(() => void sync(), 30_000);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      clearInterval(timer);
    };
  }, [load, sync]);

  // Where you stand, counting anything still waiting to sync.
  const state = useMemo(() => {
    const last = waiting.at(-1)?.type;
    if (!last) return today?.state ?? 'out';
    return last === 'check_in' || last === 'break_end' ? 'in' : last === 'break_start' ? 'on_break' : 'out';
  }, [today, waiting]);

  function start(p: Pending) {
    setError(undefined);
    setNotice(undefined);
    const punch = p.type === 'check_in' || p.type === 'check_out';
    if (punch && today?.requireSelfie) setCamera(p);
    else void record(p);
  }

  async function record(p: Pending, selfie?: Blob) {
    setCamera(null);
    setBusy(true);
    const occurredAt = new Date().toISOString();
    const position = p.type === 'check_in' || p.type === 'check_out' ? await locate() : null;
    const event: QueuedEvent = {
      clientEventId: crypto.randomUUID(),
      workspaceId: workspace.id,
      type: p.type,
      occurredAt,
      breakName: p.breakName,
      latitude: position?.coords.latitude,
      longitude: position?.coords.longitude,
      accuracyMeters: position?.coords.accuracy,
      deviceId: deviceId(),
      selfie,
    };
    try {
      // Anything older still waiting goes first, so events arrive in order.
      if (waiting.length > 0) throw new TypeError('queue not empty');
      setToday(await send(event));
      setHistoryVersion((v) => v + 1);
    } catch (err) {
      if (isNetworkError(err)) {
        await enqueue(event);
        await refreshQueue();
        setNotice(t('att.savedOffline'));
        void sync();
      } else {
        setError(err instanceof ApiError ? err.message : t('att.genericError'));
        load();
      }
    } finally {
      setBusy(false);
    }
  }

  const day = today?.day;
  const tz = today?.timezone ?? 'Asia/Karachi';

  return (
    <>
      <PageHeader title={t('att.title')} description={t('att.description')} />
      <AttendanceTabs />
      {!online && (
        <div className="mb-4">
          <Alert>{t('att.offline')}</Alert>
        </div>
      )}
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {notice && (
        <div className="mb-4">
          <Alert kind="success">{notice}</Alert>
        </div>
      )}

      {!today ? (
        <p className="text-sm text-gray-500">{online ? t('att.loading') : t('att.connectToLoad')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm text-gray-500">{prettyDate(today.date, { weekday: 'long', day: 'numeric', month: 'long' }, locale)}</p>
                <p className="text-sm text-gray-700">
                  {today.shift ? (
                    <>
                      {today.shift.name} · {shiftHours(today.shift, locale)}
                    </>
                  ) : (
                    t('att.noShift')
                  )}
                </p>
              </div>
              <StatusBadge status={day!.status} />
            </div>

            <div className="my-6 text-center">
              <p className="text-4xl font-semibold tabular-nums">{duration(day!.workedMinutes, locale)}</p>
              <p className="mt-1 text-sm text-gray-500">
                {state === 'on_break'
                  ? t('att.onBreak', { name: day!.onBreak ?? waiting.at(-1)?.breakName ?? t('att.break') })
                  : state === 'in'
                    ? t('att.checkedInAt', { time: clock(day!.checkInAt ?? waiting.find((w) => w.type === 'check_in')?.occurredAt ?? null, tz, locale) })
                    : day!.checkOutAt
                      ? t('att.checkedOutAt', { time: clock(day!.checkOutAt, tz, locale) })
                      : t('att.notCheckedIn')}
              </p>
              {day!.flags.length > 0 && (
                <div className="mt-2">
                  <Flags flags={day!.flags} />
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              {state === 'out' && (
                <button type="button" className={`${btn.primary} !py-3 text-base`} disabled={busy} onClick={() => start({ type: 'check_in' })}>
                  {busy ? t('att.saving') : day!.checkInAt ? t('att.checkInAgain') : t('att.checkIn')}
                </button>
              )}
              {state === 'in' && (
                <>
                  <button type="button" className={`${btn.primary} !py-3 text-base`} disabled={busy} onClick={() => start({ type: 'check_out' })}>
                    {busy ? t('att.saving') : t('att.checkOut')}
                  </button>
                  <div className="flex flex-wrap gap-2">
                    {(today.breaks.length > 0 ? today.breaks.map((b) => b.name) : [t('att.break')]).map((name) => (
                      <button key={name} type="button" className={`${btn.secondary} flex-1`} disabled={busy} onClick={() => start({ type: 'break_start', breakName: name })}>
                        {name}
                        {today.breaks.find((b) => b.name === name) && (
                          <span className="ms-1 font-normal text-gray-500">{t('att.minutes', { n: today.breaks.find((b) => b.name === name)!.minutes })}</span>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {state === 'on_break' && (
                <button type="button" className={`${btn.primary} !py-3 text-base`} disabled={busy} onClick={() => start({ type: 'break_end' })}>
                  {busy ? t('att.saving') : t('att.endBreak')}
                </button>
              )}
            </div>

            {waiting.length > 0 && (
              <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">
                {waiting.length === 1 ? t('att.waitingOne') : t('att.waitingMany', { n: waiting.length })}
              </p>
            )}

            {day!.events.length > 0 && (
              <ol className="mt-6 space-y-2 border-t border-gray-100 pt-4 text-sm">
                {day!.events.map((e) => (
                  <li key={e.id} className="flex items-center gap-3">
                    {e.selfieUrl ? (
                      <a href={`/api${e.selfieUrl}`} target="_blank" rel="noopener" className="shrink-0">
                        <img src={`/api${e.selfieUrl}`} alt={t('att.selfieAlt')} className="h-9 w-9 rounded-full object-cover" loading="lazy" />
                      </a>
                    ) : (
                      <span className="h-9 w-9 shrink-0 rounded-full bg-gray-100" aria-hidden="true" />
                    )}
                    <span className="w-20 shrink-0 tabular-nums text-gray-500">{clock(e.occurredAt, tz, locale)}</span>
                    <span className="flex-1">
                      {t(`event.${e.type}`)}
                      {e.breakName && ` (${e.breakName})`}
                      {e.siteName && <span className="text-gray-500"> · {e.siteName}</span>}
                    </span>
                    <Flags flags={e.flags} />
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <History timezone={tz} currentMonth={today.date.slice(0, 7)} version={historyVersion} />
        </div>
      )}

      {camera && (
        <SelfieCamera
          title={camera.type === 'check_in' ? t('att.selfieIn') : t('att.selfieOut')}
          onCancel={() => setCamera(null)}
          onCapture={(photo) => void record(camera, photo)}
        />
      )}
    </>
  );
}

function History({ timezone, currentMonth, version }: { timezone: string; currentMonth: string; version: number }) {
  const api = useWorkspaceApi();
  const { workspace } = useWorkspace();
  const t = useT();
  const locale = useLocale();
  const [month, setMonth] = useState(currentMonth);
  const [days, setDays] = useState<AttendanceDayDto[]>();
  const [fixing, setFixing] = useState<AttendanceDayDto | null>(null);
  const [notice, setNotice] = useState<string>();
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api<AttendanceDayDto[]>(`/attendance/me?month=${month}`)
      .then(setDays)
      .catch(() => setDays([]));
  }, [api, month, version, reload]);

  const worked = days?.reduce((s, d) => s + d.workedMinutes, 0) ?? 0;
  const count = (pred: (d: AttendanceDayDto) => boolean) => days?.filter(pred).length ?? 0;

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t('att.history.title')}</h2>
        <input type="month" value={month} max={currentMonth} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label={t('att.history.month')} className="rounded-lg border border-gray-300 px-2 py-1 text-sm" />
      </div>
      {!days ? (
        <p className="text-sm text-gray-500">{t('att.loading')}</p>
      ) : days.length === 0 ? (
        <p className="text-sm text-gray-500">{t('att.history.empty')}</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-gray-600">
            {t('att.history.summary', {
              worked: duration(worked, locale),
              present: count((d) => d.status === 'present' || d.status === 'late'),
              late: count((d) => d.status === 'late'),
              absent: count((d) => d.status === 'absent'),
            })}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="text-start text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="py-2 pe-2 font-medium">{t('att.history.day')}</th>
                  <th className="py-2 pe-2 font-medium">{t('att.history.status')}</th>
                  <th className="py-2 pe-2 font-medium">{t('att.history.in')}</th>
                  <th className="py-2 pe-2 font-medium">{t('att.history.out')}</th>
                  <th className="py-2 text-end font-medium">{t('att.history.worked')}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {days.map((d) => (
                  <tr key={d.date}>
                    <td className="py-2 pe-2 text-gray-700">{prettyDate(d.date, undefined, locale)}</td>
                    <td className="py-2 pe-2">
                      <span className="flex flex-wrap items-center gap-1">
                        <StatusBadge status={d.status} />
                        {d.holidayName && <span className="text-xs text-rose-700">{d.holidayName}</span>}
                        {d.leave && (
                          <span className="text-xs text-violet-700">
                            {d.leave.typeName}
                            {d.leave.fraction < 1 && t('att.history.half')}
                          </span>
                        )}
                        <Flags flags={d.flags} />
                      </span>
                    </td>
                    <td className="py-2 pe-2 tabular-nums text-gray-600">{clock(d.checkInAt, timezone, locale)}</td>
                    <td className="py-2 pe-2 tabular-nums text-gray-600">{d.open ? t('att.history.now') : clock(d.checkOutAt, timezone, locale)}</td>
                    <td className="py-2 text-end tabular-nums">{d.workedMinutes > 0 ? duration(d.workedMinutes, locale) : '—'}</td>
                    <td className="py-2 ps-2 text-end">
                      {!d.open && d.status !== 'not_started' && d.status !== 'holiday' && d.status !== 'on_leave' && (
                        <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setFixing(d)} aria-label={t('att.history.fixLabel', { date: d.date })}>
                          {t('att.history.fix')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {notice && (
        <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700" role="status">
          {notice}
        </p>
      )}
      {fixing && (
        <CorrectionDialog
          date={fixing.date}
          timeZone={timezone}
          current={fixing}
          direct={workspace.role === 'owner'}
          onClose={() => setFixing(null)}
          onDone={(m) => {
            setFixing(null);
            setNotice(m);
            setReload((r) => r + 1);
          }}
        />
      )}
    </Card>
  );
}
