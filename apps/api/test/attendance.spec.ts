import type { INestApplication } from '@nestjs/common';
import { WORKSPACE_HEADER, type AttendanceDayDto, type AttendanceSettingsDto, type AttendanceTodayDto, type ShiftDto, type TeamAttendanceDto } from '@workhub/shared';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SelfieCleanupService } from '../src/attendance/selfie-cleanup.service';
import { addDays, zonedParts, zonedTime } from '../src/attendance/zoned';
import { createApp, signUp, withAdmin } from './helpers';

const PK = 'Asia/Karachi';
// The smallest thing that passes as a JPEG (selfies are checked by their bytes).
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);

let app: INestApplication;
let owner: Awaited<ReturnType<typeof signUp>>;
let manager: Awaited<ReturnType<typeof signUp>>;
let member: Awaited<ReturnType<typeof signUp>>;
let guest: Awaited<ReturnType<typeof signUp>>;
let rival: Awaited<ReturnType<typeof signUp>>;
let ws: string;
const H = () => ({ [WORKSPACE_HEADER]: ws });

async function join_(person: typeof owner, role: string) {
  await withAdmin((db) => db.query('insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)', [ws, person.user.id, role]));
}

const hhmm = (minutes: number) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** A shift that started `minutesAgo` minutes ago (Karachi time), every day of the week. */
function shiftStartedAgo(minutesAgo: number, extra: Record<string, unknown> = {}) {
  const now = zonedParts(new Date(), PK).minutes;
  return {
    name: `Shift ${randomUUID().slice(0, 6)}`,
    startTime: hhmm(now - minutesAgo),
    endTime: hhmm(now - minutesAgo + 8 * 60),
    graceMinutes: 15,
    workingDays: [1, 2, 3, 4, 5, 6, 7],
    breaks: [
      { name: 'Lunch', minutes: 45, paid: false },
      { name: 'Prayer', minutes: 15, paid: true },
    ],
    ...extra,
  };
}

function punch(agent: typeof owner.agent, type: string, fields: Record<string, string> = {}, selfie = true) {
  let req = agent.post('/attendance/events').set(H()).field('type', type);
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  if (selfie) req = req.attach('selfie', JPEG, { filename: 'me.jpg', contentType: 'image/jpeg' });
  return req;
}

async function newPerson(prefix: string, role = 'member') {
  const p = await signUp(app, prefix, `${prefix} home`);
  await join_(p, role);
  return p;
}

beforeAll(async () => {
  app = await createApp();
  owner = await signUp(app, 'owner', 'Night Shift BPO');
  ws = owner.workspace.id;
  manager = await signUp(app, 'manager', 'M home');
  member = await signUp(app, 'member', 'Mem home');
  guest = await signUp(app, 'guest', 'G home');
  rival = await signUp(app, 'rival', 'Rival BPO');
  await join_(manager, 'manager');
  await join_(member, 'member');
  await join_(guest, 'guest');
});

afterAll(async () => {
  await app.close();
});

