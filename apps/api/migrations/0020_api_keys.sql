-- Phase 3: the public API. A workspace's API keys. A key acts as the admin who made it,
-- with that person's current role, so it stops working when they leave or lose admin.
-- (0019 is skipped: it was the Urdu interface's migration, parked in draft PR #121.)
create table api_keys (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  created_by   uuid not null references users(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  -- The first characters of the key, to tell keys apart. Only the hash of the whole key is kept.
  prefix       text not null,
  token_hash   text not null unique,
  access       text not null check (access in ('read', 'write')),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index api_keys_workspace_idx on api_keys (workspace_id, created_at desc);

alter table api_keys enable row level security;
alter table api_keys force row level security;
create policy api_keys_tenant on api_keys for all
  using (workspace_id = app_workspace_id())
  with check (workspace_id = app_workspace_id());

-- A request arrives with only the key, before any workspace is known. This resolves a key
-- (by its hash) to the few fields needed to check it, and nothing else.
create or replace function api_key_by_hash(p_token_hash text)
returns table (
  id uuid,
  workspace_id uuid,
  created_by uuid,
  access text
)
language sql
stable
security definer
set search_path = public
as $$
  select k.id, k.workspace_id, k.created_by, k.access
  from api_keys k
  where k.token_hash = p_token_hash
    and k.revoked_at is null
$$;
revoke all on function api_key_by_hash(text) from public;
