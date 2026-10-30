import { Controller, Get } from '@nestjs/common';
import {
  ACTIVITY_KINDS,
  API_RATE_LIMIT_PER_MINUTE,
  CLIENT_INVOICE_STATUSES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  PRIORITIES,
  PROJECT_STATUSES,
  REQUEST_STATUSES,
  ROLES,
  STAGE_KINDS,
  WEBHOOK_EVENT_LABELS,
  WEBHOOK_EVENTS,
} from '@workhub/shared';
import { Public } from '../common/request';
import { config } from '../config';
import { MAX_PAGE } from './paging';

// The public API described as OpenAPI 3.1, for Postman, Zapier and code generators.
// Keep it in step with v1.controller.ts.

type Schema = Record<string, unknown>;

const str = (description?: string, extra: Schema = {}): Schema => ({ type: 'string', ...(description ? { description } : {}), ...extra });
const nullable = (s: Schema): Schema => ({ ...s, type: [s.type, 'null'] });
const id = str(undefined, { format: 'uuid' });
const dateTime = str(undefined, { format: 'date-time' });
const day = str(undefined, { format: 'date' });
const num = { type: 'number' };
const int = { type: 'integer' };
const bool = { type: 'boolean' };
const oneOf = (values: readonly string[]) => str(undefined, { enum: [...values] });
const obj = (properties: Record<string, Schema>): Schema => ({ type: 'object', properties, required: Object.keys(properties) });
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const custom = { type: 'object', description: 'Custom field values, by field key.', additionalProperties: true };

