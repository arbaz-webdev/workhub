import { API_RATE_LIMIT_PER_MINUTE } from '@workhub/shared';
import type { Metadata } from 'next';
import { ArticleBody } from '@/components/help/article-body';
import { SiteFooter, SiteHeader } from '@/components/landing/site';
import { siteUrl } from '@/lib/site-url';

export const metadata: Metadata = {
  title: 'API documentation · WorkHub',
  description: "Read a WorkHub workspace's people, attendance, leave, time, projects, CRM and invoices from your own software.",
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
- \`GET /v1/invoices\` and \`GET /v1/invoices/{id}\`: invoices to your clients, with their lines.

Every field is described in the [OpenAPI description](/api/v1/openapi.json). Import it into Postman, Insomnia or a code generator.

## Limits and errors

- Each key can make **${API_RATE_LIMIT_PER_MINUTE} requests a minute**. Past that you get \`429\`; wait a minute and try again.
- \`401\`: the key is missing, wrong, or was revoked.
- \`403\`: the person who made the key is no longer an admin, or the workspace's plan doesn't include the API.
- \`400\`: a parameter is missing or not valid. The \`message\` says which.

## Keep keys safe

- Treat a key like a password. Keep it on your server, never in a web page, an app people download, or a shared spreadsheet.
- Give each system its own key, so you can revoke one without breaking the others.
- If a key might have leaked, revoke it in **Settings → API** and make a new one. It stops working at once.

> Coming next: changing data through the API (adding tasks, leads and contacts), and webhooks that tell your system the moment something happens.`;

  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-bold tracking-tight">WorkHub API</h1>
        <p className="mt-2 text-lg text-gray-600">Read your workspace&apos;s data from your own software: payroll, accounting, dashboards or anything else.</p>
        <article className="mt-8 min-w-0">
          <ArticleBody body={body} />
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
