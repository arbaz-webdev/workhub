// Unit tests for the attendance rules: time zones, night shifts, statuses, breaks, zones.
import type { ShiftBreak } from '@workhub/shared';
import { checkZone, deviceLabel, distanceMeters, isValidRange, normalizeIp } from '../src/attendance/location';
import { breaksOn, evaluateDay, resolveWorkday, shiftWindow, type DayEvent, type DayInput } from '../src/attendance/rules';
import { addDays, isoWeekday, zonedParts, zonedTime } from '../src/attendance/zoned';

const PK = 'Asia/Karachi'; // UTC+5, no daylight saving
const at = (localIso: string) => new Date(`${localIso}+05:00`);

describe('time zones', () => {
  it('converts Karachi wall-clock time to an instant and back', () => {
    expect(zonedTime('2026-10-21', 9 * 60, PK).toISOString()).toBe('2026-10-21T04:00:00.000Z');
    expect(zonedParts(new Date('2026-10-21T21:30:00Z'), PK)).toEqual({ date: '2026-10-22', minutes: 150 });
  });

  it('handles daylight saving (New York, spring forward on 8 March 2026)', () => {
    expect(zonedTime('2026-03-07', 9 * 60, 'America/New_York').toISOString()).toBe('2026-03-07T14:00:00.000Z');
    expect(zonedTime('2026-03-09', 9 * 60, 'America/New_York').toISOString()).toBe('2026-03-09T13:00:00.000Z');
  });

  it('does calendar arithmetic', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(isoWeekday('2026-10-23')).toBe(5); // Friday
    expect(isoWeekday('2026-10-25')).toBe(7); // Sunday
  });
});

const NIGHT = { startTime: '18:00', endTime: '03:00' };
const DAY = { startTime: '09:00', endTime: '18:00' };

describe('which workday a check-in belongs to', () => {
  it('keeps a night shift on the date it started', () => {
    const w = shiftWindow(NIGHT, '2026-10-21', PK);
    expect(w.start.toISOString()).toBe('2026-10-21T13:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-10-21T22:00:00.000Z'); // 03:00 on the 22nd
    expect(resolveWorkday(at('2026-10-22T02:00:00'), NIGHT, PK)).toBe('2026-10-21');
    expect(resolveWorkday(at('2026-10-21T17:30:00'), NIGHT, PK)).toBe('2026-10-21');
    expect(resolveWorkday(at('2026-10-22T13:00:00'), NIGHT, PK)).toBe('2026-10-22'); // early for tonight's shift
  });

  it('uses the local date for day shifts and when there is no shift', () => {
    expect(resolveWorkday(at('2026-10-21T08:10:00'), DAY, PK)).toBe('2026-10-21');
    expect(resolveWorkday(at('2026-10-21T23:00:00'), DAY, PK)).toBe('2026-10-21');
    expect(resolveWorkday(at('2026-10-21T00:30:00'), null, PK)).toBe('2026-10-21');
  });
});

const LUNCH: ShiftBreak = { name: 'Lunch', minutes: 45, paid: false, days: [] };
const PRAYER: ShiftBreak = { name: 'Prayer', minutes: 15, paid: true, days: [] };
const JUMUAH: ShiftBreak = { name: "Jumu'ah", minutes: 60, paid: true, days: [5] };

function day(events: [string, DayEvent['type'], string?][], overrides: Partial<DayInput> = {}): DayInput {
  const date = '2026-10-21';
  const w = shiftWindow(DAY, date, PK);
  return {
    date,
    workingDay: true,
    graceMinutes: 15,
    fullDayMinutes: 480,
    halfDayMinutes: 240,
    breaks: [LUNCH, PRAYER],
    scheduledStart: w.start,
    scheduledEnd: w.end,
    dayEnd: zonedTime(addDays(date, 1), 0, PK),
    events: events.map(([time, type, breakName]) => ({ type, at: at(`${date}T${time}:00`), breakName: breakName ?? null, flags: [] })),
    now: at('2026-10-21T20:00:00'),
    ...overrides,
  };
}

