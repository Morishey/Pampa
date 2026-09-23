/* =============================================================================
 * Pampa — 0003 — the desk's history, passwords, and the dispute's note
 *
 * Three things the screens need that the first two migrations did not ship:
 *
 * 1. pampa_desk_settle() writes a resolution onto a booking, but there is no
 *    way for the desk to see yesterday's decisions — the queue is disputed
 *    bookings only. The mediator's screen has a "Settled" column, so the
 *    queue function now answers with both halves.
 *
 * 2. The device app let anyone with the phone change their password. A server
 *    has to check the current one first: pampa_change_password().
 *
 * 3. pampa_booking_dispute stores the reason, but the "anything to add?" note
 *    the client types had nowhere to go. Rather than widen the dispute jsonb
 *    shape in two places, the desk's own settle already carries a note-less
 *    path — so the note rides the same jsonb, written at dispute time by the
 *    function that owns the transition.
 * ========================================================================== */

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

  return jsonb_build_object(
    'open', coalesce((
      select jsonb_agg(public.pampa_booking_json(b.id)
                       order by b.scheduled_date, b.scheduled_time)
        from public.pampa_bookings b
       where b.status = 'disputed'), '[]'::jsonb),
    'settled', coalesce((
      select jsonb_agg(public.pampa_booking_json(b.id)
                       order by b.resolution->>'at' desc)
        from public.pampa_bookings b
       where b.status = 'settled'), '[]'::jsonb)
  );
end;
$$;

/* A password changes only behind the one it replaces — the same rule the
   change-password screen has always applied, now enforced where the hash
   lives. The lockout counter participates too: a failed check here is a
   failed sign-in, so guessing at the current password through this door is
   slowed by exactly the same wall. */
create or replace function public.pampa_change_password(
  p_token      text,
  p_current    text,
  p_new        text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id   uuid := public.pampa_auth(p_token);
  v_acct public.pampa_accounts;
begin
  if p_new is null or length(p_new) < 6 then
    raise exception 'Use a password of at least 6 characters';
  end if;

  select * into v_acct from public.pampa_accounts where id = v_id for update;
  if v_acct.id is null then raise exception 'Account not found'; end if;

  if v_acct.locked_until is not null and v_acct.locked_until > now() then
    raise exception 'Too many attempts — try again in a few minutes';
  end if;

  if extensions.crypt(coalesce(p_current, ''), v_acct.password_hash) <> v_acct.password_hash then
    update public.pampa_accounts
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 8
                               then now() + interval '15 minutes' else locked_until end
     where id = v_id;
    raise exception 'That current password does not match';
  end if;

  update public.pampa_accounts
     set password_hash   = extensions.crypt(p_new, extensions.gen_salt('bf', 10)),
         failed_attempts = 0,
         locked_until    = null
   where id = v_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.pampa_change_password(text, text, text) to anon;

/* The note the client types beside the reason. The first two migrations
   dropped it: the dispute jsonb carried the reason and the photos, and the
   note the screen collected never reached the row. Written by the same
   function, guarded by the same transition, so the shape stays the client's
   own side of the record. */
create or replace function public.pampa_booking_dispute(
  p_token   text,
  p_booking uuid,
  p_reason  text,
  p_photos  jsonb default '[]'::jsonb,
  p_note    text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := public.pampa_auth(p_token);
  b       public.pampa_bookings;
  v_pics  jsonb := coalesce(p_photos, '[]'::jsonb);
  v_note  text := left(btrim(coalesce(p_note, '')), 600);
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
           'photos', v_pics,
           'note', v_note)
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

/* Re-stamp the grants the function's redefinition dropped. */
grant execute on function public.pampa_booking_dispute(text, uuid, text, jsonb, text) to anon;
