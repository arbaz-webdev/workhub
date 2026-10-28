-- Sprint 12: two-factor sign-in with an authenticator app (TOTP), recovery codes, and a
-- workspace switch that requires it of everyone. Like users and sessions, these belong
-- to a person, not a workspace, so they're outside RLS and only the auth code reads them.

-- A short-lived ticket between "password correct" and "code correct".
alter type auth_token_purpose add value if not exists 'two_factor';

create table user_totp (
  user_id      uuid primary key references users(id) on delete cascade,
  -- The shared secret, encrypted with TOTP_ENCRYPTION_KEY (AES-256-GCM): iv.tag.data, base64url.
  secret_enc   text not null,
  -- Null while being set up (scanned but not yet confirmed with a code).
  enabled_at   timestamptz,
  -- The last 30-second step a code was accepted for, so a code can't be used twice.
  last_step    bigint,
  created_at   timestamptz not null default now()
);

create table recovery_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  code_hash   text not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index recovery_codes_user_idx on recovery_codes (user_id) where used_at is null;

alter table workspaces add column require_two_factor boolean not null default false;
