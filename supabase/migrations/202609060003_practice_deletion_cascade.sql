-- Both parent chains can cascade during account deletion; neither may block the other.
do $$ declare constraint_name text; begin
  for constraint_name in select conname from pg_constraint
    where conrelid='app.session_practice'::regclass and confrelid='app.practice_version'::regclass
  loop execute format('alter table app.session_practice drop constraint %I',constraint_name); end loop;
end $$;
alter table app.session_practice add constraint practice_value_kind_owner
  foreign key(practice_id,schedule_version_id,journey_id,owner_id,kind)
  references app.practice_version(id,schedule_version_id,journey_id,owner_id,kind) on delete cascade;
