/* =============================================================================
 * Pampa — 0001 — accounts, trades, services and the provider directory
 *
 * Two things shape everything below.
 *
 * 1. Pampa does not use Supabase Auth. People sign in with the phone number or
 *    username they already have plus a password, and are never asked for a
 *    code. So accounts live in a table this app owns, passwords are bcrypt
 *    hashes made by pgcrypto, and a signed-in device holds a session token
 *    instead of a JWT.
 *
 * 2. Because there is no JWT there is no `auth.uid()`, which means Row Level
 *    Security cannot tell one client from another. So RLS is used the blunt
 *    way: every table is locked shut (enabled, zero policies, and the anon role
 *    holds no privilege on it at all) and the only way in is through the
 *    SECURITY DEFINER functions at the bottom of this file, each of which
 *    authenticates the caller from `p_token` before it does anything.
 *
 * A consequence worth stating plainly: the anon key is public — it is in the
 * app's source and every browser has it — and this is safe only because the
 * key alone grants nothing. If a table is ever added here without revoking
 * privileges, that stops being true. There is a catch-all revoke right before
 * the grants at the end of each migration for exactly that reason.
 * ========================================================================== */

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

/* ---------- Reference data ---------- */
/* These mirror js/core.js. They are the same nine services with the same ids,
 * because a booking stores a service id and both ends have to agree on what it
 * means — a client's "Full haircut" is the professional's "Full haircut". */

create table if not exists public.pampa_trades (
  id   text primary key,
  name text not null,
  note text not null default '',
  ico  text not null default '',
  /* `sort` carries the ordering the app promises in registration: barbing
   * leads the list. It is a column rather than a fixed array so the order can
   * change without a deploy. */
  sort int  not null default 100
);

insert into public.pampa_trades (id, name, note, ico, sort) values
  ('barb',  'Barbing', 'Fades, line-ups, beard work',   'scissors', 1),
  ('hair',  'Hair',    'Braids, weaving, styling',      'braids',   2),
  ('nails', 'Nails',   'Manicure, pedicure, gel',       'polish',   3),
  ('spa',   'Spa',     'Facials, massage, skin',        'sparkle',  4)
on conflict (id) do update
  set name = excluded.name, note = excluded.note,
      ico = excluded.ico, sort = excluded.sort;

create table if not exists public.pampa_areas (
  id   text primary key,
  name text not null,
  city text not null default 'Lagos',
  lat  numeric(9,6) not null,
  lng  numeric(9,6) not null
);

insert into public.pampa_areas (id, name, city, lat, lng) values
  ('vi',       'Victoria Island', 'Lagos', 6.4281, 3.4219),
  ('ikoyi',    'Ikoyi',           'Lagos', 6.4520, 3.4350),
  ('lekki1',   'Lekki Phase 1',   'Lagos', 6.4410, 3.4750),
  ('ajah',     'Ajah',            'Lagos', 6.4667, 3.5667),
  ('yaba',     'Yaba',            'Lagos', 6.5095, 3.3711),
  ('surulere', 'Surulere',        'Lagos', 6.5000, 3.3500),
  ('gbagada',  'Gbagada',         'Lagos', 6.5550, 3.3900),
  ('oshodi',   'Oshodi',          'Lagos', 6.5550, 3.3400),
  ('maryland', 'Maryland',        'Lagos', 6.5700, 3.3667),
  ('ikeja',    'Ikeja GRA',       'Lagos', 6.5833, 3.3500)
on conflict (id) do update
  set name = excluded.name, city = excluded.city,
      lat = excluded.lat, lng = excluded.lng;

create table if not exists public.pampa_services (
  id       text primary key,
  trade    text not null references public.pampa_trades(id),
  name     text not null,
  dur_min  int  not null check (dur_min > 0),
  /* The catalogue price is the middle a professional's own range is built
   * around, never the price of anything — see pampa_provider_services. */
  price    int  not null check (price >= 0),
  ico      text not null default '',
  sort     int  not null default 100
);

