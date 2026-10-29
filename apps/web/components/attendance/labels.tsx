import type { AttendanceEventType, AttendanceFlag, AttendanceStatus } from '@workhub/shared';

export const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  half_day: 'Half day',
  absent: 'Absent',
  on_leave: 'On leave',
  holiday: 'Holiday',
  weekend: 'Day off',
  not_started: 'Not checked in',
};

const STATUS_STYLE: Record<AttendanceStatus, string> = {
  present: 'bg-green-100 text-green-800',
  late: 'bg-amber-100 text-amber-800',
  half_day: 'bg-blue-100 text-blue-800',
  absent: 'bg-red-100 text-red-700',
  on_leave: 'bg-violet-100 text-violet-800',
  holiday: 'bg-teal-100 text-teal-800',
  weekend: 'bg-gray-100 text-gray-600',
  not_started: 'bg-gray-100 text-gray-600',
};

export const FLAG_LABEL: Record<AttendanceFlag, string> = {
  late: 'Late',
  left_early: 'Left early',
  long_break: 'Long break',
  missed_check_out: 'No check-out',
  short_day: 'Short day',
  day_off: 'Worked a day off',
  outside_zone: 'Outside office',
  no_location: 'No location',
  offline: 'Synced later',
  half_day_leave: 'Half day leave',
  corrected: 'Corrected',
  device: 'From the device',
};

/** Flags that are just information, not something to look into. */
export const INFO_FLAGS = new Set<AttendanceFlag>(['day_off', 'offline', 'half_day_leave', 'corrected', 'device']);

export const EVENT_LABEL: Record<AttendanceEventType, string> = {
  check_in: 'Checked in',
  check_out: 'Checked out',
  break_start: 'Started break',
  break_end: 'Ended break',
};

export function StatusBadge({ status }: { status: AttendanceStatus }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}

/** Flags worth a manager's attention, as small chips. `late` is already in the status. */
export function Flags({ flags }: { flags: AttendanceFlag[] }) {
  const shown = flags.filter((f) => f !== 'late');
  if (shown.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {shown.map((f) => (
        <span
          key={f}
          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${INFO_FLAGS.has(f) ? 'bg-gray-100 text-gray-600' : 'bg-amber-50 text-amber-800'}`}
        >
          {FLAG_LABEL[f]}
        </span>
      ))}
    </span>
  );
}

/** 125 → "2h 05m". */
export function duration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** A time in the workspace's time zone, e.g. "9:05 AM". */
export function clock(iso: string | null, timeZone: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone });
}

export function prettyDate(date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
}

/** "09:00–18:00" with "(next day)" for overnight shifts. */
export function shiftHours(s: { startTime: string; endTime: string; overnight: boolean }) {
  return `${s.startTime}–${s.endTime}${s.overnight ? ' (next day)' : ''}`;
}
