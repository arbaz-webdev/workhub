import type { LabelColor, Locale, Priority } from '@workhub/shared';

export const LABEL_STYLES: Record<LabelColor, string> = {
  gray: 'bg-gray-100 text-gray-700',
  red: 'bg-red-100 text-red-700',
  amber: 'bg-amber-100 text-amber-800',
  green: 'bg-green-100 text-green-800',
  teal: 'bg-teal-100 text-teal-800',
  blue: 'bg-blue-100 text-blue-800',
  violet: 'bg-violet-100 text-violet-800',
  pink: 'bg-pink-100 text-pink-800',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  none: 'No priority',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const PRIORITY_STYLE: Partial<Record<Priority, string>> = {
  medium: 'bg-blue-50 text-blue-700',
  high: 'bg-amber-100 text-amber-800',
  urgent: 'bg-red-100 text-red-700',
};

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts.at(-1)![0] : '')).toUpperCase();
}

/** Today in the browser's calendar, as YYYY-MM-DD. */
export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 1.5 → "1.5h", 0.25 → "15m", 2 → "2h". */
export function hoursText(hours: number, locale: Locale = 'en') {
  if (hours > 0 && hours < 1) return locale === 'ur' ? `${Math.round(hours * 60)} منٹ` : `${Math.round(hours * 60)}m`;
  return locale === 'ur' ? `${Math.round(hours * 10) / 10} گھنٹے` : `${Math.round(hours * 10) / 10}h`;
}

/** "Today", "Tomorrow", "Overdue · 3 Oct" or "12 Nov". Dates are YYYY-MM-DD in the workspace's calendar. */
export function dueLabel(due: string, completed: boolean): { text: string; overdue: boolean } {
  const today = new Date();
  const todayStr = localToday();
  const d = new Date(`${due}T00:00:00`);
  const pretty = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  if (due === todayStr) return { text: 'Today', overdue: false };
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (d.getTime() === tomorrow.getTime()) return { text: 'Tomorrow', overdue: false };
  const overdue = !completed && due < todayStr;
  return { text: overdue ? `Overdue · ${pretty}` : pretty, overdue };
}
