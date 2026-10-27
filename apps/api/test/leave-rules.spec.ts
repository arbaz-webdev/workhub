// Unit tests for leave arithmetic, Pakistan's holiday list and leave in day statuses.
import { evaluateDay, shiftWindow } from '../src/attendance/rules';
import { addDays, zonedTime } from '../src/attendance/zoned';
import { pakistanHolidays } from '../src/leave/holidays-pk';
import { entitlement, leaveDates, sumDays, weekStart } from '../src/leave/leave-rules';

const MON_FRI = [1, 2, 3, 4, 5];

describe('leave days', () => {
  it('counts working days only', () => {
    // Fri 2026-10-23 to Tue 2026-10-27: Fri, Mon, Tue
    expect(sumDays(leaveDates('2026-10-23', '2026-10-27', 'none', MON_FRI, new Set()))).toBe(3);
  });

  it('skips holidays', () => {
    // Mon 23 Mar 2026 is Pakistan Day
    const dates = leaveDates('2026-03-23', '2026-03-24', 'none', MON_FRI, new Set(['2026-03-23']));
    expect(dates).toEqual([{ date: '2026-03-24', fraction: 1 }]);
  });

  it('counts a half day as 0.5', () => {
    expect(sumDays(leaveDates('2026-10-26', '2026-10-26', 'first', MON_FRI, new Set()))).toBe(0.5);
  });

  it('follows the person’s own working days (a six-day week)', () => {
    expect(sumDays(leaveDates('2026-10-24', '2026-10-24', 'none', [1, 2, 3, 4, 5, 6], new Set()))).toBe(1);
    expect(sumDays(leaveDates('2026-10-24', '2026-10-24', 'none', MON_FRI, new Set()))).toBe(0);
  });
});

describe('entitlement', () => {
  const annual = { daysPerYear: 14, accrual: 'monthly' as const };
  const casual = { daysPerYear: 10, accrual: 'yearly' as const };

  it('gives yearly leave all at once, prorated for joiners', () => {
    expect(entitlement(casual, 2026, '2024-05-01', '2026-02-01')).toBe(10);
    expect(entitlement(casual, 2026, '2026-07-15', '2026-08-01')).toBe(5); // July–December
  });

  it('earns monthly leave a twelfth at a time, rounded down to half days', () => {
    expect(entitlement(annual, 2026, '2024-01-01', '2026-03-10')).toBe(3.5); // 14 × 3 / 12
    expect(entitlement(annual, 2026, '2024-01-01', '2027-01-05')).toBe(14); // a past year: all of it
    expect(entitlement(annual, 2026, '2026-10-20', '2026-12-01')).toBe(3.5); // Oct–Dec: 14 × 3 / 12
  });

  it('gives nothing before joining, and no limit for unlimited types', () => {
    expect(entitlement(casual, 2025, '2026-01-01', '2026-06-01')).toBe(0);
    expect(entitlement({ daysPerYear: null, accrual: 'yearly' }, 2026, '2020-01-01', '2026-06-01')).toBeNull();
  });

  it('finds the Monday of a week', () => {
    expect(weekStart('2026-10-25')).toBe('2026-10-19'); // Sunday → Monday before
    expect(weekStart('2026-10-19')).toBe('2026-10-19');
  });
});

describe('Pakistan holidays', () => {
  it('has the fixed public holidays every year', () => {
    const names = pakistanHolidays(2031).map((h) => `${h.date} ${h.name}`);
    expect(names).toEqual(
      expect.arrayContaining(['2031-02-05 Kashmir Solidarity Day', '2031-03-23 Pakistan Day', '2031-08-14 Independence Day', '2031-12-25 Quaid-e-Azam Day']),
    );
    expect(pakistanHolidays(2031).every((h) => !h.estimated)).toBe(true);
  });

  it('adds estimated Eid dates for the years it knows, with stable keys', () => {
    const y = pakistanHolidays(2027);
    const fitr = y.filter((h) => h.name.startsWith('Eid ul-Fitr'));
    expect(fitr.map((h) => h.date)).toEqual(['2027-03-10', '2027-03-11', '2027-03-12']);
    expect(fitr.every((h) => h.estimated)).toBe(true);
    expect(new Set(y.map((h) => h.key)).size).toBe(y.length);
  });
});

describe('leave in daily status', () => {
  const PK = 'Asia/Karachi';
  const date = '2026-10-21';
  const at = (t: string) => new Date(`${date}T${t}:00+05:00`);
  const w = shiftWindow({ startTime: '09:00', endTime: '18:00' }, date, PK);
  const base = {
    date,
    workingDay: true,
    graceMinutes: 15,
    fullDayMinutes: 480,
    halfDayMinutes: 240,
    breaks: [],
    scheduledStart: w.start,
    scheduledEnd: w.end,
    dayEnd: zonedTime(addDays(date, 1), 0, PK),
    now: at('20:00'),
  };

  it('a full day of leave is on leave', () => {
    expect(evaluateDay({ ...base, events: [], leaveFraction: 1 }).status).toBe('on_leave');
  });

  it('a half day of leave halves the hours owed and skips lateness', () => {
    const r = evaluateDay({
      ...base,
      leaveFraction: 0.5,
      events: [
        { type: 'check_in', at: at('13:30'), breakName: null, flags: [] },
        { type: 'check_out', at: at('18:00'), breakName: null, flags: [] },
      ],
    });
    expect(r).toMatchObject({ status: 'present', workedMinutes: 270, lateMinutes: 0, flags: ['half_day_leave'] });
  });

  it('half a day off with no work at all is absent for the other half', () => {
    expect(evaluateDay({ ...base, events: [], leaveFraction: 0.5 })).toMatchObject({ status: 'absent', flags: ['half_day_leave'] });
  });

  it('a holiday beats leave', () => {
    expect(evaluateDay({ ...base, events: [], holiday: true, leaveFraction: 1 }).status).toBe('holiday');
  });
});
