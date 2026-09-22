/* =============================================================================
 * Pampa — 0002 — bookings, escrow, payouts and the discovery feed
 *
 * This is the migration that matters. Until now the booking state machine —
 * who may accept, when money may move, what a counter-offer does to the escrow
 * — lived in escrow.js and ran in whichever browser had the page open. That is
 * a demo. Here it is a set of tables plus a set of functions that are the only
 * way to change them, so a client cannot release a payout the professional has
 * not earned, and a professional cannot mark a job done that was never paid
 * for. Every rule the app used to enforce on screen is restated below, in the
 * same order, with the same arithmetic.
 *
 * Three conventions worth knowing before reading:
 *
 *   • Every function takes `p_token` and authenticates the caller itself
 *     (0001 explains why there is no auth.uid()).
 *   • Nothing writes a booking without writing a `pampa_booking_events` row in
 *     the same transaction. That table is the booking's history in the app and
 *     the escrow ledger underneath it, and it is append-only by trigger.
 *   • Times are naive (a date and a time, exactly as the app stores them) but
 *     every comparison against the clock goes through pampa_starts_at, which
 *     anchors them to Lagos. Without that, "has the appointment passed" would
 *     be answered an hour early or late depending on where the database sits.
 * ========================================================================== */

create extension if not exists pgcrypto with schema extensions;

/* Mediators are accounts with a flag, not a third role: a desk member is
   somebody who works here, and the flag is how the app finds them. */
alter table public.pampa_accounts
  add column if not exists desk boolean not null default false;

/* ---------- Bookings ---------- */

create table if not exists public.pampa_bookings (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.pampa_accounts(id) on delete restrict,
  provider_id        uuid not null references public.pampa_providers(account_id) on delete restrict,
  service_id         text not null references public.pampa_services(id),
  /* Names are snapshots. A professional who renames themselves must not
     rewrite the receipt of a job that was done last week. */
  provider_name      text not null,
  client_name        text not null,
  client_phone       text not null default '',
  scheduled_date     date not null,
  scheduled_time     time not null,
  loc                text not null check (loc in ('home','studio')),
  area_id            text references public.pampa_areas(id),
  area_name          text not null default '',
  address            text not null default '',
  studio_address     text not null default '',
  studio_area_name   text not null default '',
  km                 numeric(6,1),
  travel_fee         int not null default 0 check (travel_fee >= 0),
  price              int not null check (price >= 0),
  total              int not null check (total >= 0),
  currency           text not null default 'NGN',
  /* The client's opening number and the band it was chosen from — the band is
     the professional's published promise, kept here so an agreed price can
     always be read back against it. */
  offer              jsonb not null default '{}'::jsonb,
  price_range        jsonb not null default '{}'::jsonb,
  negotiation        jsonb not null default '{}'::jsonb,
  status             text not null default 'unpaid'
                     check (status in ('unpaid','escrowed','confirmed','released',
                                       'cancelled','declined','disputed','settled')),
  pro_marked_done    boolean not null default false,
  pay                jsonb,
  refund             jsonb,
  resolution         jsonb,
  dispute            jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  accepted_at        timestamptz,
  done_at            timestamptz,
  released_at        timestamptz,
  constraint pampa_bookings_total_is_price_plus_travel check (total = price + travel_fee),
  /* A booking belongs to two different people. */
  constraint pampa_bookings_two_parties check (client_id <> provider_id)
);

create index if not exists pampa_bookings_client_idx   on public.pampa_bookings (client_id);
create index if not exists pampa_bookings_provider_idx on public.pampa_bookings (provider_id);
create index if not exists pampa_bookings_open_idx
  on public.pampa_bookings (provider_id, scheduled_date, scheduled_time)
  where status in ('escrowed','confirmed','disputed');
create index if not exists pampa_bookings_status_idx   on public.pampa_bookings (status);

/* The booking's history and the escrow ledger, in one append-only table: the
   app has always shown one line per thing that happened, and the money is one
   of the things that happened. */
create table if not exists public.pampa_booking_events (
  id         bigserial primary key,
  booking_id uuid not null references public.pampa_bookings(id) on delete cascade,
  at         timestamptz not null default now(),
  actor_id   uuid references public.pampa_accounts(id) on delete set null,
  actor_role text not null default 'system'
             check (actor_role in ('client','pro','desk','system')),
  kind       text not null,
  label      text not null,
  amount     int,
  fee        int,
  net        int,
  meta       jsonb not null default '{}'::jsonb
);

create index if not exists pampa_booking_events_booking_idx
  on public.pampa_booking_events (booking_id, at);

/* A payout is the moment released money leaves escrow for a bank account or a
   wallet. One per booking, because a job is paid once. */
create table if not exists public.pampa_payouts (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null unique references public.pampa_bookings(id) on delete cascade,
  provider_id    uuid not null references public.pampa_providers(account_id) on delete restrict,
  destination_id uuid references public.pampa_payout_destinations(id) on delete set null,
  gross          int not null check (gross >= 0),
  fee            int not null default 0 check (fee >= 0),
  net            int not null check (net >= 0),
  method         text not null default 'escrow',
  ref            text not null default '',
  status         text not null default 'sent' check (status in ('pending','sent','failed')),
  created_at     timestamptz not null default now()
);

create index if not exists pampa_payouts_provider_idx on public.pampa_payouts (provider_id);

/* ---------- Guards ---------- */

create or replace function public.pampa_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pampa_bookings_touch on public.pampa_bookings;
create trigger pampa_bookings_touch
  before update on public.pampa_bookings
  for each row execute function public.pampa_touch();

/* The journal cannot be edited or shortened. A ledger that can be rewritten is
   not evidence, and this one is also the record a dispute is decided on. */
create or replace function public.pampa_journal_is_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'The booking journal is append-only' using errcode = '42501';
end;
$$;

drop trigger if exists pampa_booking_events_append_only on public.pampa_booking_events;
create trigger pampa_booking_events_append_only
  before update or delete on public.pampa_booking_events
  for each row execute function public.pampa_journal_is_append_only();

/* The state machine, as a table of legal moves rather than a habit. Anything
   not listed is a bug or an attack, and is refused with the same error. */
