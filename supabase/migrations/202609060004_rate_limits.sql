create table app.rate_bucket (
  scope text not null check(scope in ('sign-in-minute','sign-in-hour','sign-in-ip-minute','sign-in-ip-hour','write-minute')),
  key_hash text not null check(key_hash ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null,
  attempts integer not null check(attempts > 0),
  primary key(scope,key_hash)
);
create index rate_bucket_expiry on app.rate_bucket(window_start);
alter table app.rate_bucket enable row level security;
alter table app.rate_bucket force row level security;
revoke all on app.rate_bucket from public,anon,authenticated,app_api;

create function app.consume_rate_limit(p_scope text,p_key_hash text) returns integer
language plpgsql security definer set search_path=pg_catalog,app as $$
declare span_seconds integer; cap integer; started timestamptz; current_time_value timestamptz := clock_timestamp(); attempt_count integer;
begin
  if session_user <> 'app_api' then raise exception 'Restricted application role required'; end if;
  if p_scope not in ('sign-in-minute','sign-in-hour','sign-in-ip-minute','sign-in-ip-hour','write-minute')
    or p_key_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid rate bucket'; end if;
  span_seconds := case when p_scope like '%hour' then 3600 else 60 end;
  cap := case when p_scope='write-minute' then 120 when span_seconds=3600 then 5 else 1 end;
  started := to_timestamp(floor(extract(epoch from current_time_value)/span_seconds)*span_seconds);
  delete from app.rate_bucket where ctid in (select ctid from app.rate_bucket where window_start < current_time_value-interval '2 hours' limit 1000);
  insert into app.rate_bucket(scope,key_hash,window_start,attempts) values(p_scope,p_key_hash,started,1)
  on conflict(scope,key_hash) do update set window_start=excluded.window_start,
    attempts=case when rate_bucket.window_start=excluded.window_start then least(rate_bucket.attempts+1,cap+1) else 1 end
  returning attempts into attempt_count;
  if attempt_count>cap then return greatest(1,ceil(extract(epoch from started+make_interval(secs=>span_seconds)-current_time_value))::integer); end if;
  return 0;
end $$;
revoke all on function app.consume_rate_limit(text,text) from public,anon,authenticated;
grant execute on function app.consume_rate_limit(text,text) to app_api;
