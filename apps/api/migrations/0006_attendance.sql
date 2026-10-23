-- Sprint 5: attendance core. Shifts (including night shifts across midnight),
-- break policies, office sites (GPS radius and/or IP ranges), and check-in
-- events with selfies. Every table is workspace-owned with RLS forced.

-- A working pattern. end_time <= start_time means the shift ends the next day
-- (18:00–03:00 is one workday, dated by its start).
create table shifts (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  name              text not null,
  start_time        time not null,
  end_time          time not null,
  -- Arriving more than this many minutes after the start counts as late.
  grace_minutes     smallint not null default 15 check (grace_minutes between 0 and 240),
  full_day_minutes  smallint not null default 480 check (full_day_minutes between 1 and 1440),
  half_day_minutes  smallint not null default 240 check (half_day_minutes between 0 and 1440),
  -- ISO weekdays, 1 = Monday … 7 = Sunday.
  working_days      smallint[] not null default '{1,2,3,4,5}',
  -- [{ "name": "Lunch", "minutes": 45, "paid": false, "days": [1,2,3,4] }, …]
  breaks            jsonb not null default '[]',
  is_default        boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (start_time <> end_time),
  check (half_day_minutes <= full_day_minutes)
);
create index shifts_workspace_idx on shifts (workspace_id);
-- At most one default shift per workspace.
create unique index shifts_one_default on shifts (workspace_id) where is_default;
create trigger shifts_updated_at before update on shifts for each row execute function set_updated_at();

-- Where people are expected to work from. A check-in is "in zone" when it is
-- within radius of a site's GPS point, or comes from one of its IP ranges.
create table attendance_sites (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  name           text not null,
  latitude       double precision check (latitude between -90 and 90),
  longitude      double precision check (longitude between -180 and 180),
  radius_meters  integer check (radius_meters between 20 and 50000),
  ip_ranges      cidr[] not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check ((latitude is null) = (longitude is null) and (latitude is null) = (radius_meters is null)),
  check (latitude is not null or cardinality(ip_ranges) > 0)
);
create index attendance_sites_workspace_idx on attendance_sites (workspace_id);
create trigger attendance_sites_updated_at before update on attendance_sites for each row execute function set_updated_at();

-- Who works which shift: a person's own shift, else their team's, else the default.
alter table teams add column shift_id uuid references shifts(id) on delete set null;
alter table memberships add column team_id uuid references teams(id) on delete set null;
alter table memberships add column shift_id uuid references shifts(id) on delete set null;
-- Remote people are never flagged for checking in outside an office site.
alter table memberships add column attendance_remote boolean not null default false;

alter table workspaces add column attendance_require_selfie boolean not null default true;

-- One row per person per workday. The shift is copied at the first check-in, so
-- later changes to the shift don't rewrite history.
create table attendance_days (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  user_id          uuid not null references users(id) on delete cascade,
  work_date        date not null,
  shift_id         uuid references shifts(id) on delete set null,
  shift_name       text,
  scheduled_start  timestamptz,
  scheduled_end    timestamptz,
  -- { graceMinutes, fullDayMinutes, halfDayMinutes, breaks }
  policy           jsonb not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (workspace_id, user_id, work_date)
);
create index attendance_days_date_idx on attendance_days (workspace_id, work_date);
create trigger attendance_days_updated_at before update on attendance_days for each row execute function set_updated_at();

create type attendance_event_type as enum ('check_in', 'check_out', 'break_start', 'break_end');

create table attendance_events (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  day_id           uuid not null references attendance_days(id) on delete cascade,
  user_id          uuid not null references users(id) on delete cascade,
  type             attendance_event_type not null,
  -- When it happened (from the device for check-ins queued offline).
  occurred_at      timestamptz not null,
  received_at      timestamptz not null default now(),
  -- Set by the device so a retried or re-synced event is only recorded once.
  client_event_id  uuid,
  break_name       text,
  ip               inet,
  user_agent       text,
  device_id        text,
  latitude         double precision,
  longitude        double precision,
  accuracy_meters  real,
  -- null when the workspace has no sites, or the person is remote.
  in_zone          boolean,
  site_id          uuid references attendance_sites(id) on delete set null,
  -- outside_zone, no_location, offline
  flags            text[] not null default '{}',
  selfie_key       text,
  selfie_deleted_at timestamptz,
  unique (workspace_id, user_id, client_event_id)
);
create index attendance_events_day_idx on attendance_events (day_id, occurred_at);
create index attendance_events_selfie_idx on attendance_events (received_at) where selfie_key is not null;

do $$
declare t text;
begin
  foreach t in array array['shifts', 'attendance_sites', 'attendance_days', 'attendance_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy %I on %I for all using (workspace_id = app_workspace_id()) with check (workspace_id = app_workspace_id())',
      t || '_tenant', t
    );
  end loop;
end $$;

-- Selfies are kept for 30 days. The cleanup job runs outside any one workspace,
-- so it gets just the expired keys through this function and nothing else.
create or replace function expired_selfies(p_cutoff timestamptz, p_limit int)
returns table (id uuid, workspace_id uuid, selfie_key text)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.workspace_id, e.selfie_key
  from attendance_events e
  where e.selfie_key is not null and e.received_at < p_cutoff
  order by e.received_at
  limit least(p_limit, 1000)
$$;
revoke all on function expired_selfies(timestamptz, int) from public;
