// The help centre's articles. Bodies use a small Markdown subset that components/help/article-body
// renders: "## " headings, paragraphs, "- " and "1. " lists, "> " tips, **bold** and [links](/path).

export interface HelpArticle {
  slug: string;
  title: string;
  summary: string;
  category: 'Getting started' | 'Attendance and time' | 'Projects and clients' | 'Your account and billing';
  /** Words people might search for that aren't in the title. */
  keywords: string;
  body: string;
}

export const HELP_CATEGORIES: HelpArticle['category'][] = ['Getting started', 'Attendance and time', 'Projects and clients', 'Your account and billing'];

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: 'set-up-your-workspace',
    title: 'Set up your workspace',
    summary: 'Create a workspace and let the setup wizard prepare it for how your company works.',
    category: 'Getting started',
    keywords: 'sign up start wizard onboarding industry software house agency bpo',
    body: `Your workspace is your company in WorkHub. Everyone you invite works inside it, and nothing in it is visible to any other company.

## Create it

1. Go to [Create a workspace](/sign-up) and enter your name, email, a password and your company's name. You can also sign up with Google.
2. Confirm your email from the link we send you.
3. The setup wizard opens. Choose the kind of company you run: software house, agency, BPO or consultancy.

## What the wizard sets up

- **Working days and a first shift.** BPOs get a night shift that crosses midnight, counted as one workday.
- **Teams**, such as Development, Design or Sales, depending on your industry.
- **Pakistan's public holidays** for the year.
- **Sales pipeline stages** for your CRM.
- **A sample project** so you can see how boards work. Delete it whenever you like.

Then it asks you to invite your team. You can skip that and do it later from **People**.

> Every new workspace gets 14 days of the Business plan, free, with no card needed.

## Next

- [Invite your team and choose their roles](/help/invite-your-team)
- [Check in and out](/help/check-in-and-out)`,
  },
  {
    slug: 'invite-your-team',
    title: 'Invite your team and choose their roles',
    summary: 'Add people by email or with a join link, and decide what each of them can see and do.',
    category: 'Getting started',
    keywords: 'people members add user invite link role admin manager guest owner remove',
    body: `## Two ways to invite

Open **People**.

- **Invite by email**: type one or more addresses. Each person gets an email with a link to join.
- **Share a join link**: choose a role, create the link and send it on WhatsApp or anywhere else. Anyone with the link can join until you turn it off, so share it only with your team.

## Roles

- **Owner**: everything, including billing. There is one owner.
- **Admin**: everything except billing ownership. Admins manage people, settings and the audit log.
- **Manager**: runs projects and teams, approves leave, timesheets and attendance corrections, and sees reports.
- **Member**: checks in, works on projects they're part of, chats, and asks for leave.
- **Guest**: a client or freelancer who only sees the projects you share with them. Guests are always free and don't count towards your plan.

You can change someone's role on the **People** page at any time. Removing someone takes away their access straight away; their past work stays.

> On the Free plan you can have up to 10 people. Guests don't count.`,
  },
  {
    slug: 'check-in-and-out',
    title: 'Check in and out',
    summary: 'How check-in works on a phone or computer, with a selfie, location or office network, even offline.',
    category: 'Attendance and time',
    keywords: 'attendance clock in clock out selfie gps location office ip wifi break offline late absent install app',
    body: `## Checking in

Open **Attendance** and press **Check in**. When you finish, press **Check out**. Breaks are recorded the same way.

Depending on your company's rules, WorkHub may ask for:

- **A selfie**, taken with your phone or laptop camera. Selfies are deleted automatically after 30 days.
- **Your location**, to confirm you're at an office or allowed place.
- **The office network**, to confirm you're connected from the office.

Your browser asks your permission for the camera or location the first time.

## No internet?

Install WorkHub on your phone (**Install app** in the top bar, or "Add to Home Screen"). If you check in without internet, the check-in is saved on your phone and sent when you're back online, with the time you actually pressed the button.

## Something wrong?

If you forgot to check out, or the time is wrong, ask for a correction from your **Attendance** history. Your manager approves it, and the change is kept in the record.

## For admins: the rules

In **Attendance → Settings**:

- **Check-in rules**: require a selfie, a location, or the office network.
- **Shifts**: start and end times, grace minutes before someone counts as late, and night shifts that cross midnight.
- **Who works which shift**: by team, or a default for everyone.
- **Offices**: places people can check in from. Use **Use where I am now** while standing in the office.`,
  },
  {
    slug: 'leave-and-holidays',
    title: 'Leave and holidays',
    summary: 'Ask for leave, approve it, and keep public holidays out of attendance.',
    category: 'Attendance and time',
    keywords: 'leave holiday vacation sick casual annual eid time off approve balance half day',
    body: `## Asking for leave

Open **Leave** and choose **Ask for leave**. Pick the type, the dates (half days are allowed) and add a note if you like. Your manager is notified and you'll hear back in WorkHub.

**Your requests** shows each request and whether it's waiting, approved or declined.

## Approving

Managers, admins and the owner see requests waiting for them on the **Leave** page, and get a notification. Approved leave shows on the attendance record, so the person isn't marked absent.

## Holidays

Pakistan's public holidays are added when you set up your workspace. Admins can add company holidays or change dates, for example when an Eid date is confirmed. Nobody is marked absent on a holiday or on a day off in their working week.`,
  },
  {
    slug: 'projects-boards-and-timesheets',
    title: 'Projects, boards and timesheets',
    summary: 'Plan work on boards, record hours against tasks, and submit a weekly timesheet.',
    category: 'Projects and clients',
    keywords: 'project board kanban task card estimate hours template timer timesheet submit approve client',
    body: `## Projects and boards

Open **Projects** and create one, from scratch or from a template. Each project can belong to a client, so its hours count towards that client's profitability.

On the board, drag cards between columns. Open a card to add a description, people, a due date, an estimate in hours, comments and files. Changes appear for everyone looking at the board straight away.

**My work** shows every task assigned to you across projects, with what's due today and what's overdue.

## Recording hours

Start the timer on a task, or add hours by hand. Hours on a task show against its estimate, so you can see when work runs over.

## Timesheets

**Timesheets** shows your week. Check the hours and **submit** it. While it waits for approval the week is locked. Your manager approves it or sends it back with a note.

> Approved hours feed the utilisation and client profitability reports.`,
  },
  {
    slug: 'crm-leads-and-deals',
    title: 'Leads, deals and importing contacts',
    summary: 'Track leads and deals through your pipeline, import contacts from a spreadsheet, and turn a won deal into a project.',
    category: 'Projects and clients',
    keywords: 'crm lead contact company deal pipeline stage won lost follow up reminder import csv excel duplicate upwork fiverr linkedin whatsapp custom fields',
    body: `## Leads and contacts

In **CRM**, add leads with where they came from (Upwork, Fiverr, LinkedIn, WhatsApp, referral and so on). Pakistani phone numbers are tidied into one format, and WorkHub warns you about duplicates.

## Deals

**Deals** shows your pipeline as a board. Drag a deal to move it to the next stage. Each deal has a value, a currency and an expected close date.

Log calls, meetings and notes on a lead, contact or deal, and set a follow-up date: WorkHub reminds you on the day. **Follow-ups** lists what's due.

When you mark a deal **won**, WorkHub offers to create the project for it, already linked to the client.

## Clients

Open a company to see everything about that client in one place: contacts, deals, projects, hours and, on Business, profitability.

## Importing from a spreadsheet

1. Save your sheet as CSV (in Excel: **File → Save As → CSV UTF-8**).
2. Go to **CRM → Import** and choose the file.
3. Match your columns to WorkHub's fields, and choose what to do with duplicates.
4. Check the preview and import. Rows with problems are listed so you can fix and re-import them.

> Custom fields and more than one pipeline are part of the Business plan.`,
  },
  {
    slug: 'inbox-and-announcements',
    title: 'Team chat and announcements',
    summary: 'Channels, direct messages, mentions and company announcements with read receipts.',
    category: 'Getting started',
    keywords: 'inbox chat message channel direct dm thread mention file announcement read receipt notification',
    body: `## Inbox

**Inbox** has channels for teams and topics, and direct messages between people. Messages arrive instantly.

- Mention someone with **@name** to notify them.
- Reply in a thread to keep a channel tidy.
- Attach files and images; images show in the conversation.
- Private channels are seen only by their members.

Search with **Ctrl+K** (or the search box) to find people, pages and more.

## Announcements

Managers, admins and the owner can post **Announcements** to the whole company, such as a holiday notice or a policy change. Everyone sees it in the menu with a count, and the person who posted it can see who has read it.`,
  },
  {
    slug: 'reports-and-profitability',
    title: 'Reports: profitability and utilisation',
    summary: 'See which clients make you money and how much of your team’s time is billable.',
    category: 'Projects and clients',
    keywords: 'reports profit margin client profitability utilisation billable hours salary cost rate exchange dollar sales pipeline dashboard',
    body: `Reports are for managers, admins and the owner. **Home** shows the owner dashboard: today's attendance, work in progress, sales and money at a glance.

## Set up your costs first

Profitability needs to know what an hour of each person costs and what you charge. In **Reports → Costs**:

- **Working hours and exchange rates**: monthly working hours, and the rates for clients who pay in dollars or other currencies.
- **Monthly cost of each person**: salary and other costs. Only admins and the owner see these.
- **Hourly rates**: what each project bills per hour.

## The reports

- **Client profitability** (Business plan): revenue, cost and margin for each client, from the hours your team recorded. Clients that cost more than they pay are marked in red.
- **Utilisation**: billable hours against total hours, for each person and team.
- **Sales**: your pipeline's value by stage, deals won and lost, and win rate.

Monthly attendance can also be exported to Excel for payroll.`,
  },
  {
    slug: 'plans-and-billing',
    title: 'Plans, invoices and paying',
    summary: 'Choose a plan, pay in rupees, and get invoices with your NTN and sales tax.',
    category: 'Your account and billing',
    keywords: 'billing plan price free starter business upgrade invoice ntn sales tax province pay bank transfer ibft jazzcash easypaisa card founding discount trial',
    body: `Only the owner manages billing, in **Settings → Plan and billing**. See current prices on the [pricing page](/pricing).

## Plans

- **Free**: everything, for up to 10 people.
- **Starter**: no limit on people.
- **Business**: adds client profitability, custom fields and more sales pipelines.

Guests are always free. New workspaces get 14 days of Business first.

## Invoices

Add your billing details: the company name, email, NTN (or CNIC) and province. Sales tax on services for your province is added as its own line. Choose a plan and monthly or yearly billing (yearly gets two months free) to get an invoice, numbered like WH-2027-000123. Print it or save it as a PDF.

## Paying

- **Bank transfer (IBFT)** for yearly plans: send the amount to the account shown, then upload the receipt and reference number. Your plan starts when we confirm it, usually the same working day.
- **Card, JazzCash and Easypaisa** open with paid plans.

## Founding customers

Workspaces created before paid plans launch keep 40% off every invoice for as long as they stay. It's shown on your billing page and as its own line on each invoice.`,
  },
  {
    slug: 'two-factor-sign-in',
    title: 'Two-factor sign-in',
    summary: 'Protect your account with a code from an authenticator app, and require it for your whole company.',
    category: 'Your account and billing',
    keywords: '2fa two factor authenticator google microsoft code otp recovery codes lost phone security password',
    body: `Two-factor sign-in means a stolen password isn't enough to get into your account. After your password (or Google), WorkHub asks for a 6-digit code from an app on your phone.

## Turn it on

1. Install an authenticator app, such as Google Authenticator or Microsoft Authenticator.
2. In WorkHub, open **Account** from the menu and choose **Set up two-factor sign-in**.
3. Scan the QR code with the app (or type the key it shows), then enter the 6-digit code.
4. Save your **recovery codes**: download them or copy them somewhere safe. Each one signs you in once if you lose your phone.

Turning it on signs you out on your other devices.

## Lost your phone?

On the code screen, choose **Use a recovery code**. Then, from **Account**, make new recovery codes or set two-factor sign-in up again on your new phone. If you've lost your codes as well, ask your workspace owner to contact us.

## Require it for everyone (owners)

In **Settings → Security**, choose **Require two-factor sign-in**. You need it turned on yourself first. Anyone without it is asked to set it up before they can use the workspace.

> Recommended for every owner and admin.`,
  },
];

export const helpArticle = (slug: string) => HELP_ARTICLES.find((a) => a.slug === slug);
