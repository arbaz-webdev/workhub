# Staging site

A permanent copy of WorkHub on the internet, for you and your partner to use and test.
It costs **nothing** and updates itself after anything merged into `main` passes CI.

```
Browser ──https──▶ workhub-staging (one free Render web service, Singapore)
                     ├─ website (Next.js)  ── /api/* ──▶ API (NestJS, 127.0.0.1 only)
                     │                                    ├──▶ Postgres on Neon (Singapore, free)
                     │                                    └──▶ files on Cloudflare R2 (free)
```

The website and the API run in one container (`deploy/staging.Dockerfile`). The API
listens only inside it, so nobody can call it directly. CI checks that it can't be
reached from outside.

**The catch with free:** the site goes to sleep after 15 minutes without visitors, and
the next visit waits about a minute while it wakes. It's also slow while waking.
That's fine for showing your partner. See "Always on" below for the paid layout.

## Accounts

| Service | For | Cost |
|---|---|---|
| **Render** (render.com) | Runs the site | Free plan, $0. A card is on file only to verify you |
| **Neon** (neon.com) | The Postgres database | Free |
| **Cloudflare** (cloudflare.com) | R2 storage for attachments and selfies | Free up to 10 GB a month. A card is on file to switch R2 on |

**Not needed yet:**
- **A domain and Resend**, for real emails. Until then emails are written to the site's log, and your partner joins with a join link.
- **Google Cloud**, for "Sign in with Google".

> Why Neon and not Render's own Postgres? WorkHub's API logs in as a second, restricted
> database user that can never bypass the company-separation rules (Row-Level Security). Neon
> documents that it supports creating that user; Render's Postgres docs don't say.

## 1. Neon: the database

1. **New project**: name `workhub-staging`, Postgres **17**, region **AWS Asia Pacific 1 (Singapore)**.
2. **Connect**:
   - Role `neondb_owner`, database `neondb`.
   - Turn **Connection pooling off**. The address must not contain `-pooler`.
3. **Copy snippet** copies the connection string with its password. Keep it private.

## 2. Cloudflare R2: file storage

1. **R2 Object Storage** → switch R2 on (free plan).
2. **Create bucket** `workhub-staging`. The location is picked automatically (Asia Pacific), and public access stays disabled.
3. **API Tokens → Create Account API token**:
   - Permission: **Object Read & Write**
   - Buckets: **specific buckets only** → `workhub-staging`
4. Keep the **Access Key ID** and **Secret Access Key** private. The secret is shown only once.

## 3. Render: the site

1. Install Render's GitHub app on **only** `arbaz-webdev/workhub`, and connect GitHub in Render.
2. **New → Blueprint** → `arbaz-webdev/workhub`, branch **main**, name `workhub-staging`.
   Render reads `render.yaml`. It should show **one web service, `workhub-staging`, on the free
   plan ($0)**. If it shows a price, stop.
3. Paste the three secrets:

   | Variable | Paste |
   |---|---|
   | `DATABASE_URL` | the Neon connection string |
   | `S3_ACCESS_KEY_ID` | from R2 |
   | `S3_SECRET_ACCESS_KEY` | from R2 |

   Everything else is in `render.yaml`. The R2 endpoint is already filled in, and Render
   generates the password for the API's restricted database user. On every start the site
   applies new database migrations and creates or updates that user.
4. **Deploy Blueprint**. The first build takes about 10 minutes.

### If the address isn't `https://workhub-staging.onrender.com`

Render adds a suffix when a name is taken. If the site has a different `.onrender.com`
address:
1. Open **workhub-staging → Environment**.
2. Set `WEB_ORIGIN` and `APP_URL` to the real address (with `https://`, no trailing slash).
3. Save, and let it redeploy.

Until then, signing in fails with "Origin not allowed".

## 4. Check it works

1. Open the site (allow a minute if it's asleep). Sign up and create your workspace.
2. Attach a file to a task and download it again (this checks R2).
3. **Attendance** → check in. The IP on the check-in should be **your** public IP. If it's a
   Cloudflare address (e.g. 104.x.x.x), `TRUST_PROXY` is one too low. Render sits behind Cloudflare,
   so the free single-service setup needs `3`.
4. **People → Share a join link**: choose **Manager**, then **Create link** → **Copy**, and send it to your
   partner. Once they've joined, you can make them an **Admin** on the same page.

Emails, such as the "confirm your email" link, are in **workhub-staging → Logs**; search for `To:`.

## What CI checks

On every pull request, CI builds the staging image and runs it as Render does. It checks that:
- migrations apply to a fresh Postgres;
- sign-up works through the website;
- the API **can't** be reached from outside the container;
- the whole container stops if either process dies, so Render restarts it.

It also builds and tests the two separate images used for the always-on layout. Render only
deploys after CI passes.

## Later

- **Always on, no sleeping (about $14/month):** run the website and the API as two Render services
  (`deploy/web.Dockerfile`, and a private service from `deploy/api.Dockerfile`). Then set
  `API_URL` on the website to the API's private `host:port`.
- **Real emails:** buy the domain and add it to Resend. Then set `EMAIL_TRANSPORT=resend`,
  `RESEND_API_KEY` and `EMAIL_FROM=WorkHub <no-reply@yourdomain>`, and delete `ALLOW_CONSOLE_EMAIL`.
- **Your own address:** point `staging.yourdomain.com` at the site in Render's **Custom domains**,
  and update `WEB_ORIGIN` and `APP_URL`.
- **Feedback by email:** set `FEEDBACK_TO` to your address. Until then feedback is saved in the
  `feedback` table (and, while emails go to the log, the email shows there too).
- **Product analytics (free PostHog plan):** create an EU project at posthog.com and set
  `POSTHOG_KEY` to its project API key. Nothing is sent until you do.
- **Chat with several API copies:** live updates go through the API's memory, which is fine for
  one copy. Running two or more needs Redis pub/sub first (Sprint 12).
