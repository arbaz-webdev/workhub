-- Phase 2: quotes and invoices a workspace sends its own clients, and invoices made from
-- approved timesheet hours. (Not the WorkHub subscription invoices in "invoices".)

create table client_documents (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  kind           text not null check (kind in ('quote', 'invoice')),
  -- Q-0001 or INV-0001, counted per workspace and kind.
  number         text not null,
  company_id     uuid not null references companies(id),
  status         text not null default 'draft'
                 check (status in ('draft', 'sent', 'accepted', 'declined', 'paid', 'void')),
  currency       text not null,
  issue_date     date not null,
  -- Payment due (invoice) or valid until (quote).
  due_date       date,
  notes          text,
  tax_label      text,
  tax_rate       numeric(5, 2) not null default 0,
  subtotal       numeric(14, 2) not null default 0,
  tax_amount     numeric(14, 2) not null default 0,
  total          numeric(14, 2) not null default 0,
  -- The quote an invoice was made from.
  quote_id       uuid references client_documents(id) on delete set null,
  sent_at        timestamptz,
  paid_at        timestamptz,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, kind, number)
);
create index client_documents_list_idx on client_documents (workspace_id, kind, issue_date desc);
create index client_documents_company_idx on client_documents (workspace_id, company_id);
create trigger client_documents_updated_at before update on client_documents for each row execute function set_updated_at();

create table client_document_lines (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  document_id   uuid not null references client_documents(id) on delete cascade,
  position      smallint not null,
  description   text not null,
  quantity      numeric(10, 2) not null,
  unit_price    numeric(12, 2) not null,
  amount        numeric(14, 2) not null,
  -- Lines made from hours name their project.
  project_id    uuid references projects(id) on delete set null
);
create index client_document_lines_doc_idx on client_document_lines (document_id, position);

-- The next number for each workspace and kind.
create table client_document_counters (
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  kind          text not null,
  last_number   integer not null default 0,
  primary key (workspace_id, kind)
);

-- An hour is billed once: the invoice it went on. Cleared if that invoice is voided or deleted.
alter table time_entries add column invoice_id uuid references client_documents(id) on delete set null;
create index time_entries_unbilled_idx on time_entries (workspace_id, project_id, work_date) where invoice_id is null and billable;

do $$
declare t text;
begin
  foreach t in array array['client_documents', 'client_document_lines', 'client_document_counters'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy %I on %I for all using (workspace_id = app_workspace_id()) with check (workspace_id = app_workspace_id())',
      t || '_tenant', t
    );
  end loop;
end $$;
