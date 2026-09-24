# Pampa

A mobile-first booking webapp for beauty & barber services — book stylists to
your home or their studio. Built with plain HTML/CSS/JS, no build step.

## Run

Open `index.html` directly in a browser, or serve the folder:

```bash
npx serve .
# or: python3 -m http.server
```

**Live:** **[getpampa.vercel.app](https://getpampa.vercel.app)** — the Vercel
project `pampa` builds the repo root as a static site, and the GitHub repo is
connected to it, so **a push to `master` deploys to production on its own**.
`tools/` and `.freebuff/` are kept out of the upload by `.vercelignore`. There
is no server behind the site: escrow, the directory and every account live in
the browser's own storage, as the sections below describe.

## What works

- **Splash + two doors, and they no longer share a corridor** — **Sign in**
  is one screen; **Create account** is a short walk. Every auth screen states
  which one you are on (kicker + step chips: sign-in has nothing to count down
  and says so, creating an account is 6 steps for a client and 7 for a
  professional), with its own titles and button labels
- **Sign in** — your **number or your username, and your password**, each in a
  field with its own icon, on one screen. No code anywhere in that door: the
  code is the price of a *new* account and nothing else.
  The name, role, trade, area and picture are restored from the account book and
  the app opens on the right dashboard with no onboarding. An unknown number or
  name falls through into onboarding and re-labels itself as a sign-up; a
  password that does not match is refused on the spot
- **Create account** → phone → OTP verification (demo code: **1234**) → name →
  **password** → **role** → trade (professionals only) → location
- **The one account that needs a way through** is one made before passwords
  existed. It has no credential to check against and no code is coming, so
  sign-in says exactly that and offers the only honest door left on a device
  with no server: **set a password now, once**. It is a migration, and the
  screen calls it one rather than dressing it up as verification
- **Passwords are never stored as text** — each account keeps a random
  **salt** and a **SHA-256 hash** of salt + password (`crypto.subtle`), and the
  top nav's face, the display picture and the credential all live on the same
  account record, which is merged on every save rather than overwritten. This is
  still a device-local demo — a hash in `localStorage` is not a security
  boundary — but the accounts book never holds the password itself, and nothing
  in it would have to be unlearned to move the check server-side
- **Change your password** — Profile → *Change my password*, which asks for the
  current one first (it reads *Create my password* for an account that has none
  yet)
- **Role, chosen once and then fixed** — *I work in beauty* or *I want to book*.
  It decides the whole shape of the app from then on, and it does not change:
  - **Professional** → the trade step (**Barbing leads the list**, then Hair,
    Nails, Spa), a studio area, and a **Work dashboard**
  - **Client** → straight to location, and the booking home
  - The **trade is set once at sign-up** and is not editable afterwards — it is
    what every escrow path, payout and disclosure hangs off. The profile states
    it and offers no button to change it. A client has no directory record, so
    **pro mode is not theirs to open**: the entrance is hidden, and the guard
    inside the desk refuses anyway
- **Home (client dashboard)** — one screen, top to bottom: **the stories rail**
  (what professionals are doing today, 24 hours a ring), **where you are** — one
  compact pill (area + street on its two lines) beside **one search box** that
  finds a person by name or by trade ("fade" finds the barbers) — the trade
  chips, and **Closest to you** —
  **every** professional on the device, in a **two-across grid** (three once the
  window passes 520px) sorted nearest-first with the distance that decided it.
  There is no service catalogue on Home: a client chooses a person, and the
  person's own services — each with **the price range they publish for it** on
  the card — are what the booking sheet opens on
- **In the spotlight** — below the booking funnel, a strip of professionals who
  have real work on display, each card led by a portfolio photo with a works
  count and their distance from you, nearest first. A card opens the
  professional's public profile, not a filter
- **Clips** — a vertical rail of every video on the device, watched one full
  screen at a time: it plays by itself, snaps as you scroll, and every clip can
  be **liked** and **commented on**. Tabs: *For you* and *Near you* (see below)
- **Display pictures and portfolios** — **every** account can set a profile
  picture: it is the avatar in the top nav on Home (tap it to open Profile) and
  the one beside your own name, and for a professional it is also the public
  face on every client's discovery card. Providers additionally publish up to 9
  pieces of work, photos or clips (see below)
- **Work (professional dashboard)** — a business card at the top: their picture,
  name, profession and where they work, with contact-editing one tap away, and
  a **Taking bookings** switch under it that closes their books without hiding
  their page, and a **Your rates** card under that for the prices of each of
  their services (see below);
  below it their gallery, then what is waiting on them, what is in
  progress, and what is available to withdraw, then every paid request in date
  order with the client, the visit type and what you keep — and a door into the
  escrow desk to accept, mark done and withdraw. Their Home tab is locked to
  their own trade: chips, slider, services, the professionals strip and the
  spotlight all show barbing to a barber and nothing else, and a chip outside
  their trade answers with a toast instead of re-filtering
- **Provider directory** — picking a trade puts you in client-side discovery, so
  you can be found and booked like anyone else (see below)
- **Provider profiles** — tap any discovery card for a public page: the picture,
  bio, the work gallery, every service with its price, the rating history and a
  coverage map
- **Editable personal details** — display name, email and Instagram / TikTok / X
  handles, from a button on the profile or the pro dashboard's business card;
  handles save without the @, invalid emails are refused, and everything rides
  the public record so the dashboard and the public page agree
- **Ratings** — releasing escrow is also the moment to rate the job 1–5 stars
  with an optional review; the average shows on the discovery card and profile
- **Pro's Home is their profession** — no service grid, no search, no chips, no
  professional strip: the trade with its icon, the average rating, jobs done,
  reviews and the review history, plus a button into the work dashboard. The
  featured slider and every other booking surface stay client-side
- **Booking sheet** — pick stylist, **the price you can afford** inside their
  published range (a slider plus the floor, the middle and the ceiling, one tap
  each), date, time slot, and **how**: *Home visit* or *Studio walk-in* on every
  booking, with the destination and the travel fee spelled out for each (a
  walk-in pays no travel fee and shows the studio's door). Professionals who are
  not taking bookings are marked and cannot be picked. Live price; confirm
- **Bookings** — the client side of the same ledger: upcoming/past tabs, the
  destination and kind of visit on each card (*Home visit · <address>* or
  *Walk-in · <studio>*), travel fee where it applies, cancel
- **Profile** — your details, the role you joined as, trade, area + address, bio,
  appearance switch, save-on-device toggle, log out
- **Escrow payments** — pay by card, bank transfer or USDT; money is held until
  you confirm the job
- **Pro mode** — the escrow desk behind the Work dashboard: **accept the
  client's price or negotiate one of your own**, mark jobs done, file evidence
  and withdraw earnings. It belongs to the account that opened it: a
  professional works as themselves, and the identity cannot be swapped for
  someone else's
- **Persistence** — user, bookings, escrow ledger and pro account stored in
  `localStorage`, so a refresh keeps everything intact

## The provider directory

Everyone who takes jobs is one record: the four seeded stylists, the three
providers the app ships with, and you the moment you pick a trade. Discovery,
the booking sheet and pro mode all read the same record, which is what makes a
registration bookable rather than a special case.

```
pick a trade → provider record → appears in discovery → booked → escrow → paid
```

What a provider record carries and where each part comes from:

- **Their trade's services.** `cats` (from the trade) decides which services
  they can do, which services the sheet offers them, and which bookings their
  pro inbox sees. A barber is simply never listed for knotless braids.
- **Their own distance.** Measured from their studio area to the client's area
  with the haversine formula — 2.6 km for Ade in Surulere, 22.1 km for Nkechi in
  Ajah, from a client in Yaba. It drives the sort order and the travel fee.
- **Their coverage.** A seeded stylist keeps a hand-picked list of areas; a
  registered provider gets `covers: null` and covers **every area within 14 km
  of their studio**, so signing up never asks you to draw a coverage map. That's
  also why Nkechi reads *studio only* from Yaba while Ade reads *visits you*.
- **Their history.** A fresh provider reads "New on Pampa" instead of
  "0.0 · 0 jobs". Only a released escrow — work actually paid for — increments
  their public job count, which then reads "1 job · no ratings yet".
- **Their face and their work.** `dp` (one square profile photo) and `works`
  (up to nine pieces) travel with the record, so the picture and the gallery
  appear everywhere the provider does — see *Faces and work* below.
- **Whether they are at work today.** A professional with a status still live on
  the spotlight rail comes up the list ahead of everyone else — nearest-first
  *inside* that tier — with a small gold *Live* chip beside their name. It is
  the same fact the rail shows, read where a booker is deciding rather than
  where a watcher is browsing. The *Nearest* badge follows the truly nearest
  professional, not the top slot, so a live professional can hold the first card
  without the pin moving off the closest one.

A tier only says something while it is a minority. The curated seeds therefore
light **four** of the seven seeded professionals — one per trade — and leave the
other three to go about their day, so a fresh install opens with a rail worth
tapping and a list where the live cards are visibly lifted out of the rest. When
every card is badged, nothing is.

Distance is measured between areas, so a professional whose studio is the
client's *own* area is not "0 m away": the app knows their area, not their
doorstep. It says **In your area**, which is both true and the only way two
professionals in the same area are distinguishable on a list sorted by distance.

The trade is written once, at sign-up, and does not change afterwards: there is
no edit path to it, and a client never gets a record at all. Registering again
with the same number rejoins the same provider profile.

**The directory and the booking ledger outlive a session.** Both live in their
own device-level storage (`pampa.directory.v1`, `pampa.bookings.v1`), not in the
per-account session, so the marketplace keeps working between logins: a stylist
who registers stays discoverable and bookable after they log out, and the
escrow they're owed is still waiting when they come back. Records are keyed by
the phone the account was created with, so re-registering with the same number
rejoins the same provider profile rather than forking a second one.

A record can never be registered without a number, and any record left under
the placeholder key (`p:guest`) is repaired on the next load: adopted onto the
real key when it is the signed-in person's own, removed when it is
unattributable. Either way it cannot survive as a second, unbookable provider in
everyone else's discovery list.

```
Kola registers (Barbing · Yaba) → logs out
Ada signs up (client · Lekki) → discovery shows Kola at 13.8 km, visits-you
Ada books + pays escrow → logs out
Kola returns → pro mode shows Ada's request → accepts → earns
```

Each signed-in account sees only its own bookings; the desk sees every dispute,
and slot-taking is device-wide so two clients can never hold the same hour.

### Stories: the spotlight rail is a status rail

The spotlight strip on Home is a stories rail — one ephemeral ring per
professional, running the Instagram logic end to end:

- **A professional posts a status** from their dashboard (a *Today's status*
  card under the availability switch): a photo, a short clip (file up to the
  same 1.5 MB budget as a portfolio clip, or a YouTube/mp4 link), or a line of
  text over their own trade's drawing. Up to six live at once, photos are
  shrunk to 1080px before saving, and each one dies exactly 24 hours after it
  was posted — expiry is a read-time filter, so it needs no timer and cannot be
  missed by a closed app.
- **The rail sits at the very top of the client's Home**, the next thing after
  the header, above the location group — the first thing a reader meets, as the
  borrowed logic dictates.
  Unwatched rings are the gold accent, watched rings a quiet rule, the
  professional's own empty ring is a dashed slot with a plus (their invitation
  to post), and their own live status sits first. Ordering is stories-order:
  unseen first, then freshest, then nearest. A professional's Home hides the
  rail with the market — their own ring lives on their dashboard.
- **The viewer** plays one professional at a time with segmented progress bars,
  auto-advancing through their set and handing over to the next professional
  with something new. Tap right to move on, left to go back, hold to pause
  (the bar and the timer pause together), swipe the card down to dismiss,
  `Esc`/`←`/`→`/`Space` on a keyboard. Photos hold 5s, notes 6.5s, clips play to
  their real length capped at 20s. The footer is role-aware: a client gets
  *Profile* and *Book* (disabled with the reason when the professional is in a
  session or paused); the owner gets *Post another* and *Delete this*.
- **Seen is per account**, keyed like the bell's unread mark — a client who has
  watched a ring reads it as watched, the next account on the device reads it as
  new.
- **A status is a conversation, not a broadcast.** In the viewer a client gets
  four quick reactions and a short message field. One reaction per account — a
  second emoji replaces the first, the way the rail behaves everywhere — and any
  number of messages, capped at 140 characters and kept to the newest thirty per
  status. Both land in the professional's bell as news in the same feed as
  bookings and clips (*Ada Client reacted 🔥 to your status*, *Ada Client sent a
  message on your status*), and tapping the row plays the story they are about.
  A status that has expired takes its news with it, exactly like the clip
  ledger. **The story stands still while the message field has the focus**, so a
  sentence written for one professional can never be delivered to the next one —
  the hold is keyed, so lifting a finger mid-sentence does not send the story on
  either, and the arrows and `Esc` belong to the text while it is being typed.
- **The professional sees what their day did.** The *Today's status* card counts
  unique clients who watched each status (a small eye-and-number chip on the
  tile, never the owner's own looks) and sums it into one line: *1 live · 2 views
  · 1 reaction · 1 message — all of it lands in your bell.*
- **A tile has a vertical budget, and the note tile was over it.** A status tile
  is 74×106 and carries three things besides the status: a views badge (16px)
  and a delete button (28px) in its top corners, and the *23h left* band (18px)
  across its foot. The note tile also had a quotation glyph above its caption,
  and that was the one thing too many — the glyph sat under the badge, and the
  caption's last line ended 4px **inside** the band, so *walk in at Surulere*
  was painted behind *23h left*. The glyph is gone (the gold wash behind the
  words already says "note"), the caption is clamped to three lines with an
  ellipsis — the tile is an excerpt, the viewer is the full text — and the
  padding now reserves the instrument rows exactly (26px top, 19px foot).
  Measured on the smallest tile the app has: caption to badge 16.3px, to the
  delete button 4.3px, to the band 11.3px, none of them touching.
- **Seeded professionals carry curated statuses**, stamped a plausible number of
  minutes back, so a fresh install opens with a rail worth tapping — and the
  timestamps age honestly.

**The conversation turns two ways, and the desk answers where it reads.** A
client's message on a status is news in the professional's bell like everything
else — and now it is the one row in the feed that can be *answered from where it
is read*, without walking back to the story it came from. The row keeps its way
through to the story (the left side of it plays the status), gains a small gold
**Reply**, and the composer opens under the row it belongs to: input, gold send,
the focus already in the field, `Enter` sends. The list does not jump — the
scroll position is held across the toggle — and a message that has been answered
says **✓ Replied** instead of offering the same reply all day.

- **Both ends read the same thread.** A reply is threaded onto the exact message
  it answers (`replyTo`, plus a per-message id that older messages are given
  deterministically on load), so nothing has to guess from what came last. The
  half that mattered: the *client's*. They get their own notification — *«name»
  replied to your message*, with the reply's own words in the row and in the
  system notification — and the status viewer quotes the last word from the
  other side above the composer while they are reading it (*TestPro · Sure —
  5pm works, see you then*), so the answer arrives where they wrote the
  question. The viewer's quote is role-aware: the owner reads the newest client
  message, a client reads the professional's newest answer to them, and a
  professional's own replies are never counted back to them as news (the
  insight line says *1 message* when one client message arrived, not two).
- **The bell's rows stopped drawing a second border inside themselves.**
  `.nInfo` — the text block inside a notification row — was on the list of
  "panes" in `polish.css`, so every row of the bell had a hairline nested inside
  its own. It is not a surface; the border is the row's.
- **A place is written once, and the rule finally fires.** `placeLine` appends
  the area to an address, skipping it when the address already names it — but it
  compared whole strings, and an area is written *Surulere, Lagos* while an
  address usually names only the neighbourhood, so bookings read *12 Bode
  Thomas, Surulere, Surulere, Lagos*. It now looks for the area's own name on a
  word boundary — and looking for the *city* would have wrongly trimmed an
  address like *12 Marina, Lagos Island* — so the duplicate is gone and no
  address loses the area it needs.

### Taking bookings, or not

A professional can close their books without going anywhere: the **Taking
bookings** switch sits on their Work dashboard, directly under the business
card, because it is the control they flip most often.

- **On** — clients book and pay into escrow as usual. The state is drawn before
  it is read: a green tick on the card, *Taking bookings* on the hero chips and
  on the professional's Home card.
- **Off** — the record keeps `available: false`. The switch is the last word on
  whether a booking may *start*, and it is enforced in every place one can:
  the discovery card (dimmed, greyed portrait, a *Not taking bookings* pill and
  a greyed *Paused* button instead of a gold *Book*), the public profile (a clock
  chip, a disabled call to action and a line saying why), the booking sheet
  (their pick card is dimmed and disabled, and the sheet opens on somebody who
  can actually take the work), and the confirm step itself, which refuses with
  the reason. The tap on a paused *Book* is answered at the tap, not at the end
  of a filled-in form.

**Pausing is about new bookings only.** A job already paid into escrow is a
promise: the professional still sees it, still accepts, marks it done and gets
paid. Nothing already booked is cancelled by the switch, and the card says so in
those words. Their page, prices, work and ratings stay up the whole time — a
closed book is not a hidden one.

An install that predates the switch has no answer stored, and absent means
"taking bookings" everywhere, so nothing breaks on upgrade. Seeded records
follow their seed instead (Nkechi ships paused, so the client half of the switch
is visible without a second account), and a returning professional's record is
rebuilt from their profile at sign-in — which is also how the address below
reaches a record written before it existed.

### In session

A switch is a statement of intent. **A professional who is with a client is not
bookable whatever their switch says** — one chair, one client — and they are not
free again until the money for that job is settled. The rule is the same one a
client would apply to a barber mid-cut, enforced by the app instead of assumed.

A **session** is any booking whose money is still held — `escrowed`,
`confirmed` or `disputed` — whose booked time has arrived. It runs to
**settlement, not to a clock**: the service's own duration plus a 15-minute walk
to the next job says when the work is expected to be done, but the chair is only
handed back when the job is settled, which is the client releasing, the
dispute desk settling, or the booking being cancelled or declined outright. A
professional still waiting to be released for a chair they have already left is
still holding somebody's job, so their next opening waits with them.

`providerBookable(p)` is the only place the question is answered — the switch
and the session together — so the surfaces that state it cannot drift apart:

- **discovery** — the card dimmed from the inside, the portrait greyscaled, a
  gold *With a client* pill where *Not taking bookings* would be, and a disabled
  *In session* button in place of the gold *Book*;
- **public profile** — an *In session* chip, a disabled *In session — free after
  settlement* call to action, and a line explaining that the work and prices stay
  up meanwhile;
- **booking sheet** — their pick card dimmed and disabled with the reason, a
  warning line under the where toggle, and the confirm step refusing at the tap
  (`TestBarber is with a client right now — they open again once that job is
  settled`) rather than after a filled-in form;
- **the professional's own dashboard** — the hero chip and the header tag read
  *In session*, and the availability card says which client holds the chair and
  since when.

**The switch stays on through a session**, and the card says so in those words:
*With a client right now* — *your switch is on and it stays on*. That headline is
deliberately a third state rather than reusing *Not taking bookings*, because a
professional reading a visibly-on switch beside "Not taking bookings" is being
lied to by their own dashboard. Their page, prices, work and ratings never come
down, and the job they are in runs normally: they still accept it, mark it done
and get paid.

Because a session starts and ends on the clock rather than on a tap, the app
watches for it: **`startSessionWatch()`** re-reads the ledger every 30 seconds
and redraws the bookable surfaces **only when the answer actually changed**
(a signature of every live booking, settled or begun), so an hour-long session
costs nothing and nothing flickers. The watch is stopped with the session at
logout, so one account's clock never redraws the app behind another's
signed-out screen. Verified end to end: a walk-in booked and paid, the session
taken into its window by moving the clock, every surface reading *In session*,
the pro marking the job done — still held — and the client's release handing the
chair straight back (`Book` gold again on discovery, the pick card enabled, the
sheet's picker live).

There is a slot-level half of the same rule: a session's chair window blocks
overlapping slots (`sessionClash`), so the middle of a 90-minute service cannot
be booked even when the exact slot on the list is free.

## What they charge, and the price you name

A haircut is not one price. A touch-up and a full restyle are different jobs, so
**every service a professional offers carries a range of their own** — the floor
they will work for and the most they charge — and **the client names the number
inside it**.

- **The professional writes the range** on a **Your rates** card on the Work
dashboard, one low and one high per service of their trade (a barber gets *Full
haircut*, *Beard trim* and *Maintenance*; the trade decides the list, so nobody
can publish a rate for work they do not do). `setProviderRange` validates the
pair — both numbers real, the low one not above the high one — and a bad row
stops the whole save with the reason, so half a card is never applied. Until
somebody sets theirs, `rangeFor` answers with a default band around the
catalogue price (×0.7 to ×1.4, rounded to ₦50), which is why a seeded stylist
and a record written before rates existed both still have a usable range.
- **The client picks inside it** in the booking sheet: a slider across the
  range, the number in the largest type in the block, and three places worth one
  tap — *Lowest*, *Middle*, *Top*. Their price rides the booking as `offer`, and
the range it was chosen from is stored beside it. Switching service or
professional re-clamps the offer into the new range (`clampToRange`), and a
card that publishes a range shows it before the client has tapped anything
(*Full haircut ₦2,450 – ₦4,900*, on the discovery card and on the public
profile's service list).
- **Money moves only on the agreed number.** The client pays their offer into
  escrow as usual, and the professional's answer is where the negotiation lives:

| | |
|---|---|
| **Accept ₦X** | takes the offer as it stands. `acceptedAt` is set, the negotiation closes as *agreed*, the job is confirmed — and the journal records *at the client's price of ₦X*, not just *accepted* |
| **Negotiate price** | opens a sheet with the client's offer, a field bounded by the pro's own range, three one-tap prices (*Lowest*, *Their offer* when it sits between them, *Top*) and a live *you keep / client would pay* box. Outside the range it refuses and names the range rather than silently clamping |
| **Decline** | refunds the client in full — no work has been done |

A counter puts the decision with the client, who sees *<name> sent a price of
₦Y* on their booking card with **Accept ₦Y** and **Decline · full refund**. Only
one counter is on the table at a time, so the professional's own accept and
counter both refuse while the client holds the answer.

**The sheet opens on the person, not on a market.** A client who tapped *Book*
on somebody's card, opened a story and tapped Book there, or came through their
public page has already made the choice — a list of every other professional
under the name they chose was the app asking the same question twice. A sheet
opened *for* a named professional therefore shows exactly one card, labelled
**Your professional**, with that one's face, trade, rating, coverage and
distance; a sheet opened without a name (a service tapped from the bookings
list) is still a question and still shows the list. The way back exists for a
client who changed their mind — a quiet **Choose someone else** beside the label
— and choosing from it is what turns the sheet back into a list, so the row of
names never appears on its own. The pick card's own note also stopped saying
*studio 0 m away* for a professional in the client's own area: it reads
*Visits you · in your area*, the same words the chips and the cards use.

- **Accepting a higher counter collects the difference** through the same
  escrow, not a second one: the pay sheet opens in a *top-up* mode showing
  *Agreed price − Already in escrow = Pay now*, and the escrow is repriced to
  one total with one reference and one fee recomputed from it. **Accepting a
  lower one refunds the difference** on the spot. Declining refunds everything.

The whole exchange is journalled on the booking, so the money trail and the
bell tell it in order: *Booking placed … · client offers ₦2,000* → *Client paid
₦3,000 into escrow* → *Stylist countered ₦5,000 … waiting on the client's
answer* → *Client accepted the counter — price agreed at ₦5,000 · topped up
₦3,000 into escrow*. The bell gains three kinds for it — **counter**, **agreed**
and **counteroff** — so a price arriving is news on both sides rather than
something to go looking for.

One state is worth naming because it is designed rather than incidental: an
offer **below** the published range. A professional who raises their floor after
a booking exists still has the old offer in front of them, so the card tints red
and says so (*Client offers ₦2,000 · your range ₦3,000 – ₦6,000*) while still
offering the full set of answers, and the negotiate sheet opens on the new floor
rather than on the sub-floor number.

## Home visit or studio walk-in

Both ways to have a job done are offered on **every** booking, at the top of the
booking sheet, in the same field language: *Home visit* and *Studio walk-in*,
each with its own icon and its own consequence.

- **Home visit** — the professional travels and the client's address is the
  destination. The sheet states that address, and the travel fee is added to the
  total (`TRAVEL.base` plus per-kilometre beyond the free radius).

  The fee is **shown before confirming, priced off the precise fix-to-fix
  distance**, and it says what it is: the fee row reads *Travel to you · 406 m
  away — ₦1,000*, the fine print states the tariff (₦1,000 for the first 3 km,
  then ₦250 a km), and the where-toggle states the fee inline (*they're 406 m
  away · travel ₦1,000*) before the foot is even reached. When one side has no
  device fix the distance is area-centre measured and wears the tilde — and
  because a fee priced off a district centre is only an estimate, the fee box
  then offers *Use my location for the exact fee*, which re-reads the device
  and re-prices the sheet in place. The sheet also quietly re-reads the device
  once when it opens, so a fix saved weeks ago never prices today's visit; a
  reading less precise than three times the saved fix's accuracy does not
  replace it, and one outside the covered areas is ignored. Whatever fee is on
  the card when the client taps confirm is the fee the booking carries —
  confirm re-reads the same point and rebuilds the sheet if the two could
  disagree.
- **Studio walk-in** — the client travels. The sheet says *Walk in to* the
  professional's studio address, how far it is, how long the drive takes, and
  *no travel fee* in as many words. The total is the service price and nothing
  else. Ade at 11.3 km reads: ₦3,500 walk-in against ₦6,550 for a home visit.

Which one is chosen is recorded on the booking (`loc`, plus `studioAddress` and
`studioAreaName` for a walk-in), so it survives the sheet: the client's card
reads *Walk-in · 14 Adeniran Ogunsanya, Surulere* or *Home visit · <their
address>*, and the professional's request list reads *Walk-in at your studio* or
*Home visit*.

Two rules keep it honest rather than merely offering a choice. **Home visit is
unavailable when the professional does not travel to the client's area** — the
button is disabled with the reason beside it, and the walk-in is the way in.
**The studio address comes from the professional's own profile** (the address
field on their Home, which asks them for the door a walk-in comes to), falling
back to their area when they have not set one. Because the where is now an
explicit choice on every booking, the barbing service that used to be called
*Home haircut* is simply *Haircut* — named for the work, not the venue.

## Faces and work

A provider is a person and a portfolio, and both live on the same record so
there is never a second copy to drift.

**The display picture** is set from Profile → *Your picture* (a professional's
block is titled *Your public page*) → *Add a profile photo*, or by tapping your
own face on either dashboard — the picture itself is a button (a small camera
sits in its corner on Work, and the trade glyph is badged onto it on Home),
because a picture the owner cannot find the way to change is a picture they do
not have. It also fills the **top-nav avatar** on Home, which is a button that
opens Profile and shares the header band's one size with the two buttons beside
it, so the three sit on a single line. It is a real file picker, a phone
camera shot is 3–5 MB, and the whole directory shares a few megabytes of
`localStorage` with everything else, so the original can never be written:
`shrinkImage()` redraws it on a canvas at **320 px on the long edge, JPEG
q0.78**, which lands a 12-megapixel photo at about **4 KB**. `avatarHtml()` is
then the only avatar in the app — the home row, the booking sheet candidates,
the profile header, the public hero and the work cards all call it, so a
provider with a picture looks like themselves everywhere and one without falls
back to their initial.

A picture change redraws **every** surface that carries it through one call,
`refreshProviderSurfaces()` — the Home card, the Work dashboard, the profile
and (for a client's view) the discovery strip and spotlight. Without that, an
upload landed on the dashboard but the tab a client books from kept the old
face until something else happened to re-render it.

**The portfolio** is Profile → *Add work photos & videos*. Photos go through the
same shrink at **900 px / q0.72** (≈9 KB each) and are capped at **9 items** so
one provider cannot eat the device's storage; they appear on the public profile
as a square grid, and tapping one opens a full-size viewer. A caption can be
attached and it renders on a scrim over the tile.

**A clip is either a file from the device or a link**, and the sheet takes
either: *Add a video* opens a real video picker, and the link field carries its
own **+** button so a pasted URL never depends on the reader knowing that Enter
submits it. A file is kept whole — a video cannot be shrunk the way a photo can
without a transcoder — so it is accepted only while it fits the storage budget
the directory shares: **1.5 MB**, and past that the app says so and points at
the link path instead. A 0.8 MB webm lands in `localStorage` at about 1.1 MB of
base64, which is the price of a clip that genuinely plays offline.

A clip is watched in the **rail**, not in a viewer with one video in it — see
*Clips* below. Photos keep the tap-to-open viewer. Inside a rail slide, what was
stored decides what plays:

| what is stored | what a slide shows |
|---|---|
| an uploaded file (`data:video/…`) | an autoplaying `<video>` fills the screen |
| a direct `.mp4` `.webm` `.mov` `.m4v` link | the same, streamed on arrival |
| a YouTube / youtu.be / Shorts link | a poster with **Load the player** |
| anything else (an Instagram reel, a share page) | a gold *Open this clip* button |

Both of the last two are deliberate. Guessing at a page that will not play
inline is worse than one honest outbound link, and a YouTube embed is not loaded
until the reader asks for it: the player is a second connection and a lot of
script, and merely scrolling past a clip should not pay that cost. A clip with a
dead source says so in its own slide instead of sitting there black. The rail
drops every video's source when it closes, so nothing plays on behind the app.

The **Discover** edge of this: a discovery card carries a *N work(s)* chip and a
preview count, and the profile's *Work* section sits **above** the price list —
a client chooses a person by what they have made before they read what it costs.
A provider viewing their own card is tagged *You* and never wears the *Nearest*
badge, because your own distance to yourself is not a recommendation.

The app ships three providers shaped exactly like a registration (Ade · barbing
in Surulere, Ireti · hair in Gbagada, Nkechi · nails in Ajah) so the directory
isn't only whoever registered last. Honest limit: this is still one device, so
"other people" means other accounts on the same browser — a real deployment
moves the directory and ledger to a server and nothing in the read path changes:
discovery, the booking sheet and pro mode already consume the same records.

## Profiles, ratings and activity

**A profile page per provider**, reachable from the discovery card (or the
Profile button beside Book). It leads with who they are, then four things a
client actually decides on:

- **Bio** — providers write their own (Profile → *Add a bio*); until they do,
  Pampa writes one from their trade, studio area, coverage and history, so a
  brand-new provider reads like a person rather than a blank card.
- **Services and prices** — their trade, priced, each with a Book button that
  opens the booking sheet on that exact service.
- **Rating history** — the average, the distribution, and every review written
  on this device with its author, comment and service.
- **Coverage map** — drawn to scale in kilometres: the studio at the centre, the
  14 km they will travel as a gold ring, a dot per covered area (hover names it),
  and your own area as a violet pin when you have set one. Below it, the covered
  areas listed with real distances from you.

**Ratings are earned, never invented.** The *Job done & satisfied* button now
opens a rate-and-release sheet: 1–5 stars, an optional note, and the release
happens from there. A job can be reviewed **once**, and only by the client who
paid for it — the guard is the escrow transition itself, not a separate flag.
`Release without a review` stays one tap away, so money is never held hostage by
the review UI.

The number a client sees blends a provider's **baseline** (the rating and job
count they arrived with) with reviews written on this device, so a single five
moves a brand-new provider but barely dents a 4.9 over 210 jobs. Reviews live in
`pampa.ratings.v1`, keyed by provider, and survive logout with the directory.

**The activity bell** on Home derives its feed from the booking ledger rather
than storing events twice — every journal line already carries who it concerns
and when. Each account sees its own side:

| event | client sees | stylist sees |
|---|---|---|
| payment into escrow | "held in escrow" | **"New booking request"** |
| job accepted | "*(name)* accepted your booking" | — |
| stylist marked done | "release once you are happy" | — |
| payment released | — | "Payment released to you" |
| review posted | — | "*(client)* rated you" |
| problem reported | — | "a problem was reported, file your side" |
| desk settlement | refund / split / release outcome | same, from their side |

Only the "seen" marker is persisted (`pampa.notify.v1`, per phone number), so
unread counts survive a reload and never leak between accounts on a shared
device.

**The professional's Home card reads the same ledger as a list.** Recent booking
events for that pro, newest first, each with the service and a timestamp — five
at rest, the rest behind `+N earlier`. It is refreshed two ways: a small round
button beside the heading (the pointer-device path), and a **pull** on the list
itself — drag down while the feed sits at the top of its scroller and the hint
above it goes from *Pull to refresh* to *Release to refresh*. A short pull leans
20px and lets go; a drag started anywhere but the top is left to the scroller,
so the gesture never fights a normal scroll. Only `transform` moves, and the
hint is a pseudo-element, so the whole thing is a couple of styles and one
listener set.

**The spotlight rail scrolls itself**, a slow stories-style crawl (about 20px a
second) that bounces at each end. Touching, dragging or wheeling it pauses the
crawl for a few seconds, and `prefers-reduced-motion: reduce` switches it off
entirely. Scroll position is accumulated in fractions because browsers truncate
`scrollLeft` to whole pixels — at 0.5px a tick it would otherwise never move.

## Payments, escrow and payouts

Money never goes straight to the stylist. It sits in escrow until the client
confirms the work, and every step is journalled on the booking.

```
unpaid ──pay──▶ escrowed ──stylist accepts──▶ confirmed ──job done──▶ released
                    │                              │
                    │                              └─report a problem─▶ disputed
                    │                                                       │
                    └──decline/cancel──▶ refunded                           │
                                   resolution desk settles ◀────────────────┘
                                   ├── refund client
                                   ├── release to stylist
                                   └── split by percent
```

- **unpaid** — the booking holds the slot but a stylist cannot accept it yet
- **escrowed** — the client's money is held. The stylist sees the request with
  the payout they'll receive, and accepts or declines — and with the **trip
  stated as its own fact**: the client's address, how far it is from their
  studio, what the travel pays, and which kind of distance it is (plain when
  the booking was priced fix-to-fix, tilde with *measured to the centre of*
  the area when no device fix existed). The booking snapshots `kmPrecise` at
  pricing time, so the card says what the fee was computed from, not what a
  device would guess now.
- **confirmed** — the stylist accepted; the money is still held
- **released** — the client confirms the job was done and satisfactory and the
  money moves to the stylist's withdrawable balance
- **disputed** — the client reported a problem and attached whatever evidence
  they have; funds stay held and neither release nor cancellation is allowed.
  The report is available from the moment a stylist accepts the job — not only
  once the release window opens — because the alternative for a client whose job
  went wrong would be a cancellation that costs them 10%
- **settled** — the resolution desk decided the dispute; the outcome and who
  paid whom are recorded on the booking

**Fees** — Pampa takes 10% of the stylist's payout (not added to the client's
total). A ₦16,000 job pays the stylist ₦14,400.

**Refunds** — declining a request refunds the client in full, as does
cancelling before the stylist accepts. Cancelling after acceptance refunds the
total less a 10% cancellation fee. A cancelled booking frees its time slot
again.

**Disputes and the resolution desk** — a client who isn't satisfied reports a
problem from the booking: choose a reason, add a note, **attach photos**, and
the money freezes. Neither side can move it while it's under review — release
and cancellation are both refused. The mediator works from *Profile →
Resolution desk*, where each open dispute shows the parties, the amount frozen,
the reason, the report note, both sides' evidence and the booking's full money
trail. There are three outcomes:

- **Refund client** — the whole amount goes back to the client
- **Pay stylist** — the stylist's payout is released as normal
- **Split** — a slider sets the percentage to the stylist (10–90%); the client
  gets the remainder and Pampa's 10% fee comes out of the stylist's share only,
  so neither side can be pushed negative

**Evidence from both sides** — a dispute is decided on what each party puts on
the record, so both sides can file it:

- **The client** attaches up to 4 photos when reporting, and can remove any of
them before submitting.
- **The stylist** answers from *Pro mode → Jobs → Under review*: what happened,
  plus their own photos, filed once. Trying to answer a job that isn't theirs
  is refused, as is a second response or an empty one.
- **The desk card** shows the client evidence and the stylist's response as two
  blocks — reason, statement, thumbnails and who filed it — with a live count of
  how many disputes are still waiting on the stylist's side. Tap any thumbnail
  to see it full size.
- The client sees the stylist's response and photos on their booking card, so
  the thread is visible to both parties, not just the mediator.

Photos never leave the device: they are downscaled to 900 px on a canvas and
re-encoded as JPEG before being stored on the booking (a 670 KB phone photo
lands at about 35 KB). Each file must encode under 700 KB and all evidence
across the app is capped at 2 MB; anything rejected says why. If a write still
fails because the device is full, the dispute or response is kept and the
photos are dropped, with a journal entry that says so rather than claiming
attachments it doesn't have.

Every settlement writes a labelled entry to the booking's journal, names the
outcome in the booking's status badge, and credits the stylist's wallet through
the same ledger as a normal release. Settling is guarded: only disputed
bookings can be settled, only once, and a settled booking can't then be
cancelled, released or declined.

### The wallet

Escrow is where money rests; the wallet is where it is read, and it has its own
tab in the bottom nav for both roles. It used to be a tab inside the escrow
desk — two taps behind *Open the escrow desk* — which is a strange place to keep
the money somebody works for, and a strange place for a client's escrow too.
The desk's own Wallet tab is still there and now renders through the same
function as the tab, so the two cannot disagree about a balance.

**For a professional** it opens on what is available to withdraw, then what is
held in escrow across jobs that have not settled, then lifetime earnings and
jobs paid, then the platform fees already taken. Under that: the destinations a
payout can land in, the payouts already made with their references, and the
money trail of settled jobs.

**Destinations are a list, not a field.** A bank account (bank name plus a
10-digit number) and a crypto wallet (network plus address) can both be saved,
and one of them is the default — the row a payout is written against the moment
escrow releases. Which one is default is the professional's choice
(`pampa_set_default_destination`), and taking one back
(`pampa_remove_destination`) promotes the oldest that is left rather than
leaving the list with nowhere to send money. Rows are read back masked
(`GTBank ••••6789`, `TRC20 · TQ4f9d…t2Aa`), and the whole list lives on the
server, so the same account saved on another phone shows up here.

**Money that was released before there was a destination** is not lost in a
corner: the payout row is written `pending`, the wallet counts it as available
and says where it came from, and *Withdraw* routes it to the destination the
professional has now saved (`pampa_assign_payout`). Withdrawing is one action
for both halves — payouts waiting for a destination, and credit this device has
not sent — and the wallet is re-read from the server afterwards rather than
guessed at. Minimum ₦1,000.

**For a client** the same tab is the other end of the same ledger: what is held
in escrow for them right now, what has been paid in all time, what came back as
a refund, what has gone to their professionals, the bookings behind each figure,
and the method the pay sheet opens on.

**Pro mode** — open *Profile → Open the escrow desk*, or the door at the foot of
the Work dashboard. It opens as **you**: a professional account works as itself,
and the desk refuses anyone else, because accepting jobs under a trade you did
not register is not a feature. A client account never sees the entrance at all.
The demo keeps both sides in one browser — sign up as a professional in one
account and a client in another — so the whole cycle is exercisable; the escrow
state machine, fee maths and ledger are shaped the way a real backend would be,
so they can move to a server behind an idempotent payment webhook without
redesign.

> Payments are simulated — no card is charged and no crypto moves. Wire the
> `payBooking` seam to a provider (Paystack, Flutterwave, a stablecoin rail)
> plus a backend to make it real.

## Location

Booking is built around where you are. Ten Lagos areas ship with approximate
coordinates, and all distances are computed on-device with the haversine
formula — no map service, no API key, no network needed.

**Distances are measured fix-to-fix.** Both halves of every distance can now be
real points: the client's device fix and the professional's, each captured with
`enableHighAccuracy` and each carrying the accuracy the device reported. A
distance is measured between those two points when both exist and falls back to
the area centre only for whichever side never gave one — and which kind of
number it is stays visible: a fix-to-fix distance reads plain (*406 m away*),
an approximate one is marked with a tilde (*~1.2 km away*). Under 50 m two
points are the same place, so the answer is "in your area" rather than a
decimal that implies precision the GPS does not have. The professional's fix
and its accuracy ride their public directory record, so the precision survives
sign-out and other devices read the same door-to-door distance.

- **Set where you are, from the device or from what you typed** — there is no
  list of areas to scroll. Tap *Use my current location* (a full-width gold
  pill that reads this device with `enableHighAccuracy`) or type your address;
  the field places it as you type, and the line under it says what the two
  inputs add up to before you continue:
  *Surulere, Lagos — from your address · home visits route here*, or
  *Victoria Island, Lagos — from this device's location · accurate to about
  13 m*. The three ways a fix can fail are named, not swallowed: a denied
  prompt points at the browser's settings, no fix suggests checking that
  Location is on, a timeout says try near a window — and the address field is
  always the way that still works.
  An address is placed by what it names: the area inside it (*12 Bode Thomas,
  **Surulere***) or a street that belongs to one (Bode Thomas, Ozumba Mbadiwe,
  Admiralty Way, Allen Avenue…). The street is kept whole, because it is the
  door a home visit is priced and routed to, and a device fix is kept as the
  point distances are measured from.

  An address that names neither is **not** guessed at. Dropping somebody into
  the wrong part of the city would price their travel off a place they have
  never been, so the app says it cannot place it and asks for the area by name
  — the one thing the person in front of it can always supply — while the
  device button stays one tap above. Whichever input was used *last* decides
  (type after a fix and the text wins, take a fix after typing and the device
  wins) and the line states which, so neither is silent. A fix beyond 25 km of
  any supported area is not stored as a point at all: the nearest area we
  cover stands in for it, which is also what keeps signing up possible from
  anywhere.
- **Home's location group** — one pill and one field: the pill reports the area
  on its first line and the street under it (*12 Bode Thomas, Surulere · home
  visits come here*), and tapping it opens the location screen, where the area,
  the address and the device's own GPS live together — one door instead of
  three stacked bars, and the row only ever reports what is saved. Search sits
  directly under in the same control language. The whole decision costs about
  **91px of screen** where the old three-bar block cost 143px, and the pill's
  height never depends on the width of the phone.
- **The nearest three, in the group itself** — under the location pill sit the
  three closest professionals as compact chips: face, first name, distance, the
  nearest wearing the accent ring. The home screen answers "who is closest?"
  before a single scroll. They are deliberately *not* the filtered list — the
  chips answer where you are, which a search for *nails* does not change — and
  they are three names rather than a second grid: a tap opens that
  professional's page. They run through the same overflow vocabulary as every
  other strip (a fourth chip's worth of names on a 360px phone fades rather than
  slices), take the block to **127px**, and vanish completely — no row, no gap —
  when there is no location, and on a professional's own Home, which is not a
  market.
- **Nearest *and* free, and honest about the difference.** The chips answer the
  question a client actually has — *who can I book, right now, closest first?* —
  so the row is filled from professionals who can take a booking, nearest
  first. A professional 0.3 km away who is holding somebody else's job is no answer at
  all, however close he is, and skipping him silently would read as if nobody
  were nearer. So the one that earns a place on the row is the nearest
  professional who *cannot* take work and is closer than the furthest
  professional the row would otherwise show — a busier market further out is not
  a reason to say anything. It takes the last of the row's three seats rather
  than extending it (a chip you cannot act on is worth seeing, not worth
  swiping for), wears a dashed gold edge and a greyed face, and says why in one
  word: **busy** or **paused** — the whole sentence, *with a client right now* or
  *books paused*, in its `title` and its screen-reader label. The three names
  fit a 390px phone (measured: 0px of overflow with a blocked chip on the row).
  When nobody is free, the row falls back to the three nearest as they are, each
  one saying what is stopping it.
- **A distance is a fact, not a number to dress up** — a professional whose
  studio is the client's own area is not *0 m away*: the app knows their area,
  not their doorstep, so the pill, the chips and the cards say **In your area**
  (compactly, *your area*, in a chip). That is also what makes two professionals
  in the same area tellable apart on a list sorted by distance.
- **Near me first** — **Closest to you** lists every professional
  nearest-studio-first with a *Nearest* badge and their distance, and opening
  any service puts the sheet on the nearest one who offers it. Professionals who
  visit your area sort above studio-only ones at the same remove, because a shop
  2 km away is less use than someone who comes to your door at 4.
- **Every scroller announces its overflow** — the rows that run sideways (the
  filtered chips, the booking sheet's service row, the category slider, the
  professionals strip, the spotlight) fade on any side that still has content
  past the edge, and the columns that run down (the trade picker) fade at the
  top and the bottom the same way. The fade clears once you reach
  the end of that side, and anything that fits shows no cue at all. It is a
  **mask on the scroller**, never a decoration laid inside it, and one helper
  answers for both axes — see *The cue that scrolled away* in **Design**.
- **Home visits respect coverage** — each stylist lists the areas they visit.
  Ask for someone who doesn't cover your area and the app disables *My home*,
  explains why, and offers their studio instead.
- **Travel is priced by distance** — home visits cost the ₦1,000 base plus
  ₦250 per km beyond the first 3 km. The sheet shows service + travel = total
  before you confirm.
- **Studio visits show the trip** — studio area, distance and rough drive time
  (≈3 min/km).
- **No double-booking** — a stylist cannot be booked twice for the same date
  and time. Taken and past slots are disabled, and cancelling a booking frees
  the slot again.

## Icons, graphics and motion

There is no icon font, no sprite sheet and no image library. Every glyph is a
few inline SVG paths (`icons.js`) drawn in `currentColor`, so an icon costs
bytes rather than a request and re-tints itself with the theme. Static markup
declares placeholders (`<span data-icon="pin">`) and a `MutationObserver`
fills them in, so a screen never has to remember to hydrate itself.

### The wordmark

The app's mark is the supplied wordmark, `img/pampaTextIcon.png`. It arrives as
an 800x800 square with the letters in a thin band across the middle — **556x118
of ink in 640,000 pixels**, 91% of it transparent — so used raw it would render
as a sliver of orange in a mostly empty box, in the logo tile and in the browser
tab alike. `tools/make-logo.py` decodes it with nothing but zlib, crops to the
ink, and writes the sizes the app actually asks for:

| file | size | what it is |
|---|---|---|
| `img/pampa-logo.png` | 528x112 | the transparent wordmark every mark in the app shows |
| `img/favicon-32.png` | 32x32 | the tab icon, the wordmark fitted to the square |
| `img/favicon-48.png` | 48x48 | the bookmark and taskbar icon |

Downsampling averages every source pixel inside each target pixel's box, which
is what keeps bubble-letter edges clean instead of sparkling. Re-run it after
changing the mark: `python tools/make-logo.py`.

**In the app** the mark is a plate, not a square: `.logoImg` is 168x46 on the
splash and welcome screens and 76x34 in a sheet header, with the image
**contained**, never covered — cover would slice two letters off a 4.7:1
wordmark. The tall `.logoText` that used to spell the name out underneath it is
retired: the mark is the name now.

**In the tab** the wordmark is what the browser shows, which is an honest
trade-off rather than a free win: a 4.7:1 mark fitted into a square 16px tab slot
is about 3px of letter height, so it reads as a gold band with bubbles at that
size and only becomes legible in a bookmark bar or a dock. A wordmark favicon
cannot be made to read at 16px without distorting it; the alternative is a
single-letter tab icon, which is what most wordmark brands do.

The install icons (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`,
`apple-touch-icon.png`) are a separate family, drawn by `tools/make-icons.py` on
the dark field, because a home-screen icon is cropped to whatever shape the
launcher likes and a wide wordmark has no safe zone to sit in.

### Press and arrival

Every tappable thing answers a press the same way: a quick squeeze to **0.955**
on a pill, **0.985** on a card, and a spring back that overshoots a hair
(`cubic-bezier(0.22, 0.9, 0.3, 1.35)`) — one rule set, applied to `button`,
`.tab`, `.chip`, `.slot` and the cards, so a new control is animated the moment
it exists instead of waiting for someone to remember it. Only `transform`,
colour and shadow move, so nothing here triggers a layout pass.

Switching dashboards fades and lifts the arriving view (`viewIn`, 260 ms) and
lets its cards settle in a short stagger. Two guards keep that from becoming a
hazard: the fade starts at **0.2 opacity, never 0**, and `switchView()` drops
the class on a 420 ms timer as well as on the animation's own end. A stalled
compositor can therefore never leave a dashboard mid-fade and invisible — the
worst case is an animation that snaps instead of gliding. Everything above is
turned off wholesale under `prefers-reduced-motion: reduce`.

### The scenes

Home leads with art rather than a list of links: **Book by trade** is a strip of
four cards — Barbing, Hair, Nails, Spa — each a drawn scene that moves. Tapping
one filters the service grid underneath, so the strip is navigation, not
decoration. The same drawings appear in three more places: across the top of
every service card (as a still frame), in the empty states for Bookings, pro
requests, pro jobs, the desk and a failed search, and — alongside the older
drawings — as the mirror on the welcome screen, the radar on the location
screen and the vault on the escrow receipt.

They cost **827–1300 bytes each** (15–21 shapes) and are vector, so they are
sharp on any display at any density. No bitmap, no animation file, no video:
one scene is a few hundred bytes of markup rather than a 60–200 KB GIF or a
video that a cheap phone cannot decode.

Motion is `transform` and `opacity` only: barber-pole stripes travel, scissors
snip, a comb sways, a shine runs down the length of the hair, steam rises off
the bowl, a candle flickers, sparkles twinkle. Nothing animates layout, so
nothing costs a reflow.

### The photo slider

Just under the category chips, before **Choose a service**, sits a **featured slider**: five
full-width 16:9 slides of real photography — a barber mid-fade, braids and
natural hair, a finished nail set, hot stones in a spa — plus a generated final
slide that reads *"Stylists around <your area>"* from wherever you have set
your location. Swiping moves it (native scroll-snap, so momentum and
rubber-banding are the platform's own rather than JS drag maths), the dots under
it jump to a slide, and it advances itself every 5.2s. Tapping any slide filters
the grid below to that trade — the same path the chips use,
so the chips, the grid and the scroll position can never disagree.

The motion is the photograph itself: the active slide drifts from `scale(1.015)`
to `scale(1.07)` over 9 seconds, transform-only, so it never triggers layout, and
the autoplay stops the moment you touch the slider and stays stopped for 12
seconds. Both are dropped under `prefers-reduced-motion`, and the timer only runs
while the tab is visible.

Each slide is a `<picture>`-free `srcset` at three widths (420 / 760 / 1100,
cropped 16:9 server-side), all five together are **48 KB over the wire** — the
aftermath of `?auto=format&q=60` on Unsplash's CDN, which serves AVIF or WebP to
whatever asked. Every photo has the trade's **vector scene underneath it**: that
is the placeholder while the bytes are in flight, and the whole slide if they
never arrive, so an offline phone shows composed art instead of a grey box.

**There is no frame.** The slider carries no border, no pane tint and no shadow:
a bordered rectangle around a photograph reads as a widget, so the picture
feathers into the page instead — a mask that dissolves all four edges, 34px at
the sides and 22px top and bottom, composited `intersect` from one gradient per
axis. Both axes are needed: feathering the sides alone leaves the photograph
ending on a hard line top and bottom. The scrim wears the same mask, or its dark
band would draw back the edge the mask just removed. The slider carries a
second, wider mask of its own — the overflow cue above — because the two
answer different questions: the feather says *this photograph has no frame*,
the cue says *there is another slide past this edge*.

The feather is also why the fade rises as well as falls — a plain linear ramp
would still be half-transparent where the first glyph sits. The mask eases to
~0.87 by 0.76 of the way in, and the caption and dots are placed inside it, so
the photograph can dissolve while every letter sits on a solid scrim. Captions
are weighted so the text clears **4.5:1 even over a white photograph** (~7.5:1
before the feather, ~10:1 for the first glyph after it), because a caption's
contrast must not depend on which image happened to load. Nothing here is above
the fold taller than 182px, so none of it pushes the booking controls out of
reach.

Beyond the scenes, motion is deliberately small and safe:

- Cards rise in on one curve, offset by their position in the list (`--i`)
- A pulsing ring leaves the logo, dashes travel along the escrow flow, a live
  payment's status pill carries a pulsing dot, and the GPS button spins while it
  waits
- **Entrance animations are gated on `html.anim`**, which is only set while the
  tab is visible. A throttled or backgrounded tab can therefore never be left
  holding a half-painted list — the same class of bug that `openSheet()` avoids
  by forcing a reflow instead of waiting on `requestAnimationFrame`
- Everything is stripped under `prefers-reduced-motion: reduce`

Weight: the whole app is **~324 KB on disk across 5 requests plus the 1.3 KB
logo**, which is **~67 KB over the wire gzipped** (HTML 4.2, CSS 19.0, icons
6.0, escrow 14.4, script 24.2), plus the featured slider's photography — 48 KB
for all five photographs at phone width, which is the only thing here fetched
from a third party. No web fonts, no icon library, no video, and nothing that
needs a decoder:

## Design

The interface is **liquid glass**: translucent panes that refract a soft ambient
wash, continuous corners, and one gold accent doing all of the pointing. It
ships in **two themes with the same accent**, chosen in *Profile → Preferences
→ Appearance*:

- **Dark** (the default) is near-black `#0a0a0b` glass with gold `#efc258`.
- **Light** is a cool paper wash `#eef0f4` with a deeper gold `#7f5406`,
  because the bright yellow that reads on near-black fails on paper. Gold stays
  the only accent in both — buttons, chips, the active pill, selected slots and
  every money figure.

### The selected ring

Every "you picked this" surface wears the same ring: `--gold-ring` (55%-alpha
gold, `1.5px` on the nav pill, `1px` on cards), over the faint `--gold-soft`
wash. The ring *blooms* in — an 86→100% settle with a slight overshoot in the
curve, the iOS pill arrival — and the fill family (chips, segments, the desk and
escrow tabs) presses deeper while chosen instead. Three traps the pass had to
fight, worth knowing before touching it again: the glass layer restates borders
at equal specificity *after* the `.active` rules, so selected borders are
restated once more after it; the arrival animates **transform only, never
opacity**, because a stalled compositor freezes an animation at its first frame
and a frozen ring must still be a visible ring (the same reasoning as
`viewIn`'s 0.2 start); and `switchView` re-adds `.active` through a reflow so
the bloom replays on every change — a class that never left cannot restart an
animation.

### A button's width belongs to its container

`.nextbtn` carries `width: 85%` — the onboarding screens' CTA width, where a
single centred column makes a button that stops 15% short of either side read as
a button. Carried into the app it does the opposite: inside a card, 85% is a
left-aligned bar with a 53px hole beside it, which is how **Save my rates** and
the six pills on Profile came to look placed by accident. `#app .nextbtn,
.sheet .nextbtn { width: 100% }` gives the app and every sheet the container's
width and lets the flex centring that has always been on `.nextbtn` put the
label in the middle — measured: *Save my rates* 350px wide in a 350px card,
every pill on Profile 380px in a 388px column, and the auth screens' 85%
untouched. Buttons in a **flex row** (`.nextbtn.tight`, which is `flex: 1` and
so has a zero basis) are unaffected by design rather than by luck: measured side
by side in the portfolio sheet, *Add photos* and *Add a video* are 165px and
167px of a 344px row, exactly as before.

### One row, one measure

The Work dashboard had three things "off" that were really one thing: **nothing
was laid out as a row, and two rows were a pixel too tight.**

- **The section label took the whole line.** `h2` is a block, so `.sectionHead`
  put the title on line one and its trailing control on line two — *Manage*
  dropped under *My work*, and the professional count dropped under *Closest
  professionals* on the client side. The head is now a flex row
  (`space-between`, 10px gap) with the h2 taking the slack and the note or
  button held at `flex: none`. The house already had this shape —
  `.actFeed .journalHead` puts the activity label and its refresh on one row —
  so the head now matches it instead of being the one that wrapped.
- **Three chips that must not wrap, in a box that keeps getting narrower.**
  The business card's chip row is 297px of inner width (327 card − 28 padding −
  2 border) on paper, and *Taking bookings* + *Surulere* + *0 works* measured
  122 + 81 + 79. Trimming the gap from 8px to 6px got the row to 294 and looked
  like the end of it — until the view's own scrollbar took 8px off the client
  width and the third chip dropped onto a line of its own again, reading at a
  glance like a considered two-line layout. Arithmetic that close to the edge
  will always lose on somebody's device, so the row stopped depending on it:
  the chips no longer wrap at all. They are a **strip** — `nowrap`, `overflow-x:
  auto`, no scrollbar — and the padding came off the chips (9px a side, not 11)
  so the common 360–430px phone shows all three with 8px to spare. On the
  narrowest phones, where three badges genuinely do not fit, the row uses the
  app's existing scroll cue: a liquid fade on the right edge and a swipe to
  reach it. Nothing is orphaned at any width, and the card is 30px shorter,
  because a report should not change its height when one of its numbers does.
- **The card's action floated mid-block.** `align-items: center` centred the
  29px pill against the four-line meta column, so *Edit* sat beside the third
  line and read as a label for the address. It now aligns to the top with a
  `-4px` nudge — `(20.4 name line − 29 pill) / 2` — which puts the pill's centre
  on the name's (measured 139 vs 138).

A second pass over the same stack, from measurements rather than from looking,
found three more of the same family:

- **Two cards were welded together.** Every block in the stack carries its own
  12px, and the *Today's status* wrapper — inserted between the availability
  switch and the rates card — carried none, so the switch card and the status
  card shares an edge and read as one block with an internal divider. The gap is
  now declared for both (`#workAvail, #workStatus`), and an empty wrapper takes
  no gap with it (`#view-work > div:empty`), because a renderer that writes
  nothing should not leave a hole.
- **Two cards were bottom-heavy.** `.provCtas` keeps a 14px bottom margin for
  the copy that follows it on the public provider page; when the same row *ends*
  a card, that margin landed on top of the card's own 14px padding, so the status
  card and the gallery card were **29px deep at the foot against 15px at the
  head**. `.provCtas:last-child` drops it; both cards are 15/15 now, and 14px
  shorter.
- **The rates row drew the name over the ₦ field.** `.rateName` was `flex: 1`
  with `min-width: 0` and `overflow: visible`: on a 360px phone the box shrank to
  54px while *Maintenance* needs 82, so the word was painted 28px past its own
  box and 20px **inside** the first input beside it. The row wraps now — the two
  fields are one object (`.ratePair`, `margin-left: auto`) that steps onto its own
  line, right-aligned under the fields above, before anything is squeezed over
  anything else. The name's flex basis is the 82px the longest name in the trade
  actually asks for, so a 421px screen still keeps the row on one line (verified
  at both widths: one line at 421, two at 360, zero overflow either way).

### The frame that had no width

`@media (min-width: 769px)` turns the app into a phone frame on a desk: `body`
becomes a centred flex row and `#app` is capped at 420px. But a flex item with
**no width is sized by its content**, and every screen inside the frame is
`position: absolute` — so the frame had no in-flow content to measure and
collapsed to **0px**. On any window wider than the phone, the whole app was a
sliver: cards spilled out of a two-pixel column, and the bottom nav stretched its
labels across the desk (measured at 1200: `#app` 0px wide, x=600; the hero card
painted 380px wide out of a box that was not there). `#app` is given one in the
query — `width: 100%; max-width: 420px; flex: none` — and is 420px centred at
769, 900 and 1200 alike, with the auth pages (which slide in from the right), pro
mode and the resolution desk all landing on the same 420px column.

What that band does *not* fix is 520–768px, where the media query has not
engaged yet and the frame stretches to the window: nothing collides, but a rate
row puts its price fields 400px from the service they belong to. A proper
responsive pass, or simply lowering the breakpoint, is the next move there.

### The cue that scrolled away

Every scroller that runs off the edge has to say so, or the cut card reads as a
broken layout rather than as *there is more this way*. The first attempt drew
the fade as a `::before`/`::after` gradient on the row — and it never appeared:
a pseudo-element inside a scroller **is part of the scrollable content**, so
`::before { left: 0 }` sits at the start of the row and travels left with the
content the moment anyone scrolls. It was visible exactly when there was
nothing to the left, which is precisely when it was not wanted, and gone when
there was.

The cue is therefore a **mask on the scroller itself** — a property of the
visible box, which does not scroll with what it contains. One helper decides
the facts and one vocabulary draws them, on both axes, because a row and a
column are the same problem a quarter turn apart:

| axis | class | sides | who uses it |
|---|---|---|---|
| across | `hasOverflowX` | `moreL` `moreR` | chips, category slider, professionals, spotlight, the booking sheet's service row |
| down | `hasOverflowY` | `moreT` `moreB` | the trade picker and the area picker |

Three things this shape gets right, each of which was wrong somewhere before:

- **The fact is measured, never declared.** `hasOverflow*` is on only while the
  box can actually scroll, so a row that fits and a list that fits are both
  fully opaque. The old vertical class faded on arrival and only stopped at the
  end, so a two-row list lost the bottom of its second row to a cue about
  content that did not exist.
- **Both sides, not just one.** A column scrolled halfway down is cut at the top
  *and* the bottom. The old vertical cue only ever knew about the bottom.
- **The measurement has to survive being hidden.** A box measured while it is
  invisible reports "fits" — it has no height yet — and no scroll event will
  ever come to correct it, because nobody scrolls a list they cannot see. A
  `ResizeObserver` fires when the box appears or is re-laid out, which is how
  each picker gets its cue the moment its page is shown.

**The fade is liquid, not a switch.** The widths are registered custom
properties (`@property --fadeL` and friends, each `<length>`), so a fade that
appears or disappears as the reader scrolls *eases* there over 0.45s instead of
snapping, and an edge that is genuinely open **breathes** — a few pixels in and
out on a slow loop, the way a live edge should feel alive. Without registration
the property would interpolate as a token, not a number, and the transition
would be a cut. `prefers-reduced-motion` gets the plain honest fade.

The chips row and the vertical lists run through the same helper as the strips —
there is deliberately no second vocabulary of classes for "the chips kind" or
"the list kind" of scroller. The chips do keep a narrower fade, because a 26px
ramp over a 60px pill eats the word inside it. No scroller in the app overflows
on both axes at once, so the two masks never need to compose; one that did
would need `mask-composite: intersect`, as the hero slider's four-edge feather
does.

### Admitting to work

The app waits on real things — a password being hashed, a photograph being
redrawn, a clip being read off the disk, a fix from the GPS — and it says so in
two shapes, because the two answer different questions:

- **A spinner inside the button that is working.** That button cannot be pressed
  again while it runs (`disabled` + `aria-busy`), and its label dims rather than
  disappearing: a button that empties its own text reads as a broken button, not
  a busy one. The ring is drawn from `--btn-spin`, so it inherits the button's
  own ink instead of landing gold-on-gold and vanishing.
- **A three-pixel gold bar across the top** for everything that is not the
  button you are looking at. It is indeterminate on purpose — the app cannot
  know how long a hash takes, and a fake percentage would be a lie — so it
  slides to 72% and waits, then fills and leaves. It only appears if the work
  outlasts **140 ms**, so the many operations that finish instantly never flash
  a bar at all.

Two places already had this and keep it: the GPS button swaps to *Finding you…*
with a turning pin, and a clip in the rail carries its own spinner until the
video is ready. Everything else that waits was doing it silently.

- **Glass is built from four things**, and it needs all four: a translucent
  fill, a real `backdrop-filter: saturate(180%) blur(24px)`, a 1px specular top
  edge (`inset 0 1px 0 rgba(255,255,255,…)`), and a wide soft cast shadow. The
  **ambient wash behind everything** — three large radial gradients in gold,
  blue and violet, fixed to the viewport — is what the panes actually refract.
  Remove it and blurred panes stop reading as glass and start reading as flat
  paint.
- **The hero/ink panel** (wallet, receipt-style surfaces) stays near-black in
  both themes — `rgba(18,19,24,0.66)` in dark, `rgba(17,18,23,0.94)` on paper,
  because a 66% dark pane over pale paper turns muddy grey — which is why its
  figures read from `--hero-gold` rather than `--gold`.
- **Geometry is continuous.** Cards are 22px, controls 16px, everything you
  press is a **pill** (buttons, chips, slots, tags, the segmented control and
  its tabs), and everything round is a **circle** (avatars, the bell, the close
  controls, the back button). The sheet's grab handle is a pill again. Nothing
  in the app is squared off.
- **The chrome floats.** A tinted glass header is pinned to the top of every
  view and content scrolls underneath it, and the tab bar is a floating glass
  capsule inset 12px from the edges rather than a bar bolted to the bottom.
  The active tab is a pill behind the glyph instead of a hairline above it.
- **Typesetting:** headlines are sentence case and heavy with tight tracking
  (*Book by trade*, *Popular stylists*); small group labels stay uppercase with
  modest 0.06em tracking, the way a system list header tags its group; names
  and money keep display weight and tabular figures.
- The choice is written to `localStorage` and applied by an inline script in
  `index.html` **before the first paint**, so a returning visitor never sees a
  flash of the other theme. `color-scheme` follows it, which is what puts the
  date picker, focus rings and scrollbars on the right side too.
- Only `<html data-theme>` changes: every surface, line, ink step, hero and
  icon filter is a token, so the two themes share one stylesheet and no
  component rule is duplicated.

**Where the glass does not apply.** `prefers-reduced-transparency: reduce`
turns every pane solid instead of tinted film, and browsers without
`backdrop-filter` get the same solid fallback from a `@supports` block — so the
app is readable on a machine that cannot composite the glass at all. Two
disciplines follow from translucent surfaces: full-screen pages (pro mode, the
resolution desk) take the wash as an opaque background instead of a pane, since
a page behind a page is unreadable; and the faint ink steps are scoped per
theme, because a pane lifts the background under a caption by about 4% in dark
and the dark values have to clear 4.5:1 against *the pane*, not the page.

The palette is applied through the token layer in `css/tokens.css`:

- **Accent** — `#efc258` on near-black, `#7f5406` on paper, used only for
  things you can act on: primary buttons, the active chip, the active tab,
  selected slots, the date field's calendar, and every money figure. Gold never
  decorates; it points. Filled controls carry a vertical sheen (`--grad-gold`)
  — the same gold, lit from above, not a second colour. `--ink-faint` and
  `--ink-soft` are deliberately kept above 4.5:1 in both themes, since nav
  labels, captions and empty states read from them.
- **Semantics** — green `#16c784` for money released and jobs done, red
  `#f6465d` for disputes and refunds, blue `#8fa6ff` and violet `#b9a7ff` for
  escrow and settlements. Each is a 13% tint with a matching border, so badges
  stay legible without shouting. **Red is kept for money problems alone** — the
  activity bell's unread count wears ink instead, so the only red on a page
  always means something is wrong with the escrow.
- **Type** — sentence-case 17px headings for sections, uppercase 10.5px group
  labels at 0.06em tracking for sheet and card heads, body copy left at system
  default, figures in tabular numerals so amounts line up. The wordmark is
  letterspaced uppercase for the same reason.
- **Details** — a pill grab handle on every bottom sheet, a pill behind the
  active tab, inline SVG glyphs sized in `em` so they always track their text,
  and a `fadeScroll` mask that makes a scrolling list fade out its last partial
  row (dropped once you reach the end, so the final row stays legible). The
  category chip row gets the same treatment sideways: the last chip is cut at the
  edge, which reads as a broken layout rather than as "more this way", so it
  fades — but only while the row actually overflows, and never at the end, which
  is why the state is computed from the DOM rather than baked into the
  stylesheet. The mask is applied to the chips alone: the card rows below carry
  `backdrop-filter` panes, and masking their parent would flatten the glass. The
  date picker keeps its own `color-scheme` so the calendar and native
  scrollbars follow the theme.
- **Rhythm** — one spacing scale (4 / 8 / 12 / 16 / 22) governs the views, card
  padding and list gaps, with hairline separators inside cards that hold rows
  (profile details, preferences, evidence, the money trail). Cards that are
  separate surfaces are always ≥ 10px apart, and the content area leaves 112px
  under the floating tab bar so nothing ends up behind it.
- **Performance note** — glass costs GPU: roughly two dozen blurred layers are
  live on the home screen at once. That is fine on a desktop browser and on
  current phones, but it is the one thing in this app that scales with the
  number of cards on screen, so a longer list would want the blur moved off the
  individual cards and onto the chrome alone.

Legacy variable names (`--blue`, `--blue-deep`, `--paper`) are kept as aliases
of the new tokens so nothing in the stylesheet silently lost its colour.

## Clips

Every video on the device — uploaded, linked, or one of the demo professionals'
seeded clips — collected into one rail, opened from the **play button in the
Home header** (clients) or the **Work header** (professionals), and from any
video tile in any portfolio, which opens the rail *at that clip*.

**How it behaves.** One clip per screen, `scroll-snap-type: y mandatory` so a
scroll always lands on a boundary, with the slide sized to the scroller rather
than the window. An `IntersectionObserver` decides what plays: the slide that is
more than 60% on screen gets its source attached and plays, everything else
pauses. Sources are attached on arrival and released on close, so a rail of ten
clips costs one clip's traffic and one clip's memory.

| gesture | what happens |
|---|---|
| scroll | the next clip: it snaps, and playback moves with it |
| tap the clip | pause, with the frame dimmed under a play state |
| double-tap | like it, with a heart that blooms where the finger landed |
| the rail's heart | the same like, as a button |
| the chat icon | comments open over the rail |
| the sound icon | unmute — clips start muted, because a feed that makes noise on open is a feed people close |

The page is dark in both themes: a clip is watched, not read, and a white wall
behind a video is nobody's idea of a good time. Sound is per-session and does
not persist, which is deliberate — the next visit should not surprise anyone.

**The order, and the only claim it makes.** *For you* ranks clips by a score you
can read: professionals who cover your area lead (**+45**), then closeness from
your area (up to **+45**, falling 2.2 per km), then the clips more people have
liked (up to **+30**). *Near you* drops everyone who cannot reach you at all.
Nothing is hidden and nothing is random.

**Likes and comments** live in `pampa.social.v1`, keyed by `provider:work` so a
clip carries the same counts in the rail, on the gallery tile and in its owner's
portfolio. A like is recorded against the signed-in phone — signed out, it is
the device — so a heart can always be un-pressed. Comments are written by the
signed-in account, newest last, and the sheet is one tap from the rail.

**Replies are a two-way turn, one level each way.** The clip's owner answers
any comment — a **Reply** button on every top-level comment, the composer says
who is being answered, the answer lands nested under it. The professional's
reply hands the floor to the client: their reply row carries the **Reply**
button, and their answer joins the same thread. When the client has spoken
last, the button moves back to the owner. Nobody replies to a reply from their
own side, so a thread becomes a conversation between the two people involved
and never an argument between strangers. A client's bell tells them the
professional answered; the professional's bell tells them the client came back.

**The bell reads the clips too.** A like, a comment and a reply are events like
a booking is: they appear in the notification bell for whoever they concern —
likes and comments for the professional whose clip it is, replies for whoever
was answered — phrased and stamped like booking news, and tapping one opens the
rail at that clip, with the comments sheet already up when the news was words.
The professional's Home activity feed carries the same events beside the
bookings, and every row opens the clip.

Counts are the provider's **standing plus what this device has given**, the same
baseline-plus-local shape the ratings use: a fresh install holds nobody else's
taps, and a count of zero under every clip would read as a broken page rather
than an honest one. A professional with no history has no baseline at all, so
their first clip starts at the likes it has actually been given. The baseline is
marked as such here and in the code; a real backend replaces it with the number
it actually is.

## Fresh-install audit

Wiping device storage and walking both roles end to end — client onboarding,
booking, escrow, then a second professional registered from scratch and paid out
— turned up the following. All are fixed and re-verified; none are outstanding.

| # | what it was | where it bit | now |
|---|---|---|---|
| 1 | A provider record could be written before the account had a phone, keyed `p:guest`, and then lived on in **every client's discovery list** as "Distance unknown" beside the real one | provider registration | `registerProviderSelf` refuses to write without a phone, and `migrateProviders` repairs or drops an orphaned record on load |
| 2 | The first repair adopted *any* orphaned record onto whoever signed in next — handing one person's record to another | my own fix, caught on the second pass | adoption only when the record names the same person; unattributable records are dropped |
| 3 | Six dead slot pills on today's date with no hint another date exists — the booking sheet just looked broken late in the day | booking sheet | the slot grid now says *"Every slot on Sun 20 Sep has passed — pick another date above"*, or *"Fully booked on Mon 28 Sep"* when the free slots are all taken |
| 4 | The activity heading said `5.0 · 1 job · 1 review` while its style class still read `new`, because the two read different sources | pro Home / discovery card | both read `ratingStats`, so the chip and the text always agree |
| 5 | `+N more · refresh` re-rendered the same five rows — the button promised more and delivered none | pro Home activity feed | it expands to the full list and back (*Show less*), with the refresh moved to its own control |
| 6 | Activity timestamps were 11.5px at 2.88:1 in light theme | pro Home activity feed | a light-theme ink override puts them above 4.5:1 |
| 7 | A provider could see another trade's services and professionals on their own Home | pro Home | Home is pinned to the pro's own trade — services, chips, professionals strip, spotlight and slider |
| 8 | "Video" had no way in but the Enter key — the link field had no submit button, and there was no way to pick a clip from the device at all | the portfolio sheet | *Add a video* opens a real video picker, the link field carries its own **+**, and either lands in the same portfolio |
| 9 | Opening a YouTube clip loaded the full remote player eagerly — heavy on any device, and here it crashed the renderer outright, twice | the work viewer | a poster with **Load the player**; nothing remote loads until that tap |
| 10 | The client could only "Report a problem" *after* the release window opened; until then the single option was *Cancel · 10% fee applies* — a penalty for a job the pro had accepted and not delivered | booking card, `confirmed` state | report is offered the whole time money is in escrow and a pro holds the job, beside release when releasable and beside cancel when not |
| 11 | A stalled compositor left an arriving view frozen at `opacity: 0` — a blank dashboard that never appeared | the view transition | the fade starts at 0.2 and the class is dropped on a timer as well as on the animation's end |
| 12 | The top-nav avatar showed an initial even for an account with a picture, because the picture lived only on the provider's directory record and the nav never read it | Home, top right | the picture is mirrored onto the account and `renderNavAvatar()` draws it — cleared again on logout so one session's face cannot greet the next |
| 13 | Signing in always sent a code, so the second visit to the app was three screens and a text message for something a password answers in one | the whole sign-in door | sign-in is one screen — number or username + password — and the code now belongs to registration alone |
| 14 | The vertical scroll cue drew its fade whether or not the list overflowed, so a two-row list lost the bottom of its second row to a cue about content that was not there; it also only ever knew about the bottom edge | the trade and area pickers | both axes now run through one measured helper — `hasOverflowX/Y` with `moreL/R/T/B` — that fades a side only when something is past it, top and bottom alike |
| 15 | A scroller measured while its page was still hidden reported "fits" — it had no height yet, and nothing would ever scroll it to correct the answer | every announced scroller | a `ResizeObserver` per scroller, plus a re-measure whenever a page or view is revealed |
| 16 | Nothing in the app admitted to working: a hashed password, a redrawn photo and a file being read all happened behind an unchanged button | every waiting action | one spinner inside the button that is working, one top bar for the rest, and the bar only appears if the work outlasts 140 ms |
| 17 | A booking's own controls — Pay, Release, Report a problem, the money trail, the evidence gallery — were nested inside the card's `<button>`, which HTML forbids: a button's start tag closes an open button, so the parser lifted them out and left them as loose siblings. It looked the same, but the markup claimed a client's own evidence was not part of their own booking | the booking list, every state | the card and its controls are siblings **on purpose** inside one `.bookingItem`; a sweep for the same hoisting signature across every card in the app found nothing else |
| 18 | Every onboarding step kept its `.show` class after the first visit, so the whole flow slid in exactly once per session — walking back from the address step to the role screen arrived already in place | role → trade → name → address | `showPage` takes the class off the page being left and re-runs the enter dance (off, displayed, one forced reflow, on); measured 332px → 204px → 0 over the 500ms transition, on a second and third visit as well as the first |
| 19 | The availability card could read **Not taking bookings** beside a visibly-on switch while a session held the chair | the professional's Work dashboard | a third state, *With a client right now*, with copy that agrees with the switch — the switch is on and stays on; only new bookings wait |
| 20 | `rememberAccount` wrote the picture to the account book only `if (u.dp)` — so **removing** a photo could never reach it. The picture vanished, and came back at the next sign-in | Profile → Remove photo | the field is assigned (`acc.dp = u.dp || ""`), so a deletion propagates; proven out-and-back — a removed photo stays removed |
| 21 | A professional signing in saw an **initial in the Work header while their picture sat in the account**, because `enterApp` set `#workAvatar.textContent = initials(...)` right after `renderNavAvatar()` had drawn the picture | the Work header, every sign-in | the clobbering line is gone — both header faces come from the one call that knows a picture from a fallback |

Four things the audit looked at and cleared rather than "fixed": the client's chip/search filtering (a suspected broken search was my probe reading a selector absent from the card markup — the row renders); the pay sheet after payment (its footer *is* hidden in the done state — I was reading `textContent`, which survives `display: none`); the client's evidence upload (it needs the *Add a photo* button to arm the picker, which is correct — driven that way, the photo attaches and journals); and the empty *Upcoming* list, where the finished jobs were correctly sitting under *Past*.

### The full walk

Both roles were driven through the real UI, not by calling functions: register and
sign in, book → pay → accept → mark done → release → rate, dispute with evidence
from both sides, and settle at the desk with a 60/40 split (*"Desk split escrow
60/40: ₦2,600 back to the client, ₦3,550 to Emeka"* on the money trail, wallet at
₦3,550, withdrawn to the saved bank destination). Every button on every screen was
also clicked in a sweep with an error collector armed — Home (all five chips,
search, the slider dots, a spotlight card, the booking sheet's service chips,
where-toggle, date change and slots), the bell, both booking tabs, Profile (bio,
contact, location, theme, the public-page tools), the Work dashboard, the escrow
desk's three tabs and its payout destination controls, and the resolution desk's
three outcomes and split slider. No uncaught errors, and no sheet or overlay left
open at the end of any of it.

### The second walk, from Home to Profile

The same sweep was run again over the current app — every control on
`#view-home`, `#view-work`, `#view-bookings` and `#view-profile` for **both
roles**, clicked one at a time with the DOM and the error collector watched
after each. What it drove, end to end and by measurement:

- **The money loop, twice.** Book → pay into escrow (all three payment methods,
  each selection exclusive, receipt `ESC-52107139`, fee ₦350, net ₦3,150) →
  accept → mark done → rate 5 stars and release → the rating lands on the
  discovery card (*5.0 · 2 jobs · 1 review*) and in `pampa.ratings.v1`. Then a
  second booking disputed from both sides — the client's photo evidence
  attached through the real picker (`dispute.photos: 1`), the professional's
  reply with its own photo, the desk card showing both sides — settled one way
  as a 50/50 split (*₦1,750 back, ₦1,550 to the pro after a ₦200 desk fee*) and
  the other as a full refund (*₦3,500*), each written to the money trail in the
  order it happened.
- **Discovery.** All eight service cards open the sheet on the right service
  (travel priced per distance: ₦15,000 braids → ₦16,000 with the base fare);
  all five category chips filter (Nails → 3 professionals, 2 services); search
  narrows both halves (*fade* → 3 and 2) and restores; every card's *Book* and
  *Profile* work; the spotlight cards open the professional's page; the hero's
  five dots scroll to exact slide offsets (0, 292, 584, 876, 1168).
- **Profile, both roles.** Picture (client-rendered on the Work header, the nav
  and the discovery card from one stored photo), bio, details, portfolio (a
  photo through the real picker and a clip through the link field, both landing
  in *My work* and on the public page), password change (wrong current password
  refused, short password refused, hash untouched), theme segments (stored and
  applied both ways), install guidance, notification permission.
- **The professional's money.** Escrow desk requests → accept, jobs → mark done,
  wallet → destination saved (bank form validated: a missing bank name and a
  short account are refused with the reason) → withdraw, which zeroed the
  balance to ₦0 and toasted *₦4,700 sent to GTBank · 0123456789*.
- **The bell.** Twelve rows covering every booking event and both clip replies;
  a booking row routes to Bookings, a clip row opens the rail at that clip.

Three things the sweep looked at and cleared rather than "fixed": the payout
form's refusal to save an empty bank form (it toasts the reason and the withdraw
button toasts *Add a payout destination first*); the location step's refusal to
place an address like *12 Nondescript Close* (deliberate — see **Location**);
and the empty *Upcoming* list while finished jobs sat under *Past*.

The audit's test data was removed afterwards: the bookings, the test payout and
destination, the two test works, the test picture and bio, and the one comment
and like left on a seeded clip.

### Surfaces that outlived a session

One real leak turned up while walking the two roles through the new negotiation
flow, and it predated it: **logging out did not close the escrow desk, the
resolution desk or a provider's page.** `logout()` closed the clip rail and the
comment sheet, but those three are full-screen divs of their own, so signing out
of the desk left it standing, and the next person to sign in on the device
opened the app looking at the previous account's requests, their takings and a
live **Decline · refund the client** button. A second half turned up on the way:
**every other sheet outlived the session too** — a negotiate or pay sheet open at
sign-out was still sitting over the next account's app, because only the comment
sheet was named in the logout path.

`closeAccountSurfaces()` now closes all three overlays **and every sheet** with
the rest, and clears `proStore.proId` with them: the acting identity belongs to
the session, not the device — the desk is whoever signed in now, and the id is
set again the moment a professional enters it. Verified by opening the desk, a
provider's page and two sheets, logging out, and reading all of it back as
`none` with `proId` null and no `.sheet.show` left anywhere.

## The database

Pampa runs on the device: accounts, the directory, bookings and the escrow
ledger all live in localStorage, and that is why two people still cannot book
*each other* — a professional registered on one phone is invisible to the client
on another. Postgres is the fix, and `supabase/` is that backend, written and
waiting for a project to be pointed at.

Two migrations hold the whole thing: `accounts_and_directory` (the twelve
reference areas, four trades and nine services the app already knows; accounts;
sessions; provider profiles with rates as bands) and `bookings_and_escrow`
(bookings, the append-only journal, payouts, and every transition — accept,
counter, agree, mark done, release, cancel, dispute, reply, settle).

The reason it is Postgres functions rather than table access is the escrow.
`escrow.js` decides the state machine in whichever browser has the page open,
which is fine for a demo and hopeless for money: a client can rewrite their own
ledger. So the legal moves are a table of pairs (`pampa_transition_ok`), a trigger
refuses everything not on it, the journal is append-only by trigger, and the
arithmetic — travel fees, the 10% fee, the dispute split — happens server-side.
`supabase/README.md` explains the shape, including why the anon key is public
and harmless and why RLS is used the blunt way here (every table shut, the
`security definer` functions the only way in) when there is no JWT to identify
anyone with.

`js/config.js` holds the Project URL and anon key and is empty today, on
purpose: with nothing configured the app keeps running exactly as it does now,
so the database can be built underneath a working site. `js/db.js` is its client
half — one `fetch` to PostgREST and the named calls the app will make — and
neither is in `index.html` yet, because nothing is wired to them until there is a
database to wire to.

## Files

- `index.html` — all screens (intro, welcome, number, OTP, name, role, trade,
  location, app shell with its three dashboards, booking sheet, toasts), and the
  ordered list of stylesheets and modules
- `icons.js` — inline SVG glyph set, illustrations and the icon hydrator
- `escrow.js` — booking lifecycle, escrow ledger, fees, refunds, disputes and
  evidence, resolution desk, pro mode, payouts
- `sw.js` — the service worker: the install shell, offline fallback, and
  notification taps

### `css/` — thirteen layers, in cascade order

Split out of one 7,356-line sheet without reordering a single rule, so a rule's
place in the cascade is still its place in this list.

- `tokens.css` — the reset, both palettes, the type scale, the accent
- `onboarding.css` — splash, logo, welcome and the auth screens
- `shell.css` — app frame, preferences, bottom nav
- `booking.css` — the booking sheet, location, toasts, fees, escrow surfaces
- `pro.css` — the professional's mode, and the desktop frame
- `disputes.css` — the resolution desk, the money trail, the evidence
- `system.css` — the register pass (type, rhythm, iconography, motion, scenes)
  and the light theme's answers
- `directory.css` — discovery, public profiles, reviews, activity
- `polish.css` — the editorial pass, liquid glass, the featured slider
- `components.css` — cards, strips, spotlight, loading, edge fades, uploads
- `interactions.css` — press feedback, view transitions, the clip rail
- `pricing.css` — the discovery grid, price ranges, the price picker, the rates
  card and the negotiation surfaces. Last on purpose: it re-dresses
  `.stylistCard` from the shell, and it belongs to the feature it was written
  for rather than to the sheet it happened to arrive after
- `stories.css` — the stories rail (rings), the full-screen story viewer and the
  status composer. Sits after `pricing.css` so its tile shapes are not
  re-dressed by anything else

### `js/` — eighteen modules, in load order

One global scope, exactly as the single script had: a later file may call
anything an earlier one declared. **The order in `index.html` is the contract**,
and two rules are worth knowing before adding to it.

- `core.js` — trades, services, areas, themes, the persisted store, helpers
- `directory.js` — who is out there, and how far; accounts, ratings, coverage
- `activity.js` — the notification store, URL routing, the bell
- `pwa.js` — install, notification permission, the news watch, the nudge
- `ui.js` — spinner, top bar, toasts, pre-auth page steps, nav avatar
- `social.js` — likes, comments and identity on clips
- `home.js` — the client home: strips, spotlight, hero slider, grids
- `media.js` — profile pictures, portfolios, video checks
- `provider.js` — the public profile page and the review sheet
- `sheets.js` — bio, contact, photo and portfolio sheets, the work viewer
- `status.js` — the stories rail: the ephemeral 24-hour status model, the ring
  on the rail, the story viewer and the composer sheet
- `clips.js` — the vertical rail and the comments sheet
- `bookings.js` — the client's ledger of jobs
- `views.js` — profile, the app views, the pro dashboard, `enterApp`
- `auth.js` — both doors, password hashing, roles and trades, logout
- `location.js` — the area picker, the GPS fix, the home address
- `booking-sheet.js` — service, slot and professional, nearest first
- `wiring.js` — every listener, then boot. **Must stay last.**

Two more modules are written and not yet loaded: `config.js` (which database,
if any) and `db.js` (the PostgREST client and the calls into it). They are
deliberately absent from the list above, because this list is the page's load
order and they are not in the page.

The rules that keep it working: `wiring.js` is the only file with statements at
load time that touch the DOM (listeners and `boot`), so nothing in a module after
it can be reached by an earlier file's load; and a `const`/`let` added to a
module is only readable from inside a function, since a module loaded earlier
cannot see a binding declared later. Everything else is free — which is why the
home page's chips and section heads sit in `home.js` rather than beside the
comments sheet they were written next to.
- `manifest.webmanifest` — the install manifest (name, icons, colours)
- `tools/make-icons.py` — draws the install icons with nothing but zlib; run it
  again if the mark changes
- `tools/make-logo.py` — crops the supplied wordmark to its ink and writes the
  in-app logo and the tab icons; run it again if the wordmark changes
- `img/` — the wordmark and the icons made from it, plus the install icons (the
  slider's photographs are hot-linked from Unsplash's CDN rather than committed,
  so the repo carries no bitmaps beyond these)

## Notes

- All data stays on your device (no backend). Log out or untick "Save my
  details" to clear it.
- The demo OTP is fixed at `1234`; there is a ~3s splash on first load —
  a signed-in session skips straight to Home.
- The app's two third-party dependencies are both media: the slider's and
  portfolios' photographs from `images.unsplash.com`, and the four demo
  professionals' seeded clips from `interactive-examples.mdn.mozilla.net` (CC0
  sample videos, a few hundred kilobytes each, streamed not stored). Offline, or
  behind a block that eats either host, a slide or a clip says what it cannot do
  rather than showing an empty frame — the slider falls back to its trade's
  drawn scene, and a dead clip says *"This clip will not play here"*. Swapping
  in self-hosted files is a change to `HERO_SLIDES`, `SEED_WORKS` or
  `SEED_CLIP_CDN` alone.
