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

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger('Email');

  onModuleInit() {
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

  private async sendWithResend(message: EmailMessage) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.resendApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: config.emailFrom, ...message }),
    });
    if (!res.ok) {
      this.logger.error(`Resend rejected an email (${res.status}): ${await res.text()}`);
      throw new Error('Email could not be sent');
    }
  }
}
