/* =============================================================================
 * Pampa — 0007 — money that left escrow before there was anywhere to send it
 *
 * A payout row is written at release, against whichever destination is default
 * at that moment. A professional who had not saved one yet is paid on paper and
 * not in fact: the row is written with status 'pending' and no destination, and
 * until now nothing could ever change that — the money was released and then
 * sat there for good, while the wallet went on saying there was nothing to
 * withdraw. That is the wrong way round. Saving a destination should be able to
 * collect what is already waiting for one.
 *
 * One payout at a time, because a payout row is a real thing that happened: the
 * amount, the fee and the reference are the record of a release and are never
 * touched here. What this sets is where that money goes.
 * ========================================================================== */

create or replace function public.pampa_assign_payout(
  p_token       text,
  p_payout      uuid,
  p_destination uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := public.pampa_auth(p_token);
  v_pay   public.pampa_payouts;
  v_mine  boolean;
begin
  select * into v_pay from public.pampa_payouts where id = p_payout for update;
  if v_pay.id is null then raise exception 'That payout does not exist'; end if;
  if v_pay.provider_id <> v_actor then
    raise exception 'That payout is not yours' using errcode = '42501';
  end if;
  if v_pay.status <> 'pending' then
    raise exception 'That payout was already sent to a destination';
  end if;

  select exists (
    select 1 from public.pampa_payout_destinations
     where id = p_destination and account_id = v_actor
  ) into v_mine;
  if not v_mine then
    raise exception 'That payout destination is not yours' using errcode = '42501';
  end if;

  update public.pampa_payouts
     set destination_id = p_destination,
         status = 'sent'
   where id = p_payout;

  return public.pampa_wallet(p_token);
end;
$$;

grant execute on function public.pampa_assign_payout(text, uuid, uuid) to anon;
