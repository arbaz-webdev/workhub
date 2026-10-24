-- Sprint 6: holidays, leave, attendance corrections, task timers and weekly
-- timesheets. Every new table is workspace-owned with RLS forced.

-- Public holidays (Pakistan's preloaded, with Islamic dates estimated until
-- announced) and the company's own.
create table holidays (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  date          date not null,
  name          text not null,
  kind          text not null default 'company' check (kind in ('public', 'company')),
  -- Moon-sighting dates are estimates until the government announces them.
  estimated     boolean not null default false,
  -- Set for preset holidays so loading a year twice doesn't duplicate them.
  preset_key    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, preset_key)
);
create index holidays_workspace_date_idx on holidays (workspace_id, date);
create trigger holidays_updated_at before update on holidays for each row execute function set_updated_at();

create table leave_types (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  name           text not null,
  paid           boolean not null default true,
  -- Days per year; null means no limit (e.g. unpaid leave).
  days_per_year  numeric(5, 1) check (days_per_year is null or days_per_year between 0 and 365),
  -- yearly: the whole year's days at once; monthly: a twelfth each month.
  accrual        text not null default 'yearly' check (accrual in ('yearly', 'monthly')),
  color          text not null default 'blue',
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index leave_types_name_idx on leave_types (workspace_id, lower(name)) where archived_at is null;
create trigger leave_types_updated_at before update on leave_types for each row execute function set_updated_at();

create type request_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create table leave_requests (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  user_id        uuid not null references users(id) on delete cascade,
  leave_type_id  uuid not null references leave_types(id),
  start_date     date not null,
  end_date       date not null,
  -- A single day can be half: the first or second half of the shift.
  half_day       text not null default 'none' check (half_day in ('none', 'first', 'second')),
  -- Working days taken (weekends and holidays excluded), worked out when requested.
  days           numeric(5, 1) not null check (days > 0),
  reason         text,
  status         request_status not null default 'pending',
  decided_by     uuid references users(id) on delete set null,
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (end_date >= start_date),
  check (half_day = 'none' or start_date = end_date),
  check (extract(year from start_date) = extract(year from end_date))
);
create index leave_requests_user_idx on leave_requests (workspace_id, user_id, start_date);
create index leave_requests_dates_idx on leave_requests (workspace_id, start_date, end_date) where status in ('pending', 'approved');
create trigger leave_requests_updated_at before update on leave_requests for each row execute function set_updated_at();

-- Manual changes to a balance: carry-over, leave already taken before joining, etc.
create table leave_adjustments (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  user_id        uuid not null references users(id) on delete cascade,
  leave_type_id  uuid not null references leave_types(id) on delete cascade,
  year           smallint not null,
  days           numeric(5, 1) not null check (days <> 0),
  reason         text not null,
  created_by     uuid references users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index leave_adjustments_user_idx on leave_adjustments (workspace_id, user_id, year);

-- Corrections replace a day's check-in and check-out. The events they replace
-- are kept (voided, not deleted) and copied into the audit log.
create table attendance_corrections (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  user_id        uuid not null references users(id) on delete cascade,
  work_date      date not null,
  check_in_at    timestamptz not null,
  check_out_at   timestamptz not null,
  reason         text not null,
  status         request_status not null default 'pending',
  requested_by   uuid references users(id) on delete set null,
  decided_by     uuid references users(id) on delete set null,
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (check_out_at > check_in_at),
  check (check_out_at - check_in_at <= interval '20 hours')
);
create index attendance_corrections_idx on attendance_corrections (workspace_id, status, work_date);
create trigger attendance_corrections_updated_at before update on attendance_corrections for each row execute function set_updated_at();

alter table attendance_events add column voided_at timestamptz;
alter table attendance_events add column voided_by uuid references attendance_corrections(id) on delete set null;

-- One running timer per person per workspace.
create table task_timers (
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  task_id       uuid not null references tasks(id) on delete cascade,
  started_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

alter table time_entries add column source text not null default 'manual' check (source in ('manual', 'timer'));
alter table time_entries add column started_at timestamptz;

-- A person's week (Monday to Sunday). Submitted and approved weeks are locked.
create table timesheets (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  user_id        uuid not null references users(id) on delete cascade,
  week_start     date not null check (extract(isodow from week_start) = 1),
  status         text not null check (status in ('submitted', 'approved', 'rejected')),
  submitted_at   timestamptz not null default now(),
  decided_by     uuid references users(id) on delete set null,
  decided_at     timestamptz,
  decision_note  text,
  unique (workspace_id, user_id, week_start)
);
create index timesheets_week_idx on timesheets (workspace_id, week_start, status);

do $$
declare t text;
begin
  foreach t in array array['holidays', 'leave_types', 'leave_requests', 'leave_adjustments', 'attendance_corrections', 'task_timers', 'timesheets'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy %I on %I for all using (workspace_id = app_workspace_id()) with check (workspace_id = app_workspace_id())',
      t || '_tenant', t
    );
  end loop;
end $$;
