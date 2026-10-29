// Drizzle table definitions. The source of truth is the SQL in /migrations;
// keep these in sync when a migration changes a table.
import { bigint, boolean, date, doublePrecision, integer, jsonb, numeric, pgEnum, pgTable, real, smallint, text, time, timestamp, uuid } from 'drizzle-orm/pg-core';
import {
  ATTENDANCE_EVENT_TYPES,
  CHANNEL_KINDS,
  REQUEST_STATUSES,
  ROLES,
  type ActivityKind,
  type AttendanceFlag,
  type BillingCycle,
  type CrmEntity,
  type CustomFieldType,
  type CustomValues,
  type DealStatus,
  type FeedbackKind,
  type HalfDay,
  type Industry,
  type ImportMode,
  type ImportProblem,
  type ClientDocKind,
  type ClientDocStatus,
  type Currency,
  type IncidentImpact,
  type IncidentStatus,
  type InvoiceDto,
  type InvoiceStatus,
  type LeadSource,
  type LeadStatus,
  type PaidPlan,
  type PlanKey,
  type Province,
  type ShiftBreak,
  type StageKind,
} from '@workhub/shared';

export const memberRole = pgEnum('member_role', ROLES);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  /** Null for accounts created with Google. */
  passwordHash: text('password_hash'),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

export const authTokenPurpose = pgEnum('auth_token_purpose', ['email_verification', 'password_reset', 'two_factor']);

