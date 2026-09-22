# Pampa on Postgres

Everything in `migrations/` is the whole backend: accounts, the provider
directory, bookings, the escrow ledger and the resolution desk. There is no
other server — the app talks straight to Postgres through PostgREST, and the
functions here are the only way in.

## Why it looks like this

**Accounts are ours, not Supabase Auth's.** People sign in with a phone number
or username and a password, and are never sent a code. So passwords are bcrypt
hashes made by pgcrypto, and a signed-in device holds a session token instead of
a JWT.

**There is no `auth.uid()`, so RLS is used the blunt way.** Row Level Security
decides what a JWT may see; with no JWT it cannot tell one client from another.
So every table is locked — RLS enabled, zero policies, and the `anon` role holds
no privilege on it — and the only doors are the `security definer` functions at
the bottom of each migration, each of which authenticates `p_token` before it
does anything else.

Two consequences worth stating out loud:

- **The anon key is public.** It is in `js/config.js`, in the shipped bundle, in
  every browser. That is safe *because* it grants nothing. If a table is ever
  added without revoking privileges, it stops being safe — which is why each
  migration ends with a catch-all `revoke … from public, anon, authenticated`
  followed by an explicit grant list. Keep that pattern.
- **The service_role key must never reach the frontend.** It bypasses RLS
  completely. It belongs in an Edge Function or the push relay, nowhere else.

**The escrow rules live in the database.** This is the point of the whole
exercise. `escrow.js` decided the state machine in whichever browser had the
page open; a client could rewrite their own ledger. Now
`pampa_transition_ok()` lists the legal moves, `pampa_guard_booking()` refuses
everything else, `pampa_booking_events` is append-only by trigger, and the
amounts are computed server-side — travel fees, the 10% fee, the dispute split.
A `pampa_booking_release` from somebody who is not the client fails in Postgres,
not in the UI.

**Money is journalled in one table.** `pampa_booking_events` is both the booking
history the app renders and the escrow ledger underneath it: one line per thing
that happened, with the amounts on it. `pampa_payouts` is the moment money
leaves escrow.

## Setting it up

1. **Log in** (interactive — opens a browser, or paste a token from
   <https://supabase.com/dashboard/account/tokens>):

   ```bash
   npx supabase@2 login
   ```

2. **Create the project** in the dashboard: name it `pampa`, pick the region
   nearest Lagos (`eu-west-*` or `us-east-1`), and save the database password it
   asks you to set.

3. **Apply the migrations**, either way:

   ```bash
   # a) through the CLI, once the project is linked (asks for the DB password)
   npx supabase@2 link --project-ref <your-project-ref>
   npx supabase@2 db push

   # b) or paste each file from migrations/ into the dashboard's SQL editor,
   #    oldest first, and run it
   ```

   Path (b) needs no password and no link, but the CLI's migration history will
   not know about it — run `npx supabase@2 migration repair --status applied
   <version>` for each file afterwards to line the two up.

4. **Point the app at it.** Settings → API gives the Project URL and the anon
   key; put them in `js/config.js`, then add the two scripts to `index.html`
   (before the modules that use them):

   ```html
   <script src="js/config.js"></script>
   <script src="js/db.js"></script>
   ```

   With the values empty the app keeps running on localStorage, so this file can
   sit in the repo safely until the database exists.

5. **Make yourself a mediator** if you want the resolution desk. The desk is a
   flag on an ordinary account, not a third role:

   ```sql
   update public.pampa_accounts set desk = true where handle = '<your-handle>';
   ```

## What is here, and what is not

| | |
|---|---|
| ✅ | accounts, sessions, phone/username sign-in with lockout |
| ✅ | trades, services, areas, provider profiles, rates as bands |
| ✅ | bookings, negotiation rounds, escrow, payouts, disputes, desk settlement |
| ✅ | discovery with server-side distance and "can they take a job right now" |
| ⬜ | ratings as their own table with history (today: a sum and a count on the provider) |
| ⬜ | statuses, clips, likes, comments (the social half — needs Storage for media) |
| ⬜ | notifications and push subscriptions |
| ⬜ | seeding the demo professionals (Amara, Tunde, Zainab, Sofia) into Postgres |
| ⬜ | wiring the app's call sites over from localStorage to `db.*` |

The app is still running on localStorage today. `js/db.js` is the client half of
the migration, written against these signatures and tested only by
`node --check` — it has not been exercised against a live database yet, because
there is not one to exercise it against.

## Known gaps

- **No rate limiting on sign-in beyond the account lockout** (8 failures, 15
  minutes). Supabase's own protection covers Auth endpoints, and this is not an
  Auth endpoint, so a distributed guessing attack is only slowed, not stopped.
  Fine now; put a limit in front of it before real money moves.
- **`pampa_directory` returns every professional in the trade.** Correct for
  hundreds, hopeless for tens of thousands — it will need a bounding box or a
  PostGIS index on `(lat, lng)` before then.
- **Sessions last sixty days and are not device-labelled.** `pampa_me` will tell
  you who you are, but there is no "sign out my other devices" yet.
