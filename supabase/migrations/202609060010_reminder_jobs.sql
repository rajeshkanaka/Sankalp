-- App and worker logins execute narrowly scoped functions. Neither owns tables.
do $$ begin
  if not exists(select from pg_roles where rolname='app_worker') then
    create role app_worker login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
  if not exists(select from pg_roles where rolname='app_reminder_owner') then
    create role app_reminder_owner nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
  if exists(select from pg_roles where rolname in ('app_worker','app_reminder_owner')
    and (rolsuper or rolcreatedb or rolcreaterole or rolinherit or rolreplication or rolbypassrls))
    or exists(select from pg_auth_members where member in ('app_worker'::regrole,'app_reminder_owner'::regrole))
    or exists(select from pg_roles where rolname='app_reminder_owner' and rolcanlogin)
    or exists(select from pg_roles where rolname='app_worker' and not rolcanlogin)
    or exists(select from pg_roles where rolname in ('app_api','app_worker','anon','authenticated','service_role','authenticator')
      and pg_has_role(oid,'app_reminder_owner'::regrole,'MEMBER'))
    or exists(select from pg_class where relnamespace='app'::regnamespace
      and relowner in ('app_worker'::regrole,'app_reminder_owner'::regrole))
    or exists(select from pg_namespace where oid='app'::regnamespace
      and nspowner in ('app_worker'::regrole,'app_reminder_owner'::regrole)) then
    raise exception 'Reminder roles must remain restricted';
  end if;
end $$;
grant usage on schema app to app_worker,app_reminder_owner;
grant usage on schema auth to app_reminder_owner;
grant execute on function auth.uid() to app_reminder_owner;
grant execute on function app.valid_reminder_preferences(jsonb) to app_reminder_owner;

create table app.push_subscription (
  id uuid primary key,
  owner_id uuid not null references app.profile(owner_id) on delete cascade,
  generation integer not null default 1 check(generation > 0),
  endpoint text not null check(length(endpoint) between 1 and 4096),
  endpoint_hash text not null check(endpoint_hash ~ '^[a-f0-9]{64}$'),
  p256dh text not null check(length(p256dh) between 80 and 100),
  auth_key text not null check(length(auth_key) between 20 and 30),
  device_label text not null check(length(device_label) between 1 and 80),
  created_at timestamptz not null,
  updated_at timestamptz not null check(updated_at >= created_at),
  revoked_at timestamptz check(revoked_at is null or revoked_at >= created_at),
  last_result text check(last_result in ('accepted','subscription_gone','failed','uncertain')),
  unique(id,owner_id)
);
create unique index push_subscription_active_endpoint on app.push_subscription(endpoint_hash)
  where revoked_at is null;
create index push_subscription_owner on app.push_subscription(owner_id,id);

