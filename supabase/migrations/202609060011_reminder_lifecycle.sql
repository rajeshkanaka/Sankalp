-- Repair010's unnamed legacy constraint selection without editing applied history.
alter table app.notification_event drop constraint notification_event_check1;
alter table app.notification_event add constraint notification_event_recorded_order check(recorded_at>=occurred_at);
alter table app.reminder_job add column recovery_pending boolean not null default false;

-- Every public entry point checks its login; helper functions remain private.
-- A job's transport mode is immutable so a local receipt can never become real.
alter table app.reminder_job add column simulated boolean not null default false;
alter table app.push_subscription add column simulated boolean not null default false;
grant select(simulated) on app.push_subscription to app_api;

create function app.reminder_quiet(p_preferences jsonb,p_at timestamptz,p_zone text)
returns boolean language sql immutable set search_path=pg_catalog,app,pg_temp as $$
 select case when p_preferences->'quietHours'='null'::jsonb then false
   when p_preferences#>>'{quietHours,start}' < p_preferences#>>'{quietHours,end}' then
     to_char(p_at at time zone p_zone,'HH24:MI') >= p_preferences#>>'{quietHours,start}'
     and to_char(p_at at time zone p_zone,'HH24:MI') < p_preferences#>>'{quietHours,end}'
   else to_char(p_at at time zone p_zone,'HH24:MI') >= p_preferences#>>'{quietHours,start}'
     or to_char(p_at at time zone p_zone,'HH24:MI') < p_preferences#>>'{quietHours,end}' end
$$;

create function app.reminder_account_lock(p_owner uuid) returns boolean
language plpgsql set search_path=pg_catalog,app,pg_temp as $$
begin
 perform pg_advisory_xact_lock_shared(hashtextextended(p_owner::text,2));
 return exists(select from app.profile where owner_id=p_owner and disabled_at is null);
end $$;

create function app.reminder_fact(p_job app.reminder_job,p_kind text,p_now timestamptz,p_detail jsonb default '{}'::jsonb)
returns uuid language plpgsql set search_path=pg_catalog,app,pg_temp as $$
declare v_id uuid;
begin
 insert into app.notification_event(id,owner_id,journey_id,session_id,schedule_version_id,kind,
   occurred_at,recorded_at,session_revision,detail,job_id,subscription_id,attempt_number,simulated)
 values(gen_random_uuid(),p_job.owner_id,p_job.journey_id,p_job.session_id,p_job.schedule_version_id,p_kind,
   p_now,p_now,coalesce((select revision from app.session where id=p_job.session_id),0),p_detail,
   p_job.id,p_job.subscription_id,p_job.attempts,p_job.simulated)
 on conflict(job_id,attempt_number,kind) where job_id is not null do nothing returning id into v_id;
 if v_id is null then select id into v_id from app.notification_event
   where job_id=p_job.id and attempt_number=p_job.attempts and kind=p_kind; end if;
 return v_id;
end $$;

-- Caller already holds the owning journey/session before any subscription/job lock.
create function app.refresh_reminder_jobs(p_journey uuid,p_now timestamptz,p_simulated boolean)
returns integer language plpgsql security definer set search_path=pg_catalog,app,pg_temp as $$
declare v_j app.journey; v_s app.session; v_sub app.push_subscription; v_job app.reminder_job;
 v_owner uuid; v_enabled boolean; v_offset integer; v_at timestamptz; v_reason text; v_count integer:=0;
