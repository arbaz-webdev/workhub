-- Sprint 8: the CRM core. Companies grow from a bare client list into full records;
-- contacts and leads arrive, with custom fields and CSV imports. Every table is
-- workspace-owned with RLS forced.

alter table companies
  add column website    text,
  -- Lower-case host of the website (or of a company email), for spotting duplicates.
  add column domain     text,
  add column email      text,
  add column phone      text,
  -- Digits only, with the country code (03001234567 → 923001234567), for duplicates.
  add column phone_key  text,
  add column industry   text,
  add column city       text,
  add column country    text,
  add column address    text,
  add column notes      text,
  add column owner_id   uuid references users(id) on delete set null,
  -- Values of the workspace's custom fields, by field key.
  add column custom     jsonb not null default '{}';
create index companies_domain_idx on companies (workspace_id, domain) where deleted_at is null;

create table contacts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  company_id    uuid references companies(id) on delete set null,
  first_name    text not null check (length(first_name) between 1 and 100),
  last_name     text check (last_name is null or length(last_name) <= 100),
  email         text,
  phone         text,
  phone_key     text,
  title         text,
  notes         text,
  owner_id      uuid references users(id) on delete set null,
  -- The lead it came from, when converted.
  lead_id       uuid,
  custom        jsonb not null default '{}',
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index contacts_workspace_idx on contacts (workspace_id, lower(first_name)) where deleted_at is null;
create index contacts_email_idx on contacts (workspace_id, lower(email)) where deleted_at is null;
create index contacts_phone_idx on contacts (workspace_id, phone_key) where deleted_at is null;
create index contacts_company_idx on contacts (company_id) where deleted_at is null;
create trigger contacts_updated_at before update on contacts for each row execute function set_updated_at();

create table leads (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references workspaces(id) on delete cascade,
  name                  text not null check (length(name) between 1 and 150),
  company_name          text,
  email                 text,
  phone                 text,
  phone_key             text,
  -- Where it came from: Upwork, Fiverr, LinkedIn, WhatsApp, a referral, the website…
  source                text not null default 'other' check (source in ('upwork', 'fiverr', 'linkedin', 'whatsapp', 'referral', 'website', 'facebook', 'instagram', 'cold_call', 'event', 'other')),
  -- e.g. who referred them, or the Upwork job link.
  source_detail         text,
  status                text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'unqualified', 'converted')),
  value                 numeric(14, 2) check (value is null or value >= 0),
  currency              text not null default 'PKR',
  notes                 text,
  owner_id              uuid references users(id) on delete set null,
  custom                jsonb not null default '{}',
  converted_contact_id  uuid references contacts(id) on delete set null,
  converted_company_id  uuid references companies(id) on delete set null,
  converted_at          timestamptz,
  created_by            uuid references users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);
create index leads_workspace_idx on leads (workspace_id, status, created_at desc) where deleted_at is null;
create index leads_email_idx on leads (workspace_id, lower(email)) where deleted_at is null;
create index leads_phone_idx on leads (workspace_id, phone_key) where deleted_at is null;
create trigger leads_updated_at before update on leads for each row execute function set_updated_at();
alter table contacts add constraint contacts_lead_fk foreign key (lead_id) references leads(id) on delete set null;

-- Extra fields a workspace adds to its companies, contacts or leads.
create table custom_fields (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  entity        text not null check (entity in ('company', 'contact', 'lead')),
  -- Stable key the values are stored under; the label can change.
  key           text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label         text not null check (length(label) between 1 and 60),
  type          text not null check (type in ('text', 'number', 'date', 'select', 'checkbox', 'url')),
  options       text[] not null default '{}',
  position      integer not null default 0,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (workspace_id, entity, key)
);

-- A record of each CSV import and what happened to each row.
create table crm_imports (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  entity         text not null check (entity in ('company', 'contact', 'lead')),
  file_name      text not null,
  mode           text not null check (mode in ('skip', 'update', 'create')),
  created_count  integer not null default 0,
  updated_count  integer not null default 0,
  skipped_count  integer not null default 0,
  failed_count   integer not null default 0,
  -- [{ row, message }] for rows that were skipped or failed.
  problems       jsonb not null default '[]',
  created_by     uuid references users(id) on delete set null,
  created_at     timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['contacts', 'leads', 'custom_fields', 'crm_imports'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy %I on %I for all using (workspace_id = app_workspace_id()) with check (workspace_id = app_workspace_id())',
      t || '_tenant', t
    );
  end loop;
end $$;
