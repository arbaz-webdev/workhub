import { z } from 'zod';

// Roles, highest privilege first. Keep in sync with the member_role enum in the API migrations.
export const ROLES = ['owner', 'admin', 'manager', 'member', 'guest'] as const;
export type Role = (typeof ROLES)[number];

/** True when `role` has at least the privileges of `required`. */
export function hasRole(role: Role, required: Role): boolean {
  return ROLES.indexOf(role) <= ROLES.indexOf(required);
}

const email = z.string().trim().toLowerCase().email().max(254);

export const signUpSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(100),
  email,
  password: z.string().min(10, 'Use at least 10 characters').max(128),
  /** Omitted when someone signs up to accept an invitation to an existing workspace. */
  workspaceName: z.string().trim().min(2, 'Enter your company name').max(80).optional(),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password').max(128),
});
export type SignInInput = z.infer<typeof signInSchema>;

const password = z.string().min(10, 'Use at least 10 characters').max(128);
const token = z.string().min(20).max(200);

export const verifyEmailSchema = z.object({ token });
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({ token, password });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2, 'Enter your company name').max(80),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const TEAM_SIZES = ['1-9', '10-49', '50-199', '200+'] as const;

export const waitlistSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(100),
  email,
  company: z.string().trim().min(1, 'Enter your company name').max(120),
  teamSize: z.enum(TEAM_SIZES, { message: 'Choose your team size' }),
  currentTools: z.string().trim().max(500).optional(),
  biggestProblem: z.string().trim().max(1000).optional(),
  monthlySpend: z.string().trim().max(100).optional(),
  source: z.string().trim().max(100).optional(),
});
export type WaitlistInput = z.infer<typeof waitlistSchema>;

export interface AuthProvidersResponse {
  google: boolean;
}

export const createTeamSchema = z.object({
  name: z.string().trim().min(1, 'Enter a team name').max(80),
});
export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export interface UserDto {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
}

export interface WorkspaceDto {
  id: string;
  name: string;
  slug: string;
  role: Role;
}

export interface MeResponse {
  user: UserDto;
  workspaces: WorkspaceDto[];
}

export interface TeamDto {
  id: string;
  name: string;
  createdAt: string;
}

/** Header the web app sends to choose which workspace a request acts on. */
export const WORKSPACE_HEADER = 'x-workspace-id';

// ---- Workspace settings ----------------------------------------------------

export const CURRENCIES = ['PKR', 'USD', 'AED', 'SAR', 'GBP', 'EUR'] as const;
/** ISO weekday numbers: 1 = Monday … 7 = Sunday. */
export const WEEKDAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
] as const;

export interface WorkspaceSettingsDto extends WorkspaceDto {
  timezone: string;
  currency: (typeof CURRENCIES)[number];
  workingDays: number[];
}

export const updateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter your company name').max(80),
    timezone: z.string().min(1).max(64),
    currency: z.enum(CURRENCIES),
    workingDays: z
      .array(z.number().int().min(1).max(7))
      .min(1, 'Choose at least one working day')
      .max(7)
      .refine((days) => new Set(days).size === days.length, 'Each day once'),
  })
  .partial();
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;

// ---- Members and invitations -------------------------------------------------

/** Roles that can be given by invitation or role change (owner is never handed out this way). */
export const ASSIGNABLE_ROLES = ['admin', 'manager', 'member', 'guest'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];
const assignableRole = z.enum(ASSIGNABLE_ROLES, { message: 'Choose a role' });

export const inviteByEmailSchema = z.object({
  emails: z.array(email).min(1, 'Add at least one email').max(100, 'Up to 100 at a time'),
  role: assignableRole,
});
export type InviteByEmailInput = z.infer<typeof inviteByEmailSchema>;

export const inviteLinkSchema = z.object({
  role: z.enum(['manager', 'member', 'guest'], { message: 'Choose a role' }),
});
export type InviteLinkInput = z.infer<typeof inviteLinkSchema>;

export const acceptInviteSchema = z.object({ token });
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const updateMemberRoleSchema = z.object({ role: assignableRole });
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

export interface MemberDto {
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: string;
}

export interface InvitationDto {
  id: string;
  kind: 'email' | 'link';
  email: string | null;
  role: Role;
  invitedByName: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface InviteLinkResponse {
  invitation: InvitationDto;
  /** Shown once; only its hash is stored. */
  url: string;
}

export interface InvitePreviewDto {
  workspaceName: string;
  inviterName: string | null;
  role: Role;
  /** Set for email invites: only this address can accept. */
  email: string | null;
}

// ---- Notifications -----------------------------------------------------------

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationsResponse {
  items: NotificationDto[];
  unreadCount: number;
}

// ---- Audit log ---------------------------------------------------------------

export interface AuditLogDto {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  actorName: string | null;
  actorEmail: string | null;
  ip: string | null;
  createdAt: string;
}

export interface AuditLogPage {
  items: AuditLogDto[];
  /** Pass back as ?before= to load older entries; null when there are no more. */
  nextCursor: string | null;
}

/** Plain-English labels for audit actions, shared by the viewer and the CSV export. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'workspace.created': 'Created the workspace',
  'workspace.updated': 'Changed workspace settings',
  'team.created': 'Created a team',
  'invitation.created': 'Invited someone',
  'invitation.revoked': 'Cancelled an invitation',
  'member.joined': 'Joined the workspace',
  'member.role_changed': "Changed someone's role",
  'member.removed': 'Removed someone',
};

// ---- Clients, projects and boards (sprint 3) -------------------------------

export const PROJECT_STATUSES = ['active', 'on_hold', 'completed', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const LABEL_COLORS = ['gray', 'red', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

const uuid = z.string().uuid();
const name = (label: string, max = 120) => z.string().trim().min(1, `Enter ${label}`).max(max);
const hours = z.number().min(0).max(100_000).nullable();

export const createCompanySchema = z.object({ name: name('a client name') });
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

export interface CompanyDto {
  id: string;
  name: string;
}

export const createProjectSchema = z.object({
  name: name('a project name'),
  description: z.string().trim().max(5000).optional(),
  clientId: uuid.nullable().optional(),
  budgetHours: hours.optional(),
  /** "builtin:<key>" or a saved template's id. */
  templateId: z.string().max(80).optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    name: name('a project name'),
    description: z.string().trim().max(5000).nullable(),
    clientId: uuid.nullable(),
    status: z.enum(PROJECT_STATUSES),
    budgetHours: hours,
  })
  .partial();
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const projectMemberSchema = z.object({ userId: uuid });

export interface ProjectSummaryDto {
  id: string;
  name: string;
  status: ProjectStatus;
  client: CompanyDto | null;
  budgetHours: number | null;
  estimateHours: number;
  /** Logged time on the project, in hours. */
  actualHours: number;
  openTasks: number;
  doneTasks: number;
  updatedAt: string;
}

