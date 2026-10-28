import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { waitlistSchema, type WaitlistInput } from '@workhub/shared';
import { RateLimiter } from '../common/rate-limiter';
import { ClientIp, Public } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { DbService } from '../db/db.service';
import { waitlist } from '../db/schema';
import { EmailService } from '../email/email.service';
import { waitlistWelcomeMessage } from '../email/templates';

@Controller('waitlist')
export class WaitlistController {
  private readonly limiter = new RateLimiter('waitlist.join', 10, 60 * 60 * 1000);

  constructor(
    private readonly db: DbService,
    private readonly email: EmailService,
  ) {}

  /**
   * Joins the beta waitlist. Answers the same way for a new or an existing
   * email, so the form can't be used to find out who has signed up.
   */
  @Public()
  @Post()
  @HttpCode(202)
  async join(@Body(new ZodPipe(waitlistSchema)) body: WaitlistInput, @ClientIp() ip: string | undefined) {
    await this.limiter.consume(ip ?? 'unknown');
    const inserted = await this.db.db
      .insert(waitlist)
      .values({ ...body, ip })
      .onConflictDoNothing()
      .returning({ id: waitlist.id });

    if (inserted.length > 0) {
      await this.email.send(waitlistWelcomeMessage(body.email, body.name)).catch(() => {});
    }
    return { ok: true };
  }
}