describe('daily status', () => {
  it('a normal day: on time, unpaid lunch taken off', () => {
    const r = evaluateDay(
      day([
        ['09:05', 'check_in'],
        ['13:00', 'break_start', 'Lunch'],
        ['13:45', 'break_end'],
        ['18:00', 'check_out'],
      ]),
    );
    expect(r).toMatchObject({ status: 'present', workedMinutes: 490, breakMinutes: 45, lateMinutes: 0, open: false, flags: [] });
  });

  it('late after the grace period', () => {
    const r = evaluateDay(day([['09:20', 'check_in'], ['18:30', 'check_out']]));
    expect(r).toMatchObject({ status: 'late', lateMinutes: 20, flags: ['late'] });
  });

  it('within the grace period is on time', () => {
    expect(evaluateDay(day([['09:15', 'check_in'], ['18:00', 'check_out']])).status).toBe('present');
  });

  it('half day, and leaving early is flagged', () => {
    const r = evaluateDay(day([['09:00', 'check_in'], ['13:30', 'check_out']]));
    expect(r).toMatchObject({ status: 'half_day', workedMinutes: 270, flags: ['left_early'] });
  });

  it('does not judge a short day until the shift is over', () => {
    const r = evaluateDay(day([['09:00', 'check_in'], ['13:00', 'check_out']], { now: at('2026-10-21T13:30:00') }));
    expect(r).toMatchObject({ status: 'present', open: false, workedMinutes: 240, flags: [] });
  });

  it('less than a half day is absent, marked short', () => {
    const r = evaluateDay(day([['09:00', 'check_in'], ['10:00', 'check_out']]));
    expect(r).toMatchObject({ status: 'absent', flags: ['left_early', 'short_day'] });
  });

  it('paid breaks count up to their allowance; going over is flagged', () => {
    const r = evaluateDay(
      day([
        ['09:00', 'check_in'],
        ['13:00', 'break_start', 'Prayer'],
        ['13:25', 'break_end'],
        ['18:00', 'check_out'],
      ]),
    );
    // 540 present − 10 unpaid minutes over the 15-minute allowance
    expect(r).toMatchObject({ workedMinutes: 530, breakMinutes: 25, flags: ['long_break'] });
  });

  it('a day in progress counts until now', () => {
    const r = evaluateDay(day([['09:00', 'check_in']], { now: at('2026-10-21T11:00:00') }));
    expect(r).toMatchObject({ status: 'present', open: true, workedMinutes: 120, checkOutAt: null });
  });

  it('shows who is on a break right now', () => {
    const r = evaluateDay(day([['09:00', 'check_in'], ['13:00', 'break_start', 'Lunch']], { now: at('2026-10-21T13:10:00') }));
    expect(r).toMatchObject({ open: true, onBreak: 'Lunch', workedMinutes: 240, breakMinutes: 10 });
  });

  it('a forgotten check-out counts to the end of the shift and is flagged', () => {
    const r = evaluateDay(day([['09:00', 'check_in']], { now: at('2026-10-22T02:00:00') }));
    expect(r).toMatchObject({ status: 'present', open: false, workedMinutes: 540, flags: ['missed_check_out'] });
  });

  it('checking out during a break ends the break', () => {
    const r = evaluateDay(day([['09:00', 'check_in'], ['17:00', 'break_start', 'Lunch'], ['17:30', 'check_out']]));
    expect(r).toMatchObject({ breakMinutes: 30, workedMinutes: 480 });
  });

  it('adds up several sessions in one day', () => {
    const r = evaluateDay(day([['09:00', 'check_in'], ['12:00', 'check_out'], ['13:00', 'check_in'], ['18:00', 'check_out']]));
    expect(r).toMatchObject({ status: 'present', workedMinutes: 480, checkInAt: at('2026-10-21T09:00:00') });
  });

  it('no check-in: not started, absent, weekend, holiday, leave', () => {
    expect(evaluateDay(day([], { now: at('2026-10-21T10:00:00') })).status).toBe('not_started');
    expect(evaluateDay(day([])).status).toBe('absent');
    expect(evaluateDay(day([], { workingDay: false })).status).toBe('weekend');
    expect(evaluateDay(day([], { holiday: true })).status).toBe('holiday');
    expect(evaluateDay(day([], { onLeave: true })).status).toBe('on_leave');
  });

  it('working on a day off is recorded, not judged', () => {
    const r = evaluateDay(day([['11:00', 'check_in'], ['13:00', 'check_out']], { workingDay: false }));
    expect(r).toMatchObject({ status: 'present', workedMinutes: 120, flags: ['day_off'] });
  });

  it('a whole night shift across midnight is one day', () => {
    const w = shiftWindow(NIGHT, '2026-10-21', PK);
    const r = evaluateDay({
      ...day([]),
      scheduledStart: w.start,
      scheduledEnd: w.end,
      events: [
        { type: 'check_in', at: at('2026-10-21T18:10:00'), breakName: null, flags: [] },
        { type: 'check_out', at: at('2026-10-22T03:00:00'), breakName: null, flags: [] },
      ],
      now: at('2026-10-22T09:00:00'),
    });
    expect(r).toMatchObject({ status: 'present', workedMinutes: 530, lateMinutes: 0, flags: [] });
  });

  it('passes event flags through', () => {
    const input = day([['09:00', 'check_in'], ['18:00', 'check_out']]);
    input.events[0]!.flags = ['outside_zone', 'offline'];
    expect(evaluateDay(input).flags).toEqual(['outside_zone', 'offline']);
  });

  it("offers the Jumu'ah break only on Fridays", () => {
    expect(breaksOn([LUNCH, JUMUAH], '2026-10-23').map((b) => b.name)).toEqual(['Lunch', "Jumu'ah"]);
    expect(breaksOn([LUNCH, JUMUAH], '2026-10-22').map((b) => b.name)).toEqual(['Lunch']);
  });
});