begin
 if session_user<>'app_api' or auth.uid() is null or p_now is null or p_simulated is null then
   raise exception 'Reminder caller rejected' using errcode='42501'; end if;
 select owner_id into v_owner from app.journey where id=p_journey and owner_id=auth.uid();
 if v_owner is null then return 0; end if;
 v_enabled:=app.reminder_account_lock(v_owner);
 select * into v_j from app.journey where id=p_journey for update;
 perform id from app.session where journey_id=p_journey order by id for update;
 perform id from app.push_subscription where owner_id=v_owner order by id for update;
 for v_job in select * from app.reminder_job where journey_id=p_journey
   and state in ('pending','leased','dispatching') order by id for update loop
   select * into v_s from app.session where id=v_job.session_id;
   select * into v_sub from app.push_subscription where id=v_job.subscription_id;
   v_reason:=case when not v_enabled then 'account_disabled' when v_j.state<>'active' then 'archived'
     when v_s.superseded_at is not null then 'superseded' when v_s.confirmed then 'completed'
     when v_j.reminder_revision<>v_job.reminder_revision or not (v_j.draft#>>'{reminders,enabled}')::boolean then 'preferences_changed'
     when v_sub.revoked_at is not null or v_sub.generation<>v_job.subscription_generation
       or v_sub.simulated<>p_simulated or v_job.simulated<>p_simulated then 'subscription_changed'
     else null end;
   if v_reason is not null then
     if v_job.state='dispatching' then
       update app.reminder_job set cancel_requested_at=coalesce(cancel_requested_at,p_now) where id=v_job.id;
     else
       if v_job.recovery_pending then
         perform app.reminder_fact(v_job,'dispatch_uncertain',p_now,jsonb_build_object('reason','lease_expired'));
       end if;
       update app.reminder_job set state='canceled',safe_reason=v_reason,lease_token=null,lease_until=null,recovery_pending=false where id=v_job.id;
       perform app.reminder_fact(v_job,'reminder_canceled',p_now,jsonb_build_object('reason',v_reason));
     end if;
   end if;
 end loop;
 if not v_enabled or v_j.state<>'active' or not (v_j.draft#>>'{reminders,enabled}')::boolean then return 0; end if;
 for v_s in select * from app.session where journey_id=p_journey and superseded_at is null and not confirmed
   and closes_at>p_now order by id loop
   for v_sub in select * from app.push_subscription where owner_id=v_owner and revoked_at is null
     and simulated=p_simulated order by id loop
     for v_offset in select value::integer from jsonb_array_elements_text(v_j.draft#>'{reminders,offsets}') loop
       v_at:=v_s.opens_at+make_interval(mins=>v_offset);
       if v_at<=p_now then continue; end if;
       v_reason:=case when app.reminder_quiet(v_j.draft->'reminders',v_at,v_s.time_zone) then 'quiet_hours' else null end;
       insert into app.reminder_job(id,owner_id,journey_id,session_id,schedule_version_id,subscription_id,
         reminder_revision,subscription_generation,kind,offset_minutes,scheduled_at,expires_at,next_attempt_at,state,safe_reason,created_at,simulated)
       values(gen_random_uuid(),v_owner,p_journey,v_s.id,v_s.schedule_version_id,v_sub.id,
         v_j.reminder_revision,v_sub.generation,'offset',v_offset,v_at,least(v_at+interval '5 minutes',v_s.closes_at),v_at,
         case when v_reason is null then 'pending' else 'suppressed' end,v_reason,p_now,p_simulated)
       on conflict do nothing returning * into v_job;
       if found then
         v_count:=v_count+1;
         perform app.reminder_fact(v_job,case when v_reason is null then 'reminder_scheduled' else 'reminder_suppressed' end,
           p_now,jsonb_build_object('reason',v_reason,'scheduledAt',v_at));
       end if;
     end loop;
   end loop;
 end loop;
 return v_count;
end $$;

create function app.claim_reminder_jobs(p_now timestamptz,p_limit integer,p_simulated boolean)
returns table(job_id uuid,lease_token uuid,lease_until timestamptz)
language plpgsql security definer set search_path=pg_catalog,app,pg_temp as $$
declare v_job app.reminder_job;
begin
 if session_user<>'app_worker' or p_now is null or p_simulated is null or p_limit is null or p_limit not between 1 and 50 then
   raise exception 'Worker caller rejected' using errcode='42501'; end if;
 for v_job in select * from app.reminder_job j where j.simulated=p_simulated and
   ((j.state='pending' and j.next_attempt_at<=p_now) or (j.state in ('leased','dispatching') and j.lease_until<=p_now))
   order by j.next_attempt_at,j.id limit p_limit for update skip locked loop
   -- Do not insert facts here: their FK locks would invert parent -> job order.
   -- Even expired work is claimed for parent-locked finalization by prepare.
   job_id:=v_job.id; lease_token:=gen_random_uuid(); lease_until:=p_now+interval '60 seconds';
   update app.reminder_job j set state='leased',lease_token=claim_reminder_jobs.lease_token,
     lease_until=claim_reminder_jobs.lease_until,
     recovery_pending=(j.recovery_pending or v_job.state='dispatching') where j.id=v_job.id;
   return next;
 end loop;
end $$;

create function app.prepare_reminder_job(p_id uuid,p_token uuid,p_now timestamptz,p_simulated boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,app,pg_temp as $$
declare v_job app.reminder_job; v_j app.journey; v_s app.session; v_sub app.push_subscription;
 v_enabled boolean; v_reason text; v_event uuid;
begin
 if session_user<>'app_worker' or p_now is null or p_simulated is null then raise exception 'Worker caller rejected' using errcode='42501'; end if;
 select * into v_job from app.reminder_job where id=p_id;
 if not found then return '{"ready":false}'::jsonb; end if;
 v_enabled:=app.reminder_account_lock(v_job.owner_id);
 if v_job.journey_id is not null then
   select * into v_j from app.journey where id=v_job.journey_id for update;
   select * into v_s from app.session where id=v_job.session_id for update;
 end if;
 select * into v_sub from app.push_subscription where id=v_job.subscription_id for update;
 select * into v_job from app.reminder_job where id=p_id for update;
 if not found or v_job.state<>'leased' or v_job.lease_token is distinct from p_token or v_job.lease_until<=p_now
   or v_job.simulated<>p_simulated then return '{"ready":false}'::jsonb; end if;
 if v_job.recovery_pending then
   perform app.reminder_fact(v_job,'dispatch_uncertain',p_now,jsonb_build_object('reason','lease_expired'));
   update app.reminder_job set recovery_pending=false where id=p_id;
 end if;
 v_reason:=case when not v_enabled then 'account_disabled'
   when v_sub.id is null or v_sub.revoked_at is not null or v_sub.generation<>v_job.subscription_generation
     or v_sub.simulated<>v_job.simulated then 'subscription_changed'
   when v_job.cancel_requested_at is not null then 'canceled'
   when v_job.expires_at<=p_now or v_job.attempts>=3 then 'expired'
   when v_job.kind<>'test' then case when v_j.id is null or v_j.state<>'active' then 'archived'
     when v_s.id is null or v_s.superseded_at is not null then 'superseded' when v_s.confirmed then 'completed'
     when v_s.closes_at<=p_now then 'expired'
     when v_j.reminder_revision<>v_job.reminder_revision or not (v_j.draft#>>'{reminders,enabled}')::boolean then 'preferences_changed'
     when app.reminder_quiet(v_j.draft->'reminders',v_job.scheduled_at,v_s.time_zone)
       or app.reminder_quiet(v_j.draft->'reminders',p_now,v_s.time_zone) then 'quiet_hours' else null end
   else null end;
 if v_reason is not null then
   update app.reminder_job set state=case when v_reason='expired' and v_job.recovery_pending then 'uncertain' when v_reason='expired' then 'expired' when v_reason='quiet_hours' then 'suppressed' else 'canceled' end,
     safe_reason=v_reason,lease_token=null,lease_until=null where id=p_id;
   perform app.reminder_fact(v_job,case when v_reason='expired' then 'reminder_expired' when v_reason='quiet_hours' then 'reminder_suppressed' else 'reminder_canceled' end,
     p_now,jsonb_build_object('reason',v_reason));
   return '{"ready":false}'::jsonb;
 end if;
 update app.reminder_job set state='dispatching',attempts=attempts+1,dispatch_started_at=p_now
   where id=p_id returning * into v_job;
 v_event:=app.reminder_fact(v_job,'dispatch_started',p_now);
 return jsonb_build_object('ready',true,'jobId',v_job.id,'leaseToken',v_job.lease_token,'attempt',v_job.attempts,
   'eventId',v_event,'journeyId',v_job.journey_id,'sessionId',v_job.session_id,'subscriptionId',v_sub.id,
   'subscriptionGeneration',v_sub.generation,'expiresAt',v_job.expires_at,'simulated',v_job.simulated,
   'journeyTitle',case when coalesce((v_j.draft#>>'{reminders,detailed}')::boolean,false) then v_j.title else null end,
   'subscription',jsonb_build_object('endpoint',v_sub.endpoint,'keys',jsonb_build_object('p256dh',v_sub.p256dh,'auth',v_sub.auth_key)));
end $$;

create function app.settle_reminder_job(p_id uuid,p_token uuid,p_attempt integer,p_result jsonb,p_now timestamptz)
returns boolean language plpgsql security definer set search_path=pg_catalog,app,pg_temp as $$
declare v_job app.reminder_job; v_kind text:=p_result->>'kind'; v_reason text:=p_result->>'reason';
 v_status integer; v_event text; v_next timestamptz; v_existing jsonb; v_detail jsonb;
begin
 if session_user<>'app_worker' or p_now is null then raise exception 'Worker caller rejected' using errcode='42501'; end if;
 if p_attempt is null or p_attempt not between 1 and 3 then return false; end if;
 if p_result is null or jsonb_typeof(p_result)<>'object' or v_kind is null or v_kind not in ('accepted','terminal_failure','transient_failure','uncertain')
   or p_result->>'mode' is null or p_result->>'mode' not in ('real','simulated') or not(p_result ? 'httpStatus') then
   raise exception 'Invalid push outcome' using errcode='22023'; end if;
 if p_result->'httpStatus'<>'null'::jsonb then
   if jsonb_typeof(p_result->'httpStatus')<>'number' or (p_result->>'httpStatus') !~ '^[1-5][0-9][0-9]$' then
     raise exception 'Invalid push status' using errcode='22023'; end if;
   v_status:=(p_result->>'httpStatus')::integer;
 end if;
 if (p_result->>'mode'='simulated' and v_status is not null)
   or (v_kind='accepted' and p_result->>'mode'='real' and (v_status is null or v_status not between 200 and 299))
   or (v_kind='terminal_failure' and (v_reason is null or v_reason not in ('invalid_input','endpoint_blocked','subscription_gone','provider_rejected','tls_rejected','expired','canceled')
      or jsonb_typeof(p_result->'invalidateSubscription') is distinct from 'boolean'))
   or (v_kind='transient_failure' and (v_reason is null or v_reason not in ('dns_failure','network_before_send','provider_retry')
      or not(p_result ? 'retryAfterMs') or (p_result->'retryAfterMs'<>'null'::jsonb and
      (jsonb_typeof(p_result->'retryAfterMs')<>'number' or (p_result->>'retryAfterMs') !~ '^[0-9]{1,10}$'))))
   or (v_kind='uncertain' and (v_reason is null or v_reason not in ('timeout','aborted','network','invalid_response'))) then
   raise exception 'Invalid push outcome' using errcode='22023'; end if;
 select * into v_job from app.reminder_job where id=p_id;
 if not found then return false; end if;
 -- Fact insertion takes implicit parent FK locks; keep the same explicit order as prepare.
 perform app.reminder_account_lock(v_job.owner_id);
 if v_job.journey_id is not null then
   perform id from app.journey where id=v_job.journey_id for update;
   perform id from app.session where id=v_job.session_id for update;
 end if;
 perform id from app.push_subscription where id=v_job.subscription_id for update;
 select * into v_job from app.reminder_job where id=p_id for update;
 if not found or v_job.lease_token is distinct from p_token or v_job.attempts is distinct from p_attempt
   or v_job.simulated<>(p_result->>'mode'='simulated') then return false; end if;
 v_event:=case v_kind when 'accepted' then 'service_accepted' when 'uncertain' then 'dispatch_uncertain' else 'dispatch_failed' end;
 v_detail:=jsonb_build_object('outcome',v_kind,'reason',v_reason,'httpStatus',v_status,
   'retryAfterMs',p_result->'retryAfterMs','invalidateSubscription',p_result->'invalidateSubscription');
 select detail into v_existing from app.notification_event where job_id=p_id and attempt_number=p_attempt
   and kind in ('service_accepted','dispatch_uncertain','dispatch_failed');
 if found then return v_existing=v_detail; end if;
 if v_job.state<>'dispatching' or v_job.lease_until<=p_now then return false; end if;
 perform app.reminder_fact(v_job,v_event,p_now,v_detail);
 v_next:=p_now+make_interval(secs=>greatest(5,least(120,coalesce((p_result->>'retryAfterMs')::bigint/1000,15*v_job.attempts))));
 update app.reminder_job set state=case when v_kind='accepted' then 'accepted'
   when v_kind in ('transient_failure','uncertain') and attempts<3 and v_next<expires_at and cancel_requested_at is null then 'pending'
   when v_kind='uncertain' then 'uncertain' else 'failed' end,
   safe_reason=v_reason,next_attempt_at=greatest(scheduled_at,v_next) where id=p_id;
 -- Keep the settled token to recognize an exact repeat; a later claim replaces it.
 update app.push_subscription set last_result=case when v_kind='accepted' then 'accepted'
   when v_reason='subscription_gone' then 'subscription_gone' when v_kind='uncertain' then 'uncertain' else 'failed' end,
   revoked_at=case when v_kind='terminal_failure' and (p_result->>'invalidateSubscription')::boolean
     then greatest(created_at,p_now) else revoked_at end,
   updated_at=greatest(updated_at,p_now)
   where id=v_job.subscription_id and generation=v_job.subscription_generation;
 return true;
end $$;

create function app.due_session_closures(p_now timestamptz,p_limit integer)
returns table(session_id uuid) language plpgsql security definer set search_path=pg_catalog,app,pg_temp as $$
begin
 if session_user<>'app_worker' or p_now is null or p_limit is null or p_limit not between 1 and 50 then
   raise exception 'Worker caller rejected' using errcode='42501'; end if;
 return query select s.id from app.session s join app.profile p on p.owner_id=s.owner_id
   where s.superseded_at is null and s.closes_at<=p_now and p.disabled_at is null
   and not exists(select from app.notification_event e where e.session_id=s.id and e.kind='session_closed')
   order by s.closes_at,s.id limit p_limit;
end $$;

create function app.record_session_closure(p_id uuid,p_now timestamptz)
returns boolean language plpgsql security definer set search_path=pg_catalog,app,pg_temp as $$
declare v_s app.session; v_status text; v_count integer;
begin
 if session_user not in ('app_api','app_worker') or p_now is null then raise exception 'Closure caller rejected' using errcode='42501'; end if;
 select * into v_s from app.session where id=p_id and (session_user='app_worker' or owner_id=auth.uid());
 if not found then return false; end if;
 if not app.reminder_account_lock(v_s.owner_id) then return false; end if;
 perform id from app.journey where id=v_s.journey_id for update;
 select * into v_s from app.session where id=p_id for update;
 if not found or v_s.superseded_at is not null or v_s.closes_at>p_now then return false; end if;
 select case when v_s.confirmed and count(*)>0 and bool_and(case when p.kind='checkbox' then v.checkbox_value else v.numeric_value>=p.target end) then 'complete'
   when bool_or(case when p.kind='checkbox' then v.checkbox_value else v.numeric_value>0 end) then 'partial' else 'missed' end
 into v_status from app.session_practice v join app.practice_version p on p.id=v.practice_id and p.schedule_version_id=v.schedule_version_id
 where v.session_id=p_id;
 insert into app.notification_event(id,owner_id,journey_id,session_id,schedule_version_id,kind,occurred_at,recorded_at,session_revision,detail)
 values(gen_random_uuid(),v_s.owner_id,v_s.journey_id,p_id,v_s.schedule_version_id,'session_closed',v_s.closes_at,p_now,v_s.revision,jsonb_build_object('status',v_status))
 on conflict(session_id) where kind='session_closed' do nothing;
 get diagnostics v_count=row_count;
 return v_count=1;
end $$;

create function app.record_worker_heartbeat() returns void
language plpgsql security definer set search_path=pg_catalog,app,pg_temp as $$
begin
 if session_user<>'app_worker' then raise exception 'Worker caller rejected' using errcode='42501'; end if;
 insert into app.worker_heartbeat(singleton,observed_at) values(true,clock_timestamp())
 on conflict(singleton) do update set observed_at=excluded.observed_at;
end $$;

-- Supabase's migration login is CREATEROLE, not SUPERUSER. PostgreSQL17 requires
-- SET ROLE rights and target CREATE on the schema for an ownership transfer.
-- Temporarily enable only the trusted migration login, restoring its exact options
-- inside this one statement; application/worker principals never gain membership.
do $$ declare v_signature text; v_name text; v_member boolean; v_set boolean; v_inherit boolean; begin
 select true,set_option,inherit_option into v_member,v_set,v_inherit from pg_auth_members
   where roleid='app_reminder_owner'::regrole and member=current_user::regrole;
 execute format('grant app_reminder_owner to %I with set true',current_user);
 execute format('grant app_reminder_owner to %I with inherit true',current_user);
 grant create on schema app to app_reminder_owner;
 for v_signature,v_name in select p.oid::regprocedure::text,p.proname from pg_proc p where p.pronamespace='app'::regnamespace
   and p.proname in ('reminder_quiet','reminder_account_lock','reminder_fact','refresh_reminder_jobs',
     'claim_reminder_jobs','prepare_reminder_job','settle_reminder_job','due_session_closures','record_session_closure','record_worker_heartbeat') loop
   execute format('alter function %s owner to app_reminder_owner',v_signature);
   execute format('revoke all on function %s from public,anon,authenticated,app_api,app_worker',v_signature);
   if v_name in ('refresh_reminder_jobs','record_session_closure') then
     execute format('grant execute on function %s to app_api',v_signature); end if;
   if v_name in ('claim_reminder_jobs','prepare_reminder_job','settle_reminder_job','due_session_closures','record_session_closure','record_worker_heartbeat') then
     execute format('grant execute on function %s to app_worker',v_signature); end if;
 end loop;
 revoke create on schema app from app_reminder_owner;
 if v_member then
   execute format('grant app_reminder_owner to %I with set %s',current_user,case when v_set then 'true' else 'false' end);
   execute format('grant app_reminder_owner to %I with inherit %s',current_user,case when v_inherit then 'true' else 'false' end);
 else execute format('revoke app_reminder_owner from %I',current_user); end if;
end $$;