describe('attendance settings', () => {
  it('only admins manage shifts and sites', async () => {
    await member.agent.get('/attendance/settings').set(H()).expect(403);
    await manager.agent.post('/attendance/shifts').set(H()).send(shiftStartedAgo(0)).expect(403);
    const s = await owner.agent.get('/attendance/settings').set(H()).expect(200);
    expect(s.body).toMatchObject({ requireSelfie: true, timezone: PK, shifts: [], sites: [] });
  });

  it('validates shifts, and makes the first one the default', async () => {
    await owner.agent.post('/attendance/shifts').set(H()).send({ name: 'Bad', startTime: '09:00', endTime: '09:00' }).expect(400);
    await owner.agent.post('/attendance/shifts').set(H()).send({ name: 'Bad', startTime: '25:00', endTime: '09:00' }).expect(400);
    await owner.agent
      .post('/attendance/shifts')
      .set(H())
      .send({ name: 'Bad', startTime: '09:00', endTime: '17:00', fullDayMinutes: 240, halfDayMinutes: 300 })
      .expect(400);
    const night = await owner.agent
      .post('/attendance/shifts')
      .set(H())
      .send({ name: 'US night', startTime: '18:00', endTime: '03:00', breaks: [{ name: "Jumu'ah", minutes: 60, paid: true, days: [5] }] })
      .expect(201);
    expect(night.body).toMatchObject({ name: 'US night', overnight: true, isDefault: true, workingDays: [1, 2, 3, 4, 5] });
    const day = await owner.agent.post('/attendance/shifts').set(H()).send({ name: 'Day', startTime: '09:00', endTime: '18:00' }).expect(201);
    expect(day.body.isDefault).toBe(false);
  });

  it('stores IP ranges as networks and refuses bad ones', async () => {
    await owner.agent.post('/attendance/sites').set(H()).send({ name: 'Bad', ipRanges: ['10.0.0.1/40'] }).expect(400);
    await owner.agent.post('/attendance/sites').set(H()).send({ name: 'Nothing' }).expect(400);
    await owner.agent.post('/attendance/sites').set(H()).send({ name: 'Half', latitude: 31.5 }).expect(400);
    const site = await owner.agent.post('/attendance/sites').set(H()).send({ name: 'Branch', ipRanges: ['198.51.100.77/24'] }).expect(201);
    expect(site.body.ipRanges).toEqual(['198.51.100.0/24']);
    await owner.agent.delete(`/attendance/sites/${site.body.id}`).set(H()).expect(204);
  });

  it('assigns shifts to teams and people; a person’s own shift wins', async () => {
    const s = (await owner.agent.get('/attendance/settings').set(H())).body as AttendanceSettingsDto;
    const night = s.shifts.find((x) => x.name === 'US night')!;
    const day = s.shifts.find((x) => x.name === 'Day')!;
    const team = await owner.agent.post('/teams').set(H()).send({ name: 'Day crew' }).expect(201);
    await owner.agent.patch(`/attendance/teams/${team.body.id}`).set(H()).send({ shiftId: day.id }).expect(200);

    let after = (await owner.agent.patch(`/attendance/people/${member.user.id}`).set(H()).send({ teamId: team.body.id }).expect(200)).body as AttendanceSettingsDto;
    expect(after.people.find((p) => p.userId === member.user.id)).toMatchObject({ teamId: team.body.id, effectiveShiftId: day.id });
    after = (await owner.agent.patch(`/attendance/people/${member.user.id}`).set(H()).send({ shiftId: night.id }).expect(200)).body;
    expect(after.people.find((p) => p.userId === member.user.id)!.effectiveShiftId).toBe(night.id);
    // Others fall back to the default.
    expect(after.people.find((p) => p.userId === manager.user.id)!.effectiveShiftId).toBe(night.id);
    expect(after.people.map((p) => p.userId)).not.toContain(guest.user.id);

    await owner.agent.patch(`/attendance/people/${member.user.id}`).set(H()).send({ teamId: randomUUID() }).expect(400);
    const rivalTeam = await rival.agent.post('/teams').set(WORKSPACE_HEADER, rival.workspace.id).send({ name: 'Theirs' }).expect(201);
    await owner.agent.patch(`/attendance/people/${member.user.id}`).set(H()).send({ teamId: rivalTeam.body.id }).expect(400);
    await owner.agent.patch(`/attendance/people/${member.user.id}`).set(H()).send({ shiftId: null, teamId: null }).expect(200);
  });
});

