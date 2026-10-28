import type { INestApplication } from '@nestjs/common';
import { WORKSPACE_HEADER, type MeResponse, type SignInResponse, type TwoFactorSetupDto } from '@workhub/shared';
import request from 'supertest';
import { base32Encode, codeAt, decryptSecret, encryptSecret, stepAt, verifyCode } from '../src/auth/totp';
import { devOutbox } from '../src/email/email.service';
import { createApp, PASSWORD, signUp, withAdmin } from './helpers';

let app: INestApplication;

describe('TOTP', () => {
  it('matches the RFC 6238 test vectors (SHA-1)', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    // The RFC lists 8 digits; authenticator apps show the last 6.
    expect(codeAt(secret, Math.floor(59 / 30))).toBe('287082');
    expect(codeAt(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(codeAt(secret, Math.floor(2000000000 / 30))).toBe('279037');
  });

  it('accepts one step of clock drift, and each code only once', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    const now = 1_700_000_000_000;
    const step = stepAt(now);
    expect(verifyCode(secret, codeAt(secret, step - 1), null, now)).toBe(step - 1);
    expect(verifyCode(secret, codeAt(secret, step + 1), null, now)).toBe(step + 1);
    expect(verifyCode(secret, codeAt(secret, step - 2), null, now)).toBeNull();
    expect(verifyCode(secret, codeAt(secret, step), step, now)).toBeNull();
    expect(verifyCode(secret, 'abcdef', null, now)).toBeNull();
  });

  it('encrypts secrets at rest', () => {
    const stored = encryptSecret('JBSWY3DPEHPK3PXP');
    expect(stored).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(stored)).toBe('JBSWY3DPEHPK3PXP');
    const [iv, tag, data] = stored.split('.');
    // Tampering is detected.
    expect(() => decryptSecret([iv, tag, data!.slice(0, -2) + 'AA'].join('.'))).toThrow();
  });
});

describe('two-factor sign-in', () => {
  let person: Awaited<ReturnType<typeof signUp>>;
  let secret: string;
  let recovery: string[];
  /** The 30-second step whose code switched it on. */
  let enabledStep: number;

  const signIn = (agent = request.agent(app.getHttpServer())) => agent.post('/auth/sign-in').send({ email: person.email, password: PASSWORD });

  beforeAll(async () => {
    app = await createApp();
    person = await signUp(app, 'secure', 'Secure Co');
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets up with a QR code, confirms with a code, gives recovery codes and signs out other devices', async () => {
    expect((await person.agent.get('/auth/2fa').expect(200)).body).toEqual({ enabled: false, recoveryCodesLeft: 0 });
    const other = request.agent(app.getHttpServer());
    await signIn(other).expect(200);

    const setup = (await person.agent.post('/auth/2fa/setup').expect(200)).body as TwoFactorSetupDto;
    expect(setup.qr).toMatch(/^data:image\/png;base64,/);
    expect(setup.otpauthUrl).toContain(`otpauth://totp/WorkHub%3A${encodeURIComponent(person.email)}?secret=${setup.secret}`);
    secret = setup.secret;
    const { rows } = await withAdmin((db) => db.query('select secret_enc from user_totp where user_id = $1', [person.user.id]));
    expect(rows[0].secret_enc).not.toContain(secret);

    await person.agent.post('/auth/2fa/enable').send({ code: '000000' }).expect(400);
    enabledStep = stepAt();
    const on = await person.agent.post('/auth/2fa/enable').send({ code: codeAt(secret, enabledStep) }).expect(200);
    recovery = on.body.recoveryCodes;
    expect(recovery).toHaveLength(10);
    expect(recovery[0]).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
    expect((await person.agent.get('/auth/me').expect(200)).body.user.twoFactorEnabled).toBe(true);
    await other.get('/auth/me').expect(401);
    expect(devOutbox.at(-1)).toMatchObject({ to: person.email, subject: 'Two-factor sign-in is on' });
    await person.agent.post('/auth/2fa/setup').expect(409);
  });

  it('asks for a code after the password, and accepts each code once', async () => {
    const agent = request.agent(app.getHttpServer());
    const first = (await signIn(agent).expect(200)).body as SignInResponse;
    expect(first).toMatchObject({ twoFactorRequired: true, challenge: expect.any(String) });
    // No session yet.
    await agent.get('/auth/me').expect(401);
    const challenge = first.twoFactorRequired ? first.challenge : '';

    await agent.post('/auth/2fa/verify').send({ challenge, code: '123456' }).expect(401);
    // The code used to switch it on can't be replayed.
    await agent.post('/auth/2fa/verify').send({ challenge, code: codeAt(secret, enabledStep) }).expect(401);
    const ok = await agent.post('/auth/2fa/verify').send({ challenge, code: codeAt(secret, enabledStep + 1) }).expect(200);
    expect(ok.body.user.email).toBe(person.email);
    await agent.get('/auth/me').expect(200);
    // A ticket works once.
    await request(app.getHttpServer()).post('/auth/2fa/verify').send({ challenge, code: recovery[0] }).expect(401);
  });

  it('takes a recovery code once, and limits guesses', async () => {
    const one = (await signIn().expect(200)).body as { challenge: string };
    await request(app.getHttpServer()).post('/auth/2fa/verify').send({ challenge: one.challenge, code: recovery[1]!.toUpperCase() }).expect(200);
    const two = (await signIn().expect(200)).body as { challenge: string };
    await request(app.getHttpServer()).post('/auth/2fa/verify').send({ challenge: two.challenge, code: recovery[1] }).expect(401);
    expect((await person.agent.get('/auth/2fa').expect(200)).body.recoveryCodesLeft).toBe(9);

    const three = (await signIn().expect(200)).body as { challenge: string };
    for (let i = 0; i < 5; i++) await request(app.getHttpServer()).post('/auth/2fa/verify').send({ challenge: three.challenge, code: '111111' }).expect(401);
    await request(app.getHttpServer()).post('/auth/2fa/verify').send({ challenge: three.challenge, code: '111111' }).expect(429);
  });

  it('needs a code to make new recovery codes or switch it off', async () => {
    await person.agent.post('/auth/2fa/recovery-codes').send({ code: '000000' }).expect(400);
    const fresh = (await person.agent.post('/auth/2fa/recovery-codes').send({ code: recovery[2] }).expect(200)).body.recoveryCodes as string[];
    expect(fresh).toHaveLength(10);
    // The old ones stopped working.
    await person.agent.post('/auth/2fa/disable').send({ code: recovery[3] }).expect(400);
    await person.agent.post('/auth/2fa/disable').send({ code: fresh[0] }).expect(204);
    expect(devOutbox.at(-1)).toMatchObject({ subject: 'Two-factor sign-in was turned off' });
    expect(((await signIn().expect(200)).body as { user?: unknown }).user).toBeDefined();
  });
});

