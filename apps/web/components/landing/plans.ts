import type { PlanKey } from '@workhub/shared';

/** What each plan includes, in customers' words. Limits come from PLAN_INFO. */
export const PLAN_HIGHLIGHTS: Record<PlanKey, string[]> = {
  free: ['Up to 10 people (guests are free)', 'Attendance, leave and timesheets', 'Project boards and CRM', 'Team chat and announcements', 'Reports and the owner dashboard'],
  starter: ['Everything in Free', 'No limit on people', 'Monthly, or yearly with 2 months free'],
  business: ['Everything in Starter', 'Client profitability', 'Custom fields on leads, contacts and companies', 'More than one sales pipeline'],
};

/** Rows of the comparison table: true where a plan has it, or the text to show. */
export const COMPARISON: { group: string; rows: { label: string; plans: Record<PlanKey, boolean | string> }[] }[] = [
  {
    group: 'Team',
    rows: [
      { label: 'People', plans: { free: 'Up to 10', starter: 'No limit', business: 'No limit' } },
      { label: 'Guests (clients, freelancers)', plans: { free: 'Free', starter: 'Free', business: 'Free' } },
      { label: 'Roles: owner, admin, manager, member, guest', plans: { free: true, starter: true, business: true } },
      { label: 'Two-factor sign-in, and requiring it', plans: { free: true, starter: true, business: true } },
    ],
  },
  {
    group: 'Attendance and time',
    rows: [
      { label: 'Check-in with selfie, location or office network', plans: { free: true, starter: true, business: true } },
      { label: 'Shifts, including nights past midnight', plans: { free: true, starter: true, business: true } },
      { label: 'Leave, holidays and timesheets', plans: { free: true, starter: true, business: true } },
      { label: 'Works offline; check-ins sync later', plans: { free: true, starter: true, business: true } },
    ],
  },
  {
    group: 'Projects and clients',
    rows: [
      { label: 'Project boards and templates', plans: { free: true, starter: true, business: true } },
      { label: 'Leads, contacts, companies and deals', plans: { free: true, starter: true, business: true } },
      { label: 'Sales pipelines', plans: { free: 'One', starter: 'One', business: 'As many as you need' } },
      { label: 'Custom fields', plans: { free: false, starter: false, business: true } },
    ],
  },
  {
    group: 'Chat and reports',
    rows: [
      { label: 'Channels, direct messages and announcements', plans: { free: true, starter: true, business: true } },
      { label: 'Owner dashboard, utilisation and sales reports', plans: { free: true, starter: true, business: true } },
      { label: 'Client profitability', plans: { free: false, starter: false, business: true } },
    ],
  },
];