describe('checking in and out', () => {
  let shift: ShiftDto;
  let worker: Awaited<ReturnType<typeof signUp>>;

  beforeAll(async () => {
    worker = await newPerson('worker');
    // Started 30 minutes ago with 15 minutes' grace, so checking in now is late.
    shift = (await owner.agent.post('/attendance/shifts').set(H()).send(shiftStartedAgo(30)).expect(201)).body;
    await owner.agent.patch(`/attendance/people/${worker.user.id}`).set(H()).send({ shiftId: shift.id }).expect(200);
  });

  it('needs a real selfie by default', async () => {
    await punch(worker.agent, 'check_in', {}, false).expect(400);
    await worker.agent
      .post('/attendance/events')
      .set(H())
      .field('type', 'check_in')
      .attach('selfie', Buffer.from('<svg onload=alert(1)>'), { filename: 'x.jpg', contentType: 'image/jpeg' })
      .expect(400);
  });

  it('checks in late, with time, IP, device and selfie recorded', async () => {
    const before = (await worker.agent.get('/attendance/today').set(H()).expect(200)).body as AttendanceTodayDto;
    expect(before).toMatchObject({ state: 'out', requireSelfie: true, shift: { id: shift.id } });
    expect(before.day.status).toBe('not_started');

    const res = await punch(worker.agent, 'check_in', { latitude: '31.52', longitude: '74.35', accuracyMeters: '12', deviceId: 'dev-1' })
      .set('user-agent', 'Mozilla/5.0 (Linux; Android 14) Chrome/140.0 Mobile Safari/537.36')
      .expect(200);
    const today = res.body as AttendanceTodayDto;
    expect(today.state).toBe('in');
    expect(today.day).toMatchObject({ status: 'late', open: true, shiftName: shift.name });
    expect(today.day.lateMinutes).toBeGreaterThanOrEqual(29);
    expect(today.day.flags).toContain('late');
    const e = today.day.events[0]!;
    expect(e).toMatchObject({ type: 'check_in', device: 'Chrome on Android', inZone: null });
    expect(e.ip).toMatch(/127\.0\.0\.1|::1/);
    expect(e.selfieUrl).toMatch(/^\/attendance\/events\/.+\/selfie\?workspace=/);
  });

  it('refuses a second check-in', async () => {
    await punch(worker.agent, 'check_in').expect(409);
  });

  it('takes breaks from the shift’s list only', async () => {
    await worker.agent.post('/attendance/events').set(H()).send({ type: 'break_start', breakName: 'Smoke' }).expect(400);
    await worker.agent.post('/attendance/events').set(H()).send({ type: 'break_start' }).expect(400);
    await worker.agent.post('/attendance/events').set(H()).send({ type: 'break_end' }).expect(409);
    const onBreak = await worker.agent.post('/attendance/events').set(H()).send({ type: 'break_start', breakName: 'prayer' }).expect(200);
    expect(onBreak.body).toMatchObject({ state: 'on_break', day: { onBreak: 'prayer' } });
    await worker.agent.post('/attendance/events').set(H()).send({ type: 'break_start', breakName: 'Lunch' }).expect(409);
    const back = await worker.agent.post('/attendance/events').set(H()).send({ type: 'break_end' }).expect(200);
    expect(back.body.state).toBe('in');
  });

  it('checks out, and can check in again the same day', async () => {
    const out = await punch(worker.agent, 'check_out').expect(200);
    expect(out.body.state).toBe('out');
    expect(out.body.day.events.map((e: { type: string }) => e.type)).toEqual(['check_in', 'break_start', 'break_end', 'check_out']);
    await worker.agent.post('/attendance/events').set(H()).send({ type: 'break_start', breakName: 'Lunch' }).expect(409);
    await punch(worker.agent, 'check_out').expect(409);
    const again = await punch(worker.agent, 'check_in').expect(200);
    expect(again.body).toMatchObject({ state: 'in', date: out.body.date });
    await punch(worker.agent, 'check_out').expect(200);
  });

  it('shows the selfie to its owner and managers only', async () => {
    const today = (await worker.agent.get('/attendance/today').set(H())).body as AttendanceTodayDto;
    const url = today.day.events[0]!.selfieUrl!;
    const mine = await worker.agent.get(url).expect(200);
    expect(mine.headers['content-type']).toBe('image/jpeg');
    expect(mine.headers['cache-control']).toBe('private, no-store');
    await manager.agent.get(url).expect(200);
    await member.agent.get(url).expect(403);
    await guest.agent.get(url).expect(403);
    await rival.agent.get(url.replace(/workspace=[^&]+/, `workspace=${rival.workspace.id}`)).expect(404);
  });

  it('lists my month', async () => {
    const today = (await worker.agent.get('/attendance/today').set(H())).body as AttendanceTodayDto;
    const days = (await worker.agent.get('/attendance/me').query({ month: today.date.slice(0, 7) }).set(H()).expect(200)).body as AttendanceDayDto[];
    expect(days[0]!.date >= today.date).toBe(true);
    expect(days.find((d) => d.date === today.date)!.events).toHaveLength(6);
    await worker.agent.get('/attendance/me').query({ month: '2026-13' }).set(H()).expect(400);
  });

  it('never counts days before attendance was set up, or before someone joined, as absent', async () => {
    const today = (await worker.agent.get('/attendance/today').set(H())).body as AttendanceTodayDto;
    const lastMonth = addDays(`${today.date.slice(0, 7)}-01`, -1).slice(0, 7);
    // The workspace set attendance up today and the worker joined today: nothing earlier is listed.
    expect((await worker.agent.get('/attendance/me').query({ month: lastMonth }).set(H()).expect(200)).body).toEqual([]);
    const month = (await worker.agent.get('/attendance/me').query({ month: today.date.slice(0, 7) }).set(H())).body as AttendanceDayDto[];
    expect(month.every((d) => d.date >= addDays(today.date, -1))).toBe(true);
    const longAgo = (await manager.agent.get('/attendance/team').query({ date: addDays(today.date, -20) }).set(H()).expect(200)).body as TeamAttendanceDto;
    expect(longAgo.rows).toEqual([]);
  });

  it('keeps guests out', async () => {
    await guest.agent.get('/attendance/today').set(H()).expect(403);
    await guest.agent.post('/attendance/events').set(H()).send({ type: 'check_in' }).expect(403);
  });
});

