-- Prelaunch only: timestamp/UUID ordering cannot prove the causal order of legacy history.
-- Preserve unknown data by refusing migration. Reset ONLY marked synthetic fixtures via
-- the guarded M1 seed before applying; a populated real database requires an audited upgrade.
do $$ begin
  if exists(select from app.amendment) or exists(select from app.session where revision <> 0) then
    raise exception 'M3 requires an empty legacy practice history; preserve data and follow D15';
  end if;
end $$;

alter table app.amendment drop constraint amendment_kind_check;
alter table app.amendment add constraint amendment_kind_check
  check(kind in ('values_saved','confirmed','completion_corrected','completion_removed'));
alter table app.amendment add column session_revision integer not null check(session_revision > 0);
alter table app.amendment add constraint amendment_session_revision unique(session_id, session_revision);
alter table app.amendment add constraint amendment_owned_revision
  unique(id,session_id,schedule_version_id,journey_id,owner_id,session_revision);

create table app.notification_event (
  id uuid primary key,
  owner_id uuid not null,
  journey_id uuid not null,
  session_id uuid not null,
  schedule_version_id uuid not null,
  amendment_id uuid,
  kind text not null check(kind in ('session_closed','session_corrected')),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null check(recorded_at >= occurred_at),
  session_revision integer not null check(session_revision >= 0),
  detail jsonb not null check(jsonb_typeof(detail) = 'object'),
  check((kind='session_closed' and amendment_id is null) or
        (kind='session_corrected' and amendment_id is not null)),
  foreign key(session_id,schedule_version_id,journey_id,owner_id)
    references app.session(id,schedule_version_id,journey_id,owner_id) on delete cascade,
  foreign key(amendment_id,session_id,schedule_version_id,journey_id,owner_id,session_revision)
    references app.amendment(id,session_id,schedule_version_id,journey_id,owner_id,session_revision) on delete cascade
);
create unique index notification_event_closure on app.notification_event(session_id) where kind='session_closed';
create unique index notification_event_amendment on app.notification_event(amendment_id) where amendment_id is not null;
create index notification_event_owner_time on app.notification_event(owner_id,recorded_at desc,id desc);
create index notification_event_session_time on app.notification_event(session_id,occurred_at,id);

create table app.reflection (
  session_id uuid primary key,
  schedule_version_id uuid not null,
  journey_id uuid not null,
  owner_id uuid not null,
  text text not null check(length(text) <= 20000),
  revision integer not null check(revision > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null check(updated_at >= created_at),
  unique(session_id,schedule_version_id,journey_id,owner_id),
  foreign key(session_id,schedule_version_id,journey_id,owner_id)
    references app.session(id,schedule_version_id,journey_id,owner_id) on delete cascade
);
create table app.reflection_mood (
  session_id uuid not null,
  schedule_version_id uuid not null,
  journey_id uuid not null,
  owner_id uuid not null,
  position smallint not null check(position between 0 and 4),
  label text not null check(length(label) between 1 and 40 and label=btrim(label)),
  primary key(session_id,position),
  unique(session_id,label),
  foreign key(session_id,schedule_version_id,journey_id,owner_id)
    references app.reflection(session_id,schedule_version_id,journey_id,owner_id) on delete cascade
);
create index reflection_owner_updated on app.reflection(owner_id,updated_at desc,session_id);
create index reflection_owner_journey on app.reflection(owner_id,journey_id,session_id);
create index reflection_mood_owner_label on app.reflection_mood(owner_id,label,session_id);

alter table app.profile add column reflection_prompts text[] not null default '{}'
  check(reflection_prompts <@ array['noticed','carry_tomorrow']::text[]
    and cardinality(reflection_prompts) <= 2
    and array_position(reflection_prompts,null) is null);
grant update(reflection_prompts) on app.profile to app_api;

do $$ declare tab text; begin
  foreach tab in array array['notification_event','reflection','reflection_mood'] loop
    execute format('alter table app.%I enable row level security', tab);
    execute format('alter table app.%I force row level security', tab);
    execute format('create policy owner_access on app.%I for all to app_api using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', tab);
    execute format('revoke all on app.%I from public, anon, authenticated', tab);
    execute format('grant select, insert on app.%I to app_api', tab);
  end loop;
end $$;
grant update(text,revision,updated_at) on app.reflection to app_api;
grant delete on app.reflection_mood to app_api;