export interface ColumnDto {
  id: string;
  name: string;
  position: number;
  wipLimit: number | null;
}

export interface LabelDto {
  id: string;
  name: string;
  color: LabelColor;
}

export interface PersonDto {
  id: string;
  name: string;
  email: string;
}

/** A card on the board (top-level task, light fields only). */
export interface TaskCardDto {
  id: string;
  columnId: string;
  title: string;
  priority: Priority;
  dueDate: string | null;
  estimateHours: number | null;
  /** Logged time on the task and its subtasks, in hours. */
  actualHours: number;
  position: number;
  assigneeIds: string[];
  labelIds: string[];
  checklistDone: number;
  checklistTotal: number;
  subtasksDone: number;
  subtasksTotal: number;
  commentCount: number;
  completed: boolean;
}

export interface BoardDto {
  project: ProjectSummaryDto & { description: string | null };
  columns: ColumnDto[];
  tasks: TaskCardDto[];
  labels: LabelDto[];
  /** People who can be assigned: everyone in the workspace except guests not on the project. */
  people: PersonDto[];
  /** Whether the caller may change columns and project settings. */
  canManage: boolean;
  /** Whether the caller may create and edit tasks (false for guests). */
  canEdit: boolean;
}

export const createColumnSchema = z.object({ name: name('a column name', 60) });
export const updateColumnSchema = z
  .object({ name: name('a column name', 60), wipLimit: z.number().int().min(1).max(999).nullable() })
  .partial();
export type UpdateColumnInput = z.infer<typeof updateColumnSchema>;
export const moveSchema = z.object({ index: z.number().int().min(0).max(100_000) });

export const createTaskSchema = z.object({
  title: name('a task title', 300),
  columnId: uuid.optional(),
  parentTaskId: uuid.optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    title: name('a task title', 300),
    description: z.string().max(20_000).nullable(),
    priority: z.enum(PRIORITIES),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable(),
    estimateHours: hours,
    assigneeIds: z.array(uuid).max(20),
    labelIds: z.array(uuid).max(20),
    completed: z.boolean(),
  })
  .partial();
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const moveTaskSchema = z.object({ columnId: uuid, index: z.number().int().min(0).max(100_000) });
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;

export const createLabelSchema = z.object({ name: name('a label name', 40), color: z.enum(LABEL_COLORS) });
export type CreateLabelInput = z.infer<typeof createLabelSchema>;

export const checklistItemSchema = z.object({ text: name('an item', 300) });
export const updateChecklistItemSchema = z.object({ text: name('an item', 300), done: z.boolean() }).partial();

export const commentSchema = z.object({
  body: z.string().trim().min(1, 'Write a comment').max(10_000),
  mentions: z.array(uuid).max(20).default([]),
});
export type CommentInput = z.infer<typeof commentSchema>;

export interface ChecklistItemDto {
  id: string;
  text: string;
  done: boolean;
}

export interface SubtaskDto {
  id: string;
  title: string;
  completed: boolean;
}

export interface CommentDto {
  id: string;
  author: PersonDto | null;
  body: string;
  mentions: string[];
  createdAt: string;
  editedAt: string | null;
}

export interface ActivityDto {
  id: string;
  actorName: string | null;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface TaskDetailDto extends TaskCardDto {
  projectId: string;
  description: string | null;
  createdAt: string;
  createdByName: string | null;
  checklist: ChecklistItemDto[];
  subtasks: SubtaskDto[];
  comments: CommentDto[];
  activity: ActivityDto[];
  attachments: AttachmentDto[];
  timeEntries: TimeEntryDto[];
}

/** Server-sent board events; clients apply them by id, so repeats are harmless. */
export type BoardEvent =
  | { type: 'task.upserted'; task: TaskCardDto }
  | { type: 'task.deleted'; taskId: string }
  | { type: 'task.changed'; taskId: string }
  | { type: 'columns.changed'; columns: ColumnDto[] }
  | { type: 'labels.changed'; labels: LabelDto[] }
  | { type: 'project.changed' };

// ---- Sprint 4: time, attachments, My Work, bulk edit, templates ------------------

/** A real calendar date as YYYY-MM-DD (rejects 2026-02-31). */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'Not a real date');

export const logTimeSchema = z.object({
  minutes: z.number().int().min(1, 'Log at least a minute').max(24 * 60, 'At most 24 hours in one entry'),
  workDate: calendarDate.optional(),
  note: z.string().trim().max(500).optional(),
  billable: z.boolean().optional(),
});
export type LogTimeInput = z.infer<typeof logTimeSchema>;

export interface TimeEntryDto {
  id: string;
  user: PersonDto | null;
  workDate: string;
  minutes: number;
  note: string | null;
  billable: boolean;
}

export interface AttachmentDto {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedById: string | null;
  uploadedByName: string | null;
  createdAt: string;
  /** Relative API path; images can be shown inline. */
  url: string;
  isImage: boolean;
}

export const MAX_UPLOAD_MB = 25;

export interface MyTaskDto {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  /** For subtasks: the card that opens in the board. */
  parentTaskId: string | null;
  columnName: string;
  priority: Priority;
  dueDate: string | null;
  estimateHours: number | null;
}

export interface MyWorkDto {
  /** "Today" in the workspace's time zone, YYYY-MM-DD. */
  today: string;
  tasks: MyTaskDto[];
}

export const bulkActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), columnId: uuid }),
  z.object({ type: z.literal('assign'), userId: uuid }),
  z.object({ type: z.literal('unassign'), userId: uuid }),
  z.object({ type: z.literal('priority'), priority: z.enum(PRIORITIES) }),
  z.object({ type: z.literal('due'), dueDate: calendarDate.nullable() }),
  z.object({ type: z.literal('label'), labelId: uuid }),
  z.object({ type: z.literal('complete'), completed: z.boolean() }),
  z.object({ type: z.literal('delete') }),
]);
export const bulkTasksSchema = z.object({
  taskIds: z.array(uuid).min(1, 'Select at least one task').max(200),
  action: bulkActionSchema,
});
export type BulkTasksInput = z.infer<typeof bulkTasksSchema>;

export interface TemplateDto {
  id: string;
  name: string;
  description: string | null;
  builtin: boolean;
  columns: string[];
  taskCount: number;
}

export const saveTemplateSchema = z.object({
  name: name('a template name', 80),
  description: z.string().trim().max(300).optional(),
});
export type SaveTemplateInput = z.infer<typeof saveTemplateSchema>;

// ---- Sprint 5: attendance ------------------------------------------------------

/** 24-hour "HH:MM". */
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');
const weekdays = z
  .array(z.number().int().min(1).max(7))
  .max(7)
  .transform((d) => [...new Set(d)].sort());

