import type { INestApplication } from '@nestjs/common';
import { WORKSPACE_HEADER, type DeviceImportPreviewDto, type DeviceImportResultDto, type MemberCodesDto, type PayrollTemplateDto } from '@workhub/shared';
import { parseDeviceFile, parseDeviceTime } from '../src/attendance/device-import';
import { createApp, signUp, withAdmin } from './helpers';

let app: INestApplication;

beforeAll(async () => {
  app = await createApp();
});

afterAll(async () => {
  await app.close();
});

type Agent = Awaited<ReturnType<typeof signUp>>;

async function addMember(owner: Agent, prefix: string, role: string) {
  const person = await signUp(app, prefix, `${prefix} own`);
  await withAdmin((db) => db.query('insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)', [owner.workspace.id, person.user.id, role]));
  return person;
}

describe('Reading device files', () => {
  it('reads the date formats ZKTeco software writes', () => {
    expect(parseDeviceTime('2027-06-07 09:02:11')).toEqual({ date: '2027-06-07', seconds: 9 * 3600 + 2 * 60 + 11 });
    expect(parseDeviceTime('2027/6/7 9:02')).toEqual({ date: '2027-06-07', seconds: 9 * 3600 + 120 });
    // Day first, as in Pakistan.
    expect(parseDeviceTime('07/06/2027 09:02')).toEqual({ date: '2027-06-07', seconds: 9 * 3600 + 120 });
    expect(parseDeviceTime('7-6-2027 9:02 PM')).toEqual({ date: '2027-06-07', seconds: 21 * 3600 + 120 });
    expect(parseDeviceTime('7.6.2027 12:15 am')).toEqual({ date: '2027-06-07', seconds: 15 * 60 });
    expect(parseDeviceTime('31/02/2027 09:00')).toBeNull();
    expect(parseDeviceTime('13:00 PM 2027-06-07')).toBeNull();
  });

  it('reads attlog.dat and CSV exports, counting what it can’t read', () => {
    const attlog = parseDeviceFile(['     101\t2027-06-07 09:02:11\t1\t0\t0\t0', '     102\t2027-06-07 18:10:00\t1\t1\t0\t0', 'garbage line here'].join('\r\n'));
    expect(attlog).toMatchObject({ format: 'attlog', unreadable: 1 });
    expect(attlog.punches.map((p) => p.deviceUserId)).toEqual(['101', '102']);

    const zktime = parseDeviceFile(['AC-No.,Name,Time,State', '101,Ali Raza,07/06/2027 09:02,C/In', '101,Ali Raza,07/06/2027 18:05,C/Out', ',,,'].join('\n'));
    expect(zktime).toMatchObject({ format: 'csv', unreadable: 0 });
    expect(zktime.punches[0]).toMatchObject({ deviceUserId: '101', name: 'Ali Raza', date: '2027-06-07', seconds: 9 * 3600 + 120 });

    const split = parseDeviceFile(['Emp No\tDate\tTime', '7\t2027-06-07\t08:59:59', '7\tnot a date\t08:00'].join('\n'));
    expect(split).toMatchObject({ format: 'csv', unreadable: 1 });
    expect(split.punches[0]).toMatchObject({ deviceUserId: '7', seconds: 8 * 3600 + 59 * 60 + 59 });

    expect(parseDeviceFile('Name,Notes\nAli,hello').punches).toEqual([]);
  });
});

