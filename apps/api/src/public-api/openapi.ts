import { Controller, Get } from '@nestjs/common';
import { API_RATE_LIMIT_PER_MINUTE, CLIENT_INVOICE_STATUSES, LEAD_STATUSES, PROJECT_STATUSES, REQUEST_STATUSES, ROLES, STAGE_KINDS } from '@workhub/shared';
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

export function openApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'WorkHub API',
      version: '1',
      description:
        `Read a WorkHub workspace's data from your own software. Create a key in Settings → API and send it as "Authorization: Bearer whk_…". ` +
        `A key acts as the admin who created it and stops working if they leave or stop being an admin. Each key can make ${API_RATE_LIMIT_PER_MINUTE} requests a minute. ` +
        `Lists are returned oldest first, a page at a time: pass "nextCursor" back as "cursor" until it is null.`,
    },
    servers: [{ url: `${config.appUrl}/api` }],
    security: [{ apiKey: [] }],
    components: { securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', description: 'An API key from Settings → API.' } }, schemas },
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
      '/v1/tasks': list('Tasks, including subtasks', 'Task', [
        q('projectId', id, 'Only this project.'),
        q('completed', oneOf(['true', 'false']), 'Only completed (or open) tasks.'),
        since,
      ]),
      '/v1/companies': list('CRM companies (clients)', 'Company', [since]),
      '/v1/contacts': list('CRM contacts', 'Contact', [since]),
      '/v1/leads': list('CRM leads', 'Lead', [q('status', oneOf(LEAD_STATUSES), 'Only this status.'), since]),
      '/v1/deals': list('CRM deals', 'Deal', [q('status', oneOf(STAGE_KINDS), 'Only open, won or lost deals.'), since]),
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
