import type { Role } from '@workhub/shared';
import type { MessageKey } from '@/lib/messages/en';

export interface NavItem {
  href: string;
  /** The label in the person's language. */
  labelKey: MessageKey;
  /** In English, also matched in Ctrl+K search. */
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
  { href: '/app', labelKey: 'nav.home', label: 'Home', keywords: 'dashboard start' },
  { href: '/app/my-work', labelKey: 'nav.myWork', label: 'My work', keywords: 'my tasks assigned due today overdue' },
  { href: '/app/inbox', labelKey: 'nav.inbox', label: 'Inbox', badge: 'inbox', keywords: 'chat messages dm direct channels threads mentions' },
  { href: '/app/announcements', labelKey: 'nav.announcements', label: 'Announcements', minRole: 'member', badge: 'announcements', keywords: 'notice news hr read receipts' },
  { href: '/app/crm', labelKey: 'nav.crm', label: 'CRM', minRole: 'member', keywords: 'leads contacts companies clients customers sales import upwork fiverr whatsapp' },
  { href: '/app/projects', labelKey: 'nav.projects', label: 'Projects', keywords: 'boards kanban tasks clients' },
  { href: '/app/attendance', labelKey: 'nav.attendance', label: 'Attendance', minRole: 'member', keywords: 'check in check out clock in selfie shift break late absent correction export payroll' },
  { href: '/app/leave', labelKey: 'nav.leave', label: 'Leave', minRole: 'member', keywords: 'leave holiday vacation sick casual annual time off approvals eid' },
  { href: '/app/timesheets', labelKey: 'nav.timesheets', label: 'Timesheets', minRole: 'member', keywords: 'timesheet timer hours week submit approve' },
  { href: '/app/reports', labelKey: 'nav.reports', label: 'Reports', minRole: 'manager', keywords: 'profitability profit margin utilisation billable sales pipeline win rate dashboard costs salaries' },
  { href: '/app/teams', labelKey: 'nav.teams', label: 'Teams', keywords: 'departments groups' },
  { href: '/app/people', labelKey: 'nav.people', label: 'People', keywords: 'members invite users roles' },
  { href: '/app/settings', labelKey: 'nav.settings', label: 'Settings', minRole: 'admin', keywords: 'workspace timezone currency working days plan billing invoice upgrade subscription' },
  { href: '/app/audit-log', labelKey: 'nav.auditLog', label: 'Audit log', minRole: 'admin', keywords: 'history activity security export' },
  { href: '/app/account', labelKey: 'nav.account', label: 'Account', keywords: 'profile security two-factor 2fa authenticator recovery codes' },
];

/** Modules still to come, shown greyed out. */
export const SOON: NavItem[] = [];