describe('office sites', () => {
  const office = { id: 's1', name: 'Lahore office', latitude: 31.5204, longitude: 74.3587, radiusMeters: 150, ipRanges: ['203.0.113.0/24'] };

  it('measures distance', () => {
    expect(Math.round(distanceMeters(31.5204, 74.3587, 31.5204, 74.3687))).toBeGreaterThan(900);
    expect(distanceMeters(31.5204, 74.3587, 31.5204, 74.3587)).toBe(0);
  });

  it('is in zone by office IP or by GPS within the radius', () => {
    expect(checkZone([office], { ip: '203.0.113.77' }, false)).toEqual({ inZone: true, siteId: 's1', flags: [] });
    expect(checkZone([office], { ip: '198.51.100.1', latitude: 31.5208, longitude: 74.3589, accuracyMeters: 20 }, false).inZone).toBe(true);
  });

  it('flags, rather than blocks, check-ins outside every site', () => {
    expect(checkZone([office], { ip: '198.51.100.1', latitude: 31.6, longitude: 74.4, accuracyMeters: 10 }, false)).toEqual({
      inZone: false,
      siteId: null,
      flags: ['outside_zone'],
    });
    expect(checkZone([office], { ip: '198.51.100.1' }, false).flags).toEqual(['outside_zone', 'no_location']);
  });

  it('does not check remote people or workspaces without sites', () => {
    expect(checkZone([office], { ip: '198.51.100.1' }, true).inZone).toBeNull();
    expect(checkZone([], { ip: '198.51.100.1' }, false).inZone).toBeNull();
  });

  it('caps how much GPS inaccuracy can stretch a site', () => {
    // ~1 km away with a claimed 5 km accuracy is still outside a 150 m site.
    expect(checkZone([office], { ip: null, latitude: 31.5204, longitude: 74.3687, accuracyMeters: 5000 }, false).inZone).toBe(false);
  });

  it('validates and normalises IPs', () => {
    expect(normalizeIp('::ffff:203.0.113.5')).toBe('203.0.113.5');
    expect(normalizeIp('nonsense')).toBeNull();
    expect(isValidRange('203.0.113.0/24')).toBe(true);
    expect(isValidRange('2001:db8::/32')).toBe(true);
    expect(isValidRange('203.0.113.0/33')).toBe(false);
    expect(isValidRange('300.1.1.1')).toBe(false);
  });

  it('labels devices', () => {
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36')).toBe('Chrome on Android');
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1')).toBe('Safari on iPhone');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36 Edg/140.0')).toBe('Edge on Windows');
  });
});