export const shiftBreakSchema = z.object({
  name: name('a break name', 40),
  minutes: z.number().int().min(1).max(240),
  /** Paid breaks count as work time (up to their allowance). */
  paid: z.boolean(),
  /** Only on these ISO weekdays (e.g. a longer Jumu'ah break on Fridays). Empty = every working day. */
  days: weekdays.default([]),
});
export type ShiftBreak = z.infer<typeof shiftBreakSchema>;

export const shiftSchema = z
  .object({
    name: name('a shift name', 60),
    startTime: clockTime,
    endTime: clockTime,
    graceMinutes: z.number().int().min(0).max(240).default(15),
    fullDayMinutes: z.number().int().min(1).max(1440).default(480),
    halfDayMinutes: z.number().int().min(0).max(1440).default(240),
    workingDays: weekdays.default([1, 2, 3, 4, 5]),
    breaks: z.array(shiftBreakSchema).max(10).default([]),
    isDefault: z.boolean().default(false),
  })
  .refine((s) => s.startTime !== s.endTime, { message: 'Start and end time must differ', path: ['endTime'] })
  .refine((s) => s.halfDayMinutes <= s.fullDayMinutes, { message: 'A half day can’t be longer than a full day', path: ['halfDayMinutes'] })
  .refine((s) => new Set(s.breaks.map((b) => b.name.toLowerCase())).size === s.breaks.length, {
    message: 'Give each break a different name',
    path: ['breaks'],
  });
export type ShiftInput = z.input<typeof shiftSchema>;

export interface ShiftDto {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  /** True when the shift ends the next day (e.g. 18:00–03:00). */
  overnight: boolean;
  graceMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
  workingDays: number[];
  breaks: ShiftBreak[];
  isDefault: boolean;
}

/** IPv4/IPv6 address or CIDR range, e.g. 203.0.113.0/24. The API checks it properly. */
const ipRange = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F:.]+(\/\d{1,3})?$/, 'Enter an IP address or range like 203.0.113.0/24');

export const siteSchema = z
  .object({
    name: name('a site name', 80),
    latitude: z.number().min(-90).max(90).nullable().default(null),
    longitude: z.number().min(-180).max(180).nullable().default(null),
    radiusMeters: z.number().int().min(20).max(50_000).nullable().default(null),
    ipRanges: z.array(ipRange).max(20).default([]),
  })
  .refine((s) => (s.latitude === null) === (s.longitude === null) && (s.latitude === null) === (s.radiusMeters === null), {
    message: 'Set latitude, longitude and radius together',
    path: ['radiusMeters'],
  })
  .refine((s) => s.latitude !== null || s.ipRanges.length > 0, { message: 'Add a location or at least one IP range', path: ['ipRanges'] });
export type SiteInput = z.input<typeof siteSchema>;

export interface SiteDto {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number | null;
  ipRanges: string[];
}

export const updateAttendanceSettingsSchema = z.object({ requireSelfie: z.boolean() });

export const assignAttendanceSchema = z
  .object({
    teamId: uuid.nullable(),
    /** The person's own shift; null = use their team's or the default. */
    shiftId: uuid.nullable(),
    remote: z.boolean(),
  })
  .partial();
export type AssignAttendanceInput = z.infer<typeof assignAttendanceSchema>;

export const teamShiftSchema = z.object({ shiftId: uuid.nullable() });

export interface AttendancePersonDto {
  userId: string;
  name: string;
  email: string;
  role: Role;
  teamId: string | null;
  shiftId: string | null;
  remote: boolean;
  /** The shift that actually applies (own, team's or default), if any. */
  effectiveShiftId: string | null;
}

export interface AttendanceSettingsDto {
  requireSelfie: boolean;
  timezone: string;
  shifts: ShiftDto[];
  sites: SiteDto[];
  teams: { id: string; name: string; shiftId: string | null }[];
  people: AttendancePersonDto[];
}

export const ATTENDANCE_EVENT_TYPES = ['check_in', 'check_out', 'break_start', 'break_end'] as const;
export type AttendanceEventType = (typeof ATTENDANCE_EVENT_TYPES)[number];

/**
 * Fields of POST /attendance/events (multipart, so numbers arrive as text).
 * The selfie is the "selfie" file part.
 */
export const attendanceEventSchema = z
  .object({
    type: z.enum(ATTENDANCE_EVENT_TYPES),
    /** Set by a device that queued the event offline. */
    occurredAt: z.iso.datetime({ offset: true }).optional(),
    clientEventId: uuid.optional(),
    breakName: z.string().trim().min(1).max(40).optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    accuracyMeters: z.coerce.number().min(0).max(100_000).optional(),
    deviceId: z.string().trim().max(64).optional(),
  })
  .refine((e) => (e.latitude === undefined) === (e.longitude === undefined), { message: 'Send latitude and longitude together', path: ['longitude'] })
  .refine((e) => e.type !== 'break_start' || !!e.breakName, { message: 'Choose which break', path: ['breakName'] });
export type AttendanceEventInput = z.infer<typeof attendanceEventSchema>;

