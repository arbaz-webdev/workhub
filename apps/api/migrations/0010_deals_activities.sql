-- Sprint 9: pipelines and deals, activities with reminders, and won deals that
-- become projects. Every table is workspace-owned with RLS forced.

create table pipelines (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  name          text not null check (length(name) between 1 and 80),
  is_default    boolean not null default false,
  position      integer not null default 0,
  archived_at   timestamptz,
  created_at    timestamptz not null default now()
);
create unique index pipelines_default_idx on pipelines (workspace_id) where is_default and archived_at is null;
create unique index pipelines_name_idx on pipelines (workspace_id, lower(name)) where archived_at is null;

create table pipeline_stages (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  pipeline_id   uuid not null references pipelines(id) on delete cascade,
  name          text not null check (length(name) between 1 and 60),
  -- Chance of winning a deal at this stage, for the weighted forecast.
  probability   smallint not null default 0 check (probability between 0 and 100),
  -- Every pipeline ends in one won and one lost stage.
  kind          text not null default 'open' check (kind in ('open', 'won', 'lost')),
  position      integer not null default 0
);
create index pipeline_stages_pipeline_idx on pipeline_stages (pipeline_id, position);

create table deals (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  pipeline_id     uuid not null references pipelines(id),
  stage_id        uuid not null references pipeline_stages(id),
  title           text not null check (length(title) between 1 and 150),
  value           numeric(14, 2) check (value is null or value >= 0),
  currency        text not null default 'PKR',
  company_id      uuid references companies(id) on delete set null,
  contact_id      uuid references contacts(id) on delete set null,
  lead_id         uuid references leads(id) on delete set null,
  owner_id        uuid references users(id) on delete set null,
  expected_close  date,
  status          text not null default 'open' check (status in ('open', 'won', 'lost')),
  won_at          timestamptz,
  lost_at         timestamptz,
  lost_reason     text,
  -- The project created when it was won.
  project_id      uuid references projects(id) on delete set null,
  -- Order within its stage on the board.
  position        double precision not null default 0,
  notes           text,
  created_by      uuid references users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index deals_board_idx on deals (pipeline_id, stage_id, position) where deleted_at is null;
create index deals_company_idx on deals (company_id) where deleted_at is null;
create trigger deals_updated_at before update on deals for each row execute function set_updated_at();

-- Calls, meetings, emails, WhatsApp chats, notes and to-dos, on a deal, company, contact
-- or lead. One with a due time is a follow-up: its owner is reminded when it's due.
create table activities (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  kind          text not null check (kind in ('call', 'meeting', 'email', 'whatsapp', 'note', 'task')),
  subject       text not null check (length(subject) between 1 and 200),
  body          text check (body is null or length(body) <= 5000),
  due_at        timestamptz,
  done_at       timestamptz,
  deal_id       uuid references deals(id) on delete cascade,
  company_id    uuid references companies(id) on delete cascade,
  contact_id    uuid references contacts(id) on delete cascade,
  lead_id       uuid references leads(id) on delete cascade,
  owner_id      uuid references users(id) on delete set null,
  -- When the due reminder went out, so it's sent once.
  reminded_at   timestamptz,
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index activities_deal_idx on activities (deal_id, created_at desc);
create index activities_company_idx on activities (company_id, created_at desc);
create index activities_contact_idx on activities (contact_id, created_at desc);
create index activities_lead_idx on activities (lead_id, created_at desc);
create index activities_due_idx on activities (due_at) where done_at is null and due_at is not null;
create trigger activities_updated_at before update on activities for each row execute function set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['pipelines', 'pipeline_stages', 'deals', 'activities'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy %I on %I for all using (workspace_id = app_workspace_id()) with check (workspace_id = app_workspace_id())',
      t || '_tenant', t
    );
  end loop;
end $$;

-- Follow-ups that are due and haven't been reminded yet, across all workspaces, for the
-- reminder job. It returns only what a reminder needs; the reminder itself is written
-- inside the activity's own workspace, so RLS still applies there.
create or replace function due_follow_ups(p_now timestamptz, p_limit int)
returns table (id uuid, workspace_id uuid, owner_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.workspace_id, a.owner_id
  from activities a
  where a.done_at is null and a.reminded_at is null and a.due_at is not null and a.due_at <= p_now
    and a.owner_id is not null
  order by a.due_at
  limit least(p_limit, 1000)
$$;
revoke all on function due_follow_ups(timestamptz, int) from public;
