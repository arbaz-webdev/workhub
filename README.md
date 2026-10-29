# WorkHub (working name)

An all-in-one workspace for SMBs with remote/hybrid teams: CRM, project boards, time & attendance, internal messaging, and (Phase 2) consent-based remote monitoring. It launches in Pakistan first and is built to international standards.

## Planning documents

- [ROADMAP.md](ROADMAP.md): phases, sprint dates and links to each sprint's GitHub milestone and issues

- [PRD & Business Plan](https://claude.ai/code/artifact/da5b6a43-dec7-4ac0-b28d-990ddd03ef96): market, competitors, personas, requirements, architecture, pricing, go-to-market, roadmap, risks
- [Market Research & Execution Plan](https://claude.ai/code/artifact/687ffd0d-0968-4c4b-9e0a-2b3280cba090): competitor matrix, review pain points, Pakistan specifics, revised MVP, validation without interviews, sprint-by-sprint build plan (current plan of record)
- [Customer Interview Script & Design-Partner Pitch](https://claude.ai/code/artifact/e08e2570-d57a-4362-85b0-29bf75f5e812): optional, if interviews become possible later

## Running it locally

Requirements: Node.js 22+ (developed on 24). Docker is **not** needed: a real PostgreSQL 17 runs from npm.

```bash
npm install
cp apps/api/.env.example apps/api/.env
npm run db:start        # terminal 1: PostgreSQL on localhost:5433 (data in .data/pg)
npm run db:migrate      # once, and after every new migration
npm run dev             # terminal 2: API on :4000, web app on http://localhost:3000
```

To put it online for others (staging), see [docs/STAGING.md](docs/STAGING.md).

Checks (the same ones CI runs):

```bash
npm run lint
npm run typecheck
npm test                # needs the database running; uses its own workhub_test database
```

## Project layout

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js 16 web app. Calls the API through its own `/api/*` proxy, so the session cookie stays first-party. |
| `apps/api` | NestJS 11 API (modular monolith). Drizzle ORM on PostgreSQL. |
| `apps/api/migrations` | Plain SQL migrations, applied in order by `scripts/migrate.mjs`. |
| `apps/api/test` | Integration tests against a real database, including tenant-isolation tests. |
| `packages/shared` | Validation schemas (zod) and types shared by web and API. |
| `scripts/dev-db.mjs` | Starts the local embedded PostgreSQL. |
| `.github/workflows/ci.yml` | Lint, build, type-check, tests and dependency audit on every push and PR. |

## How tenant isolation works

Every company is a **workspace**. Workspace-owned tables carry `workspace_id` and have PostgreSQL **Row-Level Security forced on**.

- The API connects as `workhub_app`, a role that owns no tables and cannot bypass RLS. Only migrations use the admin connection.
- Each request runs inside `DbService.withContext({ workspaceId, userId }, …)`, which sets `app.workspace_id` / `app.user_id` for that transaction only.
- A query that forgets its `WHERE workspace_id = …` still only sees the current workspace; with no context set, tenant tables return nothing.
- `WorkspaceGuard` checks the `x-workspace-id` header against the user's membership and role on every workspace route.
- `test/rls.spec.ts` proves this at the database level and `test/isolation.spec.ts` through the API. **Every new tenant table needs an RLS policy and a test.**

Auth: Argon2id password hashes, opaque session tokens (only a SHA-256 hash is stored) in an HttpOnly SameSite=Lax cookie, rate-limited sign-in, an Origin check on state-changing requests, and Helmet security headers.

Local demo accounts (dev database only, password `local-dev-test-1234`): `demo.owner@example.test`, and `demo.member@example.test` (a member of the owner's workspace, for trying chat between two people).

## Email and Google sign-in

Both work locally with no accounts:

- **Email** defaults to `EMAIL_TRANSPORT=console`: emails (verification, password reset, waitlist welcome) are printed to the API log, so you can click the links there. Production refuses to start with the console transport.
- **Google sign-in** stays hidden until it's configured.

To switch them on (see `apps/api/.env.example`):

1. **Resend** (recommended email provider): create an account at resend.com, verify your sending domain (SPF and DKIM DNS records), create an API key, then set `EMAIL_TRANSPORT=resend`, `RESEND_API_KEY` and `EMAIL_FROM` (an address on the verified domain).
2. **Google**: in Google Cloud Console → APIs & Services → Credentials, create an OAuth client ID of type *Web application* with the authorised redirect URI `http://localhost:3000/api/auth/google/callback` (plus your production URL later). Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

Security notes: verification and reset links are single-use, stored only as SHA-256 hashes, and expire (24 hours / 30 minutes). A password reset signs the user out everywhere. Google sign-in uses PKCE and a state cookie. If a Google user's email matches an existing account that never verified its email, that account's password and sessions are removed before linking, to block account pre-hijacking.

## Sprint 1 status

- [x] Monorepo (npm workspaces + Turborepo), web + API + shared package
- [x] PostgreSQL schema with Row-Level Security and a restricted app role
- [x] Sign-up (creates user, workspace, owner membership), sign-in, sign-out, sessions
- [x] Workspace scoping, roles, audit log, first tenant feature (teams)
- [x] CI workflow; 55 integration tests incl. tenant isolation
- [x] Email verification and password reset
- [x] Google sign-in (needs your Google OAuth client to switch on)
- [x] Landing page with beta waitlist
- [ ] Resend account and verified sending domain (needs you; see above)

## Sprint 2 status

- [x] Invite by email (one or many, CSV upload) or shareable join link; preview, accept, cancel
- [x] Members list, role changes and removal (owner and admins protected)
- [x] Workspace settings: name, time zone, currency, working days
- [x] App shell: sidebar, top bar, workspace switcher, mobile menu
- [x] In-app notifications (bell, unread count, mark read); refreshed every minute until WebSockets arrive
- [x] Command search (Ctrl K / ⌘K) over pages, people, teams, workspaces and actions
- [x] Audit log viewer with filters, paging and CSV export (formula-safe)
- [x] 93 integration tests, incl. database-level isolation for invitations and notifications
- [ ] Notification preferences (per-user on/off by type)
- [ ] Staging environment with automatic deploys (needs a hosting account)

## Sprint 3 status

- [x] Clients (minimal; the CRM extends them) and projects linked to a client, with an hours budget
- [x] Kanban boards: default columns, add/rename/reorder/delete columns, work-in-progress limits
- [x] Tasks: description, assignees, priority, due date, estimate, labels, checklist, subtasks, activity history
- [x] Drag and drop with mouse, touch (press and hold) and keyboard (Space, arrows, Space), with readable screen-reader announcements
- [x] Live board updates via Server-Sent Events, verified at ~150 ms end to end through the web proxy
- [x] Comments with @mentions; mentioned people and assignees are notified with a link that opens the task
- [x] Guests see only projects they're added to; they can comment but not edit
- [x] 113 integration tests, incl. ordering under repeated squeezing, isolation, permissions, and a live-update test

Live updates use **Server-Sent Events** rather than WebSockets: boards only need server→browser pushes, SSE works through ordinary HTTP proxies, and the browser reconnects automatically (the board reloads after a reconnect so nothing is missed). The event bus is in-memory, so running more than one API instance will need Redis pub/sub.

## Sprint 4 status

- [x] List view next to the board, with filters (search, column, assignee, label, priority, due date, completed)
- [x] Bulk edit for up to 200 selected tasks: move, assign/unassign, priority, due date, label, complete/reopen, delete
- [x] My Work: your open assigned tasks across projects, grouped by Overdue, Today, Next 7 days, Later, No date (in the workspace's time zone)
- [x] File attachments up to 25 MB on tasks (button or drag and drop), image previews, Urdu/Arabic file names
- [x] Time logging on tasks; cards and projects show logged vs estimated hours, red when over
- [x] Budget alerts to managers and admins at 80% and 100% of a project's hours budget (once each; re-armed when the budget changes)
- [x] Project templates: four built-in (website, SEO retainer, mobile app, marketing campaign) and "Save as template" for your own process
- [x] 127 integration tests, incl. a check that every tenant table has Row-Level Security forced

Files are stored on local disk in development (`.data/uploads`) and in any S3-compatible bucket (Cloudflare R2 recommended) in production. To use a bucket, set `STORAGE_DRIVER=s3` and the `S3_*` variables (see `apps/api/.env.example`). Downloads go through the API, which checks access and then redirects to a five-minute signed URL. Only common image types are shown inline. Everything else downloads as a file, so an uploaded HTML page can never run inside the app.

**Local databases created before Sprint 4** may use the Windows code page (WIN1252), which can't store Urdu or Arabic text. Migrations now refuse to run on such a database. To fix it once, start the database and run `npm run db:fix-encoding`. It rebuilds both databases as UTF-8, keeps your data, and leaves the old copy as `workhub_old` until you drop it.

## Sprint 5 status

- [x] Check in and out with one tap on phone or web, with a selfie (kept 30 days, visible to the person and their managers), time, IP and device
- [x] Shifts, including night shifts across midnight: 18:00–03:00 counts as one workday dated by its start; grace period; full and half-day hours; working days
- [x] Per-team and per-person shifts (a person's own shift, else their team's, else the default)
- [x] Breaks per shift, paid or unpaid, with presets for Zuhr, Asr and a longer Jumu'ah break on Fridays; going over is flagged
- [x] Office sites by GPS radius and/or office IP ranges: check-ins elsewhere are **flagged, not blocked**; remote people are exempt
- [x] Daily status: present, late, half day, absent, day off, plus "on leave" and "holiday" ready for Sprint 6. Short days and leaving early are only judged once the shift has ended
- [x] Offline queue: check-ins made without a connection are kept on the device with the time they were tapped and sync automatically, exactly once
- [x] Team view for managers (who's in, late, on break, flagged) and a monthly history for everyone
- [x] 176 tests, including unit tests for time zones (incl. daylight saving), night shifts, breaks and statuses

How it decides things:
- **Which workday:** a check-in belongs to the shift it falls in, opening 6 hours early. Without a shift, it's the local date in the workspace's time zone.
- **Rules history:** a day keeps a copy of the shift rules it started under, so editing or deleting a shift never rewrites past days.
- **What counts as absent:** a day with no check-in counts only from when the person joined and the workspace started using attendance.
- **Offline sync:** events synced more than 2 minutes late keep the device's time and are marked "Synced later". Events older than 3 days are refused; a manager will correct them in Sprint 6.
- **Selfie retention:** an hourly job deletes selfies after 30 days. The check-in record stays.

Offline check-in works while the attendance page is open (or on its next load). Opening the app with no connection at all needs the installable app from Sprint 11. Behind a load balancer, set Express's `trust proxy` to match so office-IP rules see the real client address.

## Sprint 6 status

- [x] Leave types, balances and approvals:
  - Annual (14 days, earned monthly), Casual (10), Sick (8) and Unpaid by default, all editable.
  - Requests count working days only and can be half days.
  - A manager approves; both sides are notified; there's a team leave calendar and manual balance adjustments.
- [x] Pakistan's public holidays: fixed dates for any year, plus Eid ul-Fitr, Eid ul-Adha, Ashura and Eid Milad-un-Nabi loaded as *estimated* for 2026–2028, editable once announced. Company holidays too.
- [x] Leave and holidays in attendance: those days show as on leave or holiday, never absent. A half day off halves the hours owed.
- [x] Attendance corrections:
  - Ask for corrected times and a manager approves, or a manager corrects someone's day directly.
  - The replaced events are kept (voided, not deleted) and copied into the audit log.
- [x] Task timer and weekly timesheets:
  - One running timer per person, shown in the top bar.
  - Back-dated manual entries need a reason.
  - Weeks are submitted, approved or sent back; approved weeks are locked.
- [x] Monthly attendance export for payroll: .xlsx with Summary and Daily sheets (including payable days), or CSV.
- [x] 212 tests, including unit tests for leave arithmetic, entitlement and the holiday list

How it decides things:
- **Leave days:** a request takes the person's working days (their shift's, or the workspace's) minus holidays.
- **Earned leave:** yearly types give all their days at once and monthly ones a twelfth each month, prorated from when someone joined.
- **Who approves:** managers approve others' requests; only the owner can approve their own.
- **Payable days:** days in the period, minus absences, half the half days, and unpaid leave.

Two dependencies are pinned for security: `multer` (2.5.0, via an npm override) and `body-parser` (2.4.0). Both fix high-severity advisories published this month.

## Sprint 7 status

- [x] Inbox:
  - Public channels (everyone except guests is in #general), private channels, and direct messages with one person or a group of up to 8.
  - Live delivery over Server-Sent Events, tested at under half a second. The connection comes back by itself after a deploy or a dropped network.
  - Unread and @mention counts in the sidebar. Channels can be muted.
- [x] Threads and @mentions: replies sit under a message, and both a mention and a reply to your message notify you.
- [x] Files in chat: up to 5 per message, 25 MB each, stored like task attachments and downloadable only by people who can read the conversation.
- [x] Presence from attendance: checked in, on a break, checked out, on leave or not checked in, updated live as people punch.
- [x] Task cards: type `#` to pick a task, or paste a task link, and the message shows its current column, priority, due date and assignees. People who can't see the task don't get the card.
- [x] Announcements: managers post to everyone or one team, can pin them, and see who has read each one.
- [x] Feedback button in the top bar: an idea, a problem or praise, saved and emailed to `FEEDBACK_TO`.
- [x] Product analytics: PostHog events for key actions, off until `POSTHOG_KEY` is set.
- [x] 231 tests

How it decides things:
- **Privacy of conversations:** the database itself limits private channels and DMs to their members (RLS), so admins and owners can't read DMs they aren't in. Admins can delete messages in channels, never in DMs.
- **Guests:** they only see the conversations they're added to, can't browse channels or start DMs, and get no presence or announcements.
- **Unread:** counts new top-level messages since you last read the conversation. Thread replies don't count, but replies to your messages notify you.
- **Analytics:** sent from the server only, with hashed ids and no names, emails or message text. No cookies, so no consent banner is needed. Only the feature used is recorded (for example "message sent", with whether it had files).

## Sprint 8 status

- [x] Companies and contacts (`/app/crm`):
  - Full records with an owner, and a company page that lists its people and projects.
  - The existing client list became the companies, so projects already linked to a client show up there.
- [x] Duplicate warnings while typing:
  - People and leads match on the same email or phone. Phone numbers are compared however they're written: 0300 1234567, +92 300 1234567 and 923001234567 all match.
  - Companies match on the same website or name. Gmail, Yahoo and other free mailboxes don't count as a company website.
- [x] Leads with local sources: Upwork, Fiverr, LinkedIn, WhatsApp, referral, website, Facebook, Instagram, cold call and event, plus a detail such as the job link or who referred them. Statuses run from new to qualified, and a lead can carry an estimated value in any currency.
- [x] Lead conversion: one step turns a lead into a contact, with a new or existing company. (Deals come in Sprint 9.)
- [x] Custom fields on companies, contacts and leads: text, number, date, choice, yes/no and link, checked on every save.
- [x] CSV import (managers):
  - Columns are matched by name, and each match can be changed.
  - Rows that match an existing record are skipped, updated or added anyway, your choice. Duplicates within the file count too.
  - A report lists every row that was skipped or rejected.
  - Excel's Windows encoding and semicolon-separated files both work.
- [x] 243 tests

## Sprint 9 status

- [x] Pipelines and deals:
  - Every workspace starts with a Sales pipeline (New 10%, Qualified 25%, Proposal sent 50%, Negotiation 75%, then Won and Lost).
  - Managers can add pipelines and rename, reorder, add or remove stages; a stage that still has deals can't be removed.
  - A Kanban board you can drag on (mouse, touch, or keyboard), plus a list view of open, won and lost deals.
  - Totals and a weighted forecast are kept per currency (PKR and USD are never added together).
- [x] Activities and follow-ups:
  - Log calls, meetings, emails, WhatsApp chats and notes on any deal, company, contact or lead, or schedule a follow-up.
  - Its owner gets a notification when it's due, and a Follow-ups tab lists what's overdue, due today and coming up.
- [x] Won deal creates a project: mark it won and, in the same step, start the project for the client from any template (managers).
- [x] Lead conversion can open a deal with the lead's value.
- [x] Client 360: one page per company with money won, the open pipeline and forecast, hours this month and in total, each project's hours against its budget, people, deals, the activity timeline and recent files.
- [x] 251 tests

## Sprint 10 status

- [x] Owner dashboard (the home page):
  - Managers see today's attendance (live), active projects, overdue tasks, the open pipeline, overdue follow-ups and this week's hours by client.
  - Everyone sees their own day: tasks due and overdue, follow-ups due, and hours this week.
- [x] Client profitability (owners and admins), per client and month, in the workspace currency:
  - Revenue is won deals, plus billable hours × rate on hourly projects.
  - Cost is hours × each person's monthly cost ÷ the monthly working hours.
  - It warns about missing exchange rates and people without a cost.
- [x] Team utilisation (managers): billable and total hours against capacity (working days, less holidays and approved leave, × 8 h), per person and team.
- [x] Sales report (managers): open pipeline and forecast, won value, win rate, average days to win, deals by stage, lead sources (from lead to won), lost reasons, and each salesperson's calls, meetings and wins.
- [x] Costs and rates (owners and admins): monthly cost per person, monthly working hours, exchange rates, and hourly rates for time-and-materials projects.
- [x] Every report downloads as CSV that opens in Excel with Urdu names intact and formulas neutralised.
- [x] 257 tests

How it decides things:
- **No double counting:** a deal whose project bills by the hour isn't counted as revenue again; that project's hours are.
- **Currencies:** amounts are converted only with rates you enter. Without a rate, they're left out and the report says so; nothing is guessed.
- **Privacy:** salaries are visible only to owners and admins, never in other API responses, and the audit log records that a cost changed but not the amount.

## Sprint 11 status

- [x] Plans and limits (prices and rules live in `PLAN_INFO` in `packages/shared`):
  - Free is everything for up to 10 people; guests don't count.
  - Starter (PKR 699 per person per month) has no limit on people.
  - Business (PKR 1,299) adds client profitability, custom fields and extra sales pipelines.
  - Yearly billing costs 10 months. New workspaces get a 14-day Business trial.
  - `BILLING_ENFORCED=false` opens everything, for the free beta.
- [x] PKR invoices:
  - Numbered WH-YYYY-000001 across all customers.
  - Billed to the customer's name, NTN or CNIC, and province, with a provincial sales tax line.
  - Printable, or save as PDF from the browser.
  - A receipt email and a notification when paid.
- [x] Online payment through a gateway interface:
  - On staging, a clearly marked test gateway (`PAYMENTS_DRIVER=test`) lets you try the full flow without moving money.
  - **Safepay or PayFast need a merchant account in WorkHub's name before they can be connected.**
- [x] Bank transfer (IBFT) for yearly plans: the customer uploads the receipt and reference, and WorkHub staff (`PLATFORM_ADMINS`) confirm or send it back at `/app/platform`.
- [x] Setup wizard for new workspaces:
  - Choose an industry (software house, agency, BPO, consultancy).
  - Working days and a first shift (BPOs get a night shift).
  - Teams, Pakistan holidays, the sales pipeline's stages and a sample project.
  - Then invite the team.
- [x] Installable app: manifest, icons, "Install app" in the top bar, and a service worker so the installed app opens offline on the attendance page (check-ins queue and sync later).
- [x] 266 tests

Before charging real customers:
- Confirm the sales tax rates (`SALES_TAX_RATES`) with a tax adviser.
- Set `SELLER_NAME`, `SELLER_NTN` and `SELLER_ADDRESS`.
- Add the bank details (`BANK_*`).
- Open a Safepay or PayFast merchant account so its driver can be added.

The app also now waits for the server when it's starting up (after a deploy, or when the free staging plan wakes from sleep) instead of staying on "Loading your workspace…".

## Sprint 12 status

- [x] Two-factor sign-in with an authenticator app (**Account** in the menu):
  - Asked for after the password or Google; ten single-use recovery codes.
  - Secrets encrypted at rest (`TOTP_ENCRYPTION_KEY`, generated by Render); changes are emailed.
  - Owners can require it for the whole workspace (**Settings → Security**); people without it are asked to set it up before they can continue.
- [x] Redis (`REDIS_URL`, optional): rate limits are counted across all API copies, and live chat and board updates reach people connected to any copy. Without it, both stay in memory as before.
- [x] Content Security Policy with a fresh nonce on every page, plus HSTS, `frame-ancestors 'none'` and a tight `Permissions-Policy`.
- [x] Load test: 1,000 concurrent users at p95 15 ms on one API copy (`docs/LOAD-TEST.md`, `scripts/load-test.mjs`).
- [x] Backup-restore drill script and runbook (`docs/BACKUP-DRILL.md`, `scripts/backup-drill.mjs`).
- [x] Security self-review for the penetration testers (`docs/SECURITY-REVIEW.md`).
- [x] 278 tests, plus 2 that run against Redis in CI

Still to do, and yours:
- The penetration test (#71): hire a tester; `docs/SECURITY-REVIEW.md` has the scope.
- Run the backup drill on Neon itself (needs your Neon login).
- Fix the top beta issues (#75) once beta feedback comes in.

## Sprint 13 status

- [x] Founding-customer offer: workspaces created before the paid launch (3 May 2027, `FOUNDING_OFFER_ENDS`) keep 40% off every invoice for life. Existing beta workspaces get it now. It shows on the billing page and as its own line on invoices, with sales tax on the discounted amount.
- [x] Public status page at `/status`: each part (website and API, database, files, live updates) checked every minute, 90 days of uptime, and incidents. WorkHub staff post incidents and updates from `/app/platform`.
- [x] Marketing site: the landing page's pricing now comes from the real plans, and a new `/pricing` page has a price calculator (team size, monthly or yearly, founding price) and a plan comparison. Shared header and footer, `sitemap.xml` and `robots.txt`.
- [x] Help centre at `/help`: 10 articles with search, from setting up a workspace to two-factor sign-in.
- [x] 285 tests, plus 2 that run against Redis in CI

Still to do, and yours:
- The 5 short help videos (#77) need recording.
- Paid launch (#80): open a Safepay or PayFast merchant account (#66), set `BILLING_ENFORCED`, real emails (Resend), the seller and bank details, and have a lawyer write the terms of service and privacy policy.
- An outside uptime monitor for alerts (see `docs/STAGING.md`).

## Phase 2 status

- [x] Quotes and invoices to clients (#89), in **CRM → Quotes & invoices**:
  - Numbered per workspace (Q-0001, INV-0001), any currency, an optional tax line, printable or saved as PDF.
  - Statuses: draft, sent, accepted or declined, paid, void. An accepted quote becomes an invoice in one click.
  - **Bill hours**: a client's approved, billable, not-yet-billed timesheet hours become one line per project, at its hourly rate. Hours are billed once; voiding or deleting the invoice frees them.
  - Managers and up only; isolated per workspace (tested).
- [x] Client portal (#88): contacts at a client (free guests, invited from the client's page) see the projects shared with them (progress, open work by column, what's due), approved hours by month, and the quotes and invoices sent to them. Staff choose what's shared and can preview it.
- [x] Calendar and timeline views (#87): tasks get an optional start date; a project's **Calendar** shows a month by due date (drag to another day), and **Timeline** is a Gantt chart by column (drag a bar to move it, or its ends to change the dates).
- [x] Payroll exports and fingerprint devices (#90), in **Attendance → Payroll and devices**:
  - Export layouts: three built in (full summary, payable days, hours), plus your own (choose, order and rename columns). Employee codes for payroll software.
  - ZKTeco import from attlog.dat or a ZKTime/ZKBio CSV. Device users are matched to people (remembered next time); each workday's first and last punch become check-in and check-out, using the shift rules. Days recorded in the app are kept, and re-importing changes nothing.
- [x] 310 tests, plus 2 that run against Redis in CI
- [ ] Urdu interface (#91): **parked**. Two parts were built and then taken out again; the work is kept in draft PR #121, which explains how to bring it back. The app is English only, left to right. Staging's `users` table still has an unused `locale` column from that work.

- [x] Terms of service (`/terms`) and Privacy policy (`/privacy`), as **drafts** for a lawyer: accurate facts about the product and its data, with "For the lawyer" notes where a legal decision is needed. Both say they're drafts and stay out of search results and the sitemap while `LEGAL_DRAFT` in `apps/web/lib/legal.ts` is true. Linked from the site footer.

## Phase 3 · Going global

- [x] Public API, part 1 (#96): read access with API keys.
  - Owners and admins create keys in **Settings → API** (read only, or read and write). A key is shown once; only its hash is stored (`api_keys`, migration 0020).
  - A key acts as the admin who made it, with their current role, in that workspace only. It stops working if they leave or stop being an admin, or when it's revoked. Business plan only (open while billing is off).
  - `GET /api/v1/…`: `me`, `people`, `attendance?month=` (the payroll export's numbers), `leave-requests`, `time-entries` (with `approved`), `projects`, `tasks`, `companies`, `contacts`, `leads`, `deals`, `invoices` and `invoices/{id}`. Lists are paged with a cursor; CRM and tasks take `updatedSince`.
  - 600 requests a minute per key (`API_RATE_LIMIT_PER_MINUTE`). Key changes are in the audit log.
  - OpenAPI description at `/api/v1/openapi.json`; guide at `/developers`; help article **Connect other software with the API**.
  - Code: `apps/api/src/public-api/`. Tests: `apps/api/test/public-api.spec.ts`, including isolation between workspaces.

Next: the public API, part 2 (writing tasks, leads, contacts and activities), then webhooks (#96). These need accounts or money first: video calls (#86), WhatsApp Business (#84), Gmail/Outlook (#85), app stores (#83), desktop agent code signing (#81, #82).

## Key decisions so far

- Market: Pakistan first, then international (Gulf, then global)
- Customer: SMBs with 10–200 staff and remote/hybrid teams (software houses, agencies, BPOs, consultancies)
- Build: solo founder using AI coding tools
- Monitoring: consent-based, Phase 2 (not in MVP)
- Stack: TypeScript modular monolith (Next.js + NestJS + PostgreSQL with Row-Level Security)
- Hero feature: Client Profitability report; free plan up to 10 users; selfie check-in in MVP
- Validation: landing page + waitlist, then a free public beta (no interviews)
- Timeline: sprint 1 starts 2 Nov 2026 · public beta 8 Feb 2027 · paid launch 3 May 2027