const schemas: Record<string, Schema> = {
  Me: obj({
    workspace: obj({ id, name: str(), timezone: str('IANA time zone, e.g. Asia/Karachi') }),
    actingAs: obj({ id, name: str(), email: str(), role: oneOf(ROLES) }),
  }),
  Person: obj({
    id,
    name: str(),
    email: str(),
    role: oneOf(ROLES),
    employeeCode: nullable(str()),
    team: nullable(str()),
    clientCompanyId: nullable(str('For a client contact (a guest): their company.', { format: 'uuid' })),
    joinedAt: dateTime,
  }),
  AttendanceDay: obj({
    userId: id,
    name: str(),
    employeeCode: nullable(str()),
    date: day,
    status: str('present, late, half_day, absent, on_leave, holiday, weekend or not_started'),
    flags: { type: 'array', items: str() },
    checkInAt: nullable(dateTime),
    checkOutAt: nullable(dateTime),
    workedMinutes: int,
    breakMinutes: int,
    lateMinutes: int,
    shiftName: nullable(str()),
    holidayName: nullable(str()),
    leave: nullable({ type: 'object', properties: { typeName: str(), fraction: num, paid: bool } }),
  }),
  LeaveRequest: obj({
    id,
    userId: id,
    userName: str(),
    leaveType: obj({ id, name: str(), paid: bool }),
    startDate: day,
    endDate: day,
    halfDay: oneOf(['none', 'first', 'second']),
    days: num,
    reason: nullable(str()),
    status: oneOf(REQUEST_STATUSES),
    decidedBy: nullable(id),
    decidedAt: nullable(dateTime),
    decisionNote: nullable(str()),
    createdAt: dateTime,
  }),
  TimeEntry: obj({
    id,
    userId: id,
    projectId: id,
    taskId: nullable(id),
    date: day,
    minutes: int,
    note: nullable(str()),
    billable: bool,
    source: oneOf(['manual', 'timer']),
    approved: { type: 'boolean', description: "True when the person's timesheet for that week was approved." },
    invoiceId: nullable(str('The client invoice these hours were billed on.', { format: 'uuid' })),
    createdAt: dateTime,
  }),
  Project: obj({
    id,
    name: str(),
    description: nullable(str()),
    status: oneOf(PROJECT_STATUSES),
    clientId: nullable(id),
    budgetHours: nullable(num),
    hourlyRate: nullable(num),
    rateCurrency: nullable(str()),
    createdAt: dateTime,
    updatedAt: dateTime,
  }),
  Task: obj({
    id,
    projectId: id,
    parentTaskId: nullable(id),
    column: str('The board column it is in, e.g. "In progress".'),
    title: str(),
    description: nullable(str()),
    priority: oneOf(['none', 'low', 'medium', 'high', 'urgent']),
    startDate: nullable(day),
    dueDate: nullable(day),
    estimateHours: nullable(num),
    assigneeIds: { type: 'array', items: id },
    completed: bool,
    completedAt: nullable(dateTime),
    createdAt: dateTime,
    updatedAt: dateTime,
  }),
  Company: obj({
    id,
    name: str(),
    website: nullable(str()),
    email: nullable(str()),
    phone: nullable(str()),
    industry: nullable(str()),
    city: nullable(str()),
    country: nullable(str()),
    address: nullable(str()),
    notes: nullable(str()),
    ownerId: nullable(id),
    custom,
    createdAt: dateTime,
    updatedAt: dateTime,
  }),
  Contact: obj({
    id,
    companyId: nullable(id),
    firstName: str(),
    lastName: nullable(str()),
    email: nullable(str()),
    phone: nullable(str()),
    title: nullable(str()),
    notes: nullable(str()),
    ownerId: nullable(id),
    leadId: nullable(id),
    custom,
    createdAt: dateTime,
    updatedAt: dateTime,
  }),
  Lead: obj({
    id,
    name: str(),
    companyName: nullable(str()),
    email: nullable(str()),
    phone: nullable(str()),
    source: str(),
    sourceDetail: nullable(str()),
    status: oneOf(LEAD_STATUSES),
    value: nullable(num),
    currency: str(),
    notes: nullable(str()),
    ownerId: nullable(id),
    custom,
    convertedContactId: nullable(id),
    convertedCompanyId: nullable(id),
    convertedAt: nullable(dateTime),
    createdAt: dateTime,
    updatedAt: dateTime,
  }),
  Deal: obj({
    id,
    title: str(),
    value: nullable(num),
    currency: str(),
    pipeline: obj({ id, name: str() }),
    stage: obj({ id, name: str() }),
    status: oneOf(STAGE_KINDS),
    companyId: nullable(id),
    contactId: nullable(id),
    leadId: nullable(id),
    ownerId: nullable(id),
    projectId: nullable(id),
    expectedClose: nullable(day),
    wonAt: nullable(dateTime),
    lostAt: nullable(dateTime),
    lostReason: nullable(str()),
    notes: nullable(str()),
    createdAt: dateTime,
    updatedAt: dateTime,
  }),
  Invoice: obj({
    id,
    number: str(),
    companyId: id,
    status: oneOf(CLIENT_INVOICE_STATUSES),
    currency: str(),
    issueDate: day,
    dueDate: nullable(day),
    subtotal: num,
    taxLabel: nullable(str()),
    taxRate: num,
    taxAmount: num,
    total: num,
    sentAt: nullable(dateTime),
    paidAt: nullable(dateTime),
    createdAt: dateTime,
  }),
  InvoiceLine: obj({ description: str(), quantity: num, unitPrice: num, amount: num, projectId: nullable(id) }),
  Activity: obj({
    id,
    kind: oneOf(ACTIVITY_KINDS),
    subject: str(),
    body: nullable(str()),
    dueAt: nullable(dateTime),
    done: bool,
    doneAt: nullable(dateTime),
    ownerId: nullable(id),
    dealId: nullable(id),
    companyId: nullable(id),
    contactId: nullable(id),
    leadId: nullable(id),
    createdBy: nullable(id),
    createdAt: dateTime,
    updatedAt: dateTime,
  }),
  // What the write endpoints accept. Fields left out stay as they are.
  TaskFields: {
    type: 'object',
    properties: {
      description: nullable(str()),
      priority: oneOf(PRIORITIES),
      startDate: nullable(day),
      dueDate: nullable(day),
      estimateHours: nullable(num),
      assigneeIds: { type: 'array', items: id, description: 'Replaces the assignees. Each must be able to see the project.' },
      completed: bool,
    },
  },
  NewTask: {
    allOf: [
      { type: 'object', required: ['projectId', 'title'], properties: { projectId: id, title: str(), columnId: { ...id, description: 'Defaults to the first column.' }, parentTaskId: { ...id, description: 'Makes it a subtask.' } } },
      ref('TaskFields'),
    ],
  },
  TaskChanges: { allOf: [{ type: 'object', properties: { title: str(), columnId: { ...id, description: 'Moves it to the bottom of this column.' } } }, ref('TaskFields')] },
  LeadFields: {
    type: 'object',
    properties: {
      name: str(),
      companyName: nullable(str()),
      email: nullable(str()),
      phone: nullable(str()),
      source: oneOf(LEAD_SOURCES),
      sourceDetail: nullable(str()),
      status: oneOf(LEAD_STATUSES.filter((s) => s !== 'converted')),
      value: nullable(num),
      currency: str(),
      notes: nullable(str()),
      ownerId: nullable(id),
      custom,
    },
  },
  ContactFields: {
    type: 'object',
    properties: {
      firstName: str(),
      lastName: nullable(str()),
      email: nullable(str()),
      phone: nullable(str()),
      title: nullable(str()),
      companyId: nullable(id),
      notes: nullable(str()),
      ownerId: nullable(id),
      custom,
    },
  },
  NewActivity: {
    type: 'object',
    required: ['kind', 'subject'],
    description: 'Link it to at least one of a deal, company, contact or lead. With dueAt it is a follow-up and its owner is reminded; without, it is logged as done.',
    properties: {
      kind: oneOf(ACTIVITY_KINDS),
      subject: str(),
      body: nullable(str()),
      dueAt: nullable(dateTime),
      done: bool,
      dealId: nullable(id),
      companyId: nullable(id),
      contactId: nullable(id),
      leadId: nullable(id),
      ownerId: nullable(id),
    },
  },
  Error: { type: 'object', properties: { statusCode: int, message: str() } },
};
schemas.InvoiceWithLines = { allOf: [ref('Invoice'), obj({ lines: { type: 'array', items: ref('InvoiceLine') } })] };

