create table public.chessmj_rooms (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique,
  host_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'ended')),
  seat_count smallint not null check (seat_count between 2 and 4),
  rules jsonb not null default '{}'::jsonb,
  rules_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);

create table public.chessmj_room_members (
  room_id uuid not null references public.chessmj_rooms(id) on delete cascade,
  seat smallint not null check (seat between 0 and 3),
  user_id uuid references auth.users(id) on delete cascade,
  controller text not null check (controller in ('human', 'ai')),
  display_name text not null check (char_length(display_name) between 1 and 32),
  ready boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (room_id, seat),
  check ((controller = 'human' and user_id is not null) or (controller = 'ai' and user_id is null))
);

create unique index chessmj_room_members_unique_user
  on public.chessmj_room_members (room_id, user_id) where user_id is not null;

create table public.chessmj_matches (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chessmj_rooms(id) on delete cascade,
  round_no integer not null check (round_no > 0),
  status text not null default 'active' check (status in ('active', 'ended')),
  state jsonb not null,
  state_version bigint not null default 0 check (state_version >= 0),
  seed text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (room_id, round_no)
);

create table public.chessmj_match_events (
  match_id uuid not null references public.chessmj_matches(id) on delete cascade,
  seq bigint not null check (seq > 0),
  request_id text not null,
  actor_seat smallint,
  event_type text not null,
  public_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (match_id, seq),
  unique (match_id, request_id)
);

create table public.chessmj_match_results (
  match_id uuid primary key references public.chessmj_matches(id) on delete cascade,
  winner_seat smallint,
  win_source text,
  score_breakdown jsonb not null default '{}'::jsonb,
  final_scores jsonb not null default '[]'::jsonb,
  ended_at timestamptz not null default now()
);

create index chessmj_rooms_waiting_code on public.chessmj_rooms (room_code) where status = 'waiting';
create index chessmj_members_user on public.chessmj_room_members (user_id, joined_at desc) where user_id is not null;
create index chessmj_matches_room_started on public.chessmj_matches (room_id, started_at desc);

alter table public.chessmj_rooms enable row level security;
alter table public.chessmj_room_members enable row level security;
alter table public.chessmj_matches enable row level security;
alter table public.chessmj_match_events enable row level security;
alter table public.chessmj_match_results enable row level security;

create function public.chessmj_is_room_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.chessmj_room_members m
    where m.room_id = p_room_id and m.user_id = (select auth.uid())
  );
$$;

create function public.chessmj_is_match_member(p_match_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.chessmj_matches g
    join public.chessmj_room_members m on m.room_id = g.room_id
    where g.id = p_match_id and m.user_id = (select auth.uid())
  );
$$;

create policy chessmj_rooms_member_read on public.chessmj_rooms
  for select to authenticated using (public.chessmj_is_room_member(id));
create policy chessmj_members_member_read on public.chessmj_room_members
  for select to authenticated using (public.chessmj_is_room_member(room_id));
create policy chessmj_events_member_read on public.chessmj_match_events
  for select to authenticated using (public.chessmj_is_match_member(match_id));
create policy chessmj_results_member_read on public.chessmj_match_results
  for select to authenticated using (public.chessmj_is_match_member(match_id));

revoke all on public.chessmj_rooms, public.chessmj_room_members,
  public.chessmj_matches, public.chessmj_match_events, public.chessmj_match_results from anon, authenticated;
grant select on public.chessmj_rooms, public.chessmj_room_members,
  public.chessmj_match_events, public.chessmj_match_results to authenticated;

create function public.chessmj_create_room(
  p_seat_count smallint, p_rules jsonb, p_rules_hash text, p_display_name text
)
returns table (room_id uuid, room_code text, seat smallint)
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_room_id uuid;
  v_room_code text;
  v_attempt integer;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if p_seat_count not between 2 and 4 then raise exception 'invalid_seat_count'; end if;
  if length(trim(coalesce(p_rules_hash, ''))) = 0 then raise exception 'invalid_rules_hash'; end if;
  for v_attempt in 1..8 loop
    v_room_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    begin
      insert into public.chessmj_rooms (room_code, host_user_id, seat_count, rules, rules_hash)
      values (v_room_code, v_user_id, p_seat_count, coalesce(p_rules, '{}'::jsonb), p_rules_hash)
      returning id into v_room_id;
      exit;
    exception when unique_violation then v_room_id := null;
    end;
  end loop;
  if v_room_id is null then raise exception 'room_code_generation_failed'; end if;
  insert into public.chessmj_room_members (room_id, seat, user_id, controller, display_name, ready)
  values (v_room_id, 0, v_user_id, 'human', left(coalesce(nullif(trim(p_display_name), ''), '棋友'), 32), true);
  return query select v_room_id, v_room_code, 0::smallint;
