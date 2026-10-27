-- Sprint 7: the inbox (channels, direct messages, threads, files), announcements
-- with read receipts, and in-app feedback. Every table is workspace-owned with
-- RLS forced; messages in private channels and DMs are also limited to their
-- members by the database, so even an admin can't read someone else's DMs.

create type chat_channel_kind as enum ('public', 'private', 'dm');

create table chat_channels (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  kind             chat_channel_kind not null,
  -- DMs have no name; channels do.
  name             text check (name is null or length(name) between 1 and 80),
  topic            text check (topic is null or length(topic) <= 250),
  -- The DM's members' ids, sorted and joined, so the same people share one conversation.
  dm_key           text,
  -- #general: everyone in the workspace (except guests) is in it.
  is_default       boolean not null default false,
  created_by       uuid references users(id) on delete set null,
  last_message_at  timestamptz,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((kind = 'dm') = (name is null)),
  check ((kind = 'dm') = (dm_key is not null)),
  check (not is_default or kind = 'public')
);
create unique index chat_channels_name_idx on chat_channels (workspace_id, lower(name)) where kind <> 'dm';
create unique index chat_channels_dm_idx on chat_channels (workspace_id, dm_key) where kind = 'dm';
create unique index chat_channels_default_idx on chat_channels (workspace_id) where is_default;
create trigger chat_channels_updated_at before update on chat_channels for each row execute function set_updated_at();

create table chat_members (
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  channel_id    uuid not null references chat_channels(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  -- Messages after this are unread.
  last_read_at  timestamptz not null default now(),
  muted         boolean not null default false,
  joined_at     timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create index chat_members_user_idx on chat_members (workspace_id, user_id);

create table chat_messages (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  channel_id     uuid not null references chat_channels(id) on delete cascade,
  author_id      uuid references users(id) on delete set null,
  -- Set on a thread reply: the message it replies to (always a top-level message).
  parent_id      uuid references chat_messages(id) on delete cascade,
  body           text not null check (length(body) <= 8000),
  -- People @mentioned (notified) and tasks shown as cards.
  mentions       uuid[] not null default '{}',
  task_ids       uuid[] not null default '{}',
  reply_count    integer not null default 0,
  last_reply_at  timestamptz,
  created_at     timestamptz not null default now(),
  edited_at      timestamptz,
  -- Deleted messages keep their place ("This message was deleted") but lose their text.
  deleted_at     timestamptz
);
create index chat_messages_channel_idx on chat_messages (channel_id, created_at desc) where parent_id is null;
create index chat_messages_thread_idx on chat_messages (parent_id, created_at) where parent_id is not null;

create table chat_files (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  channel_id    uuid not null references chat_channels(id) on delete cascade,
  message_id    uuid not null references chat_messages(id) on delete cascade,
  uploaded_by   uuid references users(id) on delete set null,
  file_name     text not null,
  content_type  text not null,
  size_bytes    integer not null,
  storage_key   text not null,
  created_at    timestamptz not null default now()
);
create index chat_files_message_idx on chat_files (message_id);

-- Announcements go to everyone, or to one team; reads are recorded for receipts.
create table announcements (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  author_id     uuid references users(id) on delete set null,
  team_id       uuid references teams(id) on delete set null,
  title         text not null check (length(title) between 1 and 150),
  body          text not null check (length(body) <= 10000),
  pinned        boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  edited_at     timestamptz
);
create index announcements_workspace_idx on announcements (workspace_id, created_at desc);
create trigger announcements_updated_at before update on announcements for each row execute function set_updated_at();

create table announcement_reads (
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  announcement_id  uuid not null references announcements(id) on delete cascade,
  user_id          uuid not null references users(id) on delete cascade,
  read_at          timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

-- Feedback from the in-app button, for the WorkHub team (read with the admin connection).
create table feedback (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  user_id       uuid references users(id) on delete set null,
  kind          text not null check (kind in ('idea', 'problem', 'praise')),
  message       text not null check (length(message) between 1 and 4000),
  page          text check (page is null or length(page) <= 300),
  user_agent    text,
  created_at    timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['chat_channels', 'chat_members', 'chat_messages', 'chat_files', 'announcements', 'announcement_reads', 'feedback'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
  foreach t in array array['chat_members', 'announcements', 'announcement_reads'] loop
    execute format(
      'create policy %I on %I for all using (workspace_id = app_workspace_id()) with check (workspace_id = app_workspace_id())',
      t || '_tenant', t
    );
  end loop;
end $$;

-- A channel is visible when it's public or the user is in it. (Guests are kept out of
-- public channels by the API; the database guarantees the private ones.)
create policy chat_channels_read on chat_channels for select
  using (workspace_id = app_workspace_id() and (
    kind = 'public'
    or exists (select 1 from chat_members m where m.channel_id = chat_channels.id and m.user_id = app_user_id())
  ));
create policy chat_channels_insert on chat_channels for insert
  with check (workspace_id = app_workspace_id());
create policy chat_channels_update on chat_channels for update
  using (workspace_id = app_workspace_id() and (
    kind = 'public'
    or exists (select 1 from chat_members m where m.channel_id = chat_channels.id and m.user_id = app_user_id())
  ))
  with check (workspace_id = app_workspace_id());

-- Messages and files follow their channel: the subquery is itself filtered by the policy above.
create policy chat_messages_member on chat_messages for all
  using (workspace_id = app_workspace_id() and exists (select 1 from chat_channels c where c.id = chat_messages.channel_id))
  with check (workspace_id = app_workspace_id() and exists (select 1 from chat_channels c where c.id = chat_messages.channel_id));
create policy chat_files_member on chat_files for all
  using (workspace_id = app_workspace_id() and exists (select 1 from chat_channels c where c.id = chat_files.channel_id))
  with check (workspace_id = app_workspace_id() and exists (select 1 from chat_channels c where c.id = chat_files.channel_id));

-- Feedback can be sent, and the sender can see their own; nobody else reads it through the app.
create policy feedback_insert on feedback for insert
  with check (workspace_id = app_workspace_id() and user_id = app_user_id());
create policy feedback_own on feedback for select
  using (workspace_id = app_workspace_id() and user_id = app_user_id());
