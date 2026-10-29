// The Terms of service and Privacy policy. These are DRAFTS for a lawyer to finish: the facts
// about how WorkHub works are accurate, but nothing here has been legally reviewed.
// Bodies use the same small Markdown subset as the help centre (components/help/article-body).
// "> For the lawyer:" lines are notes, to be removed once each section is final.

export interface LegalDocument {
  slug: 'terms' | 'privacy';
  title: string;
  summary: string;
  /** Shown under the title; set when the lawyer signs the document off. */
  effectiveDate: string | null;
  body: string;
}

/** While true, both pages show a draft notice and ask search engines not to index them. */
export const LEGAL_DRAFT = true;

export const LEGAL_DOCUMENTS: LegalDocument[] = [
  {
    slug: 'terms',
    title: 'Terms of service',
    summary: 'The agreement between WorkHub and the companies that use it.',
    effectiveDate: null,
    body: `## Who we are

WorkHub is run by [legal name of the business], [registered address], Pakistan ("WorkHub", "we", "us").

> For the lawyer: confirm the legal entity (sole proprietor or company), its registration number and NTN, and the address to use.

## Who these terms are for

These terms are between WorkHub and the company that creates a workspace (the "customer"). The person who creates the workspace confirms they can agree to these terms for that company.

Each person the customer invites (an "authorised user") must also follow the **Acceptable use** section.

## The service

WorkHub is an online workspace for attendance, leave, timesheets, projects, a CRM, quotes and invoices to clients, a client portal, team chat and reports. We may improve, change or remove features. If we remove a feature the customer pays for, we'll give reasonable notice.

> For the lawyer: say how much notice, and whether a customer can cancel and get a refund if a paid feature is removed.

## Accounts and security

- Customers decide who gets access and with which role (owner, admin, manager, member, guest).
- Each person keeps their own password private. Two-factor sign-in is available, and an owner can require it for everyone.
- The customer tells us quickly if they think an account has been misused.

## Plans and payment

- **Free**: up to 10 people.
- **Starter**: PKR 699 per person per month. **Business**: PKR 1,299 per person per month.
- Yearly billing charges 10 months for 12. New workspaces get a 14-day Business trial with no card needed.
- Workspaces created before the paid launch on 3 May 2027 keep a **founding-customer discount of 40%** for as long as they stay subscribed.
- Prices are in Pakistani rupees and exclude provincial sales tax on services, which we add to invoices where it applies.
- Customers can pay by bank transfer or, once available, by card through a payment provider.

> For the lawyer: cover late payment, what happens when a payment fails (the app gives a grace period, then limits the workspace to the Free plan), refunds, changes to prices, and the founding discount's exact conditions.

## Customer data

- The customer owns the data it and its users put into WorkHub ("customer data").
- We use customer data only to run, secure and support the service, as set out in the [Privacy policy](/privacy).
- Each workspace's data is kept separate from every other workspace's.
- Customers can export their data (for example reports and monthly attendance as CSV) at any time.

> For the lawyer: say what happens to customer data when a customer leaves (how long we keep it, and how they can get a full export), and whether a separate data processing agreement is offered.

## Acceptable use

Customers and their users must not:

- break the law, or use WorkHub to harass, threaten or discriminate against anyone;
- upload anything they don't have the right to share, or anything harmful such as malware;
- try to get into another workspace, test our security without permission, or overload the service;
- resell WorkHub without our written agreement.

We may suspend access that breaks these rules. Where we can, we'll warn the customer first.

## Monitoring of staff

WorkHub records check-ins, check-out times, an optional selfie, and location or office network at check-in, as each customer chooses. The customer is responsible for telling its staff about this and for having a lawful reason to do it.

> For the lawyer: confirm what employers in Pakistan (and later the Gulf) must tell or ask employees before recording attendance, selfies and location.

## Availability and support

We aim to keep WorkHub running all the time and publish its status at [/status](/status). Planned maintenance is announced in advance where possible. Support is by email and WhatsApp.

> For the lawyer: decide whether to promise an uptime level (and any service credits), and the support hours.

## Liability

> For the lawyer: write the limitation of liability, exclusions, and indemnities. This section is intentionally empty.

## Ending the agreement

- A customer can stop using WorkHub at any time. Paid plans run to the end of the current billing period.
- We may end the agreement if a customer seriously breaks these terms, or doesn't pay after reminders.

> For the lawyer: notice periods, and what happens to prepaid yearly plans.

## Changes to these terms

If we change these terms, we'll tell workspace owners by email and in the app before the change takes effect.

> For the lawyer: how much notice.

## Law and disputes

> For the lawyer: governing law (Pakistan?), which courts, and whether to use arbitration.

## Contact

Questions about these terms: [email address].`,
  },
  {
    slug: 'privacy',
    title: 'Privacy policy',
    summary: 'What WorkHub collects, why, who it’s shared with, and your choices.',
    effectiveDate: null,
    body: `## Who this covers

This policy explains how WorkHub handles personal information about:

- people who use a WorkHub workspace (owners, staff, managers, guests and client contacts);
- people who visit our website or join our beta waitlist.

For information inside a workspace, the company that owns the workspace decides what is collected and why; WorkHub handles it on that company's behalf. Questions about a workspace's data are best sent to that company first.

> For the lawyer: confirm the controller/processor wording that fits Pakistani law, and the GDPR if we sign up EU customers later.

## What we collect

**Your account**

- Name, email address, password (stored only as a one-way hash), and your Google account ID if you sign in with Google.
- Two-factor sign-in secrets, stored encrypted, and recovery codes, stored as one-way hashes.
- Sign-in sessions, with the IP address and browser they came from.

**Attendance**

- Check-in, check-out and break times.
- A **selfie** at check-in or check-out, if the workspace turns this on. Selfies are deleted automatically after **30 days**.
- Your **location** at check-in (a GPS position) and the network address you checked in from, if the workspace uses office zones. This is used to check whether you were at an office.
- Times recorded by a fingerprint device, if the workspace imports them.

**Your work**

- Leave requests, timesheets, tasks, comments, files you upload, chat messages and announcements.
- CRM records such as leads, contacts and companies, including any notes and custom fields the workspace adds.
- Quotes, invoices and billing details, including the workspace's tax number if it enters one.

**Using the service**

- An audit log of important changes in a workspace (who did what, and when, and from which IP address).
- Feedback you send us, with the page you were on and your browser, so we can reproduce problems.
- Basic product usage events, such as "created a project", tied to your account and workspace IDs. These are only sent if we turn product analytics on.

**Our website**

- If you join the beta waitlist: your name, email, company, team size, the answers you give about your current tools and problems, and the IP address you signed up from.

> For the lawyer: add anything collected for payments once a card provider is chosen.

## Why we use it

- To run the service: sign you in, show your workspace, and do what you ask.
- To keep it secure: spot misuse, enforce limits, and investigate problems.
- To send emails you need, such as invitations, password resets, reminders and invoices.
- To understand which features are used, so we can improve them.
- To bill for paid plans and meet tax and accounting rules.

We don't sell personal information, and we don't use workspace data to show ads.

> For the lawyer: list the legal basis for each use, if required.

## Who we share it with

Only with services that help us run WorkHub, and only what they need:

- **Render**: hosting for the app and API.
- **Neon**: the database.
- **Cloudflare (R2)**: file storage for uploads and selfies.
- **Resend**: sending email, once set up.
- **PostHog**: product analytics, only if turned on.
- **Google**: if you choose to sign in with Google.
- A **payment provider** (such as Safepay or PayFast), once card payments are available.

We may also share information if the law requires it.

> For the lawyer: confirm where each provider stores data (some are outside Pakistan), and what we must say about transfers abroad.

## How long we keep it

- Selfies: 30 days, then deleted automatically.
- Other workspace data: for as long as the workspace exists.
- Invoices and payment records: as long as tax law requires.

> For the lawyer: set the retention period after a workspace is closed, and for backups.

## Security

- Every workspace's data is separated at the database level, so one company can't see another's.
- Passwords are hashed; two-factor secrets are encrypted.
- Connections use HTTPS, and files are downloaded through short-lived private links.

## Your choices

- You can see and change your own details in the app.
- Your workspace's owner or admins can export workspace data, and remove people, records and files.
- You can ask us for a copy of your information, or to correct or delete it, by emailing [email address]. To close a whole workspace and delete its data, the owner emails us; there's no button for this yet.

> For the lawyer: list the rights people have under applicable law, and how quickly we must reply.

## Children

WorkHub is for businesses and isn't meant for anyone under 18.

## Changes to this policy

If we make important changes, we'll tell workspace owners by email and in the app.

## Contact

Privacy questions: [email address], [postal address].`,
  },
];

export const legalDocument = (slug: LegalDocument['slug']) => LEGAL_DOCUMENTS.find((d) => d.slug === slug)!;