describe('office sites', () => {
  it('flags check-ins outside every site, and never flags remote people', async () => {
    const office = await owner.agent
      .post('/attendance/sites')
      .set(H())
      .send({ name: 'Karachi office', latitude: 24.8607, longitude: 67.0011, radiusMeters: 200 })
      .expect(201);
    await owner.agent.patch('/attendance/settings').set(H()).send({ requireSelfie: false }).expect(200);

    const away = await newPerson('away');
    const r1 = await punch(away.agent, 'check_in', { latitude: '31.52', longitude: '74.35', accuracyMeters: '10' }, false).expect(200);
    expect(r1.body.day.events[0]).toMatchObject({ inZone: false, flags: ['outside_zone'] });
    expect(r1.body.day.flags).toContain('outside_zone');

    const near = await newPerson('near');
    const r2 = await punch(near.agent, 'check_in', { latitude: '24.8610', longitude: '67.0013', accuracyMeters: '15' }, false).expect(200);
    expect(r2.body.day.events[0]).toMatchObject({ inZone: true, siteName: 'Karachi office', flags: [] });

    const noGps = await newPerson('nogps');
    const r3 = await punch(noGps.agent, 'check_in', {}, false).expect(200);
    expect(r3.body.day.events[0].flags).toEqual(['outside_zone', 'no_location']);

    const remote = await newPerson('remote');
    await owner.agent.patch(`/attendance/people/${remote.user.id}`).set(H()).send({ remote: true }).expect(200);
    const r4 = await punch(remote.agent, 'check_in', {}, false).expect(200);
    expect(r4.body.day.events[0]).toMatchObject({ inZone: null, flags: [] });

    // The office network counts as being there, GPS or not (tests connect from loopback).
    await owner.agent.patch(`/attendance/sites/${office.body.id}`).set(H()).send({ name: 'Karachi office', ipRanges: ['127.0.0.0/8', '::1/128'] }).expect(200);
    const wired = await newPerson('wired');
    const r5 = await punch(wired.agent, 'check_in', {}, false).expect(200);
    expect(r5.body.day.events[0]).toMatchObject({ inZone: true, flags: [] });

    await owner.agent.delete(`/attendance/sites/${office.body.id}`).set(H()).expect(204);
  });
});

