create schema if not exists app;
revoke all on schema app from public, anon, authenticated;

do $$ begin
  if not exists (select from pg_roles where rolname = 'app_api') then
    create role app_api login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
end $$;
grant usage on schema app, auth to app_api;
grant execute on function auth.uid() to app_api;

create table app.profile (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);
create table app.journey (
  id uuid primary key,
  owner_id uuid not null references app.profile(owner_id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  intention text not null check (length(intention) <= 2000),
  state text not null default 'draft' check (state in ('draft','active','archived')),
  revision integer not null default 0 check (revision >= 0),
  draft jsonb not null check (jsonb_typeof(draft) = 'object'),
  active_schedule_version_id uuid,
  created_at timestamptz not null,
  unique (id, owner_id)
);
create index journey_owner on app.journey(owner_id, created_at desc);
create table app.schedule_version (
  id uuid primary key,
  journey_id uuid not null,
  owner_id uuid not null,
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  created_at timestamptz not null,
  unique(id, journey_id, owner_id),
  foreign key(journey_id, owner_id) references app.journey(id, owner_id) on delete cascade
);
alter table app.journey add constraint active_version_owner foreign key(active_schedule_version_id, id, owner_id) references app.schedule_version(id, journey_id, owner_id) deferrable initially deferred;
create table app.practice_version (
  id uuid not null,
  schedule_version_id uuid not null,
  journey_id uuid not null,
  owner_id uuid not null,
  label text not null check(length(label) between 1 and 120),
  position integer not null check(position >= 0),
  kind text not null check(kind in ('checkbox','repetitions','minutes')),
  target integer,
  primary key(id, schedule_version_id),
  unique(id, schedule_version_id, journey_id, owner_id),
  unique(schedule_version_id, position),
  check ((kind = 'checkbox' and target is null) or (kind in ('repetitions','minutes') and target between 1 and 1000000)),
  foreign key(schedule_version_id, journey_id, owner_id) references app.schedule_version(id, journey_id, owner_id) on delete cascade
);
create table app.session (
  id uuid primary key,
  journey_id uuid not null,
  owner_id uuid not null,
  schedule_version_id uuid not null,
  ordinal integer not null check(ordinal > 0),
  practice_date date not null,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  time_zone text not null,
  attribution text not null check(attribution in ('civil','previous_evening')),
  adjustment text,
  confirmed boolean not null default false,
  performed_at timestamptz,
  recorded_at timestamptz,
  revision integer not null default 0 check(revision >= 0),
  superseded_at timestamptz,
  unique(id, schedule_version_id, journey_id, owner_id),
  check(closes_at > opens_at and closes_at - opens_at < interval '24 hours'),
  check((confirmed and performed_at is not null and recorded_at is not null and performed_at >= opens_at and performed_at <= recorded_at) or (not confirmed and performed_at is null and recorded_at is null)),
  foreign key(schedule_version_id, journey_id, owner_id) references app.schedule_version(id, journey_id, owner_id) on delete cascade
);
create unique index session_active_date on app.session(journey_id, practice_date) where superseded_at is null;
create unique index session_active_ordinal on app.session(journey_id, ordinal) where superseded_at is null;
create index session_owner_open on app.session(owner_id, opens_at);
create table app.session_practice (
  session_id uuid not null,
  practice_id uuid not null,
  schedule_version_id uuid not null,
  journey_id uuid not null,
  owner_id uuid not null,
  kind text not null check(kind in ('checkbox','repetitions','minutes')),
  checkbox_value boolean,
  numeric_value integer,
  primary key(session_id, practice_id),
  check((kind = 'checkbox' and checkbox_value is not null and numeric_value is null) or (kind in ('repetitions','minutes') and checkbox_value is null and numeric_value between 0 and 1000000)),
  foreign key(session_id, schedule_version_id, journey_id, owner_id) references app.session(id, schedule_version_id, journey_id, owner_id) on delete cascade,
  foreign key(practice_id, schedule_version_id, journey_id, owner_id) references app.practice_version(id, schedule_version_id, journey_id, owner_id)
);
create table app.amendment (
  id uuid primary key,
  owner_id uuid not null,
  journey_id uuid not null,
  session_id uuid not null,
  schedule_version_id uuid not null,
  kind text not null check(kind in ('values_saved','confirmed','completion_removed','closed')),
  recorded_at timestamptz not null,
  detail jsonb not null,
  foreign key(session_id, schedule_version_id, journey_id, owner_id) references app.session(id, schedule_version_id, journey_id, owner_id) on delete cascade
);
create table app.operation_receipt (
  owner_id uuid not null references app.profile(owner_id) on delete cascade,
  operation_id uuid not null,
  operation_type text not null,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key(owner_id, operation_id)
);

do $$ declare tab text; begin
  foreach tab in array array['profile','journey','schedule_version','practice_version','session','session_practice','amendment','operation_receipt'] loop
    execute format('alter table app.%I enable row level security', tab);
    execute format('create policy owner_access on app.%I for all to app_api using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', tab);
    execute format('revoke all on app.%I from public, anon, authenticated', tab);
    execute format('grant select, insert, update, delete on app.%I to app_api', tab);
  end loop;
end $$;
revoke all on all functions in schema app from public, anon, authenticated;
alter default privileges in schema app revoke all on tables from public, anon, authenticated;
alter default privileges in schema app revoke execute on functions from public, anon, authenticated;
