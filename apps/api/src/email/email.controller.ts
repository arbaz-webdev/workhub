import { BadGatewayException, Controller, HttpCode, Post } from '@nestjs/common';
import { platformAdmin } from '../common/platform-admin';
import { AuthContext, CurrentAuth } from '../common/request';
import { config } from '../config';
import { DbService } from '../db/db.service';
import { EmailRejectedError, EmailService } from './email.service';

@Controller('platform')
export class EmailController {
  constructor(
    private readonly db: DbService,
    private readonly email: EmailService,
  ) {}

  /** WorkHub staff check the email setup: a test email to their own address, or Resend's reason it failed. */
  @Post('test-email')
  @HttpCode(200)
  async testEmail(@CurrentAuth() auth: AuthContext) {
    const to = await platformAdmin(this.db, auth);
    const text = `This is a test from WorkHub (${config.appUrl}). If you can read it, emails are being sent from ${config.emailFrom}.`;
    try {
      await this.email.send({ to, subject: 'WorkHub test email', text, html: `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>` });
    } catch (err) {
      throw new BadGatewayException(err instanceof EmailRejectedError ? `Resend did not send it: ${err.reason}` : 'The email could not be sent.');
    }
    return { to, transport: config.emailTransport, from: config.emailFrom };
  }
}
