-- =========================================================
-- Pampa — who may settle a dispute, and who may say so
--
-- The dispute path was written before this: pampa_desk_settle() decides a frozen
-- escrow, and it gated itself on a `desk` column on the account —
--   select desk into v_desk from public.pampa_accounts where id = v_actor;
-- but no such column was ever created. Postgres only resolves that when the
-- function runs, so the whole mediator path would have failed the first time a
-- real dispute reached it, with "column desk does not exist". This adds the
-- column.
--
-- It also answers the question the column raises: who is allowed to hand it out?
-- There was no way to promote a mediator except pasting SQL into the dashboard.
-- There is now an RPC — and the flag cannot be taken, only granted, because a
-- trigger refuses any change to it that does not come from that RPC.
--
-- Run order: after 20260922150804 (accounts) and 20260922150811 (bookings).
-- =========================================================

/* ---------- The flags ---------- */

alter table public.pampa_accounts
  add column if not exists desk  boolean not null default false;
alter table public.pampa_accounts
  add column if not exists admin boolean not null default false;

comment on column public.pampa_accounts.desk is
  'Member of the resolution desk: may settle a disputed escrow. Granted, never self-served.';
comment on column public.pampa_accounts.admin is
  'May grant and revoke the desk. Deliberately separate from desk: deciding a dispute and deciding who decides are different powers.';

create index if not exists pampa_accounts_desk_idx
  on public.pampa_accounts (desk) where desk;

/* Neither flag can move unless the transaction says so. The granting RPC sets a
   transaction-local marker for the length of its own call; anything else —
   a crafted pampa_update_profile, a direct table write, a future RPC someone
   adds carelessly — is refused. Local (true) not session, so the marker cannot
   outlive the statement that set it and leak into the next request on a pooled
   connection. */
create or replace function public.pampa_guard_flags()
returns trigger
language plpgsql
as $$
begin
  if new.desk is distinct from old.desk or new.admin is distinct from old.admin then
    if coalesce(current_setting('pampa.granting', true), '') <> 'on' then
      raise exception 'The resolution desk is granted by an admin, not taken'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists pampa_accounts_flags_guard on public.pampa_accounts;
create trigger pampa_accounts_flags_guard
  before update on public.pampa_accounts
  for each row execute function public.pampa_guard_flags();

/* ---------- What the app is allowed to know about itself ---------- */

/* The app has to know whether to draw the desk view. It is told about its own
   account and nobody else's, and the flag is not part of the public profile a
   client can fetch. */
create or replace function public.pampa_my_flags(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid := public.pampa_auth(p_token);
begin
  return (
    select jsonb_build_object('desk', a.desk, 'admin', a.admin)
      from public.pampa_accounts a
     where a.id = v_id
  );
end;
$$;

/* ---------- Granting it ---------- */

/* Promoting a mediator, by hand and by an admin. p_handle takes what the person
   signs in with — a phone number in any spelling, or a username — because that
   is what an operator has in front of them; a uuid is accepted too. */
create or replace function public.pampa_desk_grant(
  p_token  text,
  p_handle text,
  p_on     boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor   uuid := public.pampa_auth(p_token);
  v_admin   boolean;
  v_handle  text;
  v_target  public.pampa_accounts;
begin
  select a.admin into v_admin from public.pampa_accounts a where a.id = v_actor;
  if not coalesce(v_admin, false) then
    raise exception 'Only an admin can grant the resolution desk' using errcode = '42501';
  end if;

  /* A uuid, if that is what was pasted. */
  if p_handle ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into v_target from public.pampa_accounts where id = p_handle::uuid;
  else
    v_handle := public.pampa_norm_handle(p_handle);
    select * into v_target from public.pampa_accounts where handle = v_handle;
  end if;

  if v_target.id is null then
    raise exception 'No account matches %', btrim(coalesce(p_handle, ''));
  end if;

  /* An admin taking their own desk away would leave nobody able to give it
     back, which is a lockout dressed as a permission change. */
  if v_target.id = v_actor and coalesce(p_on, true) = false then
    raise exception 'An admin cannot revoke their own desk — ask another admin';
  end if;

  /* The one place the marker is raised, for the length of this transaction. */
  perform set_config('pampa.granting', 'on', true);

  update public.pampa_accounts
     set desk = coalesce(p_on, true)
   where id = v_target.id;

  perform set_config('pampa.granting', '', true);

  return jsonb_build_object(
    'id',     v_target.id,
    'handle', v_target.handle,
    'name',   v_target.display_name,
    'desk',   coalesce(p_on, true)
  );
end;
$$;

/* Who is on the desk. Admin only: a mediator roster is not public information —
   it is a list of the people to pressure. */
create or replace function public.pampa_desk_roster(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := public.pampa_auth(p_token);
  v_admin boolean;
begin
  select a.admin into v_admin from public.pampa_accounts a where a.id = v_actor;
  if not coalesce(v_admin, false) then
    raise exception 'Only an admin can see the desk roster' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id, 'name', a.display_name, 'handle', a.handle,
             'admin', a.admin, 'desk', a.desk,
             'since', a.updated_at)
           order by a.admin desc, a.display_name)
      from public.pampa_accounts a
     where a.desk or a.admin
  ), '[]'::jsonb);
end;
$$;

/* ---------- Lock the new doors ---------- */

/* Same convention as the earlier migrations: nothing inherits EXECUTE, not even
   through the PUBLIC role Postgres grants it to by default. */
revoke all on function public.pampa_guard_flags()          from public, anon, authenticated;
revoke all on function public.pampa_my_flags(text)         from public, anon, authenticated;
revoke all on function public.pampa_desk_grant(text, text, boolean) from public, anon, authenticated;
revoke all on function public.pampa_desk_roster(text)      from public, anon, authenticated;

grant execute on function public.pampa_my_flags(text)                to anon;
grant execute on function public.pampa_desk_grant(text, text, boolean) to anon;
grant execute on function public.pampa_desk_roster(text)             to anon;

/* =========================================================
   The first admin
   =========================================================
   There is no way to bootstrap this that is not, at bottom, someone with SQL
   access saying "this one is trustworthy" — anything else would be a back door
   that anyone could walk through. So it is one transaction, run once, in the
   Supabase SQL editor. After that every further promotion goes through
   pampa_desk_grant() and nobody needs the editor again.

   The guard trigger will refuse a bare update, so the mark is raised by hand —
   the same transaction-local mark the RPC raises for itself:

     begin;
     select set_config('pampa.granting', 'on', true);
     update public.pampa_accounts
        set admin = true, desk = true
      where handle = '0805…';   -- the first admin, by phone or username
     commit;

   Everyone after them is promoted by them. */
