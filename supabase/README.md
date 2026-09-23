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

5. **Name the first admin**, once, if you want the resolution desk. The desk is a
   flag on an ordinary account, not a third role — and it is *granted, never
   taken*: a trigger refuses any change to it that does not come from
   `pampa_desk_grant()`. So the very first one is set by hand, in the SQL editor:

   ```sql
   begin;
   select set_config('pampa.granting', 'on', true);
   update public.pampa_accounts set admin = true, desk = true where handle = '<your-handle>';
   commit;
   ```

   After that nobody needs the editor again. From the app (or any PostgREST
   call as that admin), further mediators are promoted by handle:

   ```js
   await db.deskGrant("0805…");      // desk on
   await db.deskGrant("0805…", false); // desk off
   await db.deskRoster();              // who is on it
   ```

   Two powers are deliberately separate: `desk` decides a dispute, `admin`
   decides who decides. An admin cannot revoke their own desk, because that is a
   lockout wearing the clothes of a permission change, and the roster is admin
   only — it is a list of the people to pressure.

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
| ✅ | resolution desk: granted by an admin over RPC, not by pasted SQL |
| ✅ | the backend proven end to end against live Postgres (`tools/verify-db.mjs`) |
| ✅ | no shipped file can hand a raw Postgres refusal to a person (`tools/toast-guard.mjs`, run as the verifier's first two legs) |

The transactional half of the app is on the database: registration, sessions,
sign-in and sign-out, the directory with distance measured server-side, bookings
and every escrow transition, ratings, profile pushes, payouts and the resolution
desk — all through RPCs against the tables above, and all driven by the verifier.

What is still device-local is the media and social half: a professional's
portfolio uploads, clips with their likes and comments, 24-hour statuses, the
bell's read state and the preferences. None of those have tables yet — on the
server a directory record carries no media columns — so signing in on a new
phone returns your account, bookings, money and ratings, but not your gallery or
your clips.

## Is it working?

`tools/verify-db.mjs` answers that, and it answers it by calling the database
the way the app will: PostgREST, the anon key, real session tokens. No service
key, no direct table writes, no psql.

```bash
node tools/verify-db.mjs
```

It opens with static legs that need no database at all, because a static
regression should not depend on a project answering today. The first proves the
toast guard still catches a raw message (`node tools/toast-guard.mjs
--self-test` proves the same thing on its own); the second reads every shipped
file and fails if any of them has grown a fresh `.message` read inside a toast,
a dialog body or the `msg` field a transition returns — the shape that once
showed Postgres plumbing to a client. `node tools/toast-guard.mjs` runs that
scan by itself, and names the line to fix.

The third is the rendered cascade audit (`tools/render-audit.mjs`). The nav-badge
bug — a broad `.tab > span` rule quietly out-ranking the badge's own
`.tabDot` rule, so the booking count slid half over the neighbouring tab — was
invisible to every read of the source, because "does this selector ever apply
here" is a question about rendered containment, which only a browser answers.
So the audit boots a real headless Chromium, stages every surface device-locally
(both roles' views, the booking/escrow/dispute/rate sheets, notifications, the
provider page, the clip feed, the story viewer, the signed-out screens), and on
each asks the cascade the browser actually resolved: for every floating
component on screen, does a rule that never names it take a geometry declaration
away from the rule that does? It also plants the original trap and insists on
seeing it reported, so the check cannot go quietly blind; a run where the plant
is not caught fails even though every surface looks clean. It needs a browser
but no database or network — the cloud is refused at the fetch level, the live
project never hears of it — and where no Chrome or Edge exists the leg is
reported SKIP with the reason rather than pretended to have run.
`node tools/render-audit.mjs` runs it standalone, with `--list`, `--no-plant`
and `--keep-open` for poking.

It registers a client and a barber ~180 m apart, sets the barber's price bands,
checks the directory returns the precise distance and the ceiling, then runs the
whole escrow loop — request, pay, accept, complete, release with a rating, payout
net of the fee in the wallet — and the dispute leg with photos from both sides.
It asserts *relationships* (`total = price + travel`, `payout = total − fee`,
`toClient + toPro + fee = held`) rather than naira amounts, so a change to a rate
card cannot break it.

The negative tests are the point of it: the anon key reading `pampa_accounts`,
`pampa_sessions` or `pampa_bookings` must fail **with "permission denied"** — a
401 from a bad key is not the same thing — a client cannot accept their own
request or release somebody else's booking, a duplicate handle is refused, an
inverted range is refused, a non-admin cannot grant the desk, and the flag cannot
be smuggled in through a profile update. A refusal only counts when it is refused
for the right reason, so a mistyped argument name cannot look like a security
boundary.

Two things it needs to run and one it can skip:

- **The anon key and URL** come from `js/config.js` — parsed, not duplicated, so
  it verifies the config the app will ship with. `PAMPA_SUPABASE_URL` and
  `PAMPA_SUPABASE_ANON_KEY` override it.
- **Settling a dispute** needs an admin, and the first admin is named by hand
  (step 5 above) — the design, since any other way in would be a back door. The
  run brings its own key to that door, three ways in order:

  1. `PAMPA_ADMIN_HANDLE` / `PAMPA_ADMIN_PASSWORD` — your real admin signs in
     through the public RPC and acts. Nothing is minted.
  2. A Management token — `PAMPA_MANAGEMENT_TOKEN`, or the Supabase CLI's own
     `supabase/.temp/dev-token` — is the SQL editor's power, used exactly as
     the bootstrap block uses it: the run registers a throwaway admin through
     the public register RPC, raises its flag with the same transaction-local
     mark, and tracks the account so the cleanup deletes it. No standing admin
     is left behind, and the anon key never gains a power it did not have.
  3. Neither — the leg is reported SKIPPED, never passed silently.

  With a way in, the run proves the whole desk path: an admin promoting a
  mediator over the RPC, that mediator splitting a frozen escrow, both halves
  landing — a refund on the client's card, a payout row in the professional's
  wallet — and the decision journalled on the booking.
- **It cleans up after itself.** Every account is named `Verifier …` and the run
  writes `supabase/.temp/verify-cleanup.sql` naming their exact ids. Note why
  that matters: `pampa_booking_events` refuses every `update` and `delete` by
  trigger, so deleting a booking cascades into the journal and fails. The script
  disables that trigger around the deletes and puts it straight back.

### Already done for this project

The project is `pampa` (`fdwezuycrysgzhblunqp`, `eu-central-1`), the three
migrations are pushed and recorded, `js/config.js` holds its URL and anon key,
and the verification passed every leg with nothing skipped on its last full
run — the two static toast-guard legs included. No admin exists yet —
step 5 is still yours to run, naming whoever you trust to settle a dispute.

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
