import { Body, Controller, OnModuleInit, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { activitySchema, contactSchema, createTaskSchema, leadSchema, updateLeadSchema, updateTaskSchema, type ActivityInput, type ContactInput, type LeadInput, type UpdateLeadInput } from '@workhub/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { AuthContext, CurrentAuth, CurrentWorkspace, Public, WorkspaceContext } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { CrmController } from '../crm/crm.controller';
import { DealsController } from '../crm/deals.controller';
import { DbService } from '../db/db.service';
import { activities, contacts, leads } from '../db/schema';
import { TasksController } from '../projects/tasks.controller';
import { ApiKeyGuard } from './api-key.guard';
import { activityOut, contactOut, leadOut, loadTaskOut } from './v1.controller';

const taskDetails = updateTaskSchema.omit({ labelIds: true });
const createTaskBody = createTaskSchema.extend({ projectId: z.uuid() }).extend(taskDetails.omit({ title: true }).shape);
/** A task's fields, plus `columnId` to move it to the end of another column. */
const updateTaskBody = taskDetails.extend({ columnId: z.uuid().optional() });
const updateContactBody = contactSchema.partial();

/**
 * The public API's writes, for "read and write" keys (ApiKeyGuard refuses the rest).
 * Each one calls the app's own handler, so the rules, the audit trail, notifications and
 * live board updates are exactly those of the app. Answers use the read endpoints' shapes.
 */
@Controller('v1')
@Public()
@UseGuards(ApiKeyGuard)
export class PublicApiV1WriteController implements OnModuleInit {
  private tasks!: TasksController;
  private crm!: CrmController;
  private deals!: DealsController;

  constructor(
    private readonly db: DbService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit() {
    this.tasks = this.moduleRef.get(TasksController, { strict: false });
    this.crm = this.moduleRef.get(CrmController, { strict: false });
    this.deals = this.moduleRef.get(DealsController, { strict: false });
  }

  private task(auth: AuthContext, ws: WorkspaceContext, id: string) {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, (tx) => loadTaskOut(tx, ws.id, id));
  }

  private async row<T>(auth: AuthContext, ws: WorkspaceContext, table: typeof leads | typeof contacts | typeof activities, id: string, map: (row: never) => T): Promise<T> {
    const [row] = await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, (tx) => tx.select().from(table).where(eq(table.id, id)));
    return map(row as never);
  }

  /** A task (or, with parentTaskId, a subtask), optionally with its details in the same call. */
  @Post('tasks')
  async createTask(@Body(new ZodPipe(createTaskBody)) body: z.infer<typeof createTaskBody>, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    const { projectId, title, columnId, parentTaskId, ...details } = body;
    const created = await this.tasks.create(projectId, { title, columnId, parentTaskId }, auth, ws);
    if (Object.keys(details).length > 0) await this.tasks.update(created.id, details, auth, ws);
    return this.task(auth, ws, created.id);
  }

  @Patch('tasks/:id')
  async updateTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateTaskBody)) body: z.infer<typeof updateTaskBody>,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    const { columnId, ...fields } = body;
    if (Object.keys(fields).length > 0) await this.tasks.update(id, fields, auth, ws);
    // 100,000 is past the end of any column: the app's "move to the bottom".
    if (columnId) await this.tasks.move(id, { columnId, index: 100_000 }, auth, ws);
    return this.task(auth, ws, id);
  }

  @Post('leads')
  async createLead(@Body(new ZodPipe(leadSchema)) body: LeadInput, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    const created = await this.crm.createLead(body, auth, ws);
    return this.row(auth, ws, leads, created.id, leadOut);
  }

  @Patch('leads/:id')
  async updateLead(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateLeadSchema)) body: UpdateLeadInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    await this.crm.updateLead(id, body, auth, ws);
    return this.row(auth, ws, leads, id, leadOut);
  }

  @Post('contacts')
  async createContact(@Body(new ZodPipe(contactSchema)) body: ContactInput, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    const created = await this.crm.createContact(body, auth, ws);
    return this.row(auth, ws, contacts, created.id, contactOut);
  }

  @Patch('contacts/:id')
  async updateContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateContactBody)) body: Partial<ContactInput>,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    await this.crm.updateContact(id, body, auth, ws);
    return this.row(auth, ws, contacts, id, contactOut);
  }

  /** A call, meeting, note or follow-up on a deal, company, contact or lead. */
  @Post('activities')
  async createActivity(@Body(new ZodPipe(activitySchema)) body: ActivityInput, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    const created = await this.deals.createActivity(body, auth, ws);
    return this.row(auth, ws, activities, created.id, activityOut);
  }
}
