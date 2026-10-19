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
