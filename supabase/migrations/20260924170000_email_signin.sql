/* =============================================================================
 * Pampa — 0009 — one door, and two spellings of who you are
 *
 * The sign-in screen has always had exactly one identifier field, and the
 * handle behind it has always been a phone number or a username. What it could
 * not be is an email: the address on the contact sheet was a contact detail
 * that never left the device, so "sign in with your username or email" was not
 * a sentence the app could keep.
 *
 * This makes the email a credential. An account gains one, the sign-in lookup
 * answers to a handle or an email, and the two namespaces are held apart so
 * that one string can never mean two accounts:
 *
 *   1. `pampa_norm_handle` learns that an `@` settles what a handle is before
 *      its digits do. Without this, "chidi1234567@mail.com" had its digits
 *      pulled out, came back as a seven-digit string, and would have matched
 *      whichever account's phone number happened to end in them. An email is
 *      never a phone number, and a username that looks like an email is the
 *      same string, which is why the two are one namespace.
 *   2. `pampa_login` answers to the handle *or* the account's email. The
 *      handle match wins, deterministically, because it is the older name.
 *   3. A trigger refuses an email that is somebody's username and a username
 *      that is somebody's email, so registration, a profile edit and a new
 *      email all meet one rule.
 *
 * Phone numbers keep working, deliberately. Every account that exists was
 * created with one, and a rule that a number is no longer a name would lock
 * out the people who already have an account. What changes is what the field
 * advertises: a username or an email, one of the two, and one field.
 * ========================================================================== */

/* ---------- The account's email ---------- */

alter table public.pampa_accounts
  add column if not exists email text not null default '';

/* Case-insensitively unique, because nobody types their own address the same
   way twice. Partial, so the accounts that have never given one — which is
   every account that exists today — are not stacked on '' . */
create unique index if not exists pampa_accounts_email_unique
  on public.pampa_accounts (lower(email)) where email <> '';

/* ---------- What a handle is ---------- */

/* Re-declared with one addition: an `@` decides. Everything after it is
   unchanged, so every existing handle normalises to exactly what it did
   before and no account is renamed by this migration. */
create or replace function public.pampa_norm_handle(p text)
returns text
language plpgsql
immutable
as $$
declare
  v     text := regexp_replace(btrim(coalesce(p, '')), '[^0-9]', '', 'g');
  v_raw text := btrim(coalesce(p, ''));
begin
  if p is null or v_raw = '' then
    return null;
  end if;

  -- An email, or a username that reads like one. Never a phone number: the
  -- digits inside an address are not a national significant number, and
  -- treating them as one points the sign-in at the wrong account.
  if position('@' in v_raw) > 0 then
    return lower(v_raw);
  end if;

  -- Not a number at all: a username, compared case-insensitively.
  if length(v) < 7 or v !~ '^[0-9]+$' then
    return lower(v_raw);
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

/* ---------- The account as the app reads it ---------- */

/* Re-declared in full to carry the email. A session that did not know the
   address would ask for it again on the next device, and the profile would
   show an empty row on a phone that had never saved one. */
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
    'email',    nullif(a.email, ''),
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

/* ---------- One namespace ---------- */

/* A username may look like an email, and an email may look like a username —
   they are typed into the same field and matched by the same lookup, so one
   string cannot be two accounts. On the table rather than in a function,
   because registration, a profile edit and a new email are three writers and
   only one of them is this migration. */
create or replace function public.pampa_guard_handle_email()
returns trigger
language plpgsql
as $$
begin
  if new.email <> '' and exists (
    select 1 from public.pampa_accounts
     where id <> new.id and handle = lower(new.email)
  ) then
    raise exception 'That email is already used as a username'
      using errcode = '23505';
  end if;

  if position('@' in coalesce(new.handle, '')) > 0 and exists (
    select 1 from public.pampa_accounts
     where id <> new.id and email = lower(new.handle)
  ) then
    raise exception 'That email already has a Pampa account'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists pampa_accounts_handle_email on public.pampa_accounts;
create trigger pampa_accounts_handle_email
  before insert or update of handle, email on public.pampa_accounts
  for each row execute function public.pampa_guard_handle_email();

/* ---------- An email, set by its owner ---------- */

/* The contact sheet's email, saved to the account. It gets a function of its
   own rather than riding `pampa_update_profile` because it is a *credential*:
   the name and the picture can be pushed fire-and-forget, but an email that
   the server refused — an address somebody else already signs in with — has to
   come back in words, or the person would believe they could sign in with an
   address that was never saved. An empty string clears it. */
create or replace function public.pampa_set_email(p_token text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id   uuid := public.pampa_auth(p_token);
  v_mail text := lower(btrim(coalesce(p_email, '')));
begin
  if v_mail = '' then
    update public.pampa_accounts set email = '' where id = v_id;
    return public.pampa_account_json(v_id);
  end if;

  if length(v_mail) > 80 then
    raise exception 'That email is too long' using errcode = '22023';
  end if;
  if v_mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That does not look like an email address'
      using errcode = '22023';
  end if;

  /* Checked here so the refusal is a sentence. The unique index is the
     backstop underneath, and the trigger covers the username side. */
  if exists (
    select 1 from public.pampa_accounts
     where id <> v_id and lower(email) = v_mail
  ) then
    raise exception 'That email already has a Pampa account'
      using errcode = '23505';
  end if;

  update public.pampa_accounts set email = v_mail where id = v_id;
  return public.pampa_account_json(v_id);
end;
$$;

/* ---------- The door ---------- */

/* Re-declared in full: the lookup is the middle of it. The handle match is
   preferred over the email one and the answer is limited to a single row, so
   the account this returns is decided by the query rather than by whatever
   order the planner happened to read the table in. */
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
    raise exception 'Enter your username or email and your password';
  end if;

  select * into v_acct
    from public.pampa_accounts
   where handle = v_handle
      or (email <> '' and email = v_handle)
   order by (handle = v_handle) desc
   limit 1;

  /* The same message for "no such account" and "wrong password", so the
   * endpoint cannot be used to discover who has an account. */
  if v_acct.id is null then
    raise exception 'That username or email and password do not match';
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
    raise exception 'That username or email and password do not match';
  end if;

  update public.pampa_accounts
     set failed_attempts = 0, locked_until = null
   where id = v_acct.id;

  return public.pampa_issue_session(v_acct.id);
end;
$$;

grant execute on function public.pampa_set_email(text, text) to anon;
