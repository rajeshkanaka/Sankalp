-- Preserve existing preferences as the single current authority. Invalid legacy
-- values make this migration fail for review; never normalize personal settings.
create function app.valid_reminder_preferences(p_value jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog,app,pg_temp as $$
declare item jsonb; quiet jsonb; count_value integer;
begin
  if jsonb_typeof(p_value) is distinct from 'object' then return false; end if;
  if (select array_agg(key order by key) from jsonb_object_keys(p_value) as key)
    is distinct from array['detailed','enabled','offsets','quietHours']::text[] then
    return false;
  end if;
  if jsonb_typeof(p_value->'enabled') is distinct from 'boolean'
    or jsonb_typeof(p_value->'detailed') is distinct from 'boolean'
    or jsonb_typeof(p_value->'offsets') is distinct from 'array' then return false; end if;
  count_value := jsonb_array_length(p_value->'offsets');
  if count_value > 8 or ((p_value->>'enabled')::boolean and count_value = 0) then
    return false;
  end if;
  for item in select value from jsonb_array_elements(p_value->'offsets') loop
    if jsonb_typeof(item) <> 'number' then return false; end if;
    if item::numeric < -1440 or item::numeric > 0 or trunc(item::numeric) <> item::numeric then
      return false;
    end if;
  end loop;
  if (select count(distinct value) from jsonb_array_elements(p_value->'offsets')) <> count_value
    then return false; end if;
  quiet := p_value->'quietHours';
  if quiet = 'null'::jsonb then return true; end if;
  if jsonb_typeof(quiet) is distinct from 'object' then return false; end if;
  if (select array_agg(key order by key) from jsonb_object_keys(quiet) as key)
    is distinct from array['end','start']::text[] then return false; end if;
  if jsonb_typeof(quiet->'start') is distinct from 'string'
    or jsonb_typeof(quiet->'end') is distinct from 'string' then return false; end if;
  return quiet->>'start' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    and quiet->>'end' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    and quiet->>'start' <> quiet->>'end';
end $$;
revoke all on function app.valid_reminder_preferences(jsonb) from public,anon,authenticated;
grant execute on function app.valid_reminder_preferences(jsonb) to app_api;

alter table app.journey add column reminder_revision integer not null default 0
  check(reminder_revision >= 0);
alter table app.journey add constraint journey_reminder_preferences_valid
  check(app.valid_reminder_preferences(draft->'reminders'));

create function app.version_reminder_preferences() returns trigger
language plpgsql set search_path=pg_catalog,app,pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.reminder_revision <> 0 then raise exception 'Initial reminder revision must be zero'; end if;
  else
    if new.reminder_revision <> old.reminder_revision then
      raise exception 'Reminder revision is derived from preference changes';
    end if;
    if new.draft->'reminders' is distinct from old.draft->'reminders' then
      new.reminder_revision := old.reminder_revision + 1;
      if new.revision <= old.revision then
        raise exception 'Preference changes require a new journey revision';
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function app.version_reminder_preferences() from public,anon,authenticated,app_api;
create trigger journey_reminder_revision before insert or update on app.journey
  for each row execute function app.version_reminder_preferences();