describe('offline check-ins', () => {
  beforeAll(async () => {
    await owner.agent.patch('/attendance/settings').set(H()).send({ requireSelfie: false }).expect(200);
  });

  it('records a queued event once, flagged as synced later', async () => {
    const p = await newPerson('offline');
    const clientEventId = randomUUID();
    const occurredAt = new Date(Date.now() - 10 * 60_000).toISOString();
    const first = await p.agent.post('/attendance/events').set(H()).send({ type: 'check_in', clientEventId, occurredAt }).expect(200);
    expect(first.body.day.events[0]).toMatchObject({ occurredAt, flags: ['offline'] });
    const again = await p.agent.post('/attendance/events').set(H()).send({ type: 'check_in', clientEventId, occurredAt }).expect(200);
    expect(again.body.day.events).toHaveLength(1);
    // Racing copies of the same event still record it once.
    const id2 = randomUUID();
    const at2 = new Date(Date.now() - 5 * 60_000).toISOString();
    const results = await Promise.all(Array.from({ length: 8 }, () => p.agent.post('/attendance/events').set(H()).send({ type: 'check_out', clientEventId: id2, occurredAt: at2 })));
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(200));
    const today = (await p.agent.get('/attendance/today').set(H())).body as AttendanceTodayDto;
    expect(today.day.events.map((e) => e.type)).toEqual(['check_in', 'check_out']);
  });

  it('copies of one event that queue behind each other still all succeed, recorded once', async () => {
    const p = await newPerson('queued-twins');
    await p.agent.post('/attendance/events').set(H()).send({ type: 'check_in', clientEventId: randomUUID() }).expect(200);
    const clientEventId = randomUUID();
    const occurredAt = new Date(Date.now() - 60_000).toISOString();
    // Hold the day's lock so every copy gets past the duplicate check and waits, as on a slow server.
    const results = await withAdmin(async (db) => {
      await db.query('begin');
      await db.query('select id from attendance_days where user_id = $1 for update', [p.user.id]);
      const pending = Array.from({ length: 4 }, () =>
        p.agent.post('/attendance/events').set(H()).send({ type: 'check_out', clientEventId, occurredAt }).then((r) => r),
      );
      await new Promise((r) => setTimeout(r, 750));
      await db.query('commit');
      return Promise.all(pending);
    });
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const today = (await p.agent.get('/attendance/today').set(H())).body as AttendanceTodayDto;
    expect(today.day.events.map((e) => e.type)).toEqual(['check_in', 'check_out']);
  });

  it('trusts a device clock that is only slightly off', async () => {
    const p = await newPerson('skew');
    const r = await p.agent.post('/attendance/events').set(H()).send({ type: 'check_in', occurredAt: new Date(Date.now() - 30_000).toISOString() }).expect(200);
    expect(r.body.day.events[0].flags).toEqual([]);
  });

  it('refuses future and stale times, and events out of order', async () => {
    const p = await newPerson('stale');
    await p.agent.post('/attendance/events').set(H()).send({ type: 'check_in', occurredAt: new Date(Date.now() + 3600_000).toISOString() }).expect(400);
    await p.agent.post('/attendance/events').set(H()).send({ type: 'check_in', occurredAt: new Date(Date.now() - 4 * 86400_000).toISOString() }).expect(400);
    await p.agent.post('/attendance/events').set(H()).send({ type: 'check_in' }).expect(200);
    await p.agent.post('/attendance/events').set(H()).send({ type: 'check_out', occurredAt: new Date(Date.now() - 3600_000).toISOString() }).expect(409);
  });
});