describe('Device import and payroll export', () => {
  it('imports punches as check-ins and check-outs per workday, once', async () => {
    const owner = await signUp(app, 'downer', 'Device Co');
    const H = [WORKSPACE_HEADER, owner.workspace.id] as const;
    const ali = await addMember(owner, 'ali', 'member');
    const sara = await addMember(owner, 'sara', 'member');
    const zain = await addMember(owner, 'zain', 'member');

    // Ali's employee code is his device number, so he's matched without asking.
    await owner.agent.patch(`/attendance/payroll/codes/${ali.user.id}`).set(...H).send({ employeeCode: '101' }).expect(200);
    await owner.agent.patch(`/attendance/payroll/codes/${sara.user.id}`).set(...H).send({ employeeCode: '101' }).expect(409);
    await owner.agent.patch(`/attendance/payroll/codes/${sara.user.id}`).set(...H).send({ employeeCode: 'bad code!' }).expect(400);

    // Zain already has a corrected day on 2026-10-06; the device's punches for it are left alone.
    await owner.agent
      .post('/attendance/corrections')
      .set(...H)
      .send({ userId: zain.user.id, date: '2026-10-06', checkInAt: '2026-10-06T04:00:00Z', checkOutAt: '2026-10-06T12:00:00Z', reason: 'Device was down' })
      .expect(201);

    const lines = [
      '101\t2026-10-05 09:01:00\t1\t0\t0\t0',
      '101\t2026-10-05 13:00:00\t1\t2\t0\t0', // a mid-day punch: ignored
      '101\t2026-10-05 18:02:00\t1\t1\t0\t0',
      '101\t2026-10-06 09:10:00\t1\t0\t0\t0', // one punch: checked in only
      '102\t2026-10-05 08:55:00\t1\t0\t0\t0',
      '102\t2026-10-05 17:00:00\t1\t1\t0\t0',
      '103\t2026-10-06 09:00:00\t1\t0\t0\t0',
      '103\t2026-10-06 17:00:00\t1\t1\t0\t0',
      '999\t2026-10-05 09:00:00\t1\t0\t0\t0', // nobody
      '101\t2099-01-01 09:00:00\t1\t0\t0\t0', // in the future
    ].join('\n');
    const file = Buffer.from(lines);

    const preview = (await owner.agent.post('/attendance/payroll/device-import/preview').set(...H).attach('file', file, 'attlog.dat').expect(201)).body as DeviceImportPreviewDto;
    expect(preview).toMatchObject({ format: 'attlog', punches: 10, from: '2026-10-05', to: '2099-01-01' });
    expect(preview.people.map((p) => [p.deviceUserId, p.punches, p.userId])).toEqual([
      ['101', 5, ali.user.id],
      ['102', 2, null],
      ['103', 2, null],
      ['999', 1, null],
    ]);

    const mapping = JSON.stringify({ '101': ali.user.id, '102': sara.user.id, '103': zain.user.id, '999': null });
    await owner.agent.post('/attendance/payroll/device-import').set(...H).field('mapping', JSON.stringify({ '101': ali.user.id, '102': ali.user.id })).attach('file', file, 'attlog.dat').expect(400);
    const result = (await owner.agent.post('/attendance/payroll/device-import').set(...H).field('mapping', mapping).attach('file', file, 'attlog.dat').expect(201)).body as DeviceImportResultDto;
    expect(result).toEqual({ days: 3, singlePunchDays: 1, keptExisting: 1, alreadyImported: 0, unmatchedPunches: 1, futurePunches: 1 });

    // Ali's Monday: in at 09:01, out at 18:02 Karachi time; flagged as from the device.
    const events = await withAdmin(
      async (db) =>
        (await db.query("select type, occurred_at, flags from attendance_events e join attendance_days d on d.id = e.day_id where e.user_id = $1 and d.work_date = '2026-10-05' and e.voided_at is null order by occurred_at", [ali.user.id])).rows,
    );
    expect(events.map((e) => [e.type, new Date(e.occurred_at).toISOString(), e.flags])).toEqual([
      ['check_in', '2026-10-05T04:01:00.000Z', ['device']],
      ['check_out', '2026-10-05T13:02:00.000Z', ['device']],
    ]);

    // The matches were remembered.
    const codes = (await owner.agent.get('/attendance/payroll/codes').set(...H).expect(200)).body as MemberCodesDto[];
    expect(codes.find((c) => c.userId === sara.user.id)?.deviceUserId).toBe('102');

    // The same file again changes nothing.
    const again = (await owner.agent.post('/attendance/payroll/device-import').set(...H).field('mapping', mapping).attach('file', file, 'attlog.dat').expect(201)).body as DeviceImportResultDto;
    expect(again).toMatchObject({ days: 0, alreadyImported: 3, keptExisting: 1 });

    // A later file with Ali's check-out for Tuesday completes that day.
    const later = Buffer.from(['101\t2026-10-06 09:10:00\t1\t0\t0\t0', '101\t2026-10-06 17:45:00\t1\t1\t0\t0'].join('\n'));
    const completed = (await owner.agent.post('/attendance/payroll/device-import').set(...H).field('mapping', JSON.stringify({ '101': ali.user.id })).attach('file', later, 'attlog.dat').expect(201)).body as DeviceImportResultDto;
    expect(completed).toMatchObject({ days: 1, singlePunchDays: 0 });

    // Only admins import; Excel files are refused with a hint.
    await ali.agent.post('/attendance/payroll/device-import/preview').set(...H).attach('file', file, 'attlog.dat').expect(403);
    const xls = await owner.agent.post('/attendance/payroll/device-import/preview').set(...H).attach('file', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]), 'log.xlsx').expect(400);
    expect(xls.body.message).toContain('CSV');
  });

  it('exports with built-in and saved templates', async () => {
    const owner = await signUp(app, 'xowner', 'Export Co');
    const H = [WORKSPACE_HEADER, owner.workspace.id] as const;
    const manager = await addMember(owner, 'xmanager', 'manager');
    await owner.agent.patch(`/attendance/payroll/codes/${owner.user.id}`).set(...H).send({ employeeCode: 'EMP-7' }).expect(200);
    const month = new Date().toISOString().slice(0, 7);
    const header = async (agent: Agent['agent'], template?: string) => {
      const res = await agent.get('/attendance/export').query({ month, format: 'csv', ...(template ? { template } : {}) }).set(...H).expect(200);
      // Without the byte-order mark the export starts with.
      return res.text.replace(new RegExp('^' + String.fromCharCode(0xfeff)), '').split('\r\n');
    };

    const list = (await manager.agent.get('/attendance/payroll/templates').set(...H).expect(200)).body as PayrollTemplateDto[];
    expect(list.filter((t) => t.builtIn).map((t) => t.id)).toEqual(['standard', 'payable_days', 'hours']);
    expect((await header(manager.agent, 'payable_days'))[0]).toBe('Employee code,Employee,Payable days,Absent,Unpaid leave,Half days,Late days');

    await manager.agent.post('/attendance/payroll/templates').set(...H).send({ name: 'x', columns: [{ field: 'name', header: 'Name' }] }).expect(403);
    await owner.agent.post('/attendance/payroll/templates').set(...H).send({ name: 'Bad', columns: [{ field: 'salary', header: 'Pay' }] }).expect(400);
    const saved = (await owner.agent
      .post('/attendance/payroll/templates')
      .set(...H)
      .send({ name: 'Sage import', columns: [{ field: 'employeeCode', header: 'EmpCode' }, { field: 'payableDays', header: 'DaysPaid' }] })
      .expect(201)).body as PayrollTemplateDto;
    await owner.agent.post('/attendance/payroll/templates').set(...H).send({ name: 'Sage import', columns: [{ field: 'name', header: 'N' }] }).expect(409);
    const rows = await header(manager.agent, saved.id);
    expect(rows[0]).toBe('EmpCode,DaysPaid');
    expect(rows.some((r) => r.startsWith('EMP-7,'))).toBe(true);
    await manager.agent.get('/attendance/export').query({ month, format: 'csv', template: 'nope' }).set(...H).expect(400);

    // Another workspace can't use, change or see any of it.
    const rival = await signUp(app, 'xrival', 'Rival Co');
    const RH = [WORKSPACE_HEADER, rival.workspace.id] as const;
    await rival.agent.get('/attendance/export').query({ month, format: 'csv', template: saved.id }).set(...RH).expect(404);
    await rival.agent.delete(`/attendance/payroll/templates/${saved.id}`).set(...RH).expect(404);
    await rival.agent.patch(`/attendance/payroll/codes/${owner.user.id}`).set(...RH).send({ employeeCode: 'X' }).expect(404);

    await owner.agent.delete(`/attendance/payroll/templates/${saved.id}`).set(...H).expect(204);
  });
});
