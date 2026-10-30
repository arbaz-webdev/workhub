import { API_RATE_LIMIT_PER_MINUTE, WEBHOOK_EVENT_LABELS, WEBHOOK_EVENTS } from '@workhub/shared';
import type { Metadata } from 'next';
import { ArticleBody } from '@/components/help/article-body';
import { SiteFooter, SiteHeader } from '@/components/landing/site';
import { siteUrl } from '@/lib/site-url';

export const metadata: Metadata = {
  title: 'API documentation · WorkHub',
  description: "Read a WorkHub workspace's people, attendance, leave, time, projects, CRM and invoices from your own software, and add tasks, leads, contacts and activities.",
};

/** The public API's guide. The full reference is the OpenAPI description it links to. */
export default function DevelopersPage() {
  const base = `${siteUrl()}/api`;
  const body = `## Before you start

1. The API is part of the **Business** plan. While WorkHub is in beta, every workspace has it.
2. An owner or admin creates a key in **Settings → API**. The key is shown once: copy it somewhere safe.
3. A key acts as the person who created it, with their access, in that workspace only. If they leave or stop being an admin, the key stops working, so make keys from an account that will stay.

## Make a request

Send the key in the \`Authorization\` header. This asks which workspace and person the key acts as:

\`\`\`bash
curl ${base}/v1/me \\
  -H "Authorization: Bearer whk_your_key"
\`\`\`

Answers are JSON. Dates look like \`2027-01-31\`, and times are in UTC, like \`2027-01-31T04:05:00.000Z\`.

## Lists come a page at a time

Lists return the oldest first, as \`{ "data": [...], "nextCursor": "..." }\`. To get the next page, send \`nextCursor\` back as \`cursor\`. When \`nextCursor\` is \`null\`, you have everything. Ask for up to 100 at a time with \`limit\`.

\`\`\`bash
curl "${base}/v1/leads?limit=100&cursor=NEXT_CURSOR" \\
  -H "Authorization: Bearer whk_your_key"
\`\`\`

To keep another system in step, ask only for what changed: tasks, companies, contacts, leads and deals take \`updatedSince\`, a time like \`2027-01-31T00:00:00Z\`.

## What you can read

- \`GET /v1/me\`: the workspace and the person the key acts as.
- \`GET /v1/people\`: everyone in the workspace, with role, team and employee code.
- \`GET /v1/attendance?month=2027-01\`: one row per person per day, worked out exactly as the payroll export does (status, check-in and check-out, minutes worked, late, leave and holidays).
- \`GET /v1/leave-requests\`: filter by \`status\`, and by \`from\` and \`to\` dates.
- \`GET /v1/time-entries?from=2027-01-01&to=2027-01-31\`: time logged on projects, up to a year at a time. Each entry says whether its week was \`approved\`; filter with \`approved=true\`, \`projectId\` or \`userId\`.
- \`GET /v1/projects\` and \`GET /v1/tasks\`: filter tasks by \`projectId\` or \`completed\`.
- \`GET /v1/companies\`, \`/v1/contacts\`, \`/v1/leads\` and \`/v1/deals\`: your CRM, including custom fields.
- \`GET /v1/activities\`: calls, meetings, notes and follow-ups. Filter by \`dealId\`, \`companyId\`, \`contactId\` or \`leadId\`.
- \`GET /v1/invoices\` and \`GET /v1/invoices/{id}\`: invoices to your clients, with their lines.

## Change data

A key made with **Read and write** access can also add and change data. Every change follows the same rules as the app: the same checks, the same activity history, and the same notifications. For example, people you assign a task to are told, and the board updates live for anyone looking at it.

- \`POST /v1/tasks\` and \`PATCH /v1/tasks/{id}\`: add a task (or, with \`parentTaskId\`, a subtask), change its details, mark it \`completed\`, or move it with \`columnId\`.
- \`POST /v1/leads\` and \`PATCH /v1/leads/{id}\`: for example, add a lead from your website's contact form.
- \`POST /v1/contacts\` and \`PATCH /v1/contacts/{id}\`.
- \`POST /v1/activities\`: log a call or meeting, or add a follow-up with \`dueAt\`. Link it to a deal, company, contact or lead.

Send JSON. Fields you leave out stay as they are. The answer is the record as it is now, in the same shape the lists use.

\`\`\`bash
curl ${base}/v1/leads \\
  -H "Authorization: Bearer whk_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Zara Khan", "email": "zara@example.com", "source": "website"}'
\`\`\`

Every field is described in the [OpenAPI description](/api/v1/openapi.json). Import it into Postman, Insomnia or a code generator.

## Limits and errors

- Each key can make **${API_RATE_LIMIT_PER_MINUTE} requests a minute**. Past that you get \`429\`; wait a minute and try again.
- \`401\`: the key is missing, wrong, or was revoked.
- \`403\`: the key is read-only and you tried to change something, the person who made the key is no longer an admin, or the workspace's plan doesn't include the API.
- \`404\`: there's no such record in this workspace.
- \`400\`: a parameter or field is missing or not valid. The \`message\` (and, for fields, \`errors\`) says which.

## Keep keys safe

- Treat a key like a password. Keep it on your server, never in a web page, an app people download, or a shared spreadsheet.
- Give each system its own key, so you can revoke one without breaking the others.
- If a key might have leaked, revoke it in **Settings → API** and make a new one. It stops working at once.
- Use **read only** keys unless the software needs to change data.

## Webhooks: hear about changes at once

Instead of asking WorkHub again and again, a webhook tells your system the moment something happens. An owner or admin adds one in **Settings → API**: an \`https://\` address and the events to send. WorkHub then sends a \`POST\` with JSON like this:

\`\`\`json
{
  "id": "4f0c2a9e-…",
  "event": "lead.created",
  "createdAt": "2027-01-31T04:05:00.000Z",
  "workspaceId": "…",
  "data": { "id": "…", "name": "Zara Khan", "status": "new" }
}
\`\`\`

\`data\` is the record in the same shape the lists above return. For check-ins and check-outs it's the person, their employee code, the date, the time, and whether they were inside an office zone.

${WEBHOOK_EVENTS.map((e) => `- \`${e}\`: ${WEBHOOK_EVENT_LABELS[e].toLowerCase()}.`).join('\n')}