const q = (name: string, schema: Schema, description: string, required = false) => ({ name, in: 'query', required, description, schema });
const paging = [
  q('limit', { type: 'integer', minimum: 1, maximum: MAX_PAGE, default: 50 }, 'How many to return.'),
  q('cursor', str(), 'From the previous page\'s "nextCursor".'),
];
const since = q('updatedSince', dateTime, 'Only records created or changed at or after this time, to sync changes.');

const errors = {
  '400': { description: 'A parameter is missing or not valid.', content: { 'application/json': { schema: ref('Error') } } },
  '401': { description: 'No API key, or the key is not valid or was revoked.', content: { 'application/json': { schema: ref('Error') } } },
  '403': {
    description: 'The key is read-only, its creator is no longer an admin, or the workspace plan does not include the API.',
    content: { 'application/json': { schema: ref('Error') } },
  },
  '429': { description: `More than the key's limit of requests a minute.`, content: { 'application/json': { schema: ref('Error') } } },
};

const json = (schema: Schema) => ({ description: 'OK', content: { 'application/json': { schema } } });
const pageOf = (name: string) => json(obj({ data: { type: 'array', items: ref(name) }, nextCursor: nullable(str('Null on the last page.')) }));

function list(summary: string, item: string, parameters: unknown[]) {
  return { get: { summary, parameters: [...parameters, ...paging], responses: { '200': pageOf(item), ...errors } } };
}