export const ATTENDANCE_STATUSES = ['present', 'late', 'half_day', 'absent', 'on_leave', 'holiday', 'weekend', 'not_started'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/**
 * late · left_early · long_break · missed_check_out · short_day · day_off (worked on a
 * non-working day) · outside_zone · no_location · offline (recorded offline, synced later)
 */
export const ATTENDANCE_FLAGS = [
  'late',
  'left_early',
  'long_break',
  'missed_check_out',
  'short_day',
  'day_off',
  'outside_zone',
  'no_location',
  'offline',
  'half_day_leave',
  'corrected',
] as const;
export type AttendanceFlag = (typeof ATTENDANCE_FLAGS)[number];

export interface AttendanceEventDto {
  id: string;
  type: AttendanceEventType;
  occurredAt: string;
  breakName: string | null;
  inZone: boolean | null;
  siteName: string | null;
  flags: AttendanceFlag[];
  device: string | null;
  ip: string | null;
  /** Relative API path while the selfie is kept (30 days). */
  selfieUrl: string | null;
}

export interface AttendanceDayDto {
  date: string;
  status: AttendanceStatus;
  flags: AttendanceFlag[];
  /** The public or company holiday on this date, if any. */
  holidayName: string | null;
  /** Approved leave covering this date (fraction 0.5 for a half day). */
  leave: { typeName: string; fraction: number; paid: boolean } | null;
  /** Checked in and not yet checked out. */
  open: boolean;
  /** The break in progress, if any. */
  onBreak: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  shiftName: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  events: AttendanceEventDto[];
}

export interface AttendanceTodayDto {
  /** The workday a check-in now would count towards (workspace time zone). */
  date: string;
  state: 'out' | 'in' | 'on_break';
  day: AttendanceDayDto;
  shift: ShiftDto | null;
  /** Breaks allowed today under the shift. */
  breaks: ShiftBreak[];
  requireSelfie: boolean;
  timezone: string;
}

export interface TeamAttendanceDto {
  date: string;
  timezone: string;
  summary: Record<AttendanceStatus, number>;
  rows: { userId: string; name: string; teamName: string | null; remote: boolean; day: AttendanceDayDto }[];
}

export const MAX_SELFIE_BYTES = 3 * 1024 * 1024;
export const SELFIE_RETENTION_DAYS = 30;

// ---- Sprint 6: holidays, leave, corrections, timer and timesheets -------------------

export const holidaySchema = z.object({
  date: calendarDate,
  name: name('a holiday name', 80),
});
export type HolidayInput = z.infer<typeof holidaySchema>;

export interface HolidayDto {
  id: string;
  date: string;
  name: string;
  kind: 'public' | 'company';
  /** Moon-sighting date not yet announced. */
  estimated: boolean;
}

export const LEAVE_COLORS = ['blue', 'teal', 'amber', 'violet', 'pink', 'gray'] as const;

export const leaveTypeSchema = z.object({
  name: name('a leave type name', 40),
  paid: z.boolean(),
  /** Days a year; null for no limit (e.g. unpaid leave). */
  daysPerYear: z.number().min(0).max(365).multipleOf(0.5).nullable(),
  accrual: z.enum(['yearly', 'monthly']),
  color: z.enum(LEAVE_COLORS).default('blue'),
});
export type LeaveTypeInput = z.input<typeof leaveTypeSchema>;

export interface LeaveTypeDto {
  id: string;
  name: string;
  paid: boolean;
  daysPerYear: number | null;
  accrual: 'yearly' | 'monthly';
  color: (typeof LEAVE_COLORS)[number];
}

export const HALF_DAYS = ['none', 'first', 'second'] as const;
export type HalfDay = (typeof HALF_DAYS)[number];

export const leaveRequestSchema = z
  .object({
    leaveTypeId: uuid,
    startDate: calendarDate,
    endDate: calendarDate,
    halfDay: z.enum(HALF_DAYS).default('none'),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((r) => r.endDate >= r.startDate, { message: 'The leave must end on or after its first day', path: ['endDate'] })
  .refine((r) => r.halfDay === 'none' || r.startDate === r.endDate, { message: 'A half day is for a single date', path: ['halfDay'] })
  .refine((r) => r.startDate.slice(0, 4) === r.endDate.slice(0, 4), {
    message: 'Leave can’t span two years; make one request for each year',
    path: ['endDate'],
  });
export type LeaveRequestInput = z.input<typeof leaveRequestSchema>;

export const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const decisionSchema = z.object({ note: z.string().trim().max(500).optional() });
export type DecisionInput = z.infer<typeof decisionSchema>;

export interface LeaveRequestDto {
  id: string;
  user: PersonDto;
  leaveType: Pick<LeaveTypeDto, 'id' | 'name' | 'color' | 'paid'>;
  startDate: string;
  endDate: string;
  halfDay: HalfDay;
  days: number;
  /** Shown to the person and to managers only. */
  reason: string | null;
  status: RequestStatus;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface LeaveBalanceDto {
  leaveType: LeaveTypeDto;
  year: number;
  /** Earned so far this year (null when the type has no limit). */
  entitled: number | null;
  adjustments: number;
  used: number;
  pending: number;
  /** What can still be requested (null when the type has no limit). */
  available: number | null;
}

export interface MyLeaveDto {
  year: number;
  balances: LeaveBalanceDto[];
  requests: LeaveRequestDto[];
}

export const leaveAdjustmentSchema = z.object({
  userId: uuid,
  leaveTypeId: uuid,
  year: z.number().int().min(2000).max(2100),
  days: z.number().min(-365).max(365).multipleOf(0.5).refine((d) => d !== 0, 'Enter a number of days'),
  reason: name('a reason', 300),
});
export type LeaveAdjustmentInput = z.infer<typeof leaveAdjustmentSchema>;

export interface LeaveCalendarDto {
  month: string;
  holidays: HolidayDto[];
  people: { userId: string; name: string; entries: { date: string; typeName: string; color: string; status: 'pending' | 'approved'; fraction: number }[] }[];
}

export const correctionSchema = z
  .object({
    date: calendarDate,
    checkInAt: z.iso.datetime({ offset: true }),
    checkOutAt: z.iso.datetime({ offset: true }),
    reason: name('a reason', 500),
    /** Managers correcting someone else's day; applied straight away. */
    userId: uuid.optional(),
  })
  .refine((c) => new Date(c.checkOutAt) > new Date(c.checkInAt), { message: 'Check-out must be after check-in', path: ['checkOutAt'] })
  .refine((c) => new Date(c.checkOutAt).getTime() - new Date(c.checkInAt).getTime() <= 20 * 3600_000, {
    message: 'A day can’t be longer than 20 hours',
    path: ['checkOutAt'],
  });
export type CorrectionInput = z.infer<typeof correctionSchema>;

export interface CorrectionDto {
  id: string;
  user: PersonDto;
  date: string;
  checkInAt: string;
  checkOutAt: string;
  reason: string;
  status: RequestStatus;
  requestedByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface TimerDto {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  startedAt: string;
}

export const TIMESHEET_STATUSES = ['draft', 'submitted', 'approved', 'rejected'] as const;
export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];

export interface TimesheetDto {
  id: string | null;
  user: PersonDto;
  weekStart: string;
  /** The seven dates, Monday first. */
  days: string[];
  status: TimesheetStatus;
  decidedByName: string | null;
  decisionNote: string | null;
  rows: { taskId: string | null; taskTitle: string; projectId: string; projectName: string; minutes: number[]; total: number; billable: number }[];
  dayTotals: number[];
  total: number;
  billable: number;
  /** Minutes from timers vs. typed in by hand. */
  fromTimer: number;
  manual: number;
}

export interface TimesheetSummaryDto {
  user: PersonDto;
  timesheetId: string | null;
  status: TimesheetStatus;
  total: number;
  billable: number;
}

export const submitTimesheetSchema = z.object({ weekStart: calendarDate });

// ---- Sprint 7: inbox, presence, announcements, feedback ---------------------------

export const CHANNEL_KINDS = ['public', 'private', 'dm'] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];
/** A group DM holds up to this many people, the sender included. */
export const MAX_DM_PEOPLE = 8;
export const MAX_CHAT_FILES = 5;
export const MAX_TASK_CARDS = 5;

/** A multipart field holding a JSON array (or nothing). */
const jsonIds = (max: number) =>
  z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    if (v.trim() === '') return [];
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }, z.array(uuid).max(max).default([]));

const channelName = z
  .string()
  .trim()
  .toLowerCase()
  .transform((s) => s.replace(/\s+/g, '-'))
  .pipe(
    z
      .string()
      .min(1, 'Enter a channel name')
      .max(80)
      .regex(/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u, 'Use letters, numbers, - and _'),
  );
const topic = z.string().trim().max(250).nullable();

export const createChannelSchema = z.object({
  name: channelName,
  topic: topic.optional(),
  private: z.boolean().default(false),
  memberIds: z.array(uuid).max(200).default([]),
});
export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export const updateChannelSchema = z.object({ name: channelName, topic }).partial();
export const openDmSchema = z.object({ userIds: z.array(uuid).min(1, 'Choose someone').max(MAX_DM_PEOPLE - 1) });
export const addMembersSchema = z.object({ userIds: z.array(uuid).min(1, 'Choose someone').max(200) });
export const muteSchema = z.object({ muted: z.boolean() });

/** Multipart (files go with it), so the id lists arrive as JSON text. */
export const sendMessageSchema = z.object({
  body: z.string().trim().max(8000, 'Keep a message under 8,000 characters').default(''),
  parentId: uuid.optional(),
  mentions: jsonIds(50),
  taskIds: jsonIds(MAX_TASK_CARDS),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export const editMessageSchema = z.object({
  body: z.string().trim().min(1, 'Write a message').max(8000, 'Keep a message under 8,000 characters'),
  mentions: z.array(uuid).max(50).default([]),
  taskIds: z.array(uuid).max(MAX_TASK_CARDS).default([]),
});
export type EditMessageInput = z.infer<typeof editMessageSchema>;

/** in: checked in; break: on a break; out: checked out today; leave: on leave today; away: not checked in. */
export const PRESENCES = ['in', 'break', 'out', 'leave', 'away'] as const;
export type Presence = (typeof PRESENCES)[number];

export interface PresenceDto {
  userId: string;
  presence: Presence;
  /** When it last changed (the punch time), if known. */
  since: string | null;
}

export interface ChannelDto {
  id: string;
  kind: ChannelKind;
  /** Null for DMs; show the people instead. */
  name: string | null;
  topic: string | null;
  isDefault: boolean;
  /** For DMs: everyone else in it. Empty for channels. */
  people: PersonDto[];
  memberCount: number;
  joined: boolean;
  muted: boolean;
  /** Unread top-level messages, and unread messages that mention you. */
  unread: number;
  mentions: number;
  lastMessageAt: string | null;
  archived: boolean;
  createdById: string | null;
}

export interface ChatFileDto {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  url: string;
  isImage: boolean;
}

export interface ChatMessageDto {
  id: string;
  channelId: string;
  parentId: string | null;
  author: PersonDto | null;
  body: string;
  mentions: string[];
  taskIds: string[];
  files: ChatFileDto[];
  replyCount: number;
  lastReplyAt: string | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
}

export interface MessagePageDto {
  /** Oldest first. */
  messages: ChatMessageDto[];
  hasMore: boolean;
}

export interface ThreadDto {
  root: ChatMessageDto;
  replies: ChatMessageDto[];
}

/** A task shown as a card in chat; only tasks the viewer may see are returned. */
export interface TaskRefDto {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  columnName: string;
  priority: Priority;
  dueDate: string | null;
  completed: boolean;
  assignees: PersonDto[];
}

export interface InboxSummaryDto {
  unread: number;
  mentions: number;
  announcements: number;
}

/** Server-sent inbox events for one person; clients refetch or apply them by id. */
export type InboxEvent =
  | { type: 'message.created'; message: ChatMessageDto }
  | { type: 'message.updated'; message: ChatMessageDto }
  | { type: 'channel.changed'; channelId: string }
  | { type: 'channel.read'; channelId: string }
  | { type: 'presence.changed'; userId: string; presence: Presence; since: string }
  | { type: 'announcement.changed' };

export const announcementSchema = z.object({
  title: name('a title', 150),
  body: z.string().trim().min(1, 'Write the announcement').max(10_000),
  /** Null: everyone. */
  teamId: uuid.nullable().default(null),
  pinned: z.boolean().default(false),
});
export type AnnouncementInput = z.infer<typeof announcementSchema>;

export interface AnnouncementDto {
  id: string;
  title: string;
  body: string;
  author: PersonDto | null;
  team: { id: string; name: string } | null;
  pinned: boolean;
  createdAt: string;
  editedAt: string | null;
  read: boolean;
  /** Read receipts, for its author and managers and above; null for everyone else. */
  receipts: { read: number; total: number } | null;
}

export interface AnnouncementReceiptsDto {
  read: { person: PersonDto; readAt: string }[];
  unread: PersonDto[];
}

export const FEEDBACK_KINDS = ['idea', 'problem', 'praise'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const feedbackSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS, { message: 'Choose what kind of feedback' }),
  message: z.string().trim().min(1, 'Write your feedback').max(4000),
  page: z.string().trim().max(300).optional(),
});
export type FeedbackInput = z.infer<typeof feedbackSchema>;

// ---- Sprint 8: CRM core -------------------------------------------------------------

export const CRM_ENTITIES = ['company', 'contact', 'lead'] as const;
export type CrmEntity = (typeof CRM_ENTITIES)[number];

/** Where leads come from, Pakistani freelancing and agency channels first. */
export const LEAD_SOURCES = ['upwork', 'fiverr', 'linkedin', 'whatsapp', 'referral', 'website', 'facebook', 'instagram', 'cold_call', 'event', 'other'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  upwork: 'Upwork',
  fiverr: 'Fiverr',
  linkedin: 'LinkedIn',
  whatsapp: 'WhatsApp',
  referral: 'Referral',
  website: 'Website',
  facebook: 'Facebook',
  instagram: 'Instagram',
  cold_call: 'Cold call',
  event: 'Event',
  other: 'Other',
};

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'unqualified', 'converted'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const CUSTOM_FIELD_TYPES = ['text', 'number', 'date', 'select', 'checkbox', 'url'] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];
export type CustomValue = string | number | boolean | null;
export type CustomValues = Record<string, CustomValue>;

