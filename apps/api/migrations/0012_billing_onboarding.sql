-- Sprint 11: plans, invoices in PKR (paid by card/wallet through a gateway, or by
-- bank transfer that WorkHub approves), and onboarding.

create table subscriptions (
  workspace_id        uuid primary key references workspaces(id) on delete cascade,
  plan                text not null default 'free' check (plan in ('free', 'starter', 'business')),
  billing_cycle       text not null default 'monthly' check (billing_cycle in ('monthly', 'annual')),
  -- Paid up to and including this date; a few days' grace follow it.
  paid_until          date,
  trial_ends_at       timestamptz,
  -- Who the invoices are made out to.
  billing_name        text,
  billing_email       text,
  ntn                 text,
  province            text check (province is null or province in ('punjab', 'sindh', 'kp', 'balochistan', 'islamabad', 'gb', 'ajk', 'outside')),
  address             text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger subscriptions_updated_at before update on subscriptions for each row execute function set_updated_at();

-- Every workspace that exists today starts a two-week trial of everything.
insert into subscriptions (workspace_id, trial_ends_at)
select id, now() + interval '14 days' from workspaces
on conflict do nothing;

-- Invoice numbers run across all workspaces (WH-2027-000001), as tax rules expect.
create sequence invoice_number_seq;

create table invoices (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  number              text not null unique,
  status              text not null default 'open' check (status in ('open', 'pending_review', 'paid', 'void')),
  plan                text not null check (plan in ('starter', 'business')),
  billing_cycle       text not null check (billing_cycle in ('monthly', 'annual')),
  seats               integer not null check (seats > 0),
  unit_price          numeric(12, 2) not null,
  months              integer not null check (months > 0),
  subtotal            numeric(14, 2) not null,
  tax_label           text,
  tax_rate            numeric(5, 2) not null default 0,
  tax_amount          numeric(14, 2) not null default 0,
  total               numeric(14, 2) not null,
  currency            text not null default 'PKR',
  period_start        date not null,
  period_end          date not null,
  -- A copy of who it's made out to, as it was when issued.
  bill_to             jsonb not null,
  issued_at           timestamptz not null default now(),
  due_at              timestamptz not null,
  paid_at             timestamptz,
  payment_method      text check (payment_method is null or payment_method in ('card', 'wallet', 'bank_transfer', 'test')),
  -- The gateway's reference for the payment.
  provider_ref        text,
  -- Bank transfers: the customer's reference and receipt, and WorkHub's review.
  transfer_reference  text,
  transfer_proof_key  text,
  transfer_submitted_at timestamptz,
  reviewed_by         text,
  review_note         text,
  created_by          uuid references users(id) on delete set null
);
create index invoices_workspace_idx on invoices (workspace_id, issued_at desc);
create index invoices_review_idx on invoices (transfer_submitted_at) where status = 'pending_review';

alter table workspaces
  add column industry      text,
  add column onboarded_at  timestamptz;
-- Workspaces from before the wizard don't need it.
update workspaces set onboarded_at = now();

do $$
declare t text;
begin
  foreach t in array array['subscriptions', 'invoices'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy %I on %I for all using (workspace_id = app_workspace_id()) with check (workspace_id = app_workspace_id())',
      t || '_tenant', t
    );
  end loop;
end $$;

-- Bank transfers waiting for WorkHub's review, across workspaces, for the platform
-- admins' queue. Only ids come back; each invoice is then read in its own workspace.
create or replace function pending_bank_transfers(p_limit int)
returns table (id uuid, workspace_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.workspace_id from invoices i
  where i.status = 'pending_review'
  order by i.transfer_submitted_at
  limit least(p_limit, 500)
$$;
revoke all on function pending_bank_transfers(int) from public;

-- Finds the invoice a gateway's webhook is about, whatever workspace it's in.
create or replace function invoice_workspace(p_invoice uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select workspace_id from invoices where id = p_invoice
$$;
revoke all on function invoice_workspace(uuid) from public;