- Coordinates are approximate area centroids, not real addresses, and distances
  are straight-line. Swap `AREAS` for a geocoding/maps service when you need
  door-level accuracy.
- The resolution desk is a single mediator account reachable from Profile — a
  real deployment would authenticate desk staff separately and record which
  person made the call (the booking already stores `resolution.by` for this).
- Asset links carry a `?v=` query. Bump it after editing any file under `js/`,
  `css/`, or `escrow.js` and `icons.js`, so a browser holding an older copy
  picks the new one up. The service worker caches exactly the URLs the page asks
  for, query string included, so the bump is what retires yesterday's copy.
- Splitting the two monoliths raised the first-load request count (28 files
  instead of 5). It costs nothing after that: the worker holds every one of them,
  so a repeat visit is served from the cache, and the scripts are all `defer`red
  so they still fetch in parallel and execute in order. If first paint on a slow
  connection ever matters more than the file layout, concatenating the `css/`
  list back into one sheet is the only change needed — the order is already
the bundle.
- **A split can tear a comment in half, and a rejoin test will not catch it.**
  The `polish.css` / `components.css` boundary once cut a section banner
  mid-comment: the opener stayed in `polish.css`, the prose landed in
  `components.css`, and that orphaned `*/` made the parser read the prose as a
  selector — which silently swallowed the rule that followed it. The casualty
  was `.addrBlock`, so the home address block lost its grid and its gaps and
  three controls sat stacked with no space between them, while the concatenated
  files still matched the original byte for byte. Check each layer on its own:
  comment state and brace depth must return to zero per file, not just in the
  concatenation.