export const IMPORT_MODES = ['skip', 'update', 'create'] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];
export interface ImportProblem {
  /** 1-based, counting the header as row 1 (as a spreadsheet shows it). */
  row: number;
  message: string;
}
export const MAX_IMPORT_ROWS = 5000;

/** Optional text: blank becomes null. */
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .nullish()
  .transform((v) => v || null)
  .pipe(z.string().email('Enter a valid email address').nullable());
const optionalPhone = optional(40).pipe(
  z
    .string()
    .regex(/^\+?[\d\s().-]{7,}$/, 'Enter a phone number, e.g. 0300 1234567 or +92 300 1234567')
    .nullable(),
);
const customValues = z.record(z.string(), z.union([z.string().max(1000), z.number(), z.boolean(), z.null()])).default({});

export const companySchema = z.object({
  name: name('a company name', 150),
  website: optional(200),
  email: optionalEmail,
  phone: optionalPhone,
  industry: optional(80),
  city: optional(80),
  country: optional(80),
  address: optional(300),
  notes: optional(5000),
  ownerId: uuid.nullish(),
  custom: customValues,
});
export type CompanyInput = z.infer<typeof companySchema>;

export const contactSchema = z.object({
  firstName: name('a first name', 100),
  lastName: optional(100),
  email: optionalEmail,
  phone: optionalPhone,
  title: optional(100),
  companyId: uuid.nullish(),
  notes: optional(5000),
  ownerId: uuid.nullish(),
  custom: customValues,
});
export type ContactInput = z.infer<typeof contactSchema>;

