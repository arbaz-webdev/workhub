-- Sprint 3: clients, projects, Kanban columns, tasks, labels, checklists,
-- comments and task activity. Every table is workspace-owned with RLS forced.

-- Minimal client list for now; the CRM (sprint 8) extends this table.
create table companies (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null,
  created_by   uuid references users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index companies_workspace_idx on companies (workspace_id, lower(name));
create trigger companies_updated_at before update on companies for each row execute function set_updated_at();

create type project_status as enum ('active', 'on_hold', 'completed', 'archived');

create table projects (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  name          text not null,
  description   text,
  client_id     uuid references companies(id) on delete set null,
  status        project_status not null default 'active',
  budget_hours  numeric(10, 2),
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index projects_workspace_idx on projects (workspace_id, status);
create trigger projects_updated_at before update on projects for each row execute function set_updated_at();

-- Who works on a project. Members and above see every project in the
-- workspace; guests only see projects they are added to.
create table project_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  user_id      uuid not null references users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on project_members (user_id);

-- Positions are floating-point so a card can be placed between two others
-- without renumbering the whole column.
create table board_columns (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  name         text not null,
  position     double precision not null,
  wip_limit    integer check (wip_limit is null or wip_limit > 0),
  created_at   timestamptz not null default now()
);
create index board_columns_project_idx on board_columns (project_id, position);

create type task_priority as enum ('none', 'low', 'medium', 'high', 'urgent');

create table tasks (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  project_id     uuid not null references projects(id) on delete cascade,
  column_id      uuid not null references board_columns(id) on delete restrict,
  parent_task_id uuid references tasks(id) on delete cascade,
  title          text not null,
  description    text,
  priority       task_priority not null default 'none',
  due_date       date,
  estimate_hours numeric(8, 2),
  position       double precision not null,
  created_by     uuid references users(id) on delete set null,
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index tasks_board_idx on tasks (column_id, position) where deleted_at is null and parent_task_id is null;
create index tasks_project_idx on tasks (project_id) where deleted_at is null;
create index tasks_parent_idx on tasks (parent_task_id) where parent_task_id is not null;
create trigger tasks_updated_at before update on tasks for each row execute function set_updated_at();

create table task_assignees (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  task_id      uuid not null references tasks(id) on delete cascade,
  user_id      uuid not null references users(id) on delete cascade,
  primary key (task_id, user_id)
);
create index task_assignees_user_idx on task_assignees (user_id);

create table labels (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  name         text not null,
  color        text not null
);
create index labels_project_idx on labels (project_id);

create table task_labels (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  task_id      uuid not null references tasks(id) on delete cascade,
  label_id     uuid not null references labels(id) on delete cascade,
  primary key (task_id, label_id)
);

create table checklist_items (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  task_id      uuid not null references tasks(id) on delete cascade,
  text         text not null,
  done         boolean not null default false,
  position     double precision not null,
  created_at   timestamptz not null default now()
);
create index checklist_items_task_idx on checklist_items (task_id, position);

create table task_comments (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  task_id      uuid not null references tasks(id) on delete cascade,
  author_id    uuid references users(id) on delete set null,
  body         text not null,
  mentions     uuid[] not null default '{}',
  created_at   timestamptz not null default now(),
  edited_at    timestamptz,
  deleted_at   timestamptz
);
create index task_comments_task_idx on task_comments (task_id, created_at);

create table task_activity (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  task_id      uuid not null references tasks(id) on delete cascade,
  actor_id     uuid references users(id) on delete set null,
  type         text not null,
  data         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index task_activity_task_idx on task_activity (task_id, created_at);

-- Row-Level Security: one policy shape for every table above.
do $$
declare t text;
begin
  foreach t in array array[
    'companies', 'projects', 'project_members', 'board_columns', 'tasks', 'task_assignees',
    'labels', 'task_labels', 'checklist_items', 'task_comments', 'task_activity'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy %I on %I for all using (workspace_id = app_workspace_id()) with check (workspace_id = app_workspace_id())',
      t || '_tenant', t
    );
  end loop;
end $$;