- **Line endings are mixed on purpose of history, not of design.** Every `css/`
  layer is CRLF except `booking.css`, `disputes.css` and `system.css`, and the
  JS, `index.html` and `escrow.js` are LF. Tools that normalise line endings
  (many editors, `sed` on some platforms) will therefore rewrite a whole layer
  when you meant to change one line, so re-check the file after a bulk edit.

## Installing the app

Pampa is a PWA: it installs to a home screen on Android and desktop Chrome/Edge
(→ **Install app** in the browser menu, or the **Install Pampa** row in
Profile), and via **Share → Add to Home Screen** on iOS and iPadOS. The
installed app opens without browser chrome, keeps its own icon
(`tools/make-icons.py` draws it), and its shell is cached by `sw.js` so it opens
with no connection. The manifest is served from the same directory as the page;
a service worker requires HTTPS or localhost, which is worth knowing if you
serve it over plain http on a LAN — the page still runs, but the browser will
not offer install or the offline shell there. The **install nudge** is part of
the same story: after a client's first completed booking — the moment the app
has proved itself — one quiet offer to be installed appears (twice at most,
never while already installed, and never for professionals, whose habit the
booking flow forms on its own).

## Notifications

With permission — asked once, from Profile or the foot of the bell sheet — the
app raises a **system notification** when something happens for the signed-in
account: bookings moving through escrow on either side, and likes, comments and
replies on clips. The app has no server, so it checks for news while it is
running (every 45s and on returning to the foreground) and shows what is new.

