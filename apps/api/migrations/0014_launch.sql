-- Sprint 13: launch prep. The founding-customer discount, and the public status page.

-- A discount that stays with the workspace ("40% off for life" for workspaces made
-- before the paid launch). Invoices copy it, so a past invoice never changes.
alter table subscriptions
  add column discount_percent smallint not null default 0 check (discount_percent between 0 and 100),
  add column discount_label text;

alter table invoices
  add column discount_label text,
  add column discount_percent smallint not null default 0,
  -- Taken off the subtotal before sales tax.
  add column discount_amount numeric(14, 2) not null default 0;

-- Beta workspaces that already have a subscription row get the offer now; the rest get it
-- when the row is made (the API checks the workspace was created before the launch).
-- RLS is forced even for the table owner, so lift it for this one update.
alter table subscriptions no force row level security;
update subscriptions s
   set discount_percent = 40, discount_label = 'Founding customer: 40% off for life'
  from workspaces w
 where w.id = s.workspace_id and w.created_at < '2027-05-03' and s.discount_percent = 0;
alter table subscriptions force row level security;

-- Status page. These describe the service, not any one workspace, so they're outside RLS.
-- One row per component per day, counted up by the API's own checks every minute.
create table status_days (
  component  text not null,
  day        date not null,
  checks     integer not null default 0,
  failures   integer not null default 0,
  primary key (component, day)
);

-- Incidents and maintenance, written by WorkHub staff (PLATFORM_ADMINS).
create table status_incidents (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  impact       text not null check (impact in ('minor', 'major', 'maintenance')),
  components   text[] not null default '{}',
  started_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  created_by   uuid references users(id) on delete set null
);
create index status_incidents_started_idx on status_incidents (started_at desc);

create table status_updates (
  id           uuid primary key default gen_random_uuid(),
  incident_id  uuid not null references status_incidents(id) on delete cascade,
  status       text not null check (status in ('investigating', 'identified', 'monitoring', 'resolved')),
  body         text not null,
  created_at   timestamptz not null default now(),
  created_by   uuid references users(id) on delete set null
);
create index status_updates_incident_idx on status_updates (incident_id, created_at);
