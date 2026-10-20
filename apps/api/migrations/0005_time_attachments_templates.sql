-- Sprint 4: logged time (actual hours), file attachments, project templates,
-- and budget-alert tracking. All workspace-owned with RLS forced.

-- Time logged against a task. Sprint 6 adds the live timer and weekly
-- timesheet approval on top of this table.
create table time_entries (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  task_id      uuid references tasks(id) on delete set null,
  user_id      uuid not null references users(id) on delete cascade,
  work_date    date not null,
  minutes      integer not null check (minutes > 0 and minutes <= 24 * 60),
  note         text,
  billable     boolean not null default true,
  created_at   timestamptz not null default now()
);
create index time_entries_task_idx on time_entries (task_id);
create index time_entries_project_idx on time_entries (project_id, work_date);
create index time_entries_user_idx on time_entries (user_id, work_date);

create table attachments (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  task_id      uuid not null references tasks(id) on delete cascade,
  uploaded_by  uuid references users(id) on delete set null,
  file_name    text not null,
  content_type text not null,
  size_bytes   integer not null check (size_bytes > 0),
  -- Where the bytes live in the storage driver (local disk or S3/R2).
  storage_key  text not null unique,
  created_at   timestamptz not null default now()
);
create index attachments_task_idx on attachments (task_id, created_at);

-- Saved "start from" structures: columns, labels and starter tasks as JSON.
create table project_templates (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null,
  description  text,
  structure    jsonb not null,
  created_by   uuid references users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index project_templates_workspace_idx on project_templates (workspace_id);

-- Highest budget threshold already announced (0, 80 or 100), so each alert
-- is sent once; reset when the budget changes.
alter table projects add column budget_alert_level smallint not null default 0;

do $$
declare t text;
begin
  foreach t in array array['time_entries', 'attachments', 'project_templates'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy %I on %I for all using (workspace_id = app_workspace_id()) with check (workspace_id = app_workspace_id())',
      t || '_tenant', t
    );
  end loop;
end $$;
