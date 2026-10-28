# Security self-review

Our own pass before the external penetration test (issue #71). It lists what's in place,
where to find it, and what's still open, so the testers can spend their time on what we
can't check ourselves. Updated for Sprint 12 (29 October 2026).

## In place

### Keeping companies apart
- Every tenant table has Row-Level Security, **forced**, so even the table owner's queries
  are filtered. The API connects as `workhub_app`, which can't turn it off
  (`apps/api/migrations`, `apps/api/scripts/migrate.mjs`).
- Each request's workspace and user are set inside its own transaction
  (`DbService.withContext`), so a pooled connection can't carry them to another request.
- Jobs that span workspaces (selfie clean-up, reminders, bank transfers) use narrow
  `security definer` functions that return ids only, then do the work inside each workspace.
- Tests: `test/isolation.spec.ts`, `test/rls.spec.ts`, plus cross-workspace checks in each sprint's tests.

### Signing in
- Passwords hashed with Argon2 (`@node-rs/argon2`).
- Session tokens are random and stored hashed; the cookie is `HttpOnly`, `SameSite=Lax`,
  `Secure` in production, 30 days (`apps/api/src/auth/session.ts`).
- Resetting a password signs out every session; turning on two-factor sign-in signs out the others.
- **Two-factor sign-in (TOTP)** with ten single-use recovery codes. Secrets encrypted at rest
  (AES-256-GCM, `TOTP_ENCRYPTION_KEY`), codes can't be replayed, and changes are emailed.
  Owners can require it for the whole workspace, enforced by the API, not just the screen.
- Rate limits on sign-in, sign-up, password reset, email resends, token links, two-factor
  codes (per sign-in attempt, per address and per person), invitations, waitlist and new
  workspaces. Shared across API copies when `REDIS_URL` is set; keys are hashed there.

### Requests from browsers
- Cross-site requests: `SameSite=Lax` cookies, and every state-changing request must come
  from our own origin (`apps/api/src/common/origin-check.ts`).
- The browser only talks to the website's origin; `/api` is proxied, so no CORS is opened.
- **Content Security Policy** on every page with a fresh nonce per view: only our scripts
  run (`apps/web/proxy.ts`). Also `frame-ancestors 'none'`, HSTS, `nosniff`,
  `Referrer-Policy`, and a `Permissions-Policy` that allows only the camera and location
  check-in needs (`apps/web/next.config.ts`). The API sends Helmet's headers.
- Input is validated with zod schemas on every endpoint.

### Files
- Size limits on every upload. Only PNG, JPEG, GIF and WebP open in the browser; everything
  else downloads as an attachment.
- The R2 bucket is private; downloads are 5-minute signed links after a permission check.
- Check-in selfies are deleted after the workspace's retention period.

### Operations
- Secrets live in Render's environment, never in the repository (which is private).
- CI fails on high or critical vulnerabilities in production dependencies (`npm audit`),
  and runs the full test suite against real Postgres and Redis.
- Owners and admins can read an audit log of sensitive changes (roles, settings, two-factor rules).
- Backups: Neon point-in-time restore, with a drill (`docs/BACKUP-DRILL.md`).
- Load: 1,000 concurrent users at p95 15 ms on one API copy (`docs/LOAD-TEST.md`).

## Still open

| | Risk | What to do | When |
|---|---|---|---|
| 1 | **Staging prints emails to its log**, including password-reset and sign-in links. Anyone with Render access can read them. | Switch to Resend (`EMAIL_TRANSPORT=resend`) and remove `ALLOW_CONSOLE_EMAIL`. | Before real customers |
| 2 | Staging uses the pretend payment gateway. | Connect the real gateway; `ALLOW_TEST_PAYMENTS` must not be set in production. | Before charging |
| 3 | The point-in-time restore hasn't been drilled on Neon itself yet. | Follow `docs/BACKUP-DRILL.md` on staging. | Before launch |
| 4 | Styles allow inline attributes (`style-src 'unsafe-inline'`). Lower risk than scripts, but CSS can still be abused to leak page content. | Move inline widths and colours to classes, then drop it. | Later |
| 5 | Platform admins are a list of emails in an environment variable, without a second factor of their own. | Require two-factor sign-in for those accounts. | Before launch |
| 6 | No external review yet. | The penetration test (#71); fix all high and critical findings. | Before launch |

## For the penetration testers

Suggested scope, on a copy of staging with test data:
1. **Tenant isolation**: reading or changing another workspace's data through any endpoint,
   ids in URLs, file links, live streams (`/api/chat/events`, `/api/projects/:id/events`).
2. **Roles**: guest, member, manager, admin, owner; especially guests on client projects and
   what a removed member can still reach.
3. **Sign-in**: two-factor bypass, recovery codes, Google sign-in, invitation and join links,
   password reset, session handling.
4. **Files**: upload types and sizes, stored XSS through file names or content, signed links.
5. **Billing**: changing plans or seats without paying, invoice numbering, bank-transfer approval.
6. **Imports**: CSV injection and very large files in the CRM import.

Test accounts are made by the testers through the normal sign-up on the copy. Don't run
the test against the live site or with real customers' data.
