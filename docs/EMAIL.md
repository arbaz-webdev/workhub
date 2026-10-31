# Real emails: domain and Resend

Until this is done, WorkHub's emails (confirm your email, password reset, invites, invoices,
alerts) are written to the staging site's log instead of being sent. The code to send them
through [Resend](https://resend.com) is already in place; what's left needs your accounts.

**You do steps 1–4** (they involve buying, signing up and secrets). **Then tell me the domain**
and I'll do step 5 and switch the staging site over.

## 1. Buy a domain

Pick the name you'll use for WorkHub everywhere, then buy it from any registrar.

- **.pk** (e.g. `workhub.pk`): Rs 2,100 a year from PKNIC or one of its resellers.
- **.com**: about $10–15 a year, for example from Cloudflare Registrar or Namecheap.

Keep the registrar login safe and turn on its two-factor sign-in: whoever controls the domain
controls WorkHub's email and website address.

## 2. Add the domain to Resend

1. Sign up at resend.com (the free plan sends 3,000 emails a month, 100 a day).
2. **Domains → Add domain**. Enter a **subdomain** used only for sending, `mail.yourdomain`
   (e.g. `mail.workhub.pk`). Resend recommends a subdomain so a sending problem never hurts
   the main domain's reputation.
3. Choose the region closest to your customers.

## 3. Add the DNS records

Resend now shows three records. In your registrar's DNS settings (or Cloudflare's, if the
domain is on Cloudflare), add each one **exactly as Resend shows it**:

| Type | Name (host) | What it's for |
|---|---|---|
| MX | `send.mail` | Bounces come back here (priority 10) |
| TXT | `send.mail` | SPF: says Resend may send for you |
| TXT | `resend._domainkey.mail` | DKIM: signs each email so it can't be faked |

Copy the values from Resend; the table only shows the names. Most registrars want just the
part before your domain in the Name box (`send.mail`, not `send.mail.workhub.pk`). If Resend's
names differ from the table, use Resend's.

Then add one more record yourself, **DMARC**, which Gmail and Yahoo look for:

| Type | Name (host) | Value |
|---|---|---|
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:you@yourdomain` |

`p=none` only asks for reports. After a few weeks of clean reports it can be tightened to
`p=quarantine`.

Click **Verify** in Resend. It can take from a few minutes to a few hours; Resend emails you
when the domain is verified.

## 4. Put the key in Render

1. In Resend: **API Keys → Create API key**, permission **Sending access**, domain
   `mail.yourdomain`. Copy it (it's shown once).
2. In Render: **workhub-staging → Environment → Add environment variable**:
   `RESEND_API_KEY` = the key. Paste it there only: not in chat, email or the repository.
3. Optional: a real inbox for replies, such as `support@yourdomain`. Cloudflare Email Routing
   (free) can forward it to your Gmail. Then tell me the address for `EMAIL_REPLY_TO`.

## 5. Switch the site over (me)

Once you tell me the domain, I'll change `render.yaml` to:

```
EMAIL_TRANSPORT=resend
EMAIL_FROM=WorkHub <no-reply@mail.yourdomain>
EMAIL_REPLY_TO=support@yourdomain   (if you set one up)
```

and remove `ALLOW_CONSOLE_EMAIL`. The site refuses to start if the key is missing or
`EMAIL_FROM` still points at a placeholder, so a mistake shows up at deploy time, not at
someone's sign-up.

## 6. Check it

Sign in as a platform admin (your email in `PLATFORM_ADMINS`), open **/app/platform** and click
**Send me a test email**. You'll see either "Sent", or Resend's reason it wasn't (for example,
"domain is not verified"). Then check that the email arrived, including the spam folder.

## After launch

- Resend stops sending to addresses that bounced or marked an email as spam, across the
  whole account. Its rules ask for under 4% bounces and under 0.08% spam complaints.
- Gmail doesn't report spam complaints back, so watch the bounce and complaint numbers on
  Resend's dashboard.
- Over 100 emails a day, the free plan stops sending: move to Resend Pro ($20/month,
  50,000 emails) before that.