create or replace function public.pampa_transition_ok(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select case
    when p_from = p_to then true
    -- unpaid: the offer is on the table. It can be funded, or called off.
    when p_from = 'unpaid'    and p_to in ('escrowed','cancelled')    then true
    -- escrowed: money is held and the professional has not answered yet.
    when p_from = 'escrowed'  and p_to in ('confirmed','declined','cancelled','unpaid') then true
    -- confirmed: accepted work. It ends by being paid, disputed or cancelled.
    when p_from = 'confirmed' and p_to in ('released','disputed','cancelled') then true
    -- disputed: only the desk closes it.
    when p_from = 'disputed'  and p_to in ('settled') then true
    -- released, cancelled, declined and settled are history.
    else false
  end;
$$;

create or replace function public.pampa_guard_booking()
returns trigger
language plpgsql
as $$
begin
  if new.client_id   is distinct from old.client_id
     or new.provider_id is distinct from old.provider_id
     or new.service_id  is distinct from old.service_id then
    raise exception 'Who the booking is between cannot be changed' using errcode = '42501';
  end if;

  if not public.pampa_transition_ok(old.status, new.status) then
    raise exception 'A booking cannot go from % to %', old.status, new.status
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists pampa_bookings_guard on public.pampa_bookings;
create trigger pampa_bookings_guard
  before update on public.pampa_bookings
  for each row execute function public.pampa_guard_booking();

/* ---------- Money and time, in one place each ---------- */

/* Pampa's cut: 10%, rounded to the nearest ₦50. Same as escrowFee(). */
create or replace function public.pampa_fee(p_amount int)
returns int
language sql
immutable
as $$
  select greatest(0, (round(coalesce(p_amount, 0) * 0.1 / 50) * 50)::int);
$$;

/* Charged to the client only when they cancel after the professional accepted. */
create or replace function public.pampa_cancel_fee(p_amount int)
returns int
language sql
immutable
as $$
  select greatest(0, (round(coalesce(p_amount, 0) * 0.1 / 50) * 50)::int);
$$;

/* Home visits: ₦1,000 covers the first 3 km, then ₦250 a kilometre, rounded to
   the nearest ₦50 — the same arithmetic travelFeeFor() uses. */
create or replace function public.pampa_travel_fee(p_km numeric)
returns int
language sql
immutable
as $$
  select case
    when p_km is null then 0
    else (round((1000 + greatest(0, p_km - 3) * 250) / 50) * 50)::int
  end;
$$;

/* A booked time is a Lagos wall clock. Anchoring it here is what makes "has
   this appointment passed" the same answer for a client in Lagos and a
   database in Virginia. */
create or replace function public.pampa_starts_at(p_date date, p_time time)
returns timestamptz
language sql
immutable
as $$
  select (p_date::timestamp + p_time) at time zone 'Africa/Lagos';
$$;

/* How long the chair is taken: the service's own duration plus the walk to the
   next job. Mirrors SESSION_BUFFER_MIN. */
create or replace function public.pampa_session_minutes(p_service_id text)
returns int
language sql
stable
as $$
  select coalesce((select dur_min from public.pampa_services where id = p_service_id), 60) + 15;
$$;

/* A professional is with somebody from the moment a booked session starts until
   that booking is settled — not until the clock says the work is over. This is
   the half that gets forgotten: somebody still waiting to be released for a
   chair they have already left is still holding that job. */
create or replace function public.pampa_in_session(p_provider_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
      from public.pampa_bookings b
     where b.provider_id = p_provider_id
       and b.status in ('escrowed','confirmed','disputed')
       and public.pampa_starts_at(b.scheduled_date, b.scheduled_time) <= now()
  );
$$;

/* The session the professional is inside right now, as the booking itself, so
   the client can be told who they are waiting on. */
create or replace function public.pampa_active_session(p_provider_id uuid)
returns uuid
language sql
stable
as $$
  select b.id
    from public.pampa_bookings b
   where b.provider_id = p_provider_id
     and b.status in ('escrowed','confirmed','disputed')
     and public.pampa_starts_at(b.scheduled_date, b.scheduled_time) <= now()
   order by b.scheduled_date, b.scheduled_time
   limit 1;
$$;

/* Two jobs clash when their chair windows overlap, so the middle of somebody's
   session cannot be booked even though that exact slot looks free. */
create or replace function public.pampa_slot_clash(
  p_provider_id uuid, p_date date, p_time time, p_service_id text,
  p_ignore uuid default null
) returns boolean
language sql
stable
as $$
  select exists (
    select 1
      from public.pampa_bookings b
     where b.provider_id = p_provider_id
       and b.id is distinct from p_ignore
       and b.status in ('escrowed','confirmed','disputed')
       and public.pampa_starts_at(p_date, p_time)
             < public.pampa_starts_at(b.scheduled_date, b.scheduled_time)
               + make_interval(mins => public.pampa_session_minutes(b.service_id))
       and public.pampa_starts_at(b.scheduled_date, b.scheduled_time)
             < public.pampa_starts_at(p_date, p_time)
               + make_interval(mins => public.pampa_session_minutes(p_service_id))
  );
$$;

create or replace function public.pampa_role_of(p_account_id uuid)
returns text
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select role from public.pampa_accounts where id = p_account_id;
$$;

/* Journal one line. Every transition below calls this before it returns. */
create or replace function public.pampa_journal(
  p_booking uuid, p_actor uuid, p_actor_role text, p_kind text, p_label text,
  p_amount int default null, p_fee int default null, p_net int default null,
  p_meta jsonb default '{}'::jsonb
) returns void
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
  insert into public.pampa_booking_events
    (booking_id, actor_id, actor_role, kind, label, amount, fee, net, meta)
  values
    (p_booking, p_actor, coalesce(p_actor_role, 'system'), p_kind, p_label,
     p_amount, p_fee, p_net, coalesce(p_meta, '{}'::jsonb));
$$;

/* The booking as the app renders it — field names unchanged from the object
   booking-sheet.js has always built, so the client layer stays a translation
   rather than a rewrite. */
create or replace function public.pampa_booking_json(p_booking_id uuid)
returns jsonb
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id',              b.id,
    'serviceId',       b.service_id,
    'stylistId',       b.provider_id,
    'stylistName',     b.provider_name,
    'clientId',        b.client_id,
    'clientName',      b.client_name,
    'clientPhone',     b.client_phone,
    'date',            to_char(b.scheduled_date, 'YYYY-MM-DD'),
    'time',            to_char(b.scheduled_time, 'HH24:MI'),
    'loc',             b.loc,
    'areaId',          b.area_id,
    'areaName',        b.area_name,
    'address',         b.address,
    'studioAddress',   b.studio_address,
    'studioAreaName',  b.studio_area_name,
    'km',              b.km,
    'travelFee',       b.travel_fee,
    'price',           b.price,
    'total',           b.total,
    'offer',           b.offer,
    'priceRange',      b.price_range,
    'negotiation',     b.negotiation,
    'status',          b.status,
    'proMarkedDone',   b.pro_marked_done,
    'pay',             b.pay,
    'refund',          b.refund,
    'resolution',      b.resolution,
    'dispute',         b.dispute,
    'createdAt',       b.created_at,
    'acceptedAt',      b.accepted_at,
    'doneAt',          b.done_at,
    'releasedAt',      b.released_at,
    'history',         coalesce((
                         select jsonb_agg(jsonb_build_object('at', e.at, 'label', e.label)
                                          order by e.at, e.id)
                           from public.pampa_booking_events e
                          where e.booking_id = b.id), '[]'::jsonb),
    'events',          coalesce((
                         select jsonb_agg(jsonb_build_object(
                                  'at', e.at, 'kind', e.kind, 'label', e.label,
                                  'role', e.actor_role,
                                  'amount', e.amount, 'fee', e.fee, 'net', e.net)
                                          order by e.at, e.id)
                           from public.pampa_booking_events e
                          where e.booking_id = b.id), '[]'::jsonb)
  ))
  from public.pampa_bookings b
  where b.id = p_booking_id;
$$;

/* ---------- Placing a booking ---------- */

