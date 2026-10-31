import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { config } from '../config';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Emails "sent" with the console transport. Tests read this; it is never used in production. */
export const devOutbox: EmailMessage[] = [];

/** Resend turned an email down; `reason` is Resend's own explanation (no secrets in it). */
export class EmailRejectedError extends Error {
  constructor(readonly reason: string) {
    super('Email could not be sent');
  }
}

const RESEND_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;
const ATTEMPTS = 2;

/** The domain of `WorkHub <no-reply@example.com>` or `no-reply@example.com`. */
export function senderDomain(from: string): string {
  const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
  return address.split('@')[1]?.trim().toLowerCase() ?? '';
}

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger('Email');

  onModuleInit() {
    if (config.emailTransport === 'resend') {
      // Fail at start-up, not at the first sign-up: a missing key or a placeholder sender.
      void config.resendApiKey;
      const domain = senderDomain(config.emailFrom);
      if (!domain.includes('.') || domain === 'localhost' || /(^|\.)(example\.(com|org|net)|localhost|test)$/.test(domain)) {
        throw new Error(`EMAIL_FROM must use your verified sending domain, e.g. "WorkHub <no-reply@yourdomain.com>" (got "${config.emailFrom}").`);
      }
    }
    if (config.isProduction && config.emailTransport === 'console') {
      if (!config.allowConsoleEmail) {
        throw new Error('EMAIL_TRANSPORT=console is not allowed in production; configure a real provider.');
      }
      // A staging site without a mail domain yet: emails go to this log instead.
      this.logger.warn('Emails are written to this log, not sent (ALLOW_CONSOLE_EMAIL=true). Staging only.');
    }
  }

  async send(message: EmailMessage): Promise<void> {
    if (config.emailTransport === 'console') {
      devOutbox.push(message);
      if (devOutbox.length > 100) devOutbox.shift();
      if (!process.env.JEST_WORKER_ID) {
        this.logger.log(`To: ${message.to} | ${message.subject}\n${message.text}`);
      }
      return;
    }
    await this.sendWithResend(message);
  }

  /** One retry for a busy or unreachable Resend (429, 5xx, timeout); other refusals are final. */
  private async sendWithResend(message: EmailMessage) {
    const body = JSON.stringify({ from: config.emailFrom, ...(config.emailReplyTo ? { reply_to: config.emailReplyTo } : {}), ...message });
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(RESEND_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${config.resendApiKey}`, 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        if (attempt < ATTEMPTS) {
          await wait(1000);
          continue;
        }
        this.logger.error(`Could not reach Resend: ${(err as Error).message}`);
        throw new EmailRejectedError('Resend could not be reached.');
      }
      if (res.ok) return;
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < ATTEMPTS) {
        const after = Number(res.headers.get('retry-after'));
        await wait(Number.isFinite(after) && after > 0 ? Math.min(after, 5) * 1000 : 1000);
        continue;
      }
      const reason = resendReason(await res.text(), res.status);
      this.logger.error(`Resend rejected an email (${res.status}): ${reason}`);
      throw new EmailRejectedError(reason);
    }
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resend answers `{ "message": "..." }`; fall back to the status code. */
function resendReason(text: string, status: number): string {
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (typeof parsed.message === 'string' && parsed.message) return parsed.message.slice(0, 300);
  } catch {
    // not JSON
  }
  return `HTTP ${status}`;
}
