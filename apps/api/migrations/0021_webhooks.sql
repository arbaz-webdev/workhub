-- Phase 3: webhooks. A workspace's webhooks, and an outbox of deliveries: an event writes
-- its deliveries in the same transaction as the change, and a worker sends them, retrying
-- failures for about a day.
create table webhooks (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  created_by       uuid references users(id) on delete set null,
  url              text not null,
  events           text[] not null,
  -- The signing secret, encrypted (AES-256-GCM under TOTP_ENCRYPTION_KEY): it's needed to sign.
  secret_encrypted text not null,
  paused_at        timestamptz,
  paused_reason    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index webhooks_workspace_idx on webhooks (workspace_id);

create table webhook_deliveries (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  webhook_id      uuid not null references webhooks(id) on delete cascade,
  event           text not null,
  payload         jsonb not null,
  status          text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_status     integer,
  last_error      text,
  delivered_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index webhook_deliveries_due_idx on webhook_deliveries (next_attempt_at) where status = 'pending';
create index webhook_deliveries_webhook_idx on webhook_deliveries (webhook_id, created_at desc);

alter table webhooks enable row level security;
alter table webhooks force row level security;
create policy webhooks_tenant on webhooks for all
  using (workspace_id = app_workspace_id())
  with check (workspace_id = app_workspace_id());

alter table webhook_deliveries enable row level security;
alter table webhook_deliveries force row level security;
create policy webhook_deliveries_tenant on webhook_deliveries for all
  using (workspace_id = app_workspace_id())
  with check (workspace_id = app_workspace_id());

-- The worker runs across workspaces: this finds what's due (ids only); each delivery is
-- then claimed and sent inside its own workspace's context. Paused webhooks wait.
create or replace function due_webhook_deliveries(p_now timestamptz, p_limit int)
returns table (id uuid, workspace_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.workspace_id
  from webhook_deliveries d
  join webhooks w on w.id = d.webhook_id
  where d.status = 'pending' and d.next_attempt_at <= p_now and w.paused_at is null
  order by d.next_attempt_at
  limit least(p_limit, 500)
$$;
revoke all on function due_webhook_deliveries(timestamptz, int) from public;

-- Finished deliveries are kept for 30 days, for the delivery log.
create or replace function prune_webhook_deliveries(p_before timestamptz)
returns integer
language sql
volatile
security definer
set search_path = public
as $$
  with gone as (
    delete from webhook_deliveries where status <> 'pending' and created_at < p_before returning 1
  )
  select count(*)::int from gone
$$;
revoke all on function prune_webhook_deliveries(timestamptz) from public;