export const leadSchema = z.object({
  name: name('a name', 150),
  companyName: optional(150),
  email: optionalEmail,
  phone: optionalPhone,
  source: z.enum(LEAD_SOURCES).default('other'),
  sourceDetail: optional(300),
  status: z.enum(LEAD_STATUSES).exclude(['converted']).default('new'),
  value: z.number().min(0).max(999_999_999_999).nullish(),
  currency: z.enum(CURRENCIES).optional(),
  notes: optional(5000),
  ownerId: uuid.nullish(),
  custom: customValues,
});
export type LeadInput = z.infer<typeof leadSchema>;
/** For edits: like leadSchema but every field optional and without defaults (a default would overwrite the saved value). */
export const updateLeadSchema = leadSchema
  .extend({
    source: z.enum(LEAD_SOURCES),
    status: z.enum(LEAD_STATUSES).exclude(['converted']),
    custom: z.record(z.string(), z.union([z.string().max(1000), z.number(), z.boolean(), z.null()])),
  })
  .partial();
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

export const convertLeadSchema = z
  .object({
    /** new: create a company from the lead's company name; existing: link companyId; none: no company. */
    company: z.enum(['new', 'existing', 'none']),
    companyId: uuid.optional(),
    /** Also open a deal in the default pipeline, with the lead's value. */
    createDeal: z.boolean().default(false),
  })
  .refine((c) => c.company !== 'existing' || !!c.companyId, { message: 'Choose the company', path: ['companyId'] });
export type ConvertLeadInput = z.infer<typeof convertLeadSchema>;