**While the app is closed.** `sw.js` already handles `push` and
`pushsubscriptionchange`; `pampa-push.js` is the client half of the Web Push
protocol, and `tools/push-server.js` is a tiny reference backend (a subscription
store plus an `/announce` endpoint) that proves the loop and stands in for the
future real backend — it keeps subscriptions per account key and delivers the
payload the app expects. Nothing changes in the app until a server exists: with
none, notifications come from the in-app check above; with one, the same events
the app journals are delivered to the phone with Pampa fully closed. Wiring a
real server is one line — point `PampaPush` at its base URL.

**Taps land somewhere specific.** Every notification carries a lightweight
deep link — `#/b/<booking id>` for bookings, `#/c/<clip id>/comments` for clip
discussions — and both are consumed on boot and on `hashchange`, opening the
exact booking (right list, right tab, card scrolled into view and flashed) or
the clip rail with the comments sheet over the running video. A route naming a
booking this device has never seen falls through to the plain list rather than
erroring. The permission is honest about every state: on, off, blocked,
unsupported, all phrased in the UI rather than assumed.

The reference server was verified against a stand-in push service: a payload
goes in at `/announce` and arrives on the wire encrypted (aesgcm, RFC 8291)
with a VAPID JWT, `TTL` and `Urgency` headers — the full Web Push request a
real browser endpoint would receive. Dead subscriptions (410/404) are pruned
from the store automatically.

