import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { createIncidentSchema, incidentUpdateSchema, type CreateIncidentInput, type IncidentUpdateInput, type StatusPageDto } from '@workhub/shared';
import { eq } from 'drizzle-orm';
import { platformAdmin } from '../common/platform-admin';
import { AuthContext, CurrentAuth, Public } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { DbService } from '../db/db.service';
import { statusIncidents, statusUpdates } from '../db/schema';
import { StatusService } from './status.service';

@Controller()
export class StatusController {
  constructor(
    private readonly db: DbService,
    private readonly status: StatusService,
  ) {}

  /** The public status page: no sign-in, cached briefly. */
  @Public()
  @Get('status')
  page(): Promise<StatusPageDto> {
    return this.status.page();
  }

  /** WorkHub staff post an incident or planned maintenance, with its first update. */
  @Post('platform/incidents')
  async create(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(createIncidentSchema)) body: CreateIncidentInput) {
    await platformAdmin(this.db, auth);
    const id = await this.db.db.transaction(async (tx) => {
      const [incident] = await tx
        .insert(statusIncidents)
        .values({ title: body.title, impact: body.impact, components: body.components, createdBy: auth.userId, resolvedAt: body.status === 'resolved' ? new Date() : null })
        .returning({ id: statusIncidents.id });
      await tx.insert(statusUpdates).values({ incidentId: incident!.id, status: body.status, body: body.body, createdBy: auth.userId });
      return incident!.id;
    });
    this.status.forget();
    return { id };
  }

  /** A further update; "resolved" closes the incident. */
  @Post('platform/incidents/:id/updates')
  async update(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(incidentUpdateSchema)) body: IncidentUpdateInput) {
    await platformAdmin(this.db, auth);
    await this.db.db.transaction(async (tx) => {
      const [incident] = await tx.select({ id: statusIncidents.id }).from(statusIncidents).where(eq(statusIncidents.id, id));
      if (!incident) throw new NotFoundException();
      await tx.insert(statusUpdates).values({ incidentId: id, status: body.status, body: body.body, createdBy: auth.userId });
      await tx
        .update(statusIncidents)
        .set({ resolvedAt: body.status === 'resolved' ? new Date() : null })
        .where(eq(statusIncidents.id, id));
    });
    this.status.forget();
    return { ok: true };
  }
}