export const customFieldSchema = z
  .object({
    entity: z.enum(CRM_ENTITIES),
    label: name('a field name', 60),
    type: z.enum(CUSTOM_FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  })
  .refine((f) => f.type !== 'select' || f.options.length > 0, { message: 'Add at least one option', path: ['options'] });
export type CustomFieldInput = z.infer<typeof customFieldSchema>;
export const updateCustomFieldSchema = z.object({
  label: name('a field name', 60).optional(),
  options: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  position: z.number().int().min(0).max(1000).optional(),
});

export interface CustomFieldDto {
  id: string;
  entity: CrmEntity;
  key: string;
  label: string;
  type: CustomFieldType;
  options: string[];
  position: number;
}

export interface CrmCompanyDto {
  id: string;
  name: string;
  website: string | null;
  email: string | null;
  phone: string | null;
  industry: string | null;
  city: string | null;
  country: string | null;
  address: string | null;
  notes: string | null;
  owner: PersonDto | null;
  custom: CustomValues;
  contactCount: number;
  projectCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContactDto {
  id: string;
  firstName: string;
  lastName: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  company: CompanyDto | null;
  notes: string | null;
  owner: PersonDto | null;
  leadId: string | null;
  custom: CustomValues;
  createdAt: string;
  updatedAt: string;
}

export interface LeadDto {
  id: string;
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  source: LeadSource;
  sourceDetail: string | null;
  status: LeadStatus;
  value: number | null;
  currency: string;
  notes: string | null;
  owner: PersonDto | null;
  custom: CustomValues;
  convertedContactId: string | null;
  convertedCompanyId: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface CompanyPageDto {
  company: CrmCompanyDto;
  contacts: ContactDto[];
  projects: { id: string; name: string; status: ProjectStatus }[];
}

/** An existing record that looks like the same person or company. */
export interface DuplicateDto {
  entity: CrmEntity;
  id: string;
  label: string;
  reason: 'email' | 'phone' | 'website' | 'name';
}

export interface ImportPreviewDto {
  headers: string[];
  /** The first few rows, to check the mapping against. */
  sample: string[][];
  total: number;
  /** Column → field, guessed from the headers. */
  suggested: Record<string, string>;
  /** Fields a column can go into: standard ones, then custom ones as "custom.<key>". */
  targets: { key: string; label: string }[];
}

export interface ImportReportDto {
  id: string;
  entity: CrmEntity;
  fileName: string;
  mode: ImportMode;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  problems: ImportProblem[];
  createdAt: string;
}

// ---- Sprint 9: pipelines, deals, activities, Client 360 --------------------------------

export const STAGE_KINDS = ['open', 'won', 'lost'] as const;
export type StageKind = (typeof STAGE_KINDS)[number];
export type DealStatus = StageKind;

export const ACTIVITY_KINDS = ['call', 'meeting', 'email', 'whatsapp', 'note', 'task'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export const ACTIVITY_LABELS: Record<ActivityKind, string> = { call: 'Call', meeting: 'Meeting', email: 'Email', whatsapp: 'WhatsApp', note: 'Note', task: 'To-do' };

const stageInput = z.object({
  id: uuid.optional(),
  name: name('a stage name', 60),
  probability: z.number().int().min(0).max(100),
});
/** A pipeline's open stages, in order; its Won and Lost stages are added automatically. */
export const pipelineSchema = z.object({
  name: name('a pipeline name', 80),
  stages: z.array(stageInput).min(1, 'Add at least one stage').max(15),
});
export type PipelineInput = z.infer<typeof pipelineSchema>;

const optionalDate = calendarDate.nullish();
export const dealSchema = z.object({
  title: name('a deal name', 150),
  /** Defaults to the workspace's default pipeline and its first stage. */
  pipelineId: uuid.optional(),
  stageId: uuid.optional(),
  value: z.number().min(0).max(999_999_999_999).nullish(),
  currency: z.enum(CURRENCIES).optional(),
  companyId: uuid.nullish(),
  contactId: uuid.nullish(),
  ownerId: uuid.nullish(),
  expectedClose: optionalDate,
  notes: z.string().trim().max(5000).nullish(),
});
export type DealInput = z.infer<typeof dealSchema>;
export const updateDealSchema = dealSchema.omit({ pipelineId: true, stageId: true }).partial();
export type UpdateDealInput = z.infer<typeof updateDealSchema>;

export const moveDealSchema = z.object({
  stageId: uuid,
  /** Place in the stage's column, from the top; the end when left out. */
  index: z.number().int().min(0).optional(),
  lostReason: z.string().trim().max(300).optional(),
});
export type MoveDealInput = z.infer<typeof moveDealSchema>;
export const winDealSchema = z.object({
  /** Also start the work: a project for the deal's company, from a template. */
  project: z.object({ name: name('a project name'), templateId: z.string().max(80).optional() }).optional(),
});
export type WinDealInput = z.infer<typeof winDealSchema>;

export const activitySchema = z
  .object({
    kind: z.enum(ACTIVITY_KINDS),
    subject: name('a subject', 200),
    body: z.string().trim().max(5000).nullish(),
    /** A follow-up: its owner is reminded at this time. */
    dueAt: z.iso.datetime({ offset: true }).nullish(),
    done: z.boolean().default(false),
    dealId: uuid.nullish(),
    companyId: uuid.nullish(),
    contactId: uuid.nullish(),
    leadId: uuid.nullish(),
    ownerId: uuid.nullish(),
  })
  .refine((a) => a.dealId || a.companyId || a.contactId || a.leadId, { message: 'Link it to a deal, company, contact or lead', path: ['dealId'] });
export type ActivityInput = z.infer<typeof activitySchema>;
export const updateActivitySchema = z
  .object({
    kind: z.enum(ACTIVITY_KINDS),
    subject: name('a subject', 200),
    body: z.string().trim().max(5000).nullable(),
    dueAt: z.iso.datetime({ offset: true }).nullable(),
    done: z.boolean(),
    ownerId: uuid.nullable(),
  })
  .partial();
export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;

export interface StageDto {
  id: string;
  name: string;
  probability: number;
  kind: StageKind;
  position: number;
}

export interface PipelineDto {
  id: string;
  name: string;
  isDefault: boolean;
  stages: StageDto[];
}

export interface DealDto {
  id: string;
  title: string;
  pipelineId: string;
  stageId: string;
  stageName: string;
  probability: number;
  value: number | null;
  currency: string;
  company: CompanyDto | null;
  contact: { id: string; name: string } | null;
  owner: PersonDto | null;
  expectedClose: string | null;
  status: DealStatus;
  wonAt: string | null;
  lostAt: string | null;
  lostReason: string | null;
  projectId: string | null;
  position: number;
  notes: string | null;
  /** The next open follow-up on it, if any. */
  nextActivity: { id: string; subject: string; dueAt: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrmActivityDto {
  id: string;
  kind: ActivityKind;
  subject: string;
  body: string | null;
  dueAt: string | null;
  doneAt: string | null;
  overdue: boolean;
  owner: PersonDto | null;
  createdBy: PersonDto | null;
  deal: { id: string; title: string } | null;
  company: CompanyDto | null;
  contact: { id: string; name: string } | null;
  lead: { id: string; name: string } | null;
  createdAt: string;
}

/** Money by currency: deals in different currencies are never added together. */
export interface MoneyDto {
  currency: string;
  value: number;
}

/** Everything about one client on one page. */
export interface ClientOverviewDto extends Omit<CompanyPageDto, 'projects'> {
  deals: DealDto[];
  projects: { id: string; name: string; status: ProjectStatus; budgetHours: number | null; hours: number; billableHours: number }[];
  totals: {
    won: MoneyDto[];
    open: MoneyDto[];
    /** Open value times each stage's probability. */
    weighted: MoneyDto[];
    hoursThisMonth: number;
    hoursTotal: number;
  };
  activities: CrmActivityDto[];
  files: { id: string; fileName: string; sizeBytes: number; url: string; isImage: boolean; projectId: string; projectName: string; createdAt: string }[];
}

// ---- Sprint 10: reports and the owner dashboard -------------------------------------

/** YYYY-MM. */
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

export const costSettingsSchema = z.object({
  monthlyHours: z.number().int().min(1).max(744),
  /** 1 unit of the currency = this many of the workspace currency. */
  fxRates: z.partialRecord(z.enum(CURRENCIES), z.number().positive().max(1_000_000)),
});
export type CostSettingsInput = z.infer<typeof costSettingsSchema>;
export const memberCostSchema = z.object({ monthlyCost: z.number().min(0).max(1_000_000_000).nullable() });
export const projectRateSchema = z.object({ hourlyRate: z.number().min(0).max(10_000_000).nullable(), currency: z.enum(CURRENCIES).nullable() });

export interface CostSettingsDto {
  currency: string;
  monthlyHours: number;
  fxRates: Record<string, number>;
  people: { person: PersonDto; role: Role; monthlyCost: number | null; hourlyCost: number | null }[];
  projects: { id: string; name: string; client: CompanyDto | null; hourlyRate: number | null; rateCurrency: string | null }[];
}

export interface ProfitRow {
  revenue: number;
  cost: number;
  profit: number;
  /** profit ÷ revenue, as a percentage; null without revenue. */
  margin: number | null;
  hours: number;
  billableHours: number;
}

export interface ProfitabilityDto {
  /** Everything is in this currency. */
  currency: string;
  months: string[];
  clients: (ProfitRow & { client: CompanyDto | null; byMonth: (ProfitRow & { month: string })[] })[];
  total: ProfitRow & { byMonth: (ProfitRow & { month: string })[] };
  /** Currencies with deals or rates but no exchange rate: left out of revenue. */
  missingRates: string[];
  /** People who logged time but have no cost set: their hours cost nothing here. */
  peopleWithoutCost: PersonDto[];
}

export interface UtilisationRow {
  hours: number;
  billableHours: number;
  /** Working hours in the period (working days, less holidays and approved leave, × 8). */
  capacityHours: number;
  /** Billable ÷ capacity, as a percentage. */
  utilisation: number | null;
}

export interface UtilisationDto {
  from: string;
  to: string;
  people: (UtilisationRow & { person: PersonDto; team: { id: string; name: string } | null })[];
  teams: (UtilisationRow & { team: { id: string; name: string } | null; people: number })[];
  total: UtilisationRow;
}

export interface SalesReportDto {
  from: string;
  to: string;
  currency: string;
  /** Open deals now, by currency, and their weighted forecast. */
  open: MoneyDto[];
  weighted: MoneyDto[];
  /** Deals closed in the period. */
  won: { count: number; value: MoneyDto[] };
  lost: { count: number };
  /** Won ÷ (won + lost), as a percentage; null when none closed. */
  winRate: number | null;
  avgDaysToWin: number | null;
  stages: { stage: string; probability: number; count: number; value: MoneyDto[] }[];
  sources: { source: LeadSource | 'direct'; leads: number; converted: number; won: number; wonValue: MoneyDto[] }[];
  people: { person: PersonDto; activities: number; calls: number; meetings: number; won: number; wonValue: MoneyDto[]; open: number }[];
  lostReasons: { reason: string; count: number }[];
}

export interface DashboardDto {
  /** Only for managers and above. */
  team: {
    attendance: Record<Presence, number>;
    activeProjects: number;
    overdueTasks: number;
    openPipeline: MoneyDto[];
    hoursThisWeekByClient: { client: CompanyDto | null; hours: number }[];
    followUpsOverdue: number;
  } | null;
  me: {
    tasksDueToday: number;
    tasksOverdue: number;
    followUpsDue: number;
    hoursThisWeek: number;
    myOverdue: { id: string; title: string; projectId: string; projectName: string; dueDate: string }[];
  };
}

// ---- Sprint 11: plans, billing, onboarding ---------------------------------------------

export const PLANS = ['free', 'starter', 'business'] as const;
export type PlanKey = (typeof PLANS)[number];
export type PaidPlan = Exclude<PlanKey, 'free'>;

/** Features beyond the core modules, on Business (and during the trial). */
export const PLAN_FEATURES = ['profitability', 'custom_fields', 'pipelines'] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

/** Prices are per person (not guests) per month, in PKR. Change them here. */
export const PLAN_INFO: Record<PlanKey, { name: string; pricePerUser: number; maxUsers: number | null; features: PlanFeature[]; blurb: string }> = {
  free: { name: 'Free', pricePerUser: 0, maxUsers: 10, features: [], blurb: 'Everything you need to run a small team, for up to 10 people.' },
  starter: { name: 'Starter', pricePerUser: 699, maxUsers: null, features: [], blurb: 'No limit on people. Attendance, projects, CRM, chat and reports.' },
  business: { name: 'Business', pricePerUser: 1299, maxUsers: null, features: ['profitability', 'custom_fields', 'pipelines'], blurb: 'Adds client profitability, custom fields and more sales pipelines.' },
};
export const TRIAL_DAYS = 14;
/** An annual plan costs this many months: two months free. */
export const ANNUAL_MONTHS_CHARGED = 10;

export const BILLING_CYCLES = ['monthly', 'annual'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const PROVINCES = ['punjab', 'sindh', 'kp', 'balochistan', 'islamabad', 'gb', 'ajk', 'outside'] as const;
export type Province = (typeof PROVINCES)[number];
export const PROVINCE_LABELS: Record<Province, string> = {
  punjab: 'Punjab',
  sindh: 'Sindh',
  kp: 'Khyber Pakhtunkhwa',
  balochistan: 'Balochistan',
  islamabad: 'Islamabad Capital Territory',
  gb: 'Gilgit-Baltistan',
  ajk: 'Azad Jammu and Kashmir',
  outside: 'Outside Pakistan',
};

export const billingDetailsSchema = z.object({
  billingName: name('the name to bill', 150),
  billingEmail: email,
  ntn: z
    .string()
    .trim()
    .max(20)
    .regex(/^(\d{7}-?\d|\d{13})?$/, 'Enter an NTN like 1234567-8 or a 13-digit CNIC')
    .nullish()
    .transform((v) => v || null),
  province: z.enum(PROVINCES, { message: 'Choose a province' }),
  address: z.string().trim().max(300).nullish().transform((v) => v || null),
});
export type BillingDetailsInput = z.infer<typeof billingDetailsSchema>;

export const checkoutSchema = z.object({
  plan: z.enum(['starter', 'business']),
  cycle: z.enum(BILLING_CYCLES),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const bankTransferSchema = z.object({ reference: z.string().trim().min(3, 'Enter the transaction reference').max(100) });
export const reviewTransferSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(500).optional() });

export type SubscriptionStatus = 'trial' | 'active' | 'grace' | 'free';

export interface SubscriptionDto {
  /** The plan in force right now (the trial counts as Business). */
  plan: PlanKey;
  status: SubscriptionStatus;
  /** The plan paid for, if any, and until when. */
  paidPlan: PaidPlan | null;
  billingCycle: BillingCycle;
  paidUntil: string | null;
  trialEndsAt: string | null;
  seatsUsed: number;
  seatLimit: number | null;
  features: PlanFeature[];
  /** False while billing isn't switched on (the free beta): everything is open. */
  enforced: boolean;
  details: { billingName: string | null; billingEmail: string | null; ntn: string | null; province: Province | null; address: string | null };
  /** How customers can pay right now. */
  payments: { online: boolean; onlineLabel: string | null; bankTransfer: { bank: string; accountTitle: string; iban: string } | null };
}

export type InvoiceStatus = 'open' | 'pending_review' | 'paid' | 'void';

export interface InvoiceDto {
  id: string;
  number: string;
  status: InvoiceStatus;
  plan: PaidPlan;
  billingCycle: BillingCycle;
  seats: number;
  unitPrice: number;
  months: number;
  subtotal: number;
  taxLabel: string | null;
  taxRate: number;
  taxAmount: number;
  total: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  billTo: { name: string; email: string; ntn: string | null; province: Province; address: string | null; workspace: string };
  seller: { name: string; ntn: string | null; address: string | null; email: string };
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  paymentMethod: 'card' | 'wallet' | 'bank_transfer' | 'test' | null;
  transferReference: string | null;
  transferSubmittedAt: string | null;
  reviewNote: string | null;
}

/** A bank transfer waiting for WorkHub's review (platform admins only). */
export interface TransferReviewDto extends InvoiceDto {
  workspaceId: string;
  workspaceName: string;
  proofUrl: string | null;
}

export const INDUSTRIES = ['software_house', 'agency', 'bpo', 'consultancy', 'other'] as const;
export type Industry = (typeof INDUSTRIES)[number];
export const INDUSTRY_LABELS: Record<Industry, string> = {
  software_house: 'Software house',
  agency: 'Digital or marketing agency',
  bpo: 'BPO or call centre',
  consultancy: 'Consultancy or professional services',
  other: 'Something else',
};

export const onboardingSchema = z.object({
  industry: z.enum(INDUSTRIES),
  timezone: z.string().trim().min(1).max(64),
  currency: z.enum(CURRENCIES),
  workingDays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  /** A first shift, e.g. 09:00–18:00 (or a night shift for BPOs); none to skip. */
  shift: z.object({ name: name('a shift name', 60), startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).nullable(),
  teams: z.array(name('a team name', 80)).max(12),
  loadHolidays: z.boolean(),
  sampleProject: z.boolean(),
});
export type OnboardingInput = z.infer<typeof onboardingSchema>;

export interface OnboardingDto {
  done: boolean;
  industry: Industry | null;
  /** What the wizard suggests for each industry. */
  presets: Record<Industry, { teams: string[]; shift: { name: string; startTime: string; endTime: string }; workingDays: number[]; template: string | null; stages: { name: string; probability: number }[] }>;
}

export interface OnboardingResultDto {
  teams: number;
  holidays: number;
  projectId: string | null;
}
