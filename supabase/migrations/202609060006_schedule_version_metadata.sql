-- Only single-version activation exists before this migration. Refuse ambiguous backfill.
do $$ begin
  if exists(select journey_id from app.schedule_version group by journey_id having count(*) > 1) then
    raise exception 'Review existing multi-version journeys before applying version metadata';
  end if;
end $$;
alter table app.schedule_version
  add column version integer,
  add column effective_practice_date date;
update app.schedule_version set version = 1,
  effective_practice_date = (definition->'schedule'->>'startDate')::date;
alter table app.schedule_version
  alter column version set not null,
  alter column effective_practice_date set not null,
  add constraint schedule_version_number_positive check(version > 0),
  add constraint schedule_version_number_unique unique(journey_id, version);
create index session_active_open on app.session(journey_id, opens_at, id)
  where superseded_at is null;
