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

Local demo account (dev database only): `demo.owner@example.test` / `local-dev-test-1234`.

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

## Key decisions so far

- Market: Pakistan first, then international (Gulf, then global)
- Customer: SMBs with 10–200 staff and remote/hybrid teams (software houses, agencies, BPOs, consultancies)
- Build: solo founder using AI coding tools
- Monitoring: consent-based, Phase 2 (not in MVP)
- Stack: TypeScript modular monolith (Next.js + NestJS + PostgreSQL with Row-Level Security)
- Hero feature: Client Profitability report; free plan up to 10 users; selfie check-in in MVP
- Validation: landing page + waitlist, then a free public beta (no interviews)
- Timeline: sprint 1 starts 2 Nov 2026 · public beta 8 Feb 2027 · paid launch 3 May 2027
