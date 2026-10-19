-- Sprint 2: workspace settings, invitations and in-app notifications.

-- Workspace settings.
alter table workspaces
  add column timezone     text     not null default 'Asia/Karachi',
  add column currency     text     not null default 'PKR',
  -- ISO weekday numbers, 1 = Monday … 7 = Sunday.
  add column working_days smallint[] not null default '{1,2,3,4,5}';

-- Invitations: "email" invites are for one address and work once;
-- "link" invites can be used by anyone with the link until revoked or expired.
create type invitation_kind as enum ('email', 'link');

create table invitations (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind         invitation_kind not null,
  email        text,
  role         member_role not null,
  token_hash   text not null unique,
  invited_by   uuid references users(id) on delete set null,
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  accepted_by  uuid references users(id) on delete set null,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  check ((kind = 'email') = (email is not null)),
  check (role <> 'owner')
);
create index invitations_workspace_idx on invitations (workspace_id, created_at desc);

alter table invitations enable row level security;
alter table invitations force row level security;
create policy invitations_tenant on invitations for all
  using (workspace_id = app_workspace_id())
  with check (workspace_id = app_workspace_id());

-- Someone accepting an invitation is not a member yet, so they cannot see the
-- row through RLS. This narrow function resolves a token (by its hash) to the
-- few fields needed to show and accept the invite, and nothing else.
create or replace function invitation_by_token(p_token_hash text)
returns table (
  id uuid,
  workspace_id uuid,
  workspace_name text,
  kind invitation_kind,
  email text,
  role member_role,
  inviter_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.workspace_id, w.name, i.kind, i.email, i.role, u.name
  from invitations i
  join workspaces w on w.id = i.workspace_id
  left join users u on u.id = i.invited_by
  where i.token_hash = p_token_hash
    and i.revoked_at is null
    and i.accepted_at is null
    and i.expires_at > now()
$$;
revoke all on function invitation_by_token(text) from public;

-- Notifications belong to one person in one workspace.
create table notifications (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references users(id) on delete cascade,
  type         text not null,
  title        text not null,
  body         text,
  link         text,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, workspace_id, created_at desc);

alter table notifications enable row level security;
alter table notifications force row level security;
-- Anyone in the workspace may notify a colleague…
create policy notifications_insert on notifications for insert
  with check (workspace_id = app_workspace_id());
-- …but each person only sees and changes their own.
create policy notifications_own on notifications for select
  using (workspace_id = app_workspace_id() and user_id = app_user_id());
create policy notifications_own_update on notifications for update
  using (workspace_id = app_workspace_id() and user_id = app_user_id())
  with check (workspace_id = app_workspace_id() and user_id = app_user_id());
create policy notifications_own_delete on notifications for delete
  using (workspace_id = app_workspace_id() and user_id = app_user_id());
