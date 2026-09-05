-- Managed postgres cannot change SUPERUSER/BYPASSRLS attributes: fail closed on drift.
do $$ begin
  if exists(select from pg_roles where rolname='app_api' and (rolsuper or rolcreatedb or rolcreaterole or rolinherit or rolreplication or rolbypassrls))
    or exists(select from pg_auth_members where member = 'app_api'::regrole)
    or exists(select from pg_class where relnamespace = 'app'::regnamespace and relowner = 'app_api'::regrole)
    or exists(select from pg_namespace where oid = 'app'::regnamespace and nspowner = 'app_api'::regrole) then
    raise exception 'app_api must not own application objects or have role memberships';
  end if;
end $$;
alter table app.journey drop constraint journey_intention_check;
alter table app.journey add constraint journey_intention_check check(length(intention) <= 4000);
alter table app.practice_version drop constraint practice_version_check;
alter table app.practice_version add constraint practice_version_target_check check((kind='checkbox' and target is null) or (kind='repetitions' and target between 1 and 1000000) or (kind='minutes' and target between 1 and 1439));
alter table app.practice_version add constraint practice_version_kind_owner unique(id,schedule_version_id,journey_id,owner_id,kind);
alter table app.session_practice add constraint practice_value_kind_owner foreign key(practice_id,schedule_version_id,journey_id,owner_id,kind) references app.practice_version(id,schedule_version_id,journey_id,owner_id,kind);

do $$ declare tab text; begin
  foreach tab in array array['profile','journey','schedule_version','practice_version','session','session_practice','amendment','operation_receipt'] loop
    execute format('alter table app.%I force row level security', tab);
    execute format('revoke update, delete on app.%I from app_api', tab);
  end loop;
end $$;
grant update(title,intention,state,revision,draft,active_schedule_version_id) on app.journey to app_api;
grant delete on app.journey to app_api;
grant update(confirmed,performed_at,recorded_at,revision,superseded_at) on app.session to app_api;
grant update(checkbox_value,numeric_value) on app.session_practice to app_api;
-- Privacy operations get narrowly scoped procedures in their own milestone.
