-- Phase 2: the interface in Urdu. Each person picks their language; it follows them across devices.
alter table users add column locale text not null default 'en' check (locale in ('en', 'ur'));
