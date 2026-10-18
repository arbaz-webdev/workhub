# WorkHub (working name)

An all-in-one workspace for SMBs with remote/hybrid teams: CRM, project boards, time & attendance, internal messaging, and (Phase 2) consent-based remote monitoring. It launches in Pakistan first and is built to international standards.

## Planning documents

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

## Sprint 1 status

- [x] Monorepo (npm workspaces + Turborepo), web + API + shared package
- [x] PostgreSQL schema with Row-Level Security and a restricted app role
- [x] Sign-up (creates user, workspace, owner membership), sign-in, sign-out, sessions
- [x] Workspace scoping, roles, audit log, first tenant feature (teams)
- [x] 27 integration tests incl. tenant isolation; CI workflow
- [ ] Email verification and password reset (needs an email provider)
- [ ] Google sign-in
- [ ] Landing page + waitlist

## Key decisions so far

- Market: Pakistan first, then international (Gulf, then global)
- Customer: SMBs with 10–200 staff and remote/hybrid teams (software houses, agencies, BPOs, consultancies)
- Build: solo founder using AI coding tools
- Monitoring: consent-based, Phase 2 (not in MVP)
- Stack: TypeScript modular monolith (Next.js + NestJS + PostgreSQL with Row-Level Security)
- Hero feature: Client Profitability report; free plan up to 10 users; selfie check-in in MVP
- Validation: landing page + waitlist, then a free public beta (no interviews)
- Timeline: sprint 1 starts 2 Nov 2026 · public beta 8 Feb 2027 · paid launch 3 May 2027
