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