create table app.reminder_job (
  id uuid primary key,
  owner_id uuid not null references app.profile(owner_id) on delete cascade,
  journey_id uuid,
  session_id uuid,
  schedule_version_id uuid,
  subscription_id uuid not null,
  reminder_revision integer,
  subscription_generation integer not null check(subscription_generation > 0),
  kind text not null check(kind in ('offset','snooze','test')),
  offset_minutes integer check(offset_minutes between -1440 and 0),
  operation_id uuid,
  scheduled_at timestamptz not null,
  expires_at timestamptz not null check(expires_at > scheduled_at and expires_at <= scheduled_at+interval '5 minutes'),
  next_attempt_at timestamptz not null check(next_attempt_at >= scheduled_at),
  state text not null check(state in ('pending','leased','dispatching','accepted','failed','uncertain','suppressed','canceled','expired')),
  attempts integer not null default 0 check(attempts between 0 and 3),
  lease_token uuid,
  lease_until timestamptz,
  dispatch_started_at timestamptz,
  cancel_requested_at timestamptz,
  safe_reason text check(safe_reason in ('preferences_changed','subscription_changed','completed','superseded',
    'archived','account_disabled','quiet_hours','deadline','expired','invalid_input','endpoint_blocked',
    'provider_rejected','subscription_gone','dns_failure','network_before_send','provider_retry','tls_rejected',
    'timeout','aborted','network','invalid_response','snoozed','retry_exhausted','canceled')),
  created_at timestamptz not null,
  unique(id,owner_id),
  unique(id,owner_id,subscription_id),
  check((kind='offset' and offset_minutes is not null and operation_id is null)
    or (kind in ('snooze','test') and offset_minutes is null and operation_id is not null)),
  check((kind='test' and journey_id is null and session_id is null and schedule_version_id is null and reminder_revision is null)
    or (kind<>'test' and journey_id is not null and session_id is not null and schedule_version_id is not null and reminder_revision is not null and reminder_revision >= 0)),
  check((lease_token is null)=(lease_until is null)),
  check(state not in ('leased','dispatching') or (lease_token is not null and lease_until is not null)),
  check(state not in ('dispatching','accepted') or (attempts > 0 and dispatch_started_at is not null)),
  foreign key(session_id,schedule_version_id,journey_id,owner_id)
    references app.session(id,schedule_version_id,journey_id,owner_id) on delete cascade,
  foreign key(subscription_id,owner_id) references app.push_subscription(id,owner_id) on delete cascade
);
create unique index reminder_job_offset_identity on app.reminder_job
  (session_id,schedule_version_id,reminder_revision,subscription_id,subscription_generation,offset_minutes)
  where kind='offset';
create unique index reminder_job_operation_identity on app.reminder_job
  (owner_id,operation_id,subscription_id,subscription_generation) where kind in ('snooze','test');
create index reminder_job_due on app.reminder_job(next_attempt_at,id) where state in ('pending','leased','dispatching');
create index reminder_job_session on app.reminder_job(session_id,id);
create index reminder_job_subscription on app.reminder_job(subscription_id,id);

-- Keep one closure/correction stream while adding worker-owned dispatch facts.
alter table app.notification_event alter column journey_id drop not null;
alter table app.notification_event alter column session_id drop not null;
alter table app.notification_event alter column schedule_version_id drop not null;
alter table app.notification_event add column job_id uuid;
alter table app.notification_event add column subscription_id uuid;
alter table app.notification_event add column attempt_number integer check(attempt_number between 0 and 3);
alter table app.notification_event add column simulated boolean;
alter table app.notification_event add constraint notification_event_owned_id unique(id,owner_id);
alter table app.notification_event add constraint notification_event_job_owner
  foreign key(job_id,owner_id,subscription_id) references app.reminder_job(id,owner_id,subscription_id) on delete cascade;
alter table app.notification_event add constraint notification_event_subscription_owner
  foreign key(subscription_id,owner_id) references app.push_subscription(id,owner_id) on delete cascade;
alter table app.notification_event drop constraint notification_event_kind_check;
alter table app.notification_event drop constraint notification_event_check;
alter table app.notification_event add constraint notification_event_kind_check check(kind in (
  'session_closed','session_corrected','reminder_scheduled','reminder_suppressed','reminder_canceled',
  'reminder_expired','dispatch_started','service_accepted','dispatch_failed','dispatch_uncertain','notification_opened'));
alter table app.notification_event add constraint notification_event_kind_context check(
  (kind='session_closed' and amendment_id is null and job_id is null and subscription_id is null and attempt_number is null and simulated is null
    and journey_id is not null and session_id is not null and schedule_version_id is not null)
  or (kind='session_corrected' and amendment_id is not null and job_id is null and subscription_id is null and attempt_number is null and simulated is null
    and journey_id is not null and session_id is not null and schedule_version_id is not null)
  or (kind not in ('session_closed','session_corrected') and amendment_id is null
    and job_id is not null and subscription_id is not null and attempt_number is not null and simulated is not null));
