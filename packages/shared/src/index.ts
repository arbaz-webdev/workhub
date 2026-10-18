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
  workspaceName: z.string().trim().min(2, 'Enter your company name').max(80),
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
