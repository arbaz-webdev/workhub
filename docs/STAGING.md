# Staging site

A permanent copy of WorkHub on the internet, for you and your partner to use and test.
It updates itself whenever something is merged into `main`.

```
Browser ──https──▶ web (Next.js, public)  ──/api/* over Railway's private network──▶ api (NestJS, private)
                                                                                     │
                                                         Postgres (Railway) ◀────────┤
                                                         Files: Cloudflare R2 ◀──────┘
```

The API has no public address: only the web app can reach it. That keeps the setup
simple (one origin, first-party cookies, no CORS) and means nobody can call the API
directly to get around rate limits.

## Accounts you need

| Service | What it's for | Cost | Card? |
|---|---|---|---|
| **Railway** (railway.com) | Runs the web app, the API and the database | Hobby plan $5/month, which includes $5 of usage. Staging should cost about $5–10/month | A free 30-day trial needs none; the Hobby plan does |
| **Cloudflare** (cloudflare.com) | R2 file storage for attachments and selfies | Free up to 10 GB | Yes, to switch R2 on, even on the free tier |

Sign up to Railway **with your GitHub account** (arbaz-webdev), so it can deploy the
private repository. Many Pakistani debit cards work for both once international online
payments are switched on in your banking app; virtual cards from SadaPay or NayaPay
work too.

**Not needed yet:**
- A domain and **Resend**, for real emails. Until then emails are written to the API's log, and your partner joins with an invite link.
- **Google Cloud**, for "Sign in with Google".

## 1. Cloudflare R2 (about 5 minutes)

1. Cloudflare dashboard → **R2 Object Storage** → turn on R2 (free plan).
2. **Create bucket** → name `workhub-staging`, location hint **Asia-Pacific**. Leave it private.
3. **Manage API tokens** → **Create API token**:
   - Permission: **Object Read & Write**
   - Apply to: **only** the `workhub-staging` bucket
4. Keep this page open. You'll paste the **Access Key ID**, the **Secret Access Key** and the
   **S3 endpoint** (`https://<account-id>.r2.cloudflarestorage.com`) into Railway in step 2.
   Paste them straight into Railway; don't put them in chat, email or a file in the repo.

## 2. Railway

Create a project, choose the **Singapore** region if offered (closest to Pakistan), then add:

### Postgres
**+ New → Database → PostgreSQL.** Keep the service name `Postgres`.

### api
**+ New → GitHub Repo → arbaz-webdev/workhub**, then:
- Rename the service to **`api`**.
- Settings → Source: branch **main**. Turn on **Wait for CI** if offered, so a red build never deploys.
- Settings → Deploy: health check path **`/health`**.
- Networking: **don't** generate a public domain.
- Variables:

| Variable | Value |
|---|---|
| `RAILWAY_DOCKERFILE_PATH` | `deploy/api.Dockerfile` |
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `APP_DB_PASSWORD` | a long random password (see below) |
| `DATABASE_APP_URL` | `postgresql://workhub_app:${{APP_DB_PASSWORD}}@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/${{Postgres.PGDATABASE}}` |
| `WEB_ORIGIN` | `https://${{web.RAILWAY_PUBLIC_DOMAIN}}` |
| `APP_URL` | `https://${{web.RAILWAY_PUBLIC_DOMAIN}}` |
| `TRUST_PROXY` | `2` (Railway's edge, then the web app) |
| `EMAIL_TRANSPORT` | `console` |
| `ALLOW_CONSOLE_EMAIL` | `true` (staging only: emails go to the log) |
| `STORAGE_DRIVER` | `s3` |
| `S3_BUCKET` | `workhub-staging` |
| `S3_REGION` | `auto` |
| `S3_ENDPOINT` | your R2 S3 endpoint |
| `S3_ACCESS_KEY_ID` | from R2 |
| `S3_SECRET_ACCESS_KEY` | from R2 |

To make a password for `APP_DB_PASSWORD`, run this on your computer and paste the result:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

The API creates its restricted database user (`workhub_app`, which Row-Level Security
always applies to) with that password, and runs any new migrations every time it starts.

### web
**+ New → GitHub Repo → arbaz-webdev/workhub** again, then:
- Rename the service to **`web`**.
- Settings → Source: branch **main**.
- Networking: **Generate domain** on port **3000**. This is the link you share.
- Variables:

| Variable | Value |
|---|---|
| `RAILWAY_DOCKERFILE_PATH` | `deploy/web.Dockerfile` |
| `PORT` | `3000` |
| `API_URL` | `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:4000` |

Deploy `api` first, then `web`. The first builds take a few minutes.

## 3. Check it works

1. Open the web link. Sign up and create your workspace.
2. Attach a file to a task, then download it again (checks R2).
3. Check in on the Attendance page (from Sprint 5). The IP shown on the check-in should be your
   own public IP. If it's a Railway address, `TRUST_PROXY` needs changing.
4. **People → Share a join link**: choose **Manager**, then **Create link** → **Copy**, and send it to your
   partner. Once they've joined, you can make them an **Admin** on the same page.

Emails, such as the "confirm your email" link, are in **api → Logs**; search for `To:`.

## What CI checks

Every pull request:
- builds both images;
- starts the API container against a fresh Postgres (running the migrations) and the web container;
- signs up through the web app's `/api` proxy, as a browser would;
- restarts the API to check that migrations don't re-run.

So a change that would break the deploy is caught before it reaches staging.

## Later: real emails

Buy the domain, add it to Resend, then on `api` set `EMAIL_TRANSPORT=resend`,
`RESEND_API_KEY`, `EMAIL_FROM=WorkHub <no-reply@yourdomain>`, and delete
`ALLOW_CONSOLE_EMAIL`. The same domain can then replace the `*.up.railway.app` address.
