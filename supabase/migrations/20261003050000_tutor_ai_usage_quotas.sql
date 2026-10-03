create table public.tutor_ai_usage_events (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  operation text not null check (operation in (
    'question', 'evaluate', 'propose-card', 'targeted-quiz', 'evaluate-quiz-answer'
  )),
  model text not null check (char_length(model) between 1 and 120),
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  created_at timestamptz not null default now()
);

create index tutor_ai_usage_events_owner_day_idx
  on public.tutor_ai_usage_events (user_id, created_at desc);

alter table public.tutor_ai_usage_events enable row level security;
revoke all on public.tutor_ai_usage_events from anon, authenticated;
grant select on public.tutor_ai_usage_events to authenticated;

create policy tutor_ai_usage_events_own on public.tutor_ai_usage_events
  for select to authenticated using (user_id = (select auth.uid()));

create function public.reserve_tutor_ai_call(p_id uuid, p_operation text, p_model text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller_id uuid := (select auth.uid());
  day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  current_count integer;
begin
  if caller_id is null or p_operation not in (
    'question', 'evaluate', 'propose-card', 'targeted-quiz', 'evaluate-quiz-answer'
  ) or char_length(p_model) not between 1 and 120 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(caller_id::text || ':' || day_start::text, 0));
  select count(*)::integer into current_count
  from public.tutor_ai_usage_events
  where user_id = caller_id and created_at >= day_start;
  if current_count >= 30 then
    return false;
  end if;

  insert into public.tutor_ai_usage_events (id, user_id, operation, model)
  values (p_id, caller_id, p_operation, p_model);
  return true;
end;
$$;
revoke all on function public.reserve_tutor_ai_call(uuid, text, text) from public, anon;
grant execute on function public.reserve_tutor_ai_call(uuid, text, text) to authenticated;

create function public.record_tutor_ai_usage(p_id uuid, p_input_tokens integer, p_output_tokens integer)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or p_input_tokens is null or p_output_tokens is null
    or p_input_tokens < 0 or p_output_tokens < 0 then
    return false;
  end if;
  update public.tutor_ai_usage_events
  set input_tokens = p_input_tokens, output_tokens = p_output_tokens
  where id = p_id and user_id = (select auth.uid())
    and input_tokens is null and output_tokens is null;
  return found;
end;
$$;
revoke all on function public.record_tutor_ai_usage(uuid, integer, integer) from public, anon;
grant execute on function public.record_tutor_ai_usage(uuid, integer, integer) to authenticated;

comment on table public.tutor_ai_usage_events is
  'Private per-call AI metering; 30 calls per UTC day are atomically reserved per account.';
