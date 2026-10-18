-- Foundations: users, sessions, workspaces, memberships, teams, audit log.
--
-- Tenant isolation: every workspace-owned table has Row-Level Security FORCED,
-- so even a query that forgets a WHERE clause only sees the current workspace.
-- The API sets two transaction-local settings before touching tenant data:
--   app.workspace_id  the workspace the request acts on
--   app.user_id       the signed-in user (lets a user list their own memberships)
-- With neither set, tenant tables return no rows.

create or replace function app_workspace_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.workspace_id', true), '')::uuid $$;

create or replace function app_user_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create or replace function set_updated_at() returns trigger
  language plpgsql
  as $$ begin new.updated_at = now(); return new; end $$;

-- Global tables (not tenant-scoped). Only the auth module reads them.

create table users (
  id                uuid primary key default gen_random_uuid(),
  email             text not null,
  name              text not null,
  password_hash     text not null,
  email_verified_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index users_email_key on users (lower(email));
create trigger users_updated_at before update on users for each row execute function set_updated_at();

create table sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  ip           text,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index sessions_user_id_idx on sessions (user_id);

-- Tenant tables.

create type member_role as enum ('owner', 'admin', 'manager', 'member', 'guest');

create table workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger workspaces_updated_at before update on workspaces for each row execute function set_updated_at();

create table memberships (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references users(id) on delete cascade,
  role         member_role not null default 'member',
  created_at   timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index memberships_user_id_idx on memberships (user_id);

create table teams (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null,
  created_by   uuid references users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index teams_workspace_id_idx on teams (workspace_id);
create trigger teams_updated_at before update on teams for each row execute function set_updated_at();

create table audit_logs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  actor_user_id uuid references users(id) on delete set null,
  action        text not null,
  entity_type   text,
  entity_id     uuid,
  metadata      jsonb not null default '{}'::jsonb,
  ip            text,
  created_at    timestamptz not null default now()
);
create index audit_logs_workspace_created_idx on audit_logs (workspace_id, created_at desc);

-- Row-Level Security.

alter table workspaces  enable row level security;
alter table workspaces  force row level security;
alter table memberships enable row level security;
alter table memberships force row level security;
alter table teams       enable row level security;
alter table teams       force row level security;
alter table audit_logs  enable row level security;
alter table audit_logs  force row level security;

-- A user sees their own memberships (to list and switch workspaces) and,
-- inside a workspace, all memberships of that workspace.
create policy memberships_read on memberships for select
  using (workspace_id = app_workspace_id() or user_id = app_user_id());
create policy memberships_write on memberships for all
  using (workspace_id = app_workspace_id())
  with check (workspace_id = app_workspace_id());

-- A user sees the current workspace and any workspace they belong to.
create policy workspaces_read on workspaces for select
  using (
    id = app_workspace_id()
    or exists (select 1 from memberships m where m.workspace_id = workspaces.id and m.user_id = app_user_id())
  );
create policy workspaces_write on workspaces for all
  using (id = app_workspace_id())
  with check (id = app_workspace_id());

create policy teams_tenant on teams for all
  using (workspace_id = app_workspace_id())
  with check (workspace_id = app_workspace_id());

create policy audit_logs_tenant on audit_logs for all
  using (workspace_id = app_workspace_id())
  with check (workspace_id = app_workspace_id());