describe('workspace rule', () => {
  let owner: Awaited<ReturnType<typeof signUp>>;
  let member: Awaited<ReturnType<typeof signUp>>;

  beforeAll(async () => {
    app = await createApp();
    owner = await signUp(app, 'boss', 'Strict Co');
    member = await signUp(app, 'staff', 'Staff home');
    await withAdmin((db) => db.query(`insert into memberships (workspace_id, user_id, role) values ($1, $2, 'admin')`, [owner.workspace.id, member.user.id]));
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets only the owner, with two-factor on, require it; then everyone needs it to get in', async () => {
    const H = { [WORKSPACE_HEADER]: owner.workspace.id };
    await member.agent.post('/workspaces/current/require-two-factor').set(H).send({ required: true }).expect(403);
    await owner.agent.post('/workspaces/current/require-two-factor').set(H).send({ required: true }).expect(400);

    const setup = (await owner.agent.post('/auth/2fa/setup').expect(200)).body as TwoFactorSetupDto;
    await owner.agent.post('/auth/2fa/enable').send({ code: codeAt(setup.secret, stepAt()) }).expect(200);
    const res = await owner.agent.post('/workspaces/current/require-two-factor').set(H).send({ required: true }).expect(201);
    expect(res.body).toEqual({ required: true, withoutTwoFactor: 1 });

    const blocked = await member.agent.get('/projects').set(H).expect(403);
    expect(blocked.body.message).toMatch(/requires two-factor/);
    const me = (await member.agent.get('/auth/me').expect(200)).body as MeResponse;
    expect(me.workspaces.find((w) => w.id === owner.workspace.id)).toMatchObject({ requireTwoFactor: true });
    // Their own workspace isn't affected.
    await member.agent.get('/projects').set(WORKSPACE_HEADER, member.workspace.id).expect(200);

    const mine = (await member.agent.post('/auth/2fa/setup').expect(200)).body as TwoFactorSetupDto;
    await member.agent.post('/auth/2fa/enable').send({ code: codeAt(mine.secret, stepAt()) }).expect(200);
    await member.agent.get('/projects').set(H).expect(200);
  });
});
