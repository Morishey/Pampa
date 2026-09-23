/* =============================================================================
 * Pampa — 0006 — the name on the card follows the account
 *
 * A booking stores the two names it was made under: provider_name and
 * client_name, denormalised on purpose so a card can be drawn from one row.
 * The cost of that is staleness. Rename yourself in Profile and the row keeps
 * saying what you were called when you placed the request — and the name on
 * the card is the only identity the other side has, since a booking carries no
 * picture for either party.
 *
 * So the row follows the account, but only while the job is still ahead of
 * somebody: unpaid (offer on the table), escrowed (funded, unanswered),
 * confirmed (accepted work) and disputed (frozen, waiting on the desk). Those
 * are the cards two people are looking at right now, and the ones where the
 * wrong name is a small lie about who is coming.
 *
 * Everything else keeps the name it was made under. released, cancelled,
 * declined and settled are history: a finished booking is a record of what
 * happened, and the journal beside it names the same person in the same words.
 * Rewriting those would put the row out of step with the story of the row.
 *
 * The trigger sits on the account, not on pampa_update_profile, because the
 * name is written from more than one place — registration, the profile patch,
 * and any future RPC that renames somebody. One rule, wherever the write comes
 * from.
 * ============================================================================= */

create or replace function public.pampa_names_follow_account()
returns trigger
language plpgsql
security definer
as $$
begin
  /* `after update of display_name` already means the column was in the SET
     list; this is the narrower question of whether the value actually moved. */
  if new.display_name is not distinct from old.display_name then
    return new;
  end if;

  update public.pampa_bookings
     set client_name = new.display_name
   where client_id = new.id
     and status in ('unpaid', 'escrowed', 'confirmed', 'disputed');

  update public.pampa_bookings
     set provider_name = new.display_name
   where provider_id = new.id
     and status in ('unpaid', 'escrowed', 'confirmed', 'disputed');

  return new;
end;
$$;

drop trigger if exists pampa_accounts_names_follow on public.pampa_accounts;
create trigger pampa_accounts_names_follow
  after update of display_name on public.pampa_accounts
  for each row execute function public.pampa_names_follow_account();