insert into public.pampa_services (id, trade, name, dur_min, price, ico, sort) values
  ('braids',  'hair',  'Knotless braids', 180, 15000, 'braids',   10),
  ('weave',   'hair',  'Weave install',   120, 12000, 'weave',    11),
  ('cut',     'barb',  'Full haircut',     45,  3500, 'scissors', 20),
  ('beard',   'barb',  'Beard trim',       30,  2000, 'beard',    21),
  ('touch',   'barb',  'Maintenance',      20,  1500, 'comb',     22),
  ('mani',    'nails', 'Manicure',         60,  5000, 'polish',   30),
  ('pedi',    'nails', 'Pedicure',         75,  6000, 'foot',     31),
  ('facial',  'spa',   'Facial',           60, 10000, 'facial',   40),
  ('massage', 'spa',   'Massage',          90, 12000, 'hands',    41)
on conflict (id) do update
  set trade = excluded.trade, name = excluded.name, dur_min = excluded.dur_min,
      price = excluded.price, ico = excluded.ico, sort = excluded.sort;

/* ---------- Accounts ---------- */

create table if not exists public.pampa_accounts (
  id            uuid primary key default gen_random_uuid(),
  /* The sign-in handle, normalised: a phone keeps its last ten digits, a
   * username is lowercased. Two spellings of one number ("+234 0805..." and
   * "0805...") are therefore one account, not two. */
  handle        text not null unique,
  handle_kind   text not null check (handle_kind in ('phone','username')),
  password_hash text not null,
  /* Immutable. A client cannot become a professional and a professional cannot
   * become a client — a trigger enforces it, because "the screen does not offer
   * it" is not a rule. */
  role          text not null default 'client' check (role in ('client','pro')),
  display_name  text not null,
  phone         text not null default '',
  username      text not null default '',
  avatar        text not null default '',
  area_id       text references public.pampa_areas(id),
  address       text not null default '',
  lat           numeric(9,6),
  lng           numeric(9,6),
  socials       jsonb not null default '{}'::jsonb,
  /* Brute force is the cost of owning the login endpoint instead of renting
   * Supabase Auth's, so the failure count is kept here and checked on every
   * attempt. */
  failed_attempts int not null default 0,
  locked_until  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  /* A handle that looks like a number must be recorded as a phone, and one that
   * does not must not be. */
  constraint pampa_accounts_handle_kind_match
    check ((handle_kind = 'phone') = (handle ~ '^[0-9]+$'))
);

create index if not exists pampa_accounts_role_idx on public.pampa_accounts (role);

create table if not exists public.pampa_sessions (
  /* 64 hex characters from two UUIDv4s: v4 is drawn from the OS CSPRNG, so this
   * is 256 bits of entropy without needing pgcrypto's gen_random_bytes, whose
   * resolution would depend on the search_path of whoever inserts the row. */
  token       text primary key
              default replace(gen_random_uuid()::text, '-', '')
                   || replace(gen_random_uuid()::text, '-', ''),
  account_id  uuid not null references public.pampa_accounts(id) on delete cascade,
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '60 days',
  revoked_at  timestamptz
);

create index if not exists pampa_sessions_account_idx on public.pampa_sessions (account_id);

/* ---------- Provider profiles ---------- */

