import type { Role } from '@workhub/shared';
import {
  ChartPie,
  CircleUserRound,
  Clock,
  FolderKanban,
  Handshake,
  House,
  Inbox,
  ListChecks,
  type LucideIcon,
  Megaphone,
  ScrollText,
  Settings,
  Timer,
  TreePalm,
  Users,
  UsersRound,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon?: LucideIcon;
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
  { href: '/app', label: 'Home', icon: House, keywords: 'dashboard start' },
  { href: '/app/my-work', label: 'My work', icon: ListChecks, keywords: 'my tasks assigned due today overdue' },
  { href: '/app/inbox', label: 'Inbox', icon: Inbox, badge: 'inbox', keywords: 'chat messages dm direct channels threads mentions' },
  { href: '/app/announcements', label: 'Announcements', icon: Megaphone, minRole: 'member', badge: 'announcements', keywords: 'notice news hr read receipts' },
  { href: '/app/crm', label: 'CRM', icon: Handshake, minRole: 'member', keywords: 'leads contacts companies clients customers sales import upwork fiverr whatsapp' },
  { href: '/app/projects', label: 'Projects', icon: FolderKanban, keywords: 'boards kanban tasks clients' },
  { href: '/app/attendance', label: 'Attendance', icon: Clock, minRole: 'member', keywords: 'check in check out clock in selfie shift break late absent correction export payroll' },
  { href: '/app/leave', label: 'Leave', icon: TreePalm, minRole: 'member', keywords: 'leave holiday vacation sick casual annual time off approvals eid' },
  { href: '/app/timesheets', label: 'Timesheets', icon: Timer, minRole: 'member', keywords: 'timesheet timer hours week submit approve' },
  { href: '/app/reports', label: 'Reports', icon: ChartPie, minRole: 'manager', keywords: 'profitability profit margin utilisation billable sales pipeline win rate dashboard costs salaries' },
  { href: '/app/teams', label: 'Teams', icon: UsersRound, keywords: 'departments groups' },
  { href: '/app/people', label: 'People', icon: Users, keywords: 'members invite users roles' },
  { href: '/app/settings', label: 'Settings', icon: Settings, minRole: 'admin', keywords: 'workspace timezone currency working days plan billing invoice upgrade subscription' },
  { href: '/app/audit-log', label: 'Audit log', icon: ScrollText, minRole: 'admin', keywords: 'history activity security export' },
  { href: '/app/account', label: 'Account', icon: CircleUserRound, keywords: 'profile security two-factor 2fa authenticator recovery codes' },
];

/** Modules still to come, shown greyed out. */
export const SOON: NavItem[] = [];