export const authTokens = pgTable('auth_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  purpose: authTokenPurpose('purpose').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const oauthAccounts = pgTable('oauth_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  provider: text('provider').notNull(),
  providerUserId: text('provider_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const waitlist = pgTable('waitlist', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  company: text('company').notNull(),
  teamSize: text('team_size').notNull(),
  currentTools: text('current_tools'),
  biggestProblem: text('biggest_problem'),
  monthlySpend: text('monthly_spend'),
  source: text('source'),
  ip: text('ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  timezone: text('timezone').notNull().default('Asia/Karachi'),
  currency: text('currency').notNull().default('PKR'),
  /** ISO weekday numbers, 1 = Monday … 7 = Sunday. */
  workingDays: smallint('working_days').array().notNull().default([1, 2, 3, 4, 5]),
  attendanceRequireSelfie: boolean('attendance_require_selfie').notNull().default(true),
  monthlyHours: smallint('monthly_hours').notNull().default(176),
  fxRates: jsonb('fx_rates').$type<Record<string, number>>().notNull().default({}),
  industry: text('industry').$type<Industry>(),
  onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
  requireTwoFactor: boolean('require_two_factor').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable('memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  userId: uuid('user_id').notNull(),
  role: memberRole('role').notNull().default('member'),
  teamId: uuid('team_id'),
  shiftId: uuid('shift_id'),
  attendanceRemote: boolean('attendance_remote').notNull().default(false),
  monthlyCost: numeric('monthly_cost', { precision: 14, scale: 2, mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  shiftId: uuid('shift_id'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  actorUserId: uuid('actor_user_id'),
  action: text('action').notNull(),
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  ip: text('ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invitationKind = pgEnum('invitation_kind', ['email', 'link']);

export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  kind: invitationKind('kind').notNull(),
  email: text('email'),
  role: memberRole('role').notNull(),
  tokenHash: text('token_hash').notNull(),
  invitedBy: uuid('invited_by'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  acceptedBy: uuid('accepted_by'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  userId: uuid('user_id').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  link: text('link'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Sprint 3: clients, projects and boards --------------------------------

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  website: text('website'),
  domain: text('domain'),
  email: text('email'),
  phone: text('phone'),
  phoneKey: text('phone_key'),
  industry: text('industry'),
  city: text('city'),
  country: text('country'),
  address: text('address'),
  notes: text('notes'),
  ownerId: uuid('owner_id'),
  custom: jsonb('custom').$type<CustomValues>().notNull().default({}),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const projectStatus = pgEnum('project_status', ['active', 'on_hold', 'completed', 'archived']);

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  clientId: uuid('client_id'),
  status: projectStatus('status').notNull().default('active'),
  budgetAlertLevel: smallint('budget_alert_level').notNull().default(0),
  budgetHours: numeric('budget_hours', { precision: 10, scale: 2, mode: 'number' }),
  hourlyRate: numeric('hourly_rate', { precision: 12, scale: 2, mode: 'number' }),
  rateCurrency: text('rate_currency'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const projectMembers = pgTable('project_members', {
  workspaceId: uuid('workspace_id').notNull(),
  projectId: uuid('project_id').notNull(),
  userId: uuid('user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const boardColumns = pgTable('board_columns', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  projectId: uuid('project_id').notNull(),
  name: text('name').notNull(),
  position: doublePrecision('position').notNull(),
  wipLimit: integer('wip_limit'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const taskPriority = pgEnum('task_priority', ['none', 'low', 'medium', 'high', 'urgent']);

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  projectId: uuid('project_id').notNull(),
  columnId: uuid('column_id').notNull(),
  parentTaskId: uuid('parent_task_id'),
  title: text('title').notNull(),
  description: text('description'),
  priority: taskPriority('priority').notNull().default('none'),
  dueDate: date('due_date', { mode: 'string' }),
  estimateHours: numeric('estimate_hours', { precision: 8, scale: 2, mode: 'number' }),
  position: doublePrecision('position').notNull(),
  createdBy: uuid('created_by'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const taskAssignees = pgTable('task_assignees', {
  workspaceId: uuid('workspace_id').notNull(),
  taskId: uuid('task_id').notNull(),
  userId: uuid('user_id').notNull(),
});

export const labels = pgTable('labels', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  projectId: uuid('project_id').notNull(),
  name: text('name').notNull(),
  color: text('color').notNull(),
});

export const taskLabels = pgTable('task_labels', {
  workspaceId: uuid('workspace_id').notNull(),
  taskId: uuid('task_id').notNull(),
  labelId: uuid('label_id').notNull(),
});

export const checklistItems = pgTable('checklist_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  taskId: uuid('task_id').notNull(),
  text: text('text').notNull(),
  done: boolean('done').notNull().default(false),
  position: doublePrecision('position').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const taskComments = pgTable('task_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  taskId: uuid('task_id').notNull(),
  authorId: uuid('author_id'),
  body: text('body').notNull(),
  mentions: uuid('mentions').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const taskActivity = pgTable('task_activity', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  taskId: uuid('task_id').notNull(),
  actorId: uuid('actor_id'),
  type: text('type').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Sprint 4: time, attachments, templates -----------------------------------

export const timeEntries = pgTable('time_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  projectId: uuid('project_id').notNull(),
  taskId: uuid('task_id'),
  userId: uuid('user_id').notNull(),
  workDate: date('work_date', { mode: 'string' }).notNull(),
  minutes: integer('minutes').notNull(),
  note: text('note'),
  billable: boolean('billable').notNull().default(true),
  source: text('source').$type<'manual' | 'timer'>().notNull().default('manual'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  /** The client invoice these hours were billed on. */
  invoiceId: uuid('invoice_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const attachments = pgTable('attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  taskId: uuid('task_id').notNull(),
  uploadedBy: uuid('uploaded_by'),
  fileName: text('file_name').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storageKey: text('storage_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const projectTemplates = pgTable('project_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  structure: jsonb('structure').$type<TemplateStructure>().notNull(),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export interface TemplateStructure {
  columns: string[];
  labels: { name: string; color: string }[];
  tasks: { title: string; column: number; checklist?: string[]; estimateHours?: number | null }[];
}

// ---- Attendance (sprint 5) ----------------------------------------------------------

export const shifts = pgTable('shifts', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  /** "HH:MM:SS". An end at or before the start means the shift ends the next day. */
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  graceMinutes: smallint('grace_minutes').notNull().default(15),
  fullDayMinutes: smallint('full_day_minutes').notNull().default(480),
  halfDayMinutes: smallint('half_day_minutes').notNull().default(240),
  workingDays: smallint('working_days').array().notNull().default([1, 2, 3, 4, 5]),
  breaks: jsonb('breaks').$type<ShiftBreak[]>().notNull().default([]),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const attendanceSites = pgTable('attendance_sites', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  radiusMeters: integer('radius_meters'),
  /** cidr[] in the database. */
  ipRanges: text('ip_ranges').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** The rules in force for a workday, copied from the shift at the first check-in. */
export interface DayPolicy {
  graceMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
  breaks: ShiftBreak[];
  /** Whether the date was a working day under the shift. */
  workingDay: boolean;
}

export const attendanceDays = pgTable('attendance_days', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  userId: uuid('user_id').notNull(),
  workDate: date('work_date', { mode: 'string' }).notNull(),
  shiftId: uuid('shift_id'),
  shiftName: text('shift_name'),
  scheduledStart: timestamp('scheduled_start', { withTimezone: true }),
  scheduledEnd: timestamp('scheduled_end', { withTimezone: true }),
  policy: jsonb('policy').$type<DayPolicy>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const attendanceEventType = pgEnum('attendance_event_type', ATTENDANCE_EVENT_TYPES);

export const attendanceEvents = pgTable('attendance_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  dayId: uuid('day_id').notNull(),
  userId: uuid('user_id').notNull(),
  type: attendanceEventType('type').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  clientEventId: uuid('client_event_id'),
  breakName: text('break_name'),
  /** inet in the database. */
  ip: text('ip'),
  userAgent: text('user_agent'),
  deviceId: text('device_id'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  accuracyMeters: real('accuracy_meters'),
  inZone: boolean('in_zone'),
  siteId: uuid('site_id'),
  flags: text('flags').array().$type<AttendanceFlag[]>().notNull().default([]),
  selfieKey: text('selfie_key'),
  selfieDeletedAt: timestamp('selfie_deleted_at', { withTimezone: true }),
  /** Replaced by an approved correction; kept for the record, ignored everywhere else. */
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  voidedBy: uuid('voided_by'),
});

// ---- Leave, holidays, corrections, timers, timesheets (sprint 6) --------------------

export const holidays = pgTable('holidays', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  date: date('date', { mode: 'string' }).notNull(),
  name: text('name').notNull(),
  kind: text('kind').$type<'public' | 'company'>().notNull().default('company'),
  estimated: boolean('estimated').notNull().default(false),
  presetKey: text('preset_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const leaveTypes = pgTable('leave_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  paid: boolean('paid').notNull().default(true),
  daysPerYear: numeric('days_per_year', { precision: 5, scale: 1 }),
  accrual: text('accrual').$type<'yearly' | 'monthly'>().notNull().default('yearly'),
  color: text('color').notNull().default('blue'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const requestStatus = pgEnum('request_status', REQUEST_STATUSES);

export const leaveRequests = pgTable('leave_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  userId: uuid('user_id').notNull(),
  leaveTypeId: uuid('leave_type_id').notNull(),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }).notNull(),
  halfDay: text('half_day').$type<HalfDay>().notNull().default('none'),
  days: numeric('days', { precision: 5, scale: 1 }).notNull(),
  reason: text('reason'),
  status: requestStatus('status').notNull().default('pending'),
  decidedBy: uuid('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const leaveAdjustments = pgTable('leave_adjustments', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  userId: uuid('user_id').notNull(),
  leaveTypeId: uuid('leave_type_id').notNull(),
  year: smallint('year').notNull(),
  days: numeric('days', { precision: 5, scale: 1 }).notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const attendanceCorrections = pgTable('attendance_corrections', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  userId: uuid('user_id').notNull(),
  workDate: date('work_date', { mode: 'string' }).notNull(),
  checkInAt: timestamp('check_in_at', { withTimezone: true }).notNull(),
  checkOutAt: timestamp('check_out_at', { withTimezone: true }).notNull(),
  reason: text('reason').notNull(),
  status: requestStatus('status').notNull().default('pending'),
  requestedBy: uuid('requested_by'),
  decidedBy: uuid('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const taskTimers = pgTable('task_timers', {
  workspaceId: uuid('workspace_id').notNull(),
  userId: uuid('user_id').notNull(),
  taskId: uuid('task_id').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
});

export const timesheets = pgTable('timesheets', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  userId: uuid('user_id').notNull(),
  weekStart: date('week_start', { mode: 'string' }).notNull(),
  status: text('status').$type<'submitted' | 'approved' | 'rejected'>().notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  decidedBy: uuid('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
});

// ---- Inbox, announcements, feedback (sprint 7) ---------------------------------------

export const chatChannelKind = pgEnum('chat_channel_kind', CHANNEL_KINDS);

export const chatChannels = pgTable('chat_channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  kind: chatChannelKind('kind').notNull(),
  name: text('name'),
  topic: text('topic'),
  dmKey: text('dm_key'),
  isDefault: boolean('is_default').notNull().default(false),
  createdBy: uuid('created_by'),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const chatMembers = pgTable('chat_members', {
  workspaceId: uuid('workspace_id').notNull(),
  channelId: uuid('channel_id').notNull(),
  userId: uuid('user_id').notNull(),
  lastReadAt: timestamp('last_read_at', { withTimezone: true }).notNull().defaultNow(),
  muted: boolean('muted').notNull().default(false),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
});

export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  channelId: uuid('channel_id').notNull(),
  authorId: uuid('author_id'),
  parentId: uuid('parent_id'),
  body: text('body').notNull(),
  mentions: uuid('mentions').array().notNull().default([]),
  taskIds: uuid('task_ids').array().notNull().default([]),
  replyCount: integer('reply_count').notNull().default(0),
  lastReplyAt: timestamp('last_reply_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const chatFiles = pgTable('chat_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  channelId: uuid('channel_id').notNull(),
  messageId: uuid('message_id').notNull(),
  uploadedBy: uuid('uploaded_by'),
  fileName: text('file_name').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storageKey: text('storage_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const announcements = pgTable('announcements', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  authorId: uuid('author_id'),
  teamId: uuid('team_id'),
  title: text('title').notNull(),
  body: text('body').notNull(),
  pinned: boolean('pinned').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp('edited_at', { withTimezone: true }),
});

export const announcementReads = pgTable('announcement_reads', {
  workspaceId: uuid('workspace_id').notNull(),
  announcementId: uuid('announcement_id').notNull(),
  userId: uuid('user_id').notNull(),
  readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
});

export const feedback = pgTable('feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  userId: uuid('user_id'),
  kind: text('kind').$type<FeedbackKind>().notNull(),
  message: text('message').notNull(),
  page: text('page'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- CRM core (sprint 8) -----------------------------------------------------------

export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  companyId: uuid('company_id'),
  firstName: text('first_name').notNull(),
  lastName: text('last_name'),
  email: text('email'),
  phone: text('phone'),
  phoneKey: text('phone_key'),
  title: text('title'),
  notes: text('notes'),
  ownerId: uuid('owner_id'),
  leadId: uuid('lead_id'),
  custom: jsonb('custom').$type<CustomValues>().notNull().default({}),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  companyName: text('company_name'),
  email: text('email'),
  phone: text('phone'),
  phoneKey: text('phone_key'),
  source: text('source').$type<LeadSource>().notNull().default('other'),
  sourceDetail: text('source_detail'),
  status: text('status').$type<LeadStatus>().notNull().default('new'),
  value: numeric('value', { precision: 14, scale: 2, mode: 'number' }),
  currency: text('currency').notNull().default('PKR'),
  notes: text('notes'),
  ownerId: uuid('owner_id'),
  custom: jsonb('custom').$type<CustomValues>().notNull().default({}),
  convertedContactId: uuid('converted_contact_id'),
  convertedCompanyId: uuid('converted_company_id'),
  convertedAt: timestamp('converted_at', { withTimezone: true }),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const customFields = pgTable('custom_fields', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  entity: text('entity').$type<CrmEntity>().notNull(),
  key: text('key').notNull(),
  label: text('label').notNull(),
  type: text('type').$type<CustomFieldType>().notNull(),
  options: text('options').array().notNull().default([]),
  position: integer('position').notNull().default(0),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const crmImports = pgTable('crm_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  entity: text('entity').$type<CrmEntity>().notNull(),
  fileName: text('file_name').notNull(),
  mode: text('mode').$type<ImportMode>().notNull(),
  createdCount: integer('created_count').notNull().default(0),
  updatedCount: integer('updated_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  problems: jsonb('problems').$type<ImportProblem[]>().notNull().default([]),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Deals and activities (sprint 9) -------------------------------------------------

export const pipelines = pgTable('pipelines', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  position: integer('position').notNull().default(0),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pipelineStages = pgTable('pipeline_stages', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  pipelineId: uuid('pipeline_id').notNull(),
  name: text('name').notNull(),
  probability: smallint('probability').notNull().default(0),
  kind: text('kind').$type<StageKind>().notNull().default('open'),
  position: integer('position').notNull().default(0),
});

export const deals = pgTable('deals', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  pipelineId: uuid('pipeline_id').notNull(),
  stageId: uuid('stage_id').notNull(),
  title: text('title').notNull(),
  value: numeric('value', { precision: 14, scale: 2, mode: 'number' }),
  currency: text('currency').notNull().default('PKR'),
  companyId: uuid('company_id'),
  contactId: uuid('contact_id'),
  leadId: uuid('lead_id'),
  ownerId: uuid('owner_id'),
  expectedClose: date('expected_close', { mode: 'string' }),
  status: text('status').$type<DealStatus>().notNull().default('open'),
  wonAt: timestamp('won_at', { withTimezone: true }),
  lostAt: timestamp('lost_at', { withTimezone: true }),
  lostReason: text('lost_reason'),
  projectId: uuid('project_id'),
  position: doublePrecision('position').notNull().default(0),
  notes: text('notes'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const activities = pgTable('activities', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  kind: text('kind').$type<ActivityKind>().notNull(),
  subject: text('subject').notNull(),
  body: text('body'),
  dueAt: timestamp('due_at', { withTimezone: true }),
  doneAt: timestamp('done_at', { withTimezone: true }),
  dealId: uuid('deal_id'),
  companyId: uuid('company_id'),
  contactId: uuid('contact_id'),
  leadId: uuid('lead_id'),
  ownerId: uuid('owner_id'),
  remindedAt: timestamp('reminded_at', { withTimezone: true }),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Billing and onboarding (sprint 11) -----------------------------------------------

export const subscriptions = pgTable('subscriptions', {
  workspaceId: uuid('workspace_id').primaryKey(),
  plan: text('plan').$type<PlanKey>().notNull().default('free'),
  billingCycle: text('billing_cycle').$type<BillingCycle>().notNull().default('monthly'),
  paidUntil: date('paid_until', { mode: 'string' }),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  billingName: text('billing_name'),
  billingEmail: text('billing_email'),
  ntn: text('ntn'),
  province: text('province').$type<Province>(),
  address: text('address'),
  discountPercent: smallint('discount_percent').notNull().default(0),
  discountLabel: text('discount_label'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  number: text('number').notNull(),
  status: text('status').$type<InvoiceStatus>().notNull().default('open'),
  plan: text('plan').$type<PaidPlan>().notNull(),
  billingCycle: text('billing_cycle').$type<BillingCycle>().notNull(),
  seats: integer('seats').notNull(),
  unitPrice: numeric('unit_price', { precision: 12, scale: 2, mode: 'number' }).notNull(),
  months: integer('months').notNull(),
  subtotal: numeric('subtotal', { precision: 14, scale: 2, mode: 'number' }).notNull(),
  discountLabel: text('discount_label'),
  discountPercent: smallint('discount_percent').notNull().default(0),
  discountAmount: numeric('discount_amount', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
  taxLabel: text('tax_label'),
  taxRate: numeric('tax_rate', { precision: 5, scale: 2, mode: 'number' }).notNull().default(0),
  taxAmount: numeric('tax_amount', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
  total: numeric('total', { precision: 14, scale: 2, mode: 'number' }).notNull(),
  currency: text('currency').notNull().default('PKR'),
  periodStart: date('period_start', { mode: 'string' }).notNull(),
  periodEnd: date('period_end', { mode: 'string' }).notNull(),
  billTo: jsonb('bill_to').$type<InvoiceDto['billTo']>().notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  paymentMethod: text('payment_method').$type<NonNullable<InvoiceDto['paymentMethod']>>(),
  providerRef: text('provider_ref'),
  transferReference: text('transfer_reference'),
  transferProofKey: text('transfer_proof_key'),
  transferSubmittedAt: timestamp('transfer_submitted_at', { withTimezone: true }),
  reviewedBy: text('reviewed_by'),
  reviewNote: text('review_note'),
  createdBy: uuid('created_by'),
});

// ---- Two-factor sign-in (sprint 12) ----------------------------------------------------

export const userTotp = pgTable('user_totp', {
  userId: uuid('user_id').primaryKey(),
  secretEnc: text('secret_enc').notNull(),
  enabledAt: timestamp('enabled_at', { withTimezone: true }),
  lastStep: bigint('last_step', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const recoveryCodes = pgTable('recovery_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  codeHash: text('code_hash').notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Status page (sprint 13) -----------------------------------------------------------

export const statusDays = pgTable('status_days', {
  component: text('component').notNull(),
  day: date('day', { mode: 'string' }).notNull(),
  checks: integer('checks').notNull().default(0),
  failures: integer('failures').notNull().default(0),
});

export const statusIncidents = pgTable('status_incidents', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  impact: text('impact').$type<IncidentImpact>().notNull(),
  components: text('components').array().notNull().default([]),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdBy: uuid('created_by'),
});

export const statusUpdates = pgTable('status_updates', {
  id: uuid('id').primaryKey().defaultRandom(),
  incidentId: uuid('incident_id').notNull(),
  status: text('status').$type<IncidentStatus>().notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
});

// ---- Quotes and invoices to clients (phase 2) --------------------------------------------

export const clientDocuments = pgTable('client_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  kind: text('kind').$type<ClientDocKind>().notNull(),
  number: text('number').notNull(),
  companyId: uuid('company_id').notNull(),
  status: text('status').$type<ClientDocStatus>().notNull().default('draft'),
  currency: text('currency').$type<Currency>().notNull(),
  issueDate: date('issue_date', { mode: 'string' }).notNull(),
  dueDate: date('due_date', { mode: 'string' }),
  notes: text('notes'),
  taxLabel: text('tax_label'),
  taxRate: numeric('tax_rate', { precision: 5, scale: 2, mode: 'number' }).notNull().default(0),
  subtotal: numeric('subtotal', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
  taxAmount: numeric('tax_amount', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
  total: numeric('total', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
  quoteId: uuid('quote_id'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const clientDocumentLines = pgTable('client_document_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  documentId: uuid('document_id').notNull(),
  position: smallint('position').notNull(),
  description: text('description').notNull(),
  quantity: numeric('quantity', { precision: 10, scale: 2, mode: 'number' }).notNull(),
  unitPrice: numeric('unit_price', { precision: 12, scale: 2, mode: 'number' }).notNull(),
  amount: numeric('amount', { precision: 14, scale: 2, mode: 'number' }).notNull(),
  projectId: uuid('project_id'),
});

export const clientDocumentCounters = pgTable('client_document_counters', {
  workspaceId: uuid('workspace_id').notNull(),
  kind: text('kind').$type<ClientDocKind>().notNull(),
  lastNumber: integer('last_number').notNull().default(0),
});
