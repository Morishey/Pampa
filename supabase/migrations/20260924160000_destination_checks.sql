/* =============================================================================
 * Pampa — 0008 — where a payout is allowed to go
 *
 * Two holes in one story. The first is that a destination was any text at all:
 * a bank account number with nine digits, a wallet address for a network Pampa
 * cannot send over, a TRON address typed from memory. Nothing checked, because
 * a form that only the owner can reach felt like its own guard — and then the
 * money arrives at an account that does not exist and there is nobody to ask.
 * The second is worse: a client could release escrow before the professional
 * had saved anywhere for it to land. The payout was written with no
 * destination and status 'pending', which 0007 learned to collect after the
 * fact — but collecting it afterwards is a repair, not a design. A release is
 * the moment money leaves escrow, and it should not be a moment that can end
 * with the money owed to somebody who cannot be paid.
 *
 * So: the rules for what a destination may be live in one function, applied
 * where destinations are written, and a release is refused while the
 * professional has none. The refusal names them and says what to do, because
 * the person reading it is the client — who is not at fault and cannot fix it
 * — and the only useful thing to tell them is the truth and the way out.
 *
 * The resolution desk is left able to settle: a mediator's decision is not
 * something to block, and a payout written with nowhere to go is still
 * recorded, still visible in the wallet, and still collected by 0007 the
 * moment a destination exists. The guard is on the client's release, which is
 * the path where waiting costs nobody anything.
 * ========================================================================== */

/* The four networks this app can pay over, and the shape an address has on
   each. TRC20 and ERC20 are the two a client can pay with; BEP20 and BTC are
   here because a professional with a Binance or Bitcoin wallet should not be
   told to go and open a TRON one. */
create or replace function public.pampa_networks()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$ select array['TRC20', 'ERC20', 'BEP20', 'BTC']::text[] $$;

/* Trimming, uppercasing and stripping is not cosmetic: a pasted account
   number arrives with spaces in it, and a network typed in lowercase is the
   same network. Normalising here means the *stored* row is the canonical
   form, so two rows that differ only in case are the same row, and a
   comparison against what the professional typed cannot fail on whitespace. */
create or replace function public.pampa_normalise_destination(
  p_kind    text,
  p_details jsonb
) returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_kind = 'bank' then jsonb_build_object(
      'bank',    btrim(coalesce(p_details->>'bank', '')),
      'account', regexp_replace(coalesce(p_details->>'account', ''), '[^0-9]', '', 'g'))
    else jsonb_build_object(
      'network', upper(btrim(coalesce(p_details->>'network', ''))),
      'address', regexp_replace(coalesce(p_details->>'address', ''), '\s', '', 'g'))
  end
$$;

/* What is wrong with this destination, or null if nothing is. Returns the
   sentence rather than raising it, so the wording is decided in one place and
   the caller decides whether an answer or an exception is the right shape.

   It normalises what it is given before judging it, so it can be called with
   what somebody typed and not only with what a caller remembered to clean up
   first — a validator that answers differently depending on who called it is a
   trap for whoever calls it next. */
create or replace function public.pampa_destination_problem(
  p_kind    text,
  p_details jsonb
) returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_bank text;
  v_acct text;
  v_net  text;
  v_addr text;
