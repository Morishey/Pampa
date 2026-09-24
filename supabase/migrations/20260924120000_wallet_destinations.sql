/* =============================================================================
 * Pampa — 0006 — a professional's payout destinations, as a list they own
 *
 * 0002 let an account add a destination: a bank account or a wallet, one of
 * them default, the first one added becoming it. What never arrived were the
 * two verbs a list needs — saying *which* one is the default, and taking one
 * back. The app could add a destination and then never change its mind, so a
 * professional who saved a crypto wallet and later a bank account watched
 * every payout land in whichever they happened to add first, with no way to
 * move it.
 *
 * Both functions authenticate the caller (0001 explains why there is no
 * auth.uid()), refuse to touch a destination belonging to somebody else, and
 * answer with pampa_wallet — the same JSON the app already renders from — so a
 * caller re-reads the server's word rather than reassembling it locally.
 * ========================================================================== */

/* Which destination a payout lands in. Payouts are written at release, to
   whichever row is default at that moment, so this is the one control that
   decides where a professional's money actually goes. */
create or replace function public.pampa_set_default_destination(
  p_token       text,
  p_destination uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := public.pampa_auth(p_token);
  v_mine  boolean;
begin
  select exists (
    select 1 from public.pampa_payout_destinations
     where id = p_destination and account_id = v_actor
  ) into v_mine;
  if not v_mine then
    raise exception 'That payout destination is not yours' using errcode = '42501';
  end if;

  /* Cleared first, then set: the one-default-per-account index is checked per
     statement, so the promotion cannot be folded into a single update. */
  update public.pampa_payout_destinations
     set is_default = false
   where account_id = v_actor and is_default and id <> p_destination;

  update public.pampa_payout_destinations
     set is_default = true
   where id = p_destination;

  return public.pampa_wallet(p_token);
end;
$$;

/* Taking one back. A row that payouts already point at is not deleted out from
   under them — the payout keeps its amount, its fee and its reference, and its
   destination_id goes null (0001 declares that reference `on delete set null`)
   because the money has already left. What this removes is the *option*. */
create or replace function public.pampa_remove_destination(
  p_token       text,
  p_destination uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := public.pampa_auth(p_token);
  v_was   boolean;
  v_next  uuid;
begin
  select d.is_default into v_was
    from public.pampa_payout_destinations d
   where d.id = p_destination and d.account_id = v_actor;

  if v_was is null then
    raise exception 'That payout destination is not yours' using errcode = '42501';
  end if;

  delete from public.pampa_payout_destinations where id = p_destination;

  /* A list with no default is a list where the next payout has nowhere to go.
     The oldest remaining destination takes the job; if that was the last one,
     there is simply none, which is a state the wallet already knows how to
     show. */
  if v_was then
    select id into v_next
      from public.pampa_payout_destinations
     where account_id = v_actor
     order by created_at
     limit 1;
    if v_next is not null then
      update public.pampa_payout_destinations set is_default = true where id = v_next;
    end if;
  end if;

  return public.pampa_wallet(p_token);
end;
$$;

grant execute on function public.pampa_set_default_destination(text, uuid) to anon;
grant execute on function public.pampa_remove_destination(text, uuid)      to anon;