describe('night shifts', () => {
  it('counts 18:00–03:00 as one workday on the date it started', async () => {
    const p = await newPerson('night');
    const s = (await owner.agent.get('/attendance/settings').set(H())).body as AttendanceSettingsDto;
    const night = s.shifts.find((x) => x.name === 'US night')!;
    await owner.agent.patch(`/attendance/people/${p.user.id}`).set(H()).send({ shiftId: night.id }).expect(200);

    // Two nights ago, recorded offline and synced now.
    const today = zonedParts(new Date(), PK).date;
    const started = addDays(today, -2);
    const inAt = zonedTime(started, 18 * 60 + 5, PK);
    const outAt = zonedTime(addDays(started, 1), 3 * 60, PK);
    await p.agent.post('/attendance/events').set(H()).send({ type: 'check_in', occurredAt: inAt.toISOString(), clientEventId: randomUUID() }).expect(200);
    await p.agent.post('/attendance/events').set(H()).send({ type: 'check_out', occurredAt: outAt.toISOString(), clientEventId: randomUUID() }).expect(200);

    const days = (await p.agent.get('/attendance/me').query({ month: started.slice(0, 7) }).set(H()).expect(200)).body as AttendanceDayDto[];
    const d = days.find((x) => x.date === started)!;
    const weekday = new Date(`${started}T00:00:00Z`).getUTCDay() || 7;
    if (weekday <= 5) {
      expect(d).toMatchObject({ status: 'present', workedMinutes: 535, lateMinutes: 0, shiftName: 'US night' });
    } else {
      expect(d).toMatchObject({ status: 'present', workedMinutes: 535, flags: expect.arrayContaining(['day_off']) });
    }
    expect(d.flags).toContain('offline');
    // The next morning isn't a second day; and it's before this person joined, so it isn't listed.
    expect(days.find((x) => x.date === addDays(started, 1))?.events ?? []).toHaveLength(0);
  });
});

describe('team view', () => {
  it('shows managers everyone’s day, with a summary', async () => {
    await member.agent.get('/attendance/team').set(H()).expect(403);
    const r = (await manager.agent.get('/attendance/team').set(H()).expect(200)).body as TeamAttendanceDto;
    expect(r.rows.map((x) => x.userId)).not.toContain(guest.user.id);
    // Everyone who has joined is listed for today (the default date may be last night's shift).
    const calendarToday = zonedParts(new Date(), PK).date;
    const today = (await manager.agent.get('/attendance/team').query({ date: calendarToday }).set(H()).expect(200)).body as TeamAttendanceDto;
    expect(today.rows.map((x) => x.userId)).toContain(member.user.id);
    expect(today.rows.map((x) => x.userId)).not.toContain(guest.user.id);
    const total = Object.values(r.summary).reduce((a, b) => a + b, 0);
    expect(total).toBe(r.rows.length);
    // A fresh check-in shows up on the day it counts towards (whatever the time of day).
    const p = await newPerson('team-row');
    const checkedIn = (await p.agent.post('/attendance/events').set(H()).send({ type: 'check_in' }).expect(200)).body as AttendanceTodayDto;
    const onThatDay = (await manager.agent.get('/attendance/team').query({ date: checkedIn.date }).set(H()).expect(200)).body as TeamAttendanceDto;
    expect(onThatDay.rows.find((x) => x.userId === p.user.id)!.day.events).toHaveLength(1);
    await manager.agent.get('/attendance/team').query({ date: 'yesterday' }).set(H()).expect(400);
    const rivalView = (await rival.agent.get('/attendance/team').set(WORKSPACE_HEADER, rival.workspace.id).expect(200)).body as TeamAttendanceDto;
    expect(rivalView.rows.map((x) => x.userId)).toEqual([rival.user.id]);
  });
});

describe('selfie retention', () => {
  it('deletes selfies after 30 days and keeps the check-in', async () => {
    const p = await newPerson('retention');
    await owner.agent.patch('/attendance/settings').set(H()).send({ requireSelfie: true }).expect(200);
    const res = await punch(p.agent, 'check_in').expect(200);
    const eventId = res.body.day.events[0].id as string;
    const key = await withAdmin(async (db) => (await db.query('select selfie_key from attendance_events where id = $1', [eventId])).rows[0].selfie_key as string);
    const file = join(process.env.LOCAL_STORAGE_DIR!, key);
    expect(existsSync(file)).toBe(true);

    const cleanup = app.get(SelfieCleanupService);
    expect(await cleanup.purgeExpired(new Date())).toBe(0);
    expect(await cleanup.purgeExpired(new Date(Date.now() + 31 * 86400_000))).toBeGreaterThanOrEqual(1);

    expect(existsSync(file)).toBe(false);
    const after = (await p.agent.get('/attendance/today').set(H())).body as AttendanceTodayDto;
    expect(after.day.events[0]).toMatchObject({ id: eventId, type: 'check_in', selfieUrl: null });
    await p.agent.get(`/attendance/events/${eventId}/selfie`).query({ workspace: ws }).expect(404);
  });
});
