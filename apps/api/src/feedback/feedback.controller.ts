import { Body, Controller, Headers, HttpCode, Logger, Post, UseGuards } from '@nestjs/common';
import { feedbackSchema, type FeedbackInput } from '@workhub/shared';
import { eq } from 'drizzle-orm';
import { AnalyticsService } from '../analytics/analytics.service';
import { config } from '../config';
import { AuthContext, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { DbService } from '../db/db.service';
import { feedback, users, workspaces } from '../db/schema';
import { EmailService } from '../email/email.service';
import { escapeHtml } from '../email/templates';
import { WorkspaceGuard } from '../workspaces/workspace.guard';

/** The in-app feedback button: kept for the WorkHub team, and emailed to FEEDBACK_TO when set. */
@Controller('feedback')
@UseGuards(WorkspaceGuard)
@MinRole('guest')
export class FeedbackController {
  private readonly logger = new Logger('Feedback');

  constructor(
    private readonly db: DbService,
    private readonly email: EmailService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Post()
  @HttpCode(204)
  async send(
    @Body(new ZodPipe(feedbackSchema)) body: FeedbackInput,
    @Headers('user-agent') userAgent: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    const who = await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      // No RETURNING needed; the sender is the only one who could read it back anyway.
      await tx.insert(feedback).values({
        workspaceId: ws.id,
        userId: auth.userId,
        kind: body.kind,
        message: body.message,
        page: body.page ?? null,
        userAgent: userAgent?.slice(0, 300) ?? null,
      });
      const [u] = await tx.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, auth.userId));
      const [w] = await tx.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, ws.id));
      return { name: u!.name, email: u!.email, workspace: w!.name };
    });
    this.analytics.capture('feedback sent', { userId: auth.userId, workspaceId: ws.id }, { kind: body.kind });

    const to = config.feedbackTo;
    if (!to) return;
    const label = { idea: 'Idea', problem: 'Problem', praise: 'Praise' }[body.kind];
    const lines = [`From: ${who.name} <${who.email}> (${ws.role})`, `Workspace: ${who.workspace}`, `Page: ${body.page ?? '-'}`, '', body.message];
    await this.email
      .send({
        to,
        subject: `[WorkHub feedback] ${label} from ${who.name}`,
        text: lines.join('\n'),
        html: `<p>${lines.slice(0, 3).map(escapeHtml).join('<br>')}</p><p style="white-space:pre-wrap">${escapeHtml(body.message)}</p>`,
      })
      // It's already saved; a mail outage shouldn't fail the button.
      .catch((err: unknown) => this.logger.warn(`Could not email feedback: ${err instanceof Error ? err.message : String(err)}`));
  }
}