const notFound = { '404': { description: 'Not found in this workspace.', content: { 'application/json': { schema: ref('Error') } } } };
const body = (name: string, required: string[] = []) => ({
  required: true,
  content: { 'application/json': { schema: required.length ? { allOf: [ref(name), { type: 'object', required }] } : ref(name) } },
});
/** POST needs a "read and write" key. */
const create = (summary: string, input: string, output: string, required: string[] = []) => ({
  summary: `${summary} (read and write keys)`,
  requestBody: body(input, required),
  responses: { '201': { ...json(ref(output)), description: 'Created' }, ...errors, ...notFound },
});
const change = (summary: string, input: string, output: string) => ({
  summary: `${summary} (read and write keys)`,
  parameters: [{ name: 'id', in: 'path', required: true, schema: id }],
  requestBody: body(input),
  responses: { '200': json(ref(output)), ...errors, ...notFound },
});

schemas.AttendancePunch = obj({
  id,
  userId: id,
  name: nullable(str()),
  employeeCode: nullable(str()),
  date: { ...day, description: 'The workday it counts towards (a night shift can start the day before).' },
  at: dateTime,
  offline: { type: 'boolean', description: 'Recorded without a connection and sent later.' },
  inZone: nullable({ type: 'boolean', description: 'Inside an office zone, when the workspace uses them.' }),
  flags: { type: 'array', items: str() },
});

/** What each webhook event's "data" holds. */
const WEBHOOK_DATA: Record<string, string> = {
  'attendance.checked_in': 'AttendancePunch',
  'attendance.checked_out': 'AttendancePunch',
  'leave.requested': 'LeaveRequest',
  'leave.approved': 'LeaveRequest',
  'leave.rejected': 'LeaveRequest',
  'task.created': 'Task',
  'task.completed': 'Task',
  'lead.created': 'Lead',
  'deal.won': 'Deal',
  'deal.lost': 'Deal',
  'invoice.paid': 'Invoice',
};

function webhookDocs() {
  const delivery = (event: string, data: Schema) => ({
    post: {
      summary: event === 'ping' ? 'Sent by "Send a test" in Settings → API' : WEBHOOK_EVENT_LABELS[event as keyof typeof WEBHOOK_EVENT_LABELS],
      description:
        'Signed: the WorkHub-Signature header is "t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the signing secret>". WorkHub-Event and WorkHub-Delivery name the event and the delivery.',
      requestBody: {
        content: {
          'application/json': {
            schema: obj({ id: { ...id, description: 'The delivery; the same as WorkHub-Delivery.' }, event: str(undefined, { const: event }), createdAt: dateTime, workspaceId: id, data }),
          },
        },
      },
      responses: { '200': { description: 'Any 2xx within 10 seconds means it arrived. Anything else is retried for about a day.' } },
    },
  });
  return {
    ...Object.fromEntries(WEBHOOK_EVENTS.map((e) => [e, delivery(e, ref(WEBHOOK_DATA[e]!))])),
    ping: delivery('ping', obj({ message: str() })),
  };
}