create or replace function public.pampa_booking_create(
  p_token    text,
  p_provider uuid,
  p_service  text,
  p_date     date,
  p_time     time,
  p_loc      text,
  p_address  text default '',
  p_offer    int  default null,
  p_note     text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_client     uuid := public.pampa_auth(p_token);
  v_prov       public.pampa_providers;
  v_client_acc public.pampa_accounts;
  v_area       public.pampa_areas;
  v_svc        public.pampa_services;
  v_band       public.pampa_provider_services;
  v_km         numeric;
  v_travel     int := 0;
  v_area_id    text;
  v_offer      int;
  v_id         uuid;
begin
  select * into v_client_acc from public.pampa_accounts where id = v_client;
  if v_client_acc.role <> 'client' then
    raise exception 'A professional account does not book jobs';
  end if;

  select * into v_prov from public.pampa_providers where account_id = p_provider;
  if v_prov.account_id is null then
    raise exception 'That professional no longer takes bookings';
  end if;

  select * into v_svc from public.pampa_services where id = p_service;
  if v_svc.id is null then
    raise exception 'Unknown service';
  end if;

  /* The band is the professional's published promise: a price outside it is
     refused rather than quietly moved into range. */
  select * into v_band
    from public.pampa_provider_services
   where provider_id = p_provider and service_id = p_service and active;
  if v_band.provider_id is null then
    raise exception 'That professional does not offer this service';
  end if;

  if p_loc not in ('home','studio') then
    raise exception 'Choose whether this is at home or at the studio';
  end if;
  if not v_prov.available then
    raise exception 'That professional is not taking new bookings right now';
  end if;
  if public.pampa_in_session(p_provider) then
    raise exception 'That professional is with a client right now and opens again once that job is settled';
  end if;
  if public.pampa_slot_clash(p_provider, p_date, p_time, p_service) then
    raise exception 'That slot is already taken — pick another time';
  end if;
  /* Past times are refused, but with a couple of minutes of slack: a client
     tapping the next slot as the clock ticks over should not be told they are
     booking the past. */
  if public.pampa_starts_at(p_date, p_time) < now() - interval '2 minutes' then
    raise exception 'That time has already passed';
  end if;

  v_offer := (round(coalesce(p_offer, v_band.min_price) / 50.0) * 50)::int;
  if v_offer < v_band.min_price or v_offer > v_band.max_price then
    raise exception 'That professional works this service between ₦% and ₦%',
      v_band.min_price, v_band.max_price;
  end if;

  /* Where the job happens decides the travel fee, and the fee is computed here
     rather than accepted from the client. The distance is always how far the
     professional is from the client; only a home visit is charged for it,
     which is the same rule travelFeeFor() has always applied. */
  v_km := public.pampa_km(v_prov.lat, v_prov.lng, v_client_acc.lat, v_client_acc.lng);
  if p_loc = 'home' then
    v_area_id := v_client_acc.area_id;
    v_travel  := public.pampa_travel_fee(v_km);
  else
    v_area_id := v_prov.studio_area_id;
    v_km      := public.pampa_km(v_client_acc.lat, v_client_acc.lng, v_prov.lat, v_prov.lng);
    v_travel  := 0;
  end if;

  select * into v_area from public.pampa_areas where id = v_area_id;

  insert into public.pampa_bookings (
    client_id, provider_id, service_id, provider_name, client_name, client_phone,
    scheduled_date, scheduled_time, loc, area_id, area_name, address,
    studio_address, studio_area_name, km, travel_fee, price, total,
    offer, price_range, negotiation
  ) values (
    v_client, p_provider, p_service,
    (select display_name from public.pampa_accounts where id = p_provider),
    v_client_acc.display_name, v_client_acc.phone,
    p_date, p_time, p_loc, v_area_id, coalesce(v_area.name, ''),
    case when p_loc = 'home' then coalesce(p_address, v_client_acc.address) else '' end,
    case when p_loc = 'studio' then v_prov.studio_address else '' end,
    case when p_loc = 'studio'
         then coalesce((select name from public.pampa_areas where id = v_prov.studio_area_id), '')
         else '' end,
    v_km, v_travel, v_offer, v_offer + v_travel,
    jsonb_build_object('price', v_offer, 'at', now(), 'by', v_client_acc.display_name),
    jsonb_build_object('min', v_band.min_price, 'max', v_band.max_price),
    jsonb_build_object(
      'status', 'open',
      'rounds', jsonb_build_array(jsonb_build_object(
        'by', 'client', 'price', v_offer, 'note', coalesce(p_note, ''), 'at', now()))
    )
  )
  returning id into v_id;

  perform public.pampa_journal(
    v_id, v_client, 'client', 'created',
    'Booking placed for ' || to_char(p_date, 'YYYY-MM-DD') || ' at '
      || to_char(p_time, 'HH24:MI') || ' · client offers ₦' || v_offer,
    v_offer, null, null,
    jsonb_build_object('loc', p_loc, 'travelFee', v_travel, 'km', v_km)
  );

  return public.pampa_booking_json(v_id);
end;
$$;

/* ---------- Funding the escrow ---------- */

/* The client's money goes in, and stays in until the job is settled. Paying
   twice on the same booking is the top-up path: an agreed counter that costs
   more than what is already held. */
create or replace function public.pampa_booking_pay(
  p_token   text,
  p_booking uuid,
  p_method  text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := public.pampa_auth(p_token);
  b       public.pampa_bookings;
  v_price int;
  v_due   int;
  v_held  int := 0;
  v_fee   int;
  v_topup int := 0;
begin
  select * into b from public.pampa_bookings where id = p_booking for update;
  if b.id is null then raise exception 'Booking not found'; end if;
  if b.client_id <> v_actor then raise exception 'Only the client funds this booking'; end if;
  if b.status not in ('unpaid','escrowed') then
    raise exception 'This booking is already % — there is nothing to pay', b.status;
  end if;
  if p_method is null or p_method = '' then raise exception 'Choose how you are paying'; end if;

  v_held := coalesce((b.pay->>'amount')::int, 0);

  /* An agreed counter that costs more than the escrow already holds: the
     difference is what this payment is for, and the escrow keeps one reference
     and one fee rather than being split across two payments. The agreed total
     is rebuilt here from the countered price and the travel fee, so the row
     never holds a price and a total that disagree. */
  if b.negotiation->>'status' = 'countered'
     and (b.negotiation->>'topUp') is not null then
    v_price := (round((b.negotiation->>'price')::numeric / 50) * 50)::int;
    v_due   := v_price + b.travel_fee;
    v_topup := greatest(0, v_due - v_held);
    if v_topup = 0 then
      raise exception 'Nothing left to top up on this booking';
    end if;

    v_fee := public.pampa_fee(v_due);
    update public.pampa_bookings
       set price  = v_price,
           total  = v_due,
           pay    = jsonb_build_object(
                      'method', p_method, 'ref', b.pay->>'ref',
                      'amount', v_due, 'fee', v_fee, 'netToPro', v_due - v_fee,
                      'paidAt', b.pay->>'paidAt',
                      'toppedUpAt', now(), 'topUp', v_topup),
           negotiation = (b.negotiation - 'topUp') ||
                         jsonb_build_object('status', 'agreed', 'agreed', v_price),
           status = 'confirmed',
           accepted_at = now()
     where id = p_booking;

    perform public.pampa_journal(
      p_booking, v_actor, 'client', 'topup',
      'Client topped up ₦' || v_topup || ' into escrow — price agreed at ₦' || v_price,
      v_topup, v_fee, v_due - v_fee,
      jsonb_build_object('method', p_method, 'total', v_due)
    );

    return public.pampa_booking_json(p_booking);
  end if;

  if b.status = 'escrowed' then
    raise exception 'This booking is already funded — waiting on the professional';
  end if;

  v_fee := public.pampa_fee(b.total);

  update public.pampa_bookings
     set pay = jsonb_build_object(
                 'method', p_method,
                 'ref', 'ESC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
                 'amount', b.total, 'fee', v_fee, 'netToPro', b.total - v_fee,
                 'paidAt', now()),
         status = 'escrowed'
   where id = p_booking;

  perform public.pampa_journal(
    p_booking, v_actor, 'client', 'funded',
    'Client paid ₦' || b.total || ' into escrow via ' || p_method,
    b.total, v_fee, b.total - v_fee,
    jsonb_build_object('method', p_method)
  );

  return public.pampa_booking_json(p_booking);
end;
$$;

/* ---------- Agreeing a price ---------- */

/* The professional takes the client's offer as it stands. */
create or replace function public.pampa_booking_accept(p_token text, p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := public.pampa_auth(p_token);
  b       public.pampa_bookings;
begin
  select * into b from public.pampa_bookings where id = p_booking for update;
  if b.id is null then raise exception 'Booking not found'; end if;
  if b.provider_id <> v_actor then raise exception 'Only the professional accepts this booking'; end if;
  if b.status <> 'escrowed' then raise exception 'This request is already %', b.status; end if;

  update public.pampa_bookings
     set status = 'confirmed',
         accepted_at = now(),
         negotiation = coalesce(b.negotiation, '{}'::jsonb) ||
                       jsonb_build_object('status', 'agreed', 'agreed', b.price)
   where id = p_booking;

  perform public.pampa_journal(
    p_booking, v_actor, 'pro', 'accepted',
    'Professional accepted ₦' || b.price || ' — job confirmed', b.price, null, null);

  return public.pampa_booking_json(p_booking);
end;
$$;

/* An answer to the offer: a price of the professional's own, inside the band
   they publish. Outside it is refused rather than clamped, because the band is
   what their card promises the client across the whole city. */
create or replace function public.pampa_booking_counter(
  p_token   text,
  p_booking uuid,
  p_price   int,
  p_note    text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := public.pampa_auth(p_token);
  b       public.pampa_bookings;
  v_band  public.pampa_provider_services;
  v_who   text;
  v_price int;
begin
  select * into b from public.pampa_bookings where id = p_booking for update;
  if b.id is null then raise exception 'Booking not found'; end if;
  if v_actor <> b.client_id and v_actor <> b.provider_id then
    raise exception 'That booking is not yours';
  end if;
  if b.status <> 'escrowed' then
    raise exception 'A price can only be answered while the request is awaiting acceptance';
  end if;
  if b.negotiation->>'status' = 'countered' then
    raise exception 'That price is already with the other side';
  end if;

  v_price := round(coalesce(p_price, 0) / 50.0) * 50;
  if v_price <= 0 then raise exception 'Enter the price you are proposing'; end if;

  if v_actor = b.provider_id then
    v_who := 'pro';
    select * into v_band
      from public.pampa_provider_services
     where provider_id = b.provider_id and service_id = b.service_id;
    if v_price < v_band.min_price or v_price > v_band.max_price then
      raise exception 'Your published range for this service is ₦% – ₦%',
        v_band.min_price, v_band.max_price;
    end if;
  else
    v_who := 'client';
    select * into v_band
      from public.pampa_provider_services
     where provider_id = b.provider_id and service_id = b.service_id;
    if v_price < v_band.min_price or v_price > v_band.max_price then
      raise exception 'That professional works this service between ₦% and ₦%',
        v_band.min_price, v_band.max_price;
    end if;
  end if;

  update public.pampa_bookings
     set negotiation = jsonb_build_object(
           'status', 'countered',
           'price', v_price,
           'rounds', coalesce(b.negotiation->'rounds', '[]'::jsonb)
                     || jsonb_build_array(jsonb_build_object(
                          'by', v_who, 'price', v_price,
                          'note', coalesce(p_note, ''), 'at', now()))
         ) || case when v_who = 'client'
                   then jsonb_build_object('offer', jsonb_build_object(
                          'price', v_price, 'at', now(),
                          'by', (select display_name from public.pampa_accounts
                                  where id = b.client_id)))
                   else '{}'::jsonb end
   where id = p_booking;

  perform public.pampa_journal(
    p_booking, v_actor, v_who, v_who || '-counter',
    case when v_who = 'pro'
         then 'Professional countered ₦' || v_price || ' for this job — waiting on the client'
         else 'Client came back with ₦' || v_price || ' — waiting on the professional' end,
    v_price, null, null);

  return public.pampa_booking_json(p_booking);
end;
$$;

/* The other side accepts the price on the table. If it costs more than the
   escrow holds, nothing moves until the difference is funded — this stops short
   and says what is owed. If it costs less, the difference goes straight back. */
create or replace function public.pampa_booking_agree(p_token text, p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := public.pampa_auth(p_token);
  b       public.pampa_bookings;
  v_price int;
  v_held  int;
  v_due   int;
  v_extra int;
  v_back  int;
  v_fee   int;
  v_who   text;
begin
  select * into b from public.pampa_bookings where id = p_booking for update;
  if b.id is null then raise exception 'Booking not found'; end if;
  if b.status <> 'escrowed' then raise exception 'This booking is already %', b.status; end if;
  if coalesce(b.negotiation->>'status', '') <> 'countered' then
    raise exception 'There is no price on the table to agree to';
  end if;

  v_who := coalesce((b.negotiation->'rounds'->-1)->>'by', '');
  /* Whoever put the last price on the table cannot be the one accepting it. */
  if (v_who = 'pro' and v_actor <> b.client_id)
     or (v_who = 'client' and v_actor <> b.provider_id) then
    raise exception 'That price is not yours to accept';
  end if;

  v_price := (b.negotiation->>'price')::int;
  v_held  := coalesce((b.pay->>'amount')::int, 0);
  v_due   := v_price + b.travel_fee;
  v_extra := greatest(0, v_due - v_held);

  if v_extra > 0 then
    /* Owed, not agreed. The booking stays in escrow until the money lands. */
    update public.pampa_bookings
       set negotiation = b.negotiation || jsonb_build_object('topUp', v_extra)
     where id = p_booking;

    perform public.pampa_journal(
      p_booking, v_actor, case when v_actor = b.client_id then 'client' else 'pro' end,
      'agreed-pending',
      'Price agreed at ₦' || v_price || ' — ₦' || v_extra || ' more must reach escrow',
      v_extra, null, null, jsonb_build_object('due', v_due));

    return public.pampa_booking_json(p_booking);
  end if;

  v_back := greatest(0, v_held - v_due);
  v_fee  := public.pampa_fee(v_due);

  update public.pampa_bookings
     set price  = v_price,
         total  = v_due,
         status = 'confirmed',
         accepted_at = now(),
         pay = jsonb_build_object(
                 'method', b.pay->>'method', 'ref', b.pay->>'ref',
                 'amount', v_due, 'fee', v_fee, 'netToPro', v_due - v_fee,
                 'paidAt', b.pay->>'paidAt'),
         refund = case when v_back > 0
                    then jsonb_build_object('amount', v_back, 'fee', 0,
                                            'at', now(), 'reason', 'repriced')
                    else b.refund end,
         negotiation = (b.negotiation - 'price' - 'topUp')
                       || jsonb_build_object('status', 'agreed', 'agreed', v_price)
   where id = p_booking;

  perform public.pampa_journal(
    p_booking, v_actor, case when v_actor = b.client_id then 'client' else 'pro' end,
    'agreed',
    'Price agreed at ₦' || v_price
      || case when v_back > 0 then ' · ₦' || v_back || ' came back from escrow' else '' end,
    v_due, v_fee, v_due - v_fee, jsonb_build_object('refunded', v_back));

  return public.pampa_booking_json(p_booking);
end;
$$;

/* Saying no to a price. Nothing was done for the money, so all of it goes back. */
create or replace function public.pampa_booking_counter_decline(p_token text, p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := public.pampa_auth(p_token);
  b       public.pampa_bookings;
  v_price int;
  v_held  int;
  v_role  text;
begin
  select * into b from public.pampa_bookings where id = p_booking for update;
  if b.id is null then raise exception 'Booking not found'; end if;
  if v_actor <> b.client_id and v_actor <> b.provider_id then
    raise exception 'That booking is not yours';
  end if;
  if coalesce(b.negotiation->>'status', '') <> 'countered' then
    raise exception 'There is no price to decline on this booking';
  end if;

  v_price := (b.negotiation->>'price')::int;
  v_held  := coalesce((b.pay->>'amount')::int, 0);
  v_role  := case when v_actor = b.client_id then 'client' else 'pro' end;

  update public.pampa_bookings
     set status = 'declined',
         refund = case when v_held > 0
                   then jsonb_build_object('amount', v_held, 'fee', 0,
                                           'at', now(), 'reason', 'declined')
                   else refund end,
         negotiation = b.negotiation || jsonb_build_object('status', 'declined')
   where id = p_booking;

  perform public.pampa_journal(
    p_booking, v_actor, v_role, 'declined-price',
    '₦' || v_price || ' was declined — refunding in full',
    v_held, 0, 0);

  return public.pampa_booking_json(p_booking);
end;
$$;

/* The professional turns the request down without naming a price. */
create or replace function public.pampa_booking_decline(p_token text, p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := public.pampa_auth(p_token);
  b       public.pampa_bookings;
  v_held  int;
begin
  select * into b from public.pampa_bookings where id = p_booking for update;
  if b.id is null then raise exception 'Booking not found'; end if;
  if b.provider_id <> v_actor then raise exception 'Only the professional declines a request'; end if;
  if b.status <> 'escrowed' then raise exception 'Only a request awaiting you can be declined'; end if;

  v_held := coalesce((b.pay->>'amount')::int, 0);

  update public.pampa_bookings
     set status = 'declined',
         refund = case when v_held > 0
                   then jsonb_build_object('amount', v_held, 'fee', 0,
                                           'at', now(), 'reason', 'declined')
                   else refund end
   where id = p_booking;

  perform public.pampa_journal(
    p_booking, v_actor, 'pro', 'declined',
    'Professional declined the job — ₦' || v_held || ' refunded to the client',
    v_held, 0, 0);

  return public.pampa_booking_json(p_booking);
end;
$$;

/* The professional says the work is done. It changes nothing about the money —
   it is what lets the client release it. */
create or replace function public.pampa_booking_complete(p_token text, p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := public.pampa_auth(p_token);
  b       public.pampa_bookings;
begin
  select * into b from public.pampa_bookings where id = p_booking for update;
  if b.id is null then raise exception 'Booking not found'; end if;
  if b.provider_id <> v_actor then raise exception 'Only the professional marks the job done'; end if;
  if b.status <> 'confirmed' then raise exception 'Only a confirmed job can be marked done'; end if;
  if b.pro_marked_done then raise exception 'Already marked done — waiting for the client'; end if;

  update public.pampa_bookings
     set pro_marked_done = true, done_at = now()
   where id = p_booking;

  perform public.pampa_journal(
    p_booking, v_actor, 'pro', 'done', 'Professional marked the job done');

  return public.pampa_booking_json(p_booking);
end;
$$;

/* ---------- Releasing the money ---------- */

/* The client's yes, and the only path that pays a professional for a job that
   was not disputed. The rating rides along, because releasing is the moment the
   client knows what the work was like. */
create or replace function public.pampa_booking_release(
  p_token   text,
  p_booking uuid,
  p_rating  int default null,
  p_note    text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := public.pampa_auth(p_token);
  b       public.pampa_bookings;
  v_net   int;
  v_fee   int;
  v_gross int;
  v_dest  uuid;
  v_rating int;
begin
  select * into b from public.pampa_bookings where id = p_booking for update;
  if b.id is null then raise exception 'Booking not found'; end if;
  if b.client_id <> v_actor then raise exception 'Only the client releases the payment'; end if;
  if b.status = 'released' then raise exception 'Payment has already been released'; end if;
  if b.status = 'disputed' then raise exception 'Funds stay held while this is under review'; end if;
  if b.status <> 'confirmed' then raise exception 'Only a confirmed job can be released'; end if;
  if b.pay is null then raise exception 'No escrowed payment on this booking'; end if;

  /* The professional marking it done is the polite path; the appointment time
     passing is the other one, so a client is never trapped by a professional
     who has gone quiet. */
  if not (b.pro_marked_done
          or public.pampa_starts_at(b.scheduled_date, b.scheduled_time) <= now()) then
    raise exception 'Wait until the professional marks the job done, or the appointment time passes';
  end if;

  v_gross := (b.pay->>'amount')::int;
  v_fee   := coalesce((b.pay->>'fee')::int, public.pampa_fee(v_gross));
  v_net   := v_gross - v_fee;

  select id into v_dest
    from public.pampa_payout_destinations
   where account_id = b.provider_id and is_default
   limit 1;

  insert into public.pampa_payouts
    (booking_id, provider_id, destination_id, gross, fee, net, method, ref, status)
  values
    (p_booking, b.provider_id, v_dest, v_gross, v_fee, v_net,
     'escrow', 'PAY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
     case when v_dest is null then 'pending' else 'sent' end)
  on conflict (booking_id) do nothing;

  v_rating := case when p_rating is null then null
                   else greatest(1, least(5, p_rating)) end;

  update public.pampa_bookings
     set status = 'released', released_at = now()
   where id = p_booking;

  if v_rating is not null then
    update public.pampa_providers
       set rating_sum   = rating_sum + v_rating,
           rating_count = rating_count + 1,
           jobs         = jobs + 1
     where account_id = b.provider_id;
  else
    update public.pampa_providers
       set jobs = jobs + 1
     where account_id = b.provider_id;
  end if;

  perform public.pampa_journal(
    p_booking, v_actor, 'client', 'released',
    'Client released ₦' || v_net || ' to ' || b.provider_name
      || case when v_rating is not null then ' · rated ' || v_rating || '/5' else '' end,
    v_gross, v_fee, v_net,
    jsonb_build_object('rating', v_rating,
                       'note', nullif(btrim(coalesce(p_note, '')), ''),
                       'destination', v_dest));

  return public.pampa_booking_json(p_booking);
end;
$$;

/* The client calls the job off. The cancellation fee is charged only once the
   professional had accepted — before that nobody has been kept waiting. */
create or replace function public.pampa_booking_cancel(p_token text, p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := public.pampa_auth(p_token);
  b       public.pampa_bookings;
  v_held  int;
  v_fee   int;
  v_back  int;
begin
  select * into b from public.pampa_bookings where id = p_booking for update;
  if b.id is null then raise exception 'Booking not found'; end if;
  if b.client_id <> v_actor then raise exception 'Only the client cancels this booking'; end if;
  if b.status = 'released' then raise exception 'This job is completed and paid'; end if;
  if b.status in ('cancelled','declined') then raise exception 'This booking is already cancelled'; end if;
  if b.status = 'disputed' then raise exception 'This booking is under review'; end if;
  if b.status = 'settled' then raise exception 'The resolution desk already settled this booking'; end if;

  v_held := coalesce((b.pay->>'amount')::int, 0);

  if b.status = 'unpaid' then
    update public.pampa_bookings set status = 'cancelled' where id = p_booking;
    perform public.pampa_journal(
      p_booking, v_actor, 'client', 'cancelled', 'Cancelled before payment');
    return public.pampa_booking_json(p_booking);
  end if;

  /* Escrowed means the professional has not accepted yet, so no fee; confirmed
     means they had already cleared the slot for this client, so 10% is the
     cost of the change of mind. */
  v_fee  := case when b.status = 'confirmed' then public.pampa_cancel_fee(v_held) else 0 end;
  v_back := v_held - v_fee;

  update public.pampa_bookings
     set status = 'cancelled',
         refund = jsonb_build_object('amount', v_back, 'fee', v_fee,
                                     'at', now(), 'reason', 'cancelled')
   where id = p_booking;

  perform public.pampa_journal(
    p_booking, v_actor, 'client', 'cancelled',
    case when v_fee > 0
         then 'Client cancelled — ₦' || v_back || ' refunded (₦' || v_fee || ' cancellation fee)'
         else 'Client cancelled — ₦' || v_back || ' refunded in full' end,
    v_held, v_fee, v_back);

  return public.pampa_booking_json(p_booking);
end;
$$;

/* ---------- Disputes ---------- */

create or replace function public.pampa_booking_dispute(
  p_token   text,
  p_booking uuid,
  p_reason  text,
  p_photos  jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := public.pampa_auth(p_token);
  b       public.pampa_bookings;
  v_pics  jsonb := coalesce(p_photos, '[]'::jsonb);
begin
  select * into b from public.pampa_bookings where id = p_booking for update;
  if b.id is null then raise exception 'Booking not found'; end if;
  if b.client_id <> v_actor then raise exception 'Only the client can report a problem'; end if;
  if b.status <> 'confirmed' then raise exception 'Only a confirmed job can be reported'; end if;

  update public.pampa_bookings
     set status = 'disputed',
         dispute = jsonb_build_object(
           'reason', coalesce(nullif(btrim(p_reason), ''), 'Something else'),
           'at', now(),
           'by', (select display_name from public.pampa_accounts where id = v_actor),
           'photos', v_pics)
   where id = p_booking;

  perform public.pampa_journal(
    p_booking, v_actor, 'client', 'disputed',
    'Client reported a problem: ' || coalesce(nullif(btrim(p_reason), ''), 'Something else')
      || case when jsonb_array_length(v_pics) > 0
              then ' with ' || jsonb_array_length(v_pics) || ' photo'
                   || case when jsonb_array_length(v_pics) = 1 then '' else 's' end
              else '' end
      || ' — funds held for review',
    null, null, null, jsonb_build_object('photos', jsonb_array_length(v_pics)));

  return public.pampa_booking_json(p_booking);
end;
$$;

/* The professional's side of the story, once. */
create or replace function public.pampa_booking_dispute_reply(
  p_token   text,
  p_booking uuid,
  p_note    text,
  p_photos  jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := public.pampa_auth(p_token);
  b       public.pampa_bookings;
  v_pics  jsonb := coalesce(p_photos, '[]'::jsonb);
  v_text  text  := btrim(coalesce(p_note, ''));
begin
  select * into b from public.pampa_bookings where id = p_booking for update;
  if b.id is null then raise exception 'Booking not found'; end if;
  if b.provider_id <> v_actor then
    raise exception 'That dispute is on another professional''s job';
  end if;
  if b.status <> 'disputed' then raise exception 'This booking is not under review'; end if;
  if b.dispute ? 'response' then raise exception 'You have already responded to this dispute'; end if;
  if v_text = '' and jsonb_array_length(v_pics) = 0 then
    raise exception 'Add a statement or a photo to your response';
  end if;

  update public.pampa_bookings
     set dispute = b.dispute || jsonb_build_object('response', jsonb_build_object(
           'note', v_text, 'photos', v_pics, 'at', now(),
           'by', (select display_name from public.pampa_accounts where id = v_actor)))
   where id = p_booking;

  perform public.pampa_journal(
    p_booking, v_actor, 'pro', 'dispute-reply',
    'Professional responded'
      || case when jsonb_array_length(v_pics) > 0
              then ' with ' || jsonb_array_length(v_pics) || ' photo'
                   || case when jsonb_array_length(v_pics) = 1 then '' else 's' end
              else '' end
      || case when v_text <> '' then ': "' || left(v_text, 70) || '"' else '' end,
    null, null, null, jsonb_build_object('photos', jsonb_array_length(v_pics)));

  return public.pampa_booking_json(p_booking);
end;
$$;

/* The resolution desk. A mediator's decision is the one transition a client and
   a professional cannot make between them, so it is its own flag on the account
   and its own function here. */
create or replace function public.pampa_desk_settle(
  p_token   text,
  p_booking uuid,
  p_outcome text,
  p_percent int default 50
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := public.pampa_auth(p_token);
  v_desk  boolean;
  b       public.pampa_bookings;
  v_amount int;
  v_pct   int;
  v_gross int;
  v_fee   int;
  v_to_pro int;
  v_to_client int;
  v_res   jsonb;
  v_dest  uuid;
begin
  select desk into v_desk from public.pampa_accounts where id = v_actor;
  if not coalesce(v_desk, false) then
    raise exception 'Only the resolution desk settles a dispute' using errcode = '42501';
  end if;

  select * into b from public.pampa_bookings where id = p_booking for update;
  if b.id is null then raise exception 'Booking not found'; end if;
  if b.status <> 'disputed' then raise exception 'Only a disputed booking can be settled'; end if;
  if b.pay is null or coalesce((b.pay->>'amount')::int, 0) = 0 then
    raise exception 'There is no escrowed money on this booking';
  end if;

  v_amount := (b.pay->>'amount')::int;

  if p_outcome = 'refund' then
    v_res := jsonb_build_object('type', 'refund', 'toClient', v_amount, 'toPro', 0, 'fee', 0);
    update public.pampa_bookings
       set status = 'settled',
           resolution = v_res || jsonb_build_object('at', now(), 'by', 'Resolution desk'),
           refund = jsonb_build_object('amount', v_amount, 'fee', 0,
                                       'at', now(), 'reason', 'dispute-refund')
     where id = p_booking;
    perform public.pampa_journal(
      p_booking, v_actor, 'desk', 'settled',
      'Desk refunded ₦' || v_amount || ' to the client in full', v_amount, 0, 0);

  elsif p_outcome = 'release' then
    v_fee := coalesce((b.pay->>'fee')::int, public.pampa_fee(v_amount));
    v_res := jsonb_build_object('type', 'release', 'toClient', 0,
                                'toPro', v_amount - v_fee, 'fee', v_fee);
    select id into v_dest from public.pampa_payout_destinations
      where account_id = b.provider_id and is_default limit 1;
    insert into public.pampa_payouts
      (booking_id, provider_id, destination_id, gross, fee, net, method, ref, status)
    values (p_booking, b.provider_id, v_dest, v_amount, v_fee, v_amount - v_fee,
            'escrow', 'PAY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
            case when v_dest is null then 'pending' else 'sent' end)
    on conflict (booking_id) do nothing;
    update public.pampa_bookings
       set status = 'settled', released_at = now(),
           resolution = v_res || jsonb_build_object('at', now(), 'by', 'Resolution desk')
     where id = p_booking;
    perform public.pampa_journal(
      p_booking, v_actor, 'desk', 'settled',
      'Desk released ₦' || (v_amount - v_fee) || ' to ' || b.provider_name,
      v_amount, v_fee, v_amount - v_fee);

  elsif p_outcome = 'split' then
    v_pct   := greatest(1, least(99, coalesce(p_percent, 50)));
    /* The professional's share carries the fee; the client gets the rest. The
       percentage is applied to the escrow and rounded to ₦50, so the two halves
       always add back up to what was held. */
    v_gross := (round(v_amount * v_pct / 100.0 / 50) * 50)::int;
    v_fee   := public.pampa_fee(v_gross);
    v_to_pro    := v_gross - v_fee;
    v_to_client := v_amount - v_gross;

    v_res := jsonb_build_object('type', 'split', 'percent', v_pct,
                                'proGross', v_gross, 'fee', v_fee,
                                'toClient', v_to_client, 'toPro', v_to_pro);

    if v_gross > 0 then
      select id into v_dest from public.pampa_payout_destinations
        where account_id = b.provider_id and is_default limit 1;
      insert into public.pampa_payouts
        (booking_id, provider_id, destination_id, gross, fee, net, method, ref, status)
      values (p_booking, b.provider_id, v_dest, v_gross, v_fee, v_to_pro,
              'escrow', 'PAY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
              case when v_dest is null then 'pending' else 'sent' end)
      on conflict (booking_id) do nothing;
    end if;

    update public.pampa_bookings
       set status = 'settled',
           released_at = case when v_gross > 0 then now() else released_at end,
           resolution = v_res || jsonb_build_object('at', now(), 'by', 'Resolution desk'),
           refund = case when v_to_client > 0
                     then jsonb_build_object('amount', v_to_client, 'fee', 0,
                                             'at', now(), 'reason', 'dispute-split')
                     else refund end
     where id = p_booking;

    perform public.pampa_journal(
      p_booking, v_actor, 'desk', 'settled',
      'Desk split escrow ' || v_pct || '/' || (100 - v_pct) || ': ₦' || v_to_client
        || ' back to the client, ₦' || v_to_pro || ' to ' || b.provider_name,
      v_amount, v_fee, v_to_pro, jsonb_build_object('percent', v_pct));
  else
    raise exception 'Unknown settlement outcome';
  end if;

  return public.pampa_booking_json(p_booking);
end;
$$;

/* ---------- Reading it back ---------- */

/* Everything the signed-in account is party to. The app splits this into the
   client's list and the professional's jobs; the database just answers "yours". */
create or replace function public.pampa_bookings(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := public.pampa_auth(p_token);
begin
  return coalesce((
    select jsonb_agg(public.pampa_booking_json(b.id)
                     order by b.scheduled_date desc, b.scheduled_time desc)
      from public.pampa_bookings b
     where b.client_id = v_actor or b.provider_id = v_actor
  ), '[]'::jsonb);
end;
$$;

/* What the desk is looking at: every dispute, oldest first, so the one that has
   been waiting longest is the one at the top. */
create or replace function public.pampa_desk_queue(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := public.pampa_auth(p_token);
  v_desk  boolean;
begin
  select desk into v_desk from public.pampa_accounts where id = v_actor;
  if not coalesce(v_desk, false) then
    raise exception 'Only the resolution desk sees this queue' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(public.pampa_booking_json(b.id)
                     order by b.scheduled_date, b.scheduled_time)
      from public.pampa_bookings b
     where b.status = 'disputed'
  ), '[]'::jsonb);
end;
$$;

/* Where the money goes when a job is released. The first destination a
   professional adds becomes their default, so a payout always has somewhere to
   land — and if there is none, the payout is recorded as pending rather than
   silently sent nowhere. */
create or replace function public.pampa_add_destination(
  p_token   text,
  p_kind    text,
  p_label   text,
  p_details jsonb,
  p_default boolean default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := public.pampa_auth(p_token);
  v_any   boolean;
  v_make_default boolean;
begin
  if p_kind not in ('bank','crypto') then
    raise exception 'A payout destination is a bank account or a wallet';
  end if;
  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'Destination details must be an object';
  end if;

  select exists (select 1 from public.pampa_payout_destinations where account_id = v_actor)
    into v_any;
  v_make_default := coalesce(p_default, not v_any);

  if v_make_default then
    update public.pampa_payout_destinations
       set is_default = false
     where account_id = v_actor and is_default;
  end if;

  insert into public.pampa_payout_destinations
    (account_id, kind, label, details, is_default)
  values (v_actor, p_kind, coalesce(p_label, ''), p_details, v_make_default);

  return public.pampa_wallet(p_token);
end;
$$;

/* The professional's side of the money: what has been paid out, to where, and
   what is still held in escrow on jobs that have not settled. */
create or replace function public.pampa_wallet(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := public.pampa_auth(p_token);
begin
  return jsonb_build_object(
    'destinations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'kind', d.kind, 'label', d.label,
               'details', d.details, 'default', d.is_default)
             order by d.is_default desc, d.created_at)
        from public.pampa_payout_destinations d
       where d.account_id = v_actor), '[]'::jsonb),
    'payouts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'bookingId', p.booking_id, 'gross', p.gross,
               'fee', p.fee, 'net', p.net, 'status', p.status,
               'ref', p.ref, 'at', p.created_at, 'destination', p.destination_id)
             order by p.created_at desc)
        from public.pampa_payouts p
       where p.provider_id = v_actor), '[]'::jsonb),
    'held', coalesce((
      select sum((b.pay->>'netToPro')::int)
        from public.pampa_bookings b
       where b.provider_id = v_actor
         and b.status in ('escrowed','confirmed','disputed')), 0)
  );
end;
$$;

/* ---------- Discovery ---------- */

/* Everyone a client could book, nearest first, with the two facts that decide
   whether they actually can: the switch, and whether they are with somebody.
   Distance is measured client-side rather than against the studio area, so a
   professional two kilometres away is closer than one in the same area. */
create or replace function public.pampa_directory(
  p_token text,
  p_lat   numeric default null,
  p_lng   numeric default null,
  p_trade text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := public.pampa_auth(p_token);
  v_acc   public.pampa_accounts;
  v_lat   numeric;
  v_lng   numeric;
begin
  select * into v_acc from public.pampa_accounts where id = v_actor;
  /* No coordinates on the request and none on the account: distance cannot be
     answered, and saying null is more honest than pretending zero. */
  v_lat := coalesce(p_lat, v_acc.lat);
  v_lng := coalesce(p_lng, v_acc.lng);

  return coalesce((
    select jsonb_agg(rows.item order by rows.km_num nulls last, rows.nm)
      from (
        select public.pampa_km(v_lat, v_lng, pr.lat, pr.lng) as km_num,
               a.display_name as nm,
               jsonb_build_object(
                 'id',        a.id,
                 'name',      a.display_name,
                 'dp',        nullif(a.avatar, ''),
                 'trade',     pr.trade,
                 'tradeName', t.name,
                 'skill',     t.name,
                 'bio',       pr.bio,
                 'studio',    pr.studio_area_id,
                 'studioName', sa.name,
                 'studioAddress', coalesce(nullif(pr.studio_address, ''), a.address),
                 'rating',    pr.rating_avg,
                 'ratings',   pr.rating_count,
                 'jobs',      pr.jobs,
                 'available', pr.available,
                 'km',        public.pampa_km(v_lat, v_lng, pr.lat, pr.lng),
                 'sameArea',  (pr.studio_area_id = v_acc.area_id),
                 /* Being with a client is not the same as being switched off,
                    and the client is owed the difference: one lookup answers
                    both, and names who the professional is busy with. */
                 'inSession', (sess.who is not null),
                 'busyWith',  sess.who,
                 'since',     sess.since,
                 'rates',     coalesce((
                                select jsonb_object_agg(ps.service_id,
                                         jsonb_build_object('min', ps.min_price,
                                                            'max', ps.max_price))
                                  from public.pampa_provider_services ps
                                 where ps.provider_id = a.id and ps.active), '{}'::jsonb),
                 'services',  coalesce((
                                select jsonb_agg(ps.service_id order by s2.sort)
                                  from public.pampa_provider_services ps
                                  join public.pampa_services s2 on s2.id = ps.service_id
                                 where ps.provider_id = a.id and ps.active), '[]'::jsonb)
               ) as item
          from public.pampa_providers pr
          join public.pampa_accounts a on a.id = pr.account_id
          join public.pampa_trades   t on t.id = pr.trade
          left join public.pampa_areas sa on sa.id = pr.studio_area_id
          left join lateral (
            select b2.client_name as who,
                   to_char(b2.scheduled_time, 'HH24:MI') as since
              from public.pampa_bookings b2
             where b2.provider_id = pr.account_id
               and b2.status in ('escrowed','confirmed','disputed')
               and public.pampa_starts_at(b2.scheduled_date, b2.scheduled_time) <= now()
             order by b2.scheduled_date, b2.scheduled_time
             limit 1
          ) sess on true
         where a.id <> v_actor
           and (p_trade is null or pr.trade = p_trade)
      ) rows
  ), '[]'::jsonb);
end;
$$;

/* One professional's page: their bio, their rates, their history and how far
   they reach from their studio. */
create or replace function public.pampa_provider_public(
  p_token    text,
  p_provider uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := public.pampa_auth(p_token);
  v_acc   public.pampa_accounts;
  r       public.pampa_providers;
begin
  select * into v_acc from public.pampa_accounts where id = v_actor;
  select * into r from public.pampa_providers where account_id = p_provider;
  if r.account_id is null then raise exception 'That professional no longer takes bookings'; end if;

  return jsonb_build_object(
    'id',        r.account_id,
    'name',      (select display_name from public.pampa_accounts where id = r.account_id),
    'dp',        (select nullif(avatar, '') from public.pampa_accounts where id = r.account_id),
    'trade',     r.trade,
    'tradeName', (select name from public.pampa_trades where id = r.trade),
    'bio',       r.bio,
    'socials',   (select socials from public.pampa_accounts where id = r.account_id),
    'studio',    r.studio_area_id,
    'studioName', (select name from public.pampa_areas where id = r.studio_area_id),
    'studioAddress', coalesce(nullif(r.studio_address, ''),
                              (select address from public.pampa_accounts where id = r.account_id)),
    'radiusKm',  r.visit_radius_km,
    'rating',    r.rating_avg,
    'ratings',   r.rating_count,
    'jobs',      r.jobs,
    'available', r.available,
    'inSession', public.pampa_in_session(r.account_id),
    'km',        public.pampa_km(v_acc.lat, v_acc.lng, r.lat, r.lng),
    'sameArea',  (r.studio_area_id = v_acc.area_id),
    /* Every service they offer with their own band, in the catalogue's order. */
    'services',  coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'dur', s.dur_min,
               'price', s.price, 'ico', s.ico,
               'range', jsonb_build_object('min', ps.min_price, 'max', ps.max_price))
             order by s.sort)
        from public.pampa_provider_services ps
        join public.pampa_services s on s.id = ps.service_id
       where ps.provider_id = r.account_id and ps.active), '[]'::jsonb),
    /* The areas they will travel to, derived from the radius rather than a
       hand-drawn map: a registered professional is never asked to draw one. */
    'coverage',  coalesce((
      select jsonb_agg(jsonb_build_object('id', ar.id, 'name', ar.name,
                                          'km', public.pampa_km(r.lat, r.lng, ar.lat, ar.lng))
             order by public.pampa_km(r.lat, r.lng, ar.lat, ar.lng))
        from public.pampa_areas ar
       where public.pampa_km(r.lat, r.lng, ar.lat, ar.lng) is not null
         and public.pampa_km(r.lat, r.lng, ar.lat, ar.lng) <= r.visit_radius_km), '[]'::jsonb)
  );
end;
$$;

/* ---------- Lock the doors ---------- */
/* Same treatment as 0001: the new tables are shut, and every function is
   revoked from PUBLIC (which PostgreSQL grants EXECUTE to by default) before
   the app-facing list is granted back. This is repeated in full, rather than
   only for what is new, so the grants are readable as the whole public API in
   one place. */

alter table public.pampa_bookings          enable row level security;
alter table public.pampa_booking_events    enable row level security;
alter table public.pampa_payouts           enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant usage on schema public to anon, authenticated;

-- 0001
grant execute on function public.pampa_register(text, text, text, text, text, text, text, numeric, numeric, text) to anon;
grant execute on function public.pampa_login(text, text)               to anon;
grant execute on function public.pampa_logout(text)                    to anon;
grant execute on function public.pampa_me(text)                        to anon;
grant execute on function public.pampa_update_profile(text, jsonb)     to anon;
grant execute on function public.pampa_set_availability(text, boolean) to anon;
grant execute on function public.pampa_set_rates(text, jsonb)          to anon;
grant execute on function public.pampa_trades()                        to anon;
grant execute on function public.pampa_services()                      to anon;
grant execute on function public.pampa_areas()                         to anon;

-- 0002
grant execute on function public.pampa_booking_create(text, uuid, text, date, time, text, text, int, text) to anon;
grant execute on function public.pampa_booking_pay(text, uuid, text)          to anon;
grant execute on function public.pampa_booking_accept(text, uuid)             to anon;
grant execute on function public.pampa_booking_counter(text, uuid, int, text) to anon;
grant execute on function public.pampa_booking_agree(text, uuid)              to anon;
grant execute on function public.pampa_booking_counter_decline(text, uuid)    to anon;
grant execute on function public.pampa_booking_decline(text, uuid)            to anon;
grant execute on function public.pampa_booking_complete(text, uuid)           to anon;
grant execute on function public.pampa_booking_release(text, uuid, int, text) to anon;
grant execute on function public.pampa_booking_cancel(text, uuid)             to anon;
grant execute on function public.pampa_booking_dispute(text, uuid, text, jsonb)        to anon;
grant execute on function public.pampa_booking_dispute_reply(text, uuid, text, jsonb)  to anon;
grant execute on function public.pampa_bookings(text)                         to anon;
grant execute on function public.pampa_desk_queue(text)                       to anon;
grant execute on function public.pampa_desk_settle(text, uuid, text, int)     to anon;
grant execute on function public.pampa_add_destination(text, text, text, jsonb, boolean) to anon;
grant execute on function public.pampa_wallet(text)                           to anon;
grant execute on function public.pampa_directory(text, numeric, numeric, text) to anon;
grant execute on function public.pampa_provider_public(text, uuid)            to anon;