**Check that it came from WorkHub.** Adding a webhook shows its signing secret once. Every delivery has a \`WorkHub-Signature\` header like \`t=1801000000,v1=5257a8…\`. Work out the HMAC-SHA256 of the time, a dot and the raw body, with the secret as the key, and compare it with \`v1\`. Turn away anything more than five minutes old. In Node.js:

\`\`\`js
const crypto = require('node:crypto');
function fromWorkHub(rawBody, signatureHeader, secret) {
  const { t, v1 } = Object.fromEntries(signatureHeader.split(',').map((part) => part.split('=')));
  const expected = crypto.createHmac('sha256', secret).update(\`\${t}.\${rawBody}\`).digest('hex');
  const recent = Math.abs(Date.now() / 1000 - Number(t)) < 300;
  return recent && v1?.length === expected.length && crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}
\`\`\`

**Answer quickly.** Reply with any \`2xx\` status within 10 seconds, then do slow work afterwards. Anything else counts as a failure, and WorkHub tries again after 1, 5 and 30 minutes, then 2, 6 and 15 hours. If it still fails after about a day, the webhook is paused and the workspace's owners get an email. Events that happen while it's paused wait, and are sent when someone chooses **Resume**.

- Each delivery has a \`WorkHub-Delivery\` id, also in the body as \`id\`. Very rarely the same one can arrive twice, so ignore an id you've already handled.
- Deliveries may arrive out of order. Use the times in the data.
- WorkHub only sends to public \`https://\` addresses, and never follows redirects.
- **Send a test** in Settings → API sends a \`ping\` event once, and shows you what your system answered.`;

  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-bold tracking-tight">WorkHub API</h1>
        <p className="mt-2 text-lg text-gray-600">Connect your workspace to your own software: payroll, accounting, your website, dashboards or anything else.</p>
        <article className="mt-8 min-w-0">
          <ArticleBody body={body} />
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