create table if not exists public.pampa_providers (
  account_id      uuid primary key references public.pampa_accounts(id) on delete cascade,
  /* Immutable after registration, by trigger: a professional registered under
   * one trade and the app shows them only that trade's work. */
  trade           text not null references public.pampa_trades(id),
  bio             text not null default '',
  studio_area_id  text not null references public.pampa_areas(id),
  studio_address  text not null default '',
  lat             numeric(9,6),
  lng             numeric(9,6),
  /* The switch a professional flips to stop taking bookings. */
  available       boolean not null default true,
  visit_radius_km numeric(5,1) not null default 14,
  rating_sum      int not null default 0 check (rating_sum >= 0),
  rating_count    int not null default 0 check (rating_count >= 0),
  /* Kept as a pair so the average is a fact the database agrees with rather
   * than a number a client computed and could disagree about. */
  rating_avg      numeric(3,2) generated always as (
                    case when rating_count = 0 then 0
                         else round(rating_sum::numeric / rating_count, 2) end
                  ) stored,
  jobs            int not null default 0 check (jobs >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists pampa_providers_trade_idx  on public.pampa_providers (trade);
create index if not exists pampa_providers_area_idx   on public.pampa_providers (studio_area_id);

/* What a professional charges for each service they offer: a floor and a
 * ceiling, not a price. A client names what they can afford inside that band. */
create table if not exists public.pampa_provider_services (
  provider_id uuid not null references public.pampa_providers(account_id) on delete cascade,
  service_id  text not null references public.pampa_services(id),
  min_price   int  not null check (min_price >= 0),
  max_price   int  not null check (max_price >= 0),
  active      boolean not null default true,
  primary key (provider_id, service_id),
  constraint pampa_provider_services_band check (max_price >= min_price)
);

create index if not exists pampa_provider_services_service_idx
  on public.pampa_provider_services (service_id) where active;

/* Where a payout is sent, and the payouts themselves. Money leaves escrow to a
 * bank account or a wallet, so the destination is a row and not a string on the
 * booking: one professional, one default, reused by every job they take. */
create table if not exists public.pampa_payout_destinations (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.pampa_accounts(id) on delete cascade,
  kind       text not null check (kind in ('bank','crypto')),
  label      text not null default '',
  /* Account numbers and wallet addresses, masked at the edges when read back. */
  details    jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists pampa_payout_destinations_one_default
  on public.pampa_payout_destinations (account_id) where is_default;

/* ---------- Guards ---------- */

create or replace function public.pampa_guard_role()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role then
    raise exception 'An account cannot change role' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.pampa_guard_trade()
returns trigger
language plpgsql
as $$
begin
  if new.trade is distinct from old.trade then
    raise exception 'A professional cannot change trade' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists pampa_accounts_role_frozen on public.pampa_accounts;
create trigger pampa_accounts_role_frozen
  before update on public.pampa_accounts
  for each row when (old.role is distinct from new.role)
  execute function public.pampa_guard_role();

drop trigger if exists pampa_providers_trade_frozen on public.pampa_providers;
create trigger pampa_providers_trade_frozen
  before update on public.pampa_providers
  for each row when (old.trade is distinct from new.trade)
  execute function public.pampa_guard_trade();

create or replace function public.pampa_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pampa_accounts_touch on public.pampa_accounts;
create trigger pampa_accounts_touch
  before update on public.pampa_accounts
  for each row execute function public.pampa_touch();

drop trigger if exists pampa_providers_touch on public.pampa_providers;
create trigger pampa_providers_touch
  before update on public.pampa_providers
  for each row execute function public.pampa_touch();

/* ---------- Maths ---------- */

/* Great-circle distance in kilometres, to one decimal. Lives in the database
 * because "closest first" is now a question about rows the client cannot see. */
create or replace function public.pampa_km(
  p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric
) returns numeric
language sql
immutable
as $$
  select case
    when p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null then null
    else round((
      2 * 6371 * asin(sqrt(
          power(sin(radians(p_lat2 - p_lat1) / 2), 2)
        + cos(radians(p_lat1)) * cos(radians(p_lat2))
        * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
      ))
    )::numeric, 1)
  end;
$$;

/* The one place a handle is normalised. Used by registration and by sign-in, so
 * the two can never disagree about what "the same account" means.
 *
 * Phone numbers need real care here, because the app already shows both
 * spellings side by side (+234 0805 000 0005 on one screen, 0805 000 0005 in a
 * dev note). Both must land on one account, so a country code and a trunk zero
 * are stripped and the national significant number — the last ten digits — is
 * what gets compared and stored. */
create or replace function public.pampa_norm_handle(p text)
returns text
language plpgsql
immutable
as $$
declare
  v      text := regexp_replace(btrim(coalesce(p, '')), '[^0-9]', '', 'g');
begin
  if p is null or btrim(p) = '' then
    return null;
  end if;

  -- Not a number at all: a username, compared case-insensitively.
  if length(v) < 7 or v !~ '^[0-9]+$' then
    return lower(btrim(p));
  end if;

  if left(v, 3) = '234' then
    v := substr(v, 4);
  end if;
  if left(v, 1) = '0' and length(v) between 10 and 11 then
    v := substr(v, 2);
  end if;

  return right(v, 10);
end;
$$;

/* ---------- Authentication helpers ---------- */

/* Internal. Deliberately not callable by anon — a function that takes a token
 * and says whether it is valid is a token oracle. */
create or replace function public.pampa_auth(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_account uuid;
begin
  if p_token is null or length(btrim(p_token)) < 32 then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select s.account_id into v_account
    from public.pampa_sessions s
   where s.token = p_token
     and s.revoked_at is null
     and s.expires_at > now();

  if v_account is null then
    raise exception 'Your session has ended — sign in again' using errcode = '28000';
  end if;

  update public.pampa_sessions
     set last_seen_at = now()
   where token = p_token;

  return v_account;
end;
$$;

/* The whole account as the app expects to see it: the same field names the
 * client has always used, so the data layer stays a thin translation. Password
 * material never appears here — not the hash, not the failure count. */
create or replace function public.pampa_account_json(p_account_id uuid)
returns jsonb
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id',       a.id,
    'name',     a.display_name,
    'phone',    a.phone,
    'username', a.username,
    'role',     a.role,
    'area',     a.area_id,
    'address',  a.address,
    'coords',   case when a.lat is null or a.lng is null then null
                     else jsonb_build_object('lat', a.lat, 'lng', a.lng) end,
    'dp',       nullif(a.avatar, ''),
    'socials',  a.socials,
    'trade',    pr.trade,
    'provider', case when pr.account_id is null then null else jsonb_build_object(
                  'trade',       pr.trade,
                  'bio',         pr.bio,
                  'studio',      pr.studio_area_id,
                  'studioName',  sa.name,
                  'studioAddress', pr.studio_address,
                  'available',   pr.available,
                  'rating',      pr.rating_avg,
                  'ratings',     pr.rating_count,
                  'jobs',        pr.jobs,
                  'radiusKm',    pr.visit_radius_km
                ) end
  ))
  from public.pampa_accounts a
  left join public.pampa_providers pr on pr.account_id = a.id
  left join public.pampa_areas sa      on sa.id = pr.studio_area_id
  where a.id = p_account_id;
$$;

/* A fresh session for an account, returned as { token, account }. */
create or replace function public.pampa_issue_session(p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_token text;
begin
  insert into public.pampa_sessions (account_id)
  values (p_account_id)
  returning token into v_token;

  /* One live session per device is the app's model, but stale rows would grow
   * without bound, so signing in clears this account's expired ones. */
  delete from public.pampa_sessions
   where account_id = p_account_id
     and (expires_at <= now() or revoked_at is not null);

  return jsonb_build_object(
    'token',   v_token,
    'account', public.pampa_account_json(p_account_id)
  );
end;
$$;

/* ---------- The API ---------- */

create or replace function public.pampa_register(
  p_handle   text,
  p_password text,
  p_name     text,
  p_role     text default 'client',
  p_trade    text default null,
  p_area_id  text default null,
  p_address  text default '',
  p_lat      numeric default null,
  p_lng      numeric default null,
  p_dp       text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_handle text := public.pampa_norm_handle(p_handle);
  v_kind   text;
  v_role   text := coalesce(nullif(btrim(p_role), ''), 'client');
  v_name   text := btrim(coalesce(p_name, ''));
  v_id     uuid;
begin
  if v_handle is null or length(v_handle) < 7 then
    raise exception 'Enter a phone number or a username of at least 7 characters';
  end if;
  if p_password is null or length(p_password) < 6 then
    raise exception 'Use a password of at least 6 characters';
  end if;
  if v_name = '' then
    raise exception 'Enter your name';
  end if;
  if v_role not in ('client', 'pro') then
    raise exception 'Unknown account type';
  end if;

  v_kind := case when v_handle ~ '^[0-9]+$' then 'phone' else 'username' end;

  if exists (select 1 from public.pampa_accounts where handle = v_handle) then
    raise exception 'That phone number or username already has an account';
  end if;

  if v_role = 'pro' then
    if p_trade is null or not exists (select 1 from public.pampa_trades where id = p_trade) then
      raise exception 'Pick the trade you work in';
    end if;
    if p_area_id is null or not exists (select 1 from public.pampa_areas where id = p_area_id) then
      raise exception 'Pick the area you work from';
    end if;
  end if;

  insert into public.pampa_accounts (
    handle, handle_kind, password_hash, role, display_name,
    phone, username, avatar, area_id, address, lat, lng
  ) values (
    v_handle,
    v_kind,
    extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
    v_role,
    v_name,
    case when v_kind = 'phone' then btrim(p_handle) else '' end,
    case when v_kind = 'phone' then '' else btrim(p_handle) end,
    coalesce(p_dp, ''),
    p_area_id,
    coalesce(p_address, ''),
    p_lat,
    p_lng
  )
  returning id into v_id;

  if v_role = 'pro' then
    insert into public.pampa_providers (account_id, trade, studio_area_id, studio_address, lat, lng)
    values (
      v_id, p_trade, p_area_id, coalesce(p_address, ''), p_lat, p_lng
    );

    /* Every service of their trade, opened at the default band around the
     * catalogue price — the same 70%–140% the app has always used, floored at
     * ₦500/₦1,000 and rounded to the nearest ₦50. A professional who never
     * opens the rates screen is still bookable. */
    insert into public.pampa_provider_services (provider_id, service_id, min_price, max_price)
    select v_id,
           s.id,
           greatest(500,  (round(s.price * 0.7 / 50) * 50))::int,
           greatest(1000, (round(s.price * 1.4 / 50) * 50))::int
      from public.pampa_services s
     where s.trade = p_trade;
  end if;

  return public.pampa_issue_session(v_id);
end;
$$;

/* Sign-in. No code, no email: an identifier and a password, checked here. */
create or replace function public.pampa_login(
  p_handle   text,
  p_password text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_handle text := public.pampa_norm_handle(p_handle);
  v_acct   public.pampa_accounts;
begin
  if v_handle is null or p_password is null then
    raise exception 'Enter your phone number or username and your password';
  end if;

  select * into v_acct from public.pampa_accounts where handle = v_handle;

  /* The same message for "no such account" and "wrong password", so the
   * endpoint cannot be used to discover who has an account. */
  if v_acct.id is null then
    raise exception 'That phone number or username and password do not match';
  end if;

  if v_acct.locked_until is not null and v_acct.locked_until > now() then
    raise exception 'Too many attempts — try again in a few minutes';
  end if;

  if extensions.crypt(p_password, v_acct.password_hash) <> v_acct.password_hash then
    update public.pampa_accounts
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 8
                               then now() + interval '15 minutes' else locked_until end
     where id = v_acct.id;
    raise exception 'That phone number or username and password do not match';
  end if;

  update public.pampa_accounts
     set failed_attempts = 0, locked_until = null
   where id = v_acct.id;

  return public.pampa_issue_session(v_acct.id);
end;
$$;

create or replace function public.pampa_logout(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  update public.pampa_sessions
     set revoked_at = now()
   where token = p_token and revoked_at is null;
  return true;
end;
$$;

/* The signed-in account, re-read from the database. This is what makes a
 * profile edit on one device show up on another. */
create or replace function public.pampa_me(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid := public.pampa_auth(p_token);
begin
  return public.pampa_account_json(v_id);
end;
$$;

/* Profile edits: name, where they are, their face, their socials; and for a
 * professional, their bio and studio. One patch object, so adding a field is a
 * database change and not three. Keys that are absent are left alone; keys that
 * carry null are cleared. */
create or replace function public.pampa_update_profile(p_token text, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid := public.pampa_auth(p_token);
  v_area text;
begin
  if p_patch is null then
    return public.pampa_account_json(v_id);
  end if;

  if p_patch ? 'area' and p_patch->>'area' is not null then
    v_area := p_patch->>'area';
    if not exists (select 1 from public.pampa_areas where id = v_area) then
      raise exception 'Unknown area';
    end if;
  end if;

  update public.pampa_accounts
     set display_name = coalesce(nullif(btrim(p_patch->>'name'), ''), display_name),
         avatar       = case when p_patch ? 'dp'      then coalesce(p_patch->>'dp', '')      else avatar end,
         address      = case when p_patch ? 'address' then coalesce(p_patch->>'address', '') else address end,
         area_id      = case when p_patch ? 'area'    then v_area                            else area_id end,
         lat          = case when p_patch ? 'lat' then (p_patch->>'lat')::numeric else lat end,
         lng          = case when p_patch ? 'lng' then (p_patch->>'lng')::numeric else lng end,
         socials      = case when p_patch ? 'socials' then coalesce(p_patch->'socials', '{}'::jsonb) else socials end
   where id = v_id;

  /* A professional's own fields follow the account they belong to. */
  update public.pampa_providers
     set bio            = case when p_patch ? 'bio' then coalesce(p_patch->>'bio', '') else bio end,
         studio_address = case when p_patch ? 'studioAddress'
                               then coalesce(p_patch->>'studioAddress', '') else studio_address end,
         studio_area_id = case when p_patch ? 'area' and v_area is not null then v_area else studio_area_id end,
         lat            = case when p_patch ? 'lat' then (p_patch->>'lat')::numeric else lat end,
         lng            = case when p_patch ? 'lng' then (p_patch->>'lng')::numeric else lng end
   where account_id = v_id;

  return public.pampa_account_json(v_id);
end;
$$;

/* The switch that takes a professional off the market, and back on. */
create or replace function public.pampa_set_availability(p_token text, p_available boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid := public.pampa_auth(p_token);
begin
  update public.pampa_providers
     set available = coalesce(p_available, true)
   where account_id = v_id;

  if not found then
    raise exception 'Only a professional has bookings to switch off';
  end if;

  return public.pampa_account_json(v_id);
end;
$$;

/* Rates, as { "<serviceId>": { "min": 3500, "max": 6000 } }. A band that is
 * inverted, negative, or not a service of their trade is refused rather than
 * stored — a client picking a price inside it must always be able to. */
create or replace function public.pampa_set_rates(p_token text, p_rates jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id    uuid := public.pampa_auth(p_token);
  v_trade text;
  r       record;
  v_min   int;
  v_max   int;
begin
  select trade into v_trade from public.pampa_providers where account_id = v_id;
  if v_trade is null then
    raise exception 'Only a professional sets rates';
  end if;
  if p_rates is null or jsonb_typeof(p_rates) <> 'object' then
    raise exception 'Rates must be sent as an object of service ranges';
  end if;

  for r in select key as service_id, value as band from jsonb_each(p_rates) loop
    if not exists (select 1 from public.pampa_services
                    where id = r.service_id and trade = v_trade) then
      raise exception '% is not a service in your trade', r.service_id;
    end if;

    v_min := nullif(r.band->>'min', '')::int;
    v_max := nullif(r.band->>'max', '')::int;
    if v_min is null or v_max is null then
      raise exception 'Each range needs a floor and a ceiling';
    end if;
    if v_min > v_max then
      raise exception 'A range cannot start above where it ends';
    end if;

    insert into public.pampa_provider_services (provider_id, service_id, min_price, max_price)
    values (v_id, r.service_id, v_min, v_max)
    on conflict (provider_id, service_id)
      do update set min_price = excluded.min_price,
                    max_price = excluded.max_price,
                    active    = true;
  end loop;

  return public.pampa_account_json(v_id);
end;
$$;

/* Reference data is public and identical for everyone, so it is exposed as
 * functions rather than as grants on the tables: one door, one shape. */
create or replace function public.pampa_trades()
returns jsonb
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'name', t.name, 'note', t.note, 'ico', t.ico
         ) order by t.sort), '[]'::jsonb)
    from public.pampa_trades t;
$$;

create or replace function public.pampa_services()
returns jsonb
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'cat', s.trade, 'name', s.name,
           'dur', s.dur_min, 'price', s.price, 'ico', s.ico
         ) order by s.sort), '[]'::jsonb)
    from public.pampa_services s;
$$;

create or replace function public.pampa_areas()
returns jsonb
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'name', a.name, 'city', a.city,
           'lat', a.lat, 'lng', a.lng
         ) order by a.name), '[]'::jsonb)
    from public.pampa_areas a;
$$;

/* ---------- Lock the doors ---------- */
/* Tables: RLS on, no policies, no privileges for the roles PostgREST can
 * become. Functions: nothing inherits EXECUTE except the handful below. */

alter table public.pampa_trades              enable row level security;
alter table public.pampa_areas               enable row level security;
alter table public.pampa_services            enable row level security;
alter table public.pampa_accounts            enable row level security;
alter table public.pampa_sessions            enable row level security;
alter table public.pampa_providers           enable row level security;
alter table public.pampa_provider_services   enable row level security;
alter table public.pampa_payout_destinations enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
/* PUBLIC matters more than the other two: PostgreSQL grants EXECUTE to PUBLIC
 * on every new function, so revoking from anon alone would leave the anon role
 * inheriting it — including on the token oracle. */
revoke all on all functions in schema public from public, anon, authenticated;

grant usage on schema public to anon, authenticated;

grant execute on function public.pampa_register(text, text, text, text, text, text, text, numeric, numeric, text) to anon;
grant execute on function public.pampa_login(text, text)                    to anon;
grant execute on function public.pampa_logout(text)                         to anon;
grant execute on function public.pampa_me(text)                             to anon;
grant execute on function public.pampa_update_profile(text, jsonb)          to anon;
grant execute on function public.pampa_set_availability(text, boolean)      to anon;
grant execute on function public.pampa_set_rates(text, jsonb)               to anon;
grant execute on function public.pampa_trades()                             to anon;
grant execute on function public.pampa_services()                           to anon;
grant execute on function public.pampa_areas()                              to anon;
