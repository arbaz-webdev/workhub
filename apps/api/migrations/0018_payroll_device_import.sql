-- Phase 2: payroll export templates and fingerprint-device (ZKTeco) attendance import.

-- The number payroll software knows someone by, and their user number on the attendance device.
alter table memberships add column employee_code text, add column device_user_id text;
create unique index memberships_employee_code_idx on memberships (workspace_id, employee_code) where employee_code is not null;
create unique index memberships_device_user_idx on memberships (workspace_id, device_user_id) where device_user_id is not null;

-- A workspace's own export layouts: which summary columns, in what order, under what headings.
create table payroll_templates (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  name          text not null,
  columns       jsonb not null,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, name)
);
create trigger payroll_templates_updated_at before update on payroll_templates for each row execute function set_updated_at();
alter table payroll_templates enable row level security;
alter table payroll_templates force row level security;
create policy payroll_templates_tenant on payroll_templates for all
  using (workspace_id = app_workspace_id()) with check (workspace_id = app_workspace_id());