alter table app.notification_event add constraint notification_event_dispatch_attempt
  check(kind not in ('dispatch_started','service_accepted','dispatch_failed','dispatch_uncertain')
    or attempt_number between 1 and 3);
create unique index notification_event_attempt_outcome on app.notification_event(job_id,attempt_number)
  where kind in ('service_accepted','dispatch_failed','dispatch_uncertain');
create unique index notification_event_job_fact on app.notification_event(job_id,attempt_number,kind)
  where job_id is not null;

-- Permissive policies combine with OR: replace the old FOR ALL policy entirely.
drop policy owner_access on app.notification_event;
create policy owner_read on app.notification_event for select to app_api
  using(owner_id=(select auth.uid()));
create policy owner_history_insert on app.notification_event for insert to app_api
  with check(owner_id=(select auth.uid()) and kind in ('session_closed','session_corrected'));

create table app.notification_read (
  owner_id uuid not null,
  event_id uuid primary key,
  read_at timestamptz not null,
  foreign key(event_id,owner_id) references app.notification_event(id,owner_id) on delete cascade
);
create table app.worker_heartbeat (
  singleton boolean primary key default true check(singleton),
  observed_at timestamptz not null
);

do $$ declare tab text; begin
  foreach tab in array array['push_subscription','reminder_job','notification_read','worker_heartbeat'] loop
    execute format('alter table app.%I enable row level security',tab);
    execute format('alter table app.%I force row level security',tab);
    execute format('revoke all on app.%I from public,anon,authenticated,app_api,app_worker',tab);
  end loop;
  foreach tab in array array['push_subscription','reminder_job','notification_event','notification_read','worker_heartbeat'] loop
    execute format('grant select,insert on app.%I to app_reminder_owner',tab);
    if tab in ('push_subscription','reminder_job','worker_heartbeat') then
      execute format('grant update on app.%I to app_reminder_owner',tab);
    end if;
    execute format('create policy reminder_service on app.%I for all to app_reminder_owner using(true) with check(true)',tab);
  end loop;
  foreach tab in array array['profile','journey','session','session_practice','practice_version'] loop
    execute format('grant select on app.%I to app_reminder_owner',tab);
    execute format('create policy reminder_service_read on app.%I for select to app_reminder_owner using(true)',tab);
  end loop;
end $$;
create policy owner_read on app.push_subscription for select to app_api using(owner_id=(select auth.uid()));
create policy owner_read on app.reminder_job for select to app_api using(owner_id=(select auth.uid()));
create policy owner_read on app.notification_read for select to app_api using(owner_id=(select auth.uid()));
grant select(id,owner_id,generation,device_label,created_at,updated_at,revoked_at,last_result)
  on app.push_subscription to app_api;
grant select on app.reminder_job,app.notification_read to app_api;

-- A locking-only UPDATE policy/column privilege is needed for FOR UPDATE reads.
-- WITH CHECK(false) prevents this role from actually modifying canonical records.
grant update(id) on app.journey,app.session to app_reminder_owner;
create policy reminder_service_lock on app.journey for update to app_reminder_owner
  using(true) with check(false);
create policy reminder_service_lock on app.session for update to app_reminder_owner
  using(true) with check(false);

create function app.check_notification_job_context() returns trigger
language plpgsql set search_path=pg_catalog,app,pg_temp as $$
begin
  if new.job_id is not null and not exists(
    select from app.reminder_job j where j.id=new.job_id and j.owner_id=new.owner_id
      and j.subscription_id=new.subscription_id
      and j.journey_id is not distinct from new.journey_id
      and j.session_id is not distinct from new.session_id
      and j.schedule_version_id is not distinct from new.schedule_version_id
  ) then raise exception 'Notification context does not match its job' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function app.check_notification_job_context() from public,anon,authenticated,app_api,app_worker;
create trigger notification_job_context before insert or update on app.notification_event
  for each row execute function app.check_notification_job_context();