export function openApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'WorkHub API',
      version: '1',
      description:
        `Read and change a WorkHub workspace's data from your own software. Create a key in Settings → API and send it as "Authorization: Bearer whk_…". ` +
        `Read-only keys can only GET; "read and write" keys can also create and change tasks, leads, contacts and activities, under the same rules as the app. ` +
        `A key acts as the admin who created it and stops working if they leave or stop being an admin. Each key can make ${API_RATE_LIMIT_PER_MINUTE} requests a minute. ` +
        `Lists are returned oldest first, a page at a time: pass "nextCursor" back as "cursor" until it is null.`,
    },
    servers: [{ url: `${config.appUrl}/api` }],
    security: [{ apiKey: [] }],
    components: { securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', description: 'An API key from Settings → API.' } }, schemas },
    webhooks: webhookDocs(),
    paths: {
      '/v1/me': { get: { summary: 'The workspace and person a key acts as', responses: { '200': json(ref('Me')), ...errors } } },
      '/v1/people': list('People in the workspace', 'Person', []),
      '/v1/attendance': {
        get: {
          summary: 'Attendance for a month: one row per person per day, as in the payroll export',
          parameters: [q('month', str(undefined, { pattern: '^\\d{4}-\\d{2}$', example: '2027-01' }), 'The month.', true)],
          responses: { '200': json(obj({ month: str(), from: day, to: day, data: { type: 'array', items: ref('AttendanceDay') } })), ...errors },
        },
      },
      '/v1/leave-requests': list('Leave requests', 'LeaveRequest', [
        q('status', oneOf(REQUEST_STATUSES), 'Only this status.'),
        q('from', day, 'Requests that end on or after this date.'),
        q('to', day, 'Requests that start on or before this date.'),
      ]),
      '/v1/time-entries': list('Time logged on projects', 'TimeEntry', [
        q('from', day, 'First work date.', true),
        q('to', day, 'Last work date, at most 366 days after "from".', true),
        q('projectId', id, 'Only this project.'),
        q('userId', id, "Only this person's time."),
        q('approved', oneOf(['true', 'false']), 'Only time whose week was (or was not) approved.'),
      ]),
      '/v1/projects': list('Projects', 'Project', [q('status', oneOf(PROJECT_STATUSES), 'Only this status.')]),
      '/v1/tasks': {
        ...list('Tasks, including subtasks', 'Task', [
          q('projectId', id, 'Only this project.'),
          q('completed', oneOf(['true', 'false']), 'Only completed (or open) tasks.'),
          since,
        ]),
        post: create('Create a task or subtask', 'NewTask', 'Task'),
      },
      '/v1/tasks/{id}': { patch: change('Change a task, or move it to another column', 'TaskChanges', 'Task') },
      '/v1/companies': list('CRM companies (clients)', 'Company', [since]),
      '/v1/contacts': { ...list('CRM contacts', 'Contact', [since]), post: create('Create a contact', 'ContactFields', 'Contact', ['firstName']) },
      '/v1/contacts/{id}': { patch: change('Change a contact', 'ContactFields', 'Contact') },
      '/v1/leads': {
        ...list('CRM leads', 'Lead', [q('status', oneOf(LEAD_STATUSES), 'Only this status.'), since]),
        post: create('Create a lead', 'LeadFields', 'Lead', ['name']),
      },
      '/v1/leads/{id}': { patch: change('Change a lead', 'LeadFields', 'Lead') },
      '/v1/deals': list('CRM deals', 'Deal', [q('status', oneOf(STAGE_KINDS), 'Only open, won or lost deals.'), since]),
      '/v1/activities': {
        ...list('CRM activities: calls, meetings, notes and follow-ups', 'Activity', [
          q('dealId', id, 'Only on this deal.'),
          q('companyId', id, 'Only on this company.'),
          q('contactId', id, 'Only on this contact.'),
          q('leadId', id, 'Only on this lead.'),
          since,
        ]),
        post: create('Log an activity or add a follow-up', 'NewActivity', 'Activity'),
      },
      '/v1/invoices': list('Invoices to clients', 'Invoice', [q('status', oneOf(CLIENT_INVOICE_STATUSES), 'Only this status.'), q('companyId', id, 'Only this client.')]),
      '/v1/invoices/{id}': {
        get: {
          summary: 'One invoice to a client, with its lines',
          parameters: [{ name: 'id', in: 'path', required: true, schema: id }],
          responses: { '200': json(ref('InvoiceWithLines')), '404': { description: 'No such invoice.' }, ...errors },
        },
      },
    },
  };
}

/** GET /v1/openapi.json, open to anyone: it describes the API, not any workspace's data. */
@Controller('v1')
@Public()
export class OpenApiController {
  @Get('openapi.json')
  document() {
    return openApiDocument();
  }
}
