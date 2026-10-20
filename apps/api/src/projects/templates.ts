import type { TemplateDto } from '@workhub/shared';
import type { TemplateStructure } from '../db/schema';

interface Builtin {
  key: string;
  name: string;
  description: string;
  structure: TemplateStructure;
}

const STANDARD = ['To do', 'In progress', 'Review', 'Done'];

/** Ready-made starting points for the kinds of work our first customers do. */
export const BUILTIN_TEMPLATES: Builtin[] = [
  {
    key: 'website',
    name: 'Website build',
    description: 'Discovery to launch for a client website.',
    structure: {
      columns: ['Backlog', 'Design', 'Development', 'Client review', 'Done'],
      labels: [
        { name: 'Design', color: 'violet' },
        { name: 'Frontend', color: 'blue' },
        { name: 'Content', color: 'amber' },
        { name: 'Client', color: 'pink' },
      ],
      tasks: [
        { title: 'Kick-off call and requirements', column: 0, checklist: ['Goals and audience', 'Pages and features', 'Brand assets received'] },
        { title: 'Sitemap and wireframes', column: 0, estimateHours: 6 },
        { title: 'Homepage design', column: 0, estimateHours: 8 },
        { title: 'Inner page designs', column: 0, estimateHours: 10 },
        { title: 'Build pages and CMS', column: 0, estimateHours: 24 },
        { title: 'Content entry and SEO basics', column: 0, checklist: ['Page titles and descriptions', 'Image alt text', 'Sitemap submitted'] },
        { title: 'Cross-browser and mobile testing', column: 0, estimateHours: 4 },
        { title: 'Launch and handover', column: 0, checklist: ['DNS and SSL', 'Analytics', 'Backups', 'Client training'] },
      ],
    },
  },
  {
    key: 'seo',
    name: 'SEO retainer (monthly)',
    description: 'A repeatable month of technical, content and link work.',
    structure: {
      columns: ['This month', 'In progress', 'Waiting on client', 'Done'],
      labels: [
        { name: 'Technical', color: 'blue' },
        { name: 'Content', color: 'amber' },
        { name: 'Links', color: 'green' },
      ],
      tasks: [
        { title: 'Technical audit and fixes', column: 0, estimateHours: 4 },
        { title: 'Keyword research update', column: 0, estimateHours: 3 },
        { title: 'Write 4 blog posts', column: 0, estimateHours: 12 },
        { title: 'Outreach: 10 link prospects', column: 0, estimateHours: 6 },
        { title: 'Monthly report to client', column: 0, checklist: ['Rankings', 'Traffic', 'Work done', 'Next month plan'] },
      ],
    },
  },
  {
    key: 'mobile-app',
    name: 'Mobile app',
    description: 'Sprint-style board for a client mobile app.',
    structure: {
      columns: ['Backlog', 'Sprint', 'In progress', 'QA', 'Done'],
      labels: [
        { name: 'iOS', color: 'gray' },
        { name: 'Android', color: 'green' },
        { name: 'API', color: 'blue' },
        { name: 'Bug', color: 'red' },
      ],
      tasks: [
        { title: 'User flows and screen list', column: 0, estimateHours: 6 },
        { title: 'UI design', column: 0, estimateHours: 20 },
        { title: 'Authentication', column: 0, estimateHours: 12 },
        { title: 'Core screens', column: 0, estimateHours: 40 },
        { title: 'Push notifications', column: 0, estimateHours: 8 },
        { title: 'Store listings and release', column: 0, checklist: ['Screenshots', 'Privacy policy', 'App Store review', 'Play Store review'] },
      ],
    },
  },
  {
    key: 'marketing',
    name: 'Marketing campaign',
    description: 'Plan, create and run a campaign.',
    structure: {
      columns: ['Ideas', 'Planned', 'Creating', 'Live', 'Done'],
      labels: [
        { name: 'Social', color: 'pink' },
        { name: 'Ads', color: 'amber' },
        { name: 'Email', color: 'teal' },
      ],
      tasks: [
        { title: 'Campaign brief and goals', column: 1 },
        { title: 'Creative and copy', column: 1, estimateHours: 10 },
        { title: 'Ad set-up and budget', column: 1, estimateHours: 3 },
        { title: 'Launch', column: 1 },
        { title: 'Results report', column: 1, estimateHours: 2 },
      ],
    },
  },
];

export const BLANK: TemplateStructure = { columns: STANDARD, labels: [], tasks: [] };

export function builtinDtos(): TemplateDto[] {
  return BUILTIN_TEMPLATES.map((t) => ({
    id: `builtin:${t.key}`,
    name: t.name,
    description: t.description,
    builtin: true,
    columns: t.structure.columns,
    taskCount: t.structure.tasks.length,
  }));
}

export function findBuiltin(id: string): TemplateStructure | undefined {
  return BUILTIN_TEMPLATES.find((t) => `builtin:${t.key}` === id)?.structure;
}
