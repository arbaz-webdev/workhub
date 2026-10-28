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
  /** A live unread count shown beside it. */
  badge?: 'inbox' | 'announcements';
}

export const NAV: NavItem[] = [
  { href: '/app', label: 'Home', keywords: 'dashboard start' },
  { href: '/app/my-work', label: 'My work', keywords: 'my tasks assigned due today overdue' },
  { href: '/app/inbox', label: 'Inbox', badge: 'inbox', keywords: 'chat messages dm direct channels threads mentions' },
  { href: '/app/announcements', label: 'Announcements', minRole: 'member', badge: 'announcements', keywords: 'notice news hr read receipts' },
  { href: '/app/crm', label: 'CRM', minRole: 'member', keywords: 'leads contacts companies clients customers sales import upwork fiverr whatsapp' },
  { href: '/app/projects', label: 'Projects', keywords: 'boards kanban tasks clients' },
  { href: '/app/attendance', label: 'Attendance', minRole: 'member', keywords: 'check in check out clock in selfie shift break late absent correction export payroll' },
  { href: '/app/leave', label: 'Leave', minRole: 'member', keywords: 'leave holiday vacation sick casual annual time off approvals eid' },
  { href: '/app/timesheets', label: 'Timesheets', minRole: 'member', keywords: 'timesheet timer hours week submit approve' },
  { href: '/app/reports', label: 'Reports', minRole: 'manager', keywords: 'profitability profit margin utilisation billable sales pipeline win rate dashboard costs salaries' },
  { href: '/app/teams', label: 'Teams', keywords: 'departments groups' },
  { href: '/app/people', label: 'People', keywords: 'members invite users roles' },
  { href: '/app/settings', label: 'Settings', minRole: 'admin', keywords: 'workspace timezone currency working days' },
  { href: '/app/audit-log', label: 'Audit log', minRole: 'admin', keywords: 'history activity security export' },
];

/** Modules still to come, shown greyed out. */
export const SOON: NavItem[] = [];
