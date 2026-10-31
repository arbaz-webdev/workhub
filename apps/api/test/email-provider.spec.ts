import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { devOutbox, EmailRejectedError, EmailService, senderDomain } from '../src/email/email.service';
import { createApp, signUp, withAdmin } from './helpers';

const message = { to: 'someone@customer.pk', subject: 'Hello', text: 'Hi', html: '<p>Hi</p>' };
const ENV = ['EMAIL_TRANSPORT', 'EMAIL_FROM', 'EMAIL_REPLY_TO', 'RESEND_API_KEY'] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

function useResend() {
  process.env.EMAIL_TRANSPORT = 'resend';
  process.env.EMAIL_FROM = 'WorkHub <no-reply@mail.workhub.pk>';
  process.env.RESEND_API_KEY = 're_test_not_a_real_key';
}

function reply(status: number, body: unknown = { id: 'email_1' }, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

let fetchMock: jest.SpyInstance;

beforeEach(() => {
  fetchMock = jest.spyOn(global, 'fetch');
});

afterEach(() => {
  fetchMock.mockRestore();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('sending through Resend', () => {
  it('sends from EMAIL_FROM with the key, and a reply-to when set', async () => {
    useResend();
    process.env.EMAIL_REPLY_TO = 'support@workhub.pk';
    fetchMock.mockResolvedValueOnce(reply(200));
    await new EmailService().send(message);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_test_not_a_real_key');
    expect(JSON.parse(init.body as string)).toEqual({ from: 'WorkHub <no-reply@mail.workhub.pk>', reply_to: 'support@workhub.pk', ...message });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('leaves out reply-to when it is not set', async () => {
    useResend();
    fetchMock.mockResolvedValueOnce(reply(200));
    await new EmailService().send(message);
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)).not.toHaveProperty('reply_to');
  });

  it('tries once more when Resend is busy or down', async () => {
    useResend();
    fetchMock.mockResolvedValueOnce(reply(429, { message: 'Too many requests' }, { 'retry-after': '1' })).mockResolvedValueOnce(reply(200));
    await new EmailService().send(message);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset();
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(reply(200));
    await new EmailService().send(message);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the second try', async () => {
    useResend();
    fetchMock.mockResolvedValue(reply(503, { message: 'Service unavailable' }));
    await expect(new EmailService().send(message)).rejects.toEqual(new EmailRejectedError('Service unavailable'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a refusal, and keeps Resend’s reason', async () => {
    useResend();
    fetchMock.mockResolvedValueOnce(reply(403, { statusCode: 403, message: 'The mail.workhub.pk domain is not verified.' }));
    const err = await new EmailService().send(message).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmailRejectedError);
    expect((err as EmailRejectedError).reason).toBe('The mail.workhub.pk domain is not verified.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('start-up checks', () => {
  it('refuses Resend without a key or with a placeholder sender', () => {
    useResend();
    delete process.env.RESEND_API_KEY;
    expect(() => new EmailService().onModuleInit()).toThrow(/RESEND_API_KEY/);

    useResend();
    for (const from of ['WorkHub <no-reply@localhost>', 'no-reply@example.com', 'WorkHub <x@demo.test>', 'nobody']) {
      process.env.EMAIL_FROM = from;
      expect(() => new EmailService().onModuleInit()).toThrow(/EMAIL_FROM/);
    }

    process.env.EMAIL_FROM = 'WorkHub <no-reply@mail.workhub.pk>';
    expect(() => new EmailService().onModuleInit()).not.toThrow();
  });

  it('reads the sender domain from either form of address', () => {
    expect(senderDomain('WorkHub <no-reply@Mail.WorkHub.pk>')).toBe('mail.workhub.pk');
    expect(senderDomain('no-reply@workhub.pk')).toBe('workhub.pk');
    expect(senderDomain('nobody')).toBe('');
  });
});

describe('test email for WorkHub staff', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    delete process.env.PLATFORM_ADMINS;
    await app.close();
  });

  it('sends to the staff member’s own address, and says why when Resend refuses', async () => {
    const staff = await signUp(app, 'mailstaff', 'Staff Co');
    const customer = await signUp(app, 'mailcustomer', 'Customer Co');
    process.env.PLATFORM_ADMINS = staff.email;
    await withAdmin((db) => db.query('update users set email_verified_at = now() where id = $1', [staff.user.id]));

    await request(app.getHttpServer()).post('/platform/test-email').expect(401);
    await customer.agent.post('/platform/test-email').expect(403);

    const ok = (await staff.agent.post('/platform/test-email').expect(200)).body as { to: string; transport: string };
    expect(ok).toMatchObject({ to: staff.email, transport: 'console' });
    expect(devOutbox.at(-1)).toMatchObject({ to: staff.email, subject: 'WorkHub test email' });

    useResend();
    fetchMock.mockResolvedValueOnce(reply(403, { message: 'The mail.workhub.pk domain is not verified.' }));
    const failed = await staff.agent.post('/platform/test-email').expect(502);
    expect(failed.body.message).toBe('Resend did not send it: The mail.workhub.pk domain is not verified.');
    expect(JSON.stringify(failed.body)).not.toContain('re_test_not_a_real_key');
  });
});
