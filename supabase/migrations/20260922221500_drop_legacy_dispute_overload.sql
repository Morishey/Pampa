/* =============================================================================
 * Pampa — 0005 — one dispute function, not two
 *
 * Migration 0002 shipped pampa_booking_dispute with four arguments; 0003 added
 * the client's note as a fifth. Both overloads still existed, and PostgREST
 * refuses a call that omits p_note with "could not choose the best candidate
 * function" — which is an outage dressed as a type error. The app itself
 * always sends the note, so it never tripped; the first caller to omit it
 * (a verifier, a future client, a hand-rolled curl) would have.
 *
 * Postgres cannot drop a single overloaded signature with DROP FUNCTION while
 * another shares the name, so the surviving definition is snapshotted, both
 * overloads are dropped, and the five-argument form is recreated exactly as
 * 0003 wrote it. One transaction: no window where the function is missing.
 *
 * The same transaction re-runs the grants 0002 and 0003 stamped, since a
 * function's privileges die with it.
 * ========================================================================== */

begin;

/* The definition 0003 shipped, verbatim in body and shape. */
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

/* Both overloads go; the recreate above has already replaced the one we keep. */
drop function if exists public.pampa_booking_dispute(text, uuid, text, jsonb);
drop function if exists public.pampa_booking_dispute(text, uuid, text, jsonb, text);

/* ...and the surviving definition is put back and granted. */
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

grant execute on function public.pampa_booking_dispute(text, uuid, text, jsonb, text) to anon;

commit;