- Registering a trade publishes you: you appear in client-side discovery with
your trade's services, your distance from the client and a derived coverage
radius, and pro mode lists you first, as "You". A real backend would host the
directory instead of `localStorage`.
- Device storage, in one place: `pampa.data.v1` (your session), `pampa.accounts.v1`
  (every phone this device has seen — name, role, trade, area — which is what
  makes sign-in an express path to the right dashboard), `pampa.directory.v1`
  (the provider directory), `pampa.bookings.v1` (the booking + escrow ledger),
  `pampa.ratings.v1` (reviews), `pampa.social.v1` (clip likes and comments),
  `pampa.notify.v1` (activity seen-markers), `pampa.pro.v1` (pro wallet, payout
  destinations), `pampa.theme.v1`.
- Reviews are stored per provider per device, so two browsers would not see each
  other's ratings — the same server-side move the directory needs fixes that and
  clip likes and comments, which are device-local for exactly the same reason.
- A clip's baseline like count is demo data shaped by the professional's
  standing, not real engagement. Everything above it — the likes and comments
  the app records — is real, and sits in `pampa.social.v1`.
- A review can only be posted by the client who released that booking, and only
  once; the release itself is refused afterwards, which is what enforces it.
- `img/background.png` (58 KB), `img/black-afro-american-woman-vector.avif`
  (62 KB), `img/down.png` and `img/back.png` are leftovers from the original
  design and are no longer referenced by anything.
