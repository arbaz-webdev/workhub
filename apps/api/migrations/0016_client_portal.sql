-- Phase 2: client portal. A guest can be a client's contact; they see that client's
-- shared projects, approved hours, and the quotes and invoices sent to it.

-- The client this guest is a contact of. Only guests have one (the API makes sure).
alter table memberships add column client_company_id uuid references companies(id) on delete set null;
create index memberships_client_idx on memberships (workspace_id, client_company_id) where client_company_id is not null;

-- An invitation to be a client's contact carries the client.
alter table invitations add column client_company_id uuid references companies(id) on delete cascade;

-- Projects shown on their client's portal. Off until someone chooses to share.
alter table projects add column portal_visible boolean not null default false;