end;
$$;

create function public.chessmj_join_room(p_room_code text, p_display_name text)
returns table (room_id uuid, room_code text, seat smallint)
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_room public.chessmj_rooms%rowtype;
  v_seat smallint;
  v_inserted integer;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  select * into v_room from public.chessmj_rooms r
    where r.room_code = upper(trim(p_room_code)) and r.status = 'waiting' and r.expires_at > now()
    for update;
  if not found then raise exception 'room_not_found_or_started'; end if;
  select m.seat into v_seat from public.chessmj_room_members m
    where m.room_id = v_room.id and m.user_id = v_user_id;
  if found then return query select v_room.id, v_room.room_code, v_seat; return; end if;
  for v_seat in 0..(v_room.seat_count - 1) loop
    insert into public.chessmj_room_members (room_id, seat, user_id, controller, display_name)
    values (v_room.id, v_seat, v_user_id, 'human', left(coalesce(nullif(trim(p_display_name), ''), '棋友'), 32))
    on conflict do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 1 then return query select v_room.id, v_room.room_code, v_seat; return; end if;
  end loop;
  raise exception 'room_is_full';
end;
$$;

create function public.chessmj_set_ready(p_room_id uuid, p_ready boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.chessmj_room_members m set ready = p_ready
  from public.chessmj_rooms r
  where m.room_id = p_room_id and m.user_id = (select auth.uid())
    and r.id = m.room_id and r.status = 'waiting';
  if not found then raise exception 'room_membership_not_found'; end if;
end;
$$;

create function public.chessmj_fill_ai(p_room_id uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_room public.chessmj_rooms%rowtype;
  v_seat smallint;
begin
  select * into v_room from public.chessmj_rooms r
    where r.id = p_room_id and r.host_user_id = (select auth.uid()) and r.status = 'waiting'
    for update;
  if not found then raise exception 'host_or_waiting_room_required'; end if;
  for v_seat in 0..(v_room.seat_count - 1) loop
    insert into public.chessmj_room_members (room_id, seat, user_id, controller, display_name, ready)
    values (v_room.id, v_seat, null, 'ai', '電腦', true) on conflict do nothing;
  end loop;
  return (select count(*)::integer from public.chessmj_room_members m
    where m.room_id = p_room_id and m.controller = 'ai');
end;
$$;

create function public.chessmj_leave_room(p_room_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_host uuid;
  v_next_host uuid;
begin
  select r.host_user_id into v_host from public.chessmj_rooms r
    where r.id = p_room_id and r.status = 'waiting' and exists (
      select 1 from public.chessmj_room_members m where m.room_id = r.id and m.user_id = v_user_id
    ) for update;
  if not found then raise exception 'waiting_room_membership_not_found'; end if;
  if v_host = v_user_id then
    select m.user_id into v_next_host from public.chessmj_room_members m
      where m.room_id = p_room_id and m.user_id is not null and m.user_id <> v_user_id
      order by m.joined_at, m.seat limit 1;
    if v_next_host is null then delete from public.chessmj_rooms where id = p_room_id; return; end if;
    update public.chessmj_rooms set host_user_id = v_next_host where id = p_room_id;
  end if;
  delete from public.chessmj_room_members where room_id = p_room_id and user_id = v_user_id;
end;
$$;

create function public.chessmj_start_match(p_room_id uuid, p_state jsonb, p_seed text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_room public.chessmj_rooms%rowtype;
  v_match_id uuid;
begin
  select * into v_room from public.chessmj_rooms r
    where r.id = p_room_id and r.status = 'waiting' for update;
  if not found then raise exception 'waiting_room_required'; end if;
  if (select count(*) from public.chessmj_room_members m where m.room_id = p_room_id) <> v_room.seat_count then
    raise exception 'room_not_full';
  end if;
  if exists (select 1 from public.chessmj_room_members m where m.room_id = p_room_id and not m.ready) then
    raise exception 'all_seats_must_be_ready';
  end if;
  insert into public.chessmj_matches (room_id, round_no, state, seed)
  values (p_room_id, 1, p_state, p_seed) returning id into v_match_id;
  update public.chessmj_rooms set status = 'playing', updated_at = now() where id = p_room_id;
  insert into public.chessmj_match_events (match_id, seq, request_id, actor_seat, event_type, public_payload)
  values (v_match_id, 1, 'start-' || v_match_id::text, 0, 'match_started',
    jsonb_build_object('matchId', v_match_id, 'phase', 'initial-discard'));
  return v_match_id;
end;
$$;

create function public.chessmj_commit_match_action(
  p_match_id uuid, p_expected_version bigint, p_request_id text, p_actor_seat smallint,
  p_state jsonb, p_event_type text, p_public_payload jsonb, p_status text, p_result jsonb default null
)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare
  v_match public.chessmj_matches%rowtype;
  v_existing_seq bigint;
  v_next_version bigint;
begin
  if p_request_id is null or length(p_request_id) not between 1 and 100 then raise exception 'invalid_request_id'; end if;
  select e.seq into v_existing_seq from public.chessmj_match_events e
    where e.match_id = p_match_id and e.request_id = p_request_id;
  if found then return v_existing_seq; end if;
  select * into v_match from public.chessmj_matches g where g.id = p_match_id for update;
  if not found or v_match.status <> 'active' then raise exception 'active_match_not_found'; end if;
  if v_match.state_version <> p_expected_version then raise exception 'stale_match_version'; end if;
  if p_status not in ('active', 'ended') then raise exception 'invalid_match_status'; end if;
  v_next_version := v_match.state_version + 1;
  update public.chessmj_matches set state = p_state, state_version = v_next_version,
    status = p_status, ended_at = case when p_status = 'ended' then now() else null end
    where id = p_match_id;
  insert into public.chessmj_match_events (match_id, seq, request_id, actor_seat, event_type, public_payload)
  values (p_match_id, v_next_version + 1, p_request_id, p_actor_seat, p_event_type, coalesce(p_public_payload, '{}'::jsonb));
  if p_status = 'ended' and p_result is not null then
    insert into public.chessmj_match_results (match_id, winner_seat, win_source, score_breakdown, final_scores)
    values (p_match_id, nullif(p_result->>'winnerSeat', '')::smallint, p_result->>'source',
      coalesce(p_result->'scoreBreakdown', '{}'::jsonb), coalesce(p_result->'finalScores', '[]'::jsonb))
    on conflict (match_id) do update set winner_seat = excluded.winner_seat,
      win_source = excluded.win_source, score_breakdown = excluded.score_breakdown,
      final_scores = excluded.final_scores, ended_at = now();
    update public.chessmj_rooms set status = 'ended', updated_at = now()
      where id = v_match.room_id;
  end if;
  return v_next_version + 1;
end;
$$;

revoke all on function public.chessmj_is_room_member(uuid) from public, anon;
revoke all on function public.chessmj_is_match_member(uuid) from public, anon;
revoke all on function public.chessmj_create_room(smallint, jsonb, text, text) from public, anon;
revoke all on function public.chessmj_join_room(text, text) from public, anon;
revoke all on function public.chessmj_set_ready(uuid, boolean) from public, anon;
revoke all on function public.chessmj_fill_ai(uuid) from public, anon;
revoke all on function public.chessmj_leave_room(uuid) from public, anon;
revoke all on function public.chessmj_start_match(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.chessmj_commit_match_action(uuid, bigint, text, smallint, jsonb, text, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.chessmj_is_room_member(uuid) to authenticated;
grant execute on function public.chessmj_is_match_member(uuid) to authenticated;
grant execute on function public.chessmj_create_room(smallint, jsonb, text, text) to authenticated;
grant execute on function public.chessmj_join_room(text, text) to authenticated;
grant execute on function public.chessmj_set_ready(uuid, boolean) to authenticated;
grant execute on function public.chessmj_fill_ai(uuid) to authenticated;
grant execute on function public.chessmj_leave_room(uuid) to authenticated;
grant execute on function public.chessmj_start_match(uuid, jsonb, text) to service_role;
grant execute on function public.chessmj_commit_match_action(uuid, bigint, text, smallint, jsonb, text, jsonb, text, jsonb) to service_role;

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.chessmj_room_members;
  end if;
exception when duplicate_object then null;
end;
$$;

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.chessmj_match_events;
  end if;
exception when duplicate_object then null;
end;
$$;
