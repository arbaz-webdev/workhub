-- Email verification and password-reset tokens, Google sign-in, and the
-- pre-launch waitlist. All global tables (not workspace-owned), so no RLS;
-- only the auth and waitlist modules read them.

create type auth_token_purpose as enum ('email_verification', 'password_reset');

create table auth_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  purpose    auth_token_purpose not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index auth_tokens_user_purpose_idx on auth_tokens (user_id, purpose);

-- Accounts created with Google have no password.
alter table users alter column password_hash drop not null;

create table oauth_accounts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(id) on delete cascade,
  provider         text not null,
  provider_user_id text not null,
  created_at       timestamptz not null default now(),
  unique (provider, provider_user_id)
);
create index oauth_accounts_user_id_idx on oauth_accounts (user_id);

create table waitlist (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  name            text not null,
  company         text not null,
  team_size       text not null,
  current_tools   text,
  biggest_problem text,
  monthly_spend   text,
  source          text,
  ip              text,
  created_at      timestamptz not null default now()
);
create unique index waitlist_email_key on waitlist (lower(email));
