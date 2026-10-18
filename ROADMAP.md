# WorkHub roadmap

Paid launch in Pakistan on **3 May 2027**, public beta on **8 February 2027**, international expansion from November 2027.

Every task is a GitHub issue, grouped into one **milestone per sprint**. Open the [milestones page](https://github.com/arbaz-webdev/workhub/milestones) to see progress; close an issue when its pull request merges.

## Planning documents

- [PRD & Business Plan](https://claude.ai/code/artifact/da5b6a43-dec7-4ac0-b28d-990ddd03ef96): vision, personas, requirements, architecture, pricing, risks
- [Market Research & Execution Plan](https://claude.ai/code/artifact/687ffd0d-0968-4c4b-9e0a-2b3280cba090): competitor research, revised MVP, validation plan, sprint plan (plan of record)

## Phases

| Phase | Dates | Goal | Gate to the next phase |
| --- | --- | --- | --- |
| MVP build | Nov 2026 – Apr 2027 | Attendance, boards, CRM, team chat, Client Profitability report | 10 beta teams use it weekly; pen test passed |
| Pakistan launch + Phase 2 | May – Oct 2027 | Paid plans; desktop agent, consent-based monitoring, mobile apps, WhatsApp | 50 paying companies; churn under 3% a month |
| Phase 3: going global | Nov 2027 – Oct 2028 | Gulf launch, Arabic/RTL, regional hosting, AI assistant, SSO | — |

## Sprints

| Sprint | Dates | Focus | Milestone |
| --- | --- | --- | --- |
| 1 | 2–15 Nov 2026 | Foundations: monorepo, tenant-isolated DB, auth, CI, landing page | [Sprint 1](https://github.com/arbaz-webdev/workhub/milestone/1) |
| 2 | 16–29 Nov 2026 | Workspace basics: invites, settings, app shell, staging | [Sprint 2](https://github.com/arbaz-webdev/workhub/milestone/2) |
| 3 | 30 Nov – 13 Dec 2026 | Project boards core | [Sprint 3](https://github.com/arbaz-webdev/workhub/milestone/3) |
| 4 | 14–27 Dec 2026 | Project boards complete | [Sprint 4](https://github.com/arbaz-webdev/workhub/milestone/4) |
| 5 | 28 Dec 2026 – 10 Jan 2027 | Attendance core (selfie check-in, night shifts, offline) | [Sprint 5](https://github.com/arbaz-webdev/workhub/milestone/5) |
| 6 | 11–24 Jan 2027 | Attendance complete (leave, holidays, timesheets) | [Sprint 6](https://github.com/arbaz-webdev/workhub/milestone/6) |
| 7 | 25 Jan – 7 Feb 2027 | Inbox (team chat) + **public beta 8 Feb** | [Sprint 7](https://github.com/arbaz-webdev/workhub/milestone/7) |
| 8 | 8–21 Feb 2027 | CRM core (lighter, Ramadan) | [Sprint 8](https://github.com/arbaz-webdev/workhub/milestone/8) |
| 9 | 22 Feb – 7 Mar 2027 | CRM complete (lighter, Ramadan) | [Sprint 9](https://github.com/arbaz-webdev/workhub/milestone/9) |
| 10 | 8–21 Mar 2027 | Reports, incl. Client Profitability | [Sprint 10](https://github.com/arbaz-webdev/workhub/milestone/10) |
| 11 | 22 Mar – 4 Apr 2027 | Billing (PKR) and onboarding | [Sprint 11](https://github.com/arbaz-webdev/workhub/milestone/11) |
| 12 | 5–18 Apr 2027 | Hardening: 2FA, pen test, load test | [Sprint 12](https://github.com/arbaz-webdev/workhub/milestone/12) |
| 13 | 19 Apr – 2 May 2027 | Launch prep + **paid launch 3 May** | [Sprint 13](https://github.com/arbaz-webdev/workhub/milestone/13) |
| Phase 2 | May – Oct 2027 | Pro plan features | [Phase 2](https://github.com/arbaz-webdev/workhub/milestone/14) |
| Phase 3 | Nov 2027 – Oct 2028 | Going global | [Phase 3](https://github.com/arbaz-webdev/workhub/milestone/15) |

## Labels

Module: `platform` `attendance` `projects` `crm` `inbox` `reports` `billing` `monitoring` · Cross-cutting: `security` `infra` `marketing` · Later: `phase-2` `phase-3`

## Definition of done (every issue)

- Works on phone and desktop; pages interactive in under 2 s on 4G
- Permission checks on the server; a tenant-isolation test for every new workspace table
- Unit tests for logic and one end-to-end test for the main flow
- Empty, loading and error states written
- CI green; deployed to staging and tried as a real user
