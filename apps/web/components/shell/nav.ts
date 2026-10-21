import type { Role } from '@workhub/shared';

export interface NavItem {
  href: string;
  label: string;
  /** Minimum role to see the item. */
  minRole?: Role;
  /** Shown greyed out with a "Soon" badge until its sprint ships. */
  soon?: boolean;
  /** Words that also match it in Ctrl+K search. */
  keywords?: string;
}

export const NAV: NavItem[] = [
  { href: '/app', label: 'Home', keywords: 'dashboard start' },
  { href: '/app/my-work', label: 'My work', keywords: 'my tasks assigned due today overdue' },
  { href: '/app/projects', label: 'Projects', keywords: 'boards kanban tasks clients' },
  { href: '/app/attendance', label: 'Attendance', minRole: 'member', keywords: 'check in check out clock in selfie shift break late absent' },
  { href: '/app/teams', label: 'Teams', keywords: 'departments groups' },
  { href: '/app/people', label: 'People', keywords: 'members invite users roles' },
  { href: '/app/settings', label: 'Settings', minRole: 'admin', keywords: 'workspace timezone currency working days' },
  { href: '/app/audit-log', label: 'Audit log', minRole: 'admin', keywords: 'history activity security export' },
];

export const SOON: NavItem[] = [
  { href: '#', label: 'CRM', soon: true },
  { href: '#', label: 'Inbox', soon: true },
];