begin
  if p_kind not in ('bank', 'crypto') then
    return 'A payout destination is a bank account or a wallet';
  end if;
  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    return 'Destination details must be an object';
  end if;
  p_details := public.pampa_normalise_destination(p_kind, p_details);

  if p_kind = 'bank' then
    v_bank := p_details->>'bank';
    v_acct := p_details->>'account';
    if coalesce(v_bank, '') = '' then
      return 'Enter the name of the bank';
    end if;
    if length(v_bank) > 60 then
      return 'That bank name is too long';
    end if;
    if coalesce(v_acct, '') = '' then
      return 'Enter the account number';
    end if;
    /* NUBAN: ten digits, always. This is the check that catches the typo that
       otherwise becomes money sent to somebody else's account. */
    if v_acct !~ '^[0-9]{10}$' then
      return 'A Nigerian account number is 10 digits — that one is ' || length(v_acct);
    end if;
    if v_acct = repeat('0', 10) then
      return 'That is not an account number';
    end if;
    return null;
  end if;

  v_net  := p_details->>'network';
  v_addr := p_details->>'address';
  if coalesce(v_net, '') = '' then
    return 'Say which network the wallet is on';
  end if;
  if not (v_net = any (public.pampa_networks())) then
    return 'Pampa pays over ' || array_to_string(public.pampa_networks(), ', ')
           || ' — not ' || v_net;
  end if;
  if coalesce(v_addr, '') = '' then
    return 'Enter the wallet address';
  end if;
  if length(v_addr) > 100 then
    return 'That wallet address is too long';
  end if;

  /* Each network has exactly one shape of address, and sending USDT-TRC20 to
     an ERC20 address is money in a hole. The alphabet matters as much as the
     length: base58 leaves out 0, O, I and l precisely so they cannot be
     confused, so an address containing one is a transcription error. */
  if v_net = 'TRC20' then
    if v_addr !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' then
      return 'A TRC20 address is 34 characters long and starts with T';
    end if;
  elsif v_net in ('ERC20', 'BEP20') then
    if v_addr !~ '^0x[0-9a-fA-F]{40}$' then
      return 'An ' || v_net || ' address is 0x followed by 40 characters';
    end if;
  else /* BTC */
    if v_addr !~ '^(bc1[a-z0-9]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$' then
      return 'That does not look like a Bitcoin address';
    end if;
  end if;
  return null;
end;
$$;

/* Where the money goes when a job is released. The first destination a
   professional adds becomes their default, so a payout always has somewhere to
   land. Now: normalised before it is checked, checked before it is stored, and
   the same one twice is refused rather than stacked. */
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
  v_actor   uuid := public.pampa_auth(p_token);
  v_any     boolean;
  v_details jsonb;
  v_problem text;
  v_make_default boolean;
begin
  if p_kind not in ('bank', 'crypto') then
    raise exception 'A payout destination is a bank account or a wallet'
      using errcode = '22023';
  end if;
  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'Destination details must be an object'
      using errcode = '22023';
  end if;

  v_details := public.pampa_normalise_destination(p_kind, p_details);
  v_problem := public.pampa_destination_problem(p_kind, v_details);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '22023';
  end if;

  select exists (
    select 1 from public.pampa_payout_destinations
     where account_id = v_actor and kind = p_kind and details = v_details
  ) into v_any;
  if v_any then
    raise exception 'That payout destination is already saved'
      using errcode = '22023';
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
  values (v_actor, p_kind, coalesce(p_label, ''), v_details, v_make_default);

  return public.pampa_wallet(p_token);
end;
$$;

/* The client's yes, and the only path that pays a professional for a job that
   was not disputed. The rating rides along, because releasing is the moment the
   client knows what the work was like.

   Re-declared in full rather than patched, because the one thing this adds —
   the check that there is somewhere for the money to go — has to happen before
   the payout row is written, which is the middle of the function. */
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

  /* Nowhere to send it, nothing to send. Releasing here would take the money
     out of escrow and hand it to a professional who cannot receive it, and the
     client — who did their part and is trying to pay — would be the one
     holding a problem they cannot solve. So the release waits, and the money
     stays in escrow where it is safe and where it is still theirs to release
     the moment the professional has saved an account.

     The message is written for the client to read, and names the person who
     has to act. */
  if v_dest is null then
    raise exception '% has not added a payout account yet, so there is nowhere to send this money. Nothing has been released — ask them to add one in their Wallet, then release again.',
      coalesce(nullif(btrim(b.provider_name), ''), 'This professional');
  end if;

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

grant execute on function public.pampa_add_destination(text, text, text, jsonb, boolean) to anon;
grant execute on function public.pampa_booking_release(text, uuid, int, text) to anon;
