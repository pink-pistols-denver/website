# Pink Pistols Denver — Upcoming Attendees

Lets any signed-in board member/lead/volunteer see who's registered
and what merch they pre-purchased for events happening in the next 48
hours — a live pass-through to Ticket Tailor's API, not a copy of
anything. Nothing is stored; every request re-fetches fresh data.

## Access model

Unlike `waiver-lookup`, this function checks **only** that the caller
signed in with a `pinkpistolsdenver.org` Google account — there's no
Firestore allowlist to maintain. Two things make that an acceptable
trade for this tool specifically:

- **Scope is narrow and short-lived.** Only events starting in the
  next 48 hours are ever visible — there's no way to browse further
  out or look up history.
- **No email addresses are surfaced.** The response only ever includes
  attendee name, ticket type, and merch — see `summarizeAttendees` in
  `lib.js`.

If either of those change, revisit whether this still belongs without
a per-person allowlist.

## One-time setup

### 1. Create a Ticket Tailor API key

Ticket Tailor dashboard → Box Office Settings → API → create a new API
key. This is a **read** key (used to fetch events/tickets/products),
separate from and unrelated to `calendar-sync`'s webhook secret (which
only verifies *inbound* webhook signatures).

### 2. Store it in Secret Manager

Never commit this key or paste it into chat/logs — anyone with it can
read your full Ticket Tailor account data:

```bash
printf '%s' 'YOUR_API_KEY_FROM_TICKET_TAILOR' | \
  gcloud secrets create tickettailor-api-key \
    --project=pinkpistolsdenver-website \
    --data-file=-
```

### 3. Enable Google Sign-In in Firebase

Same as `waiver-lookup` — if you've already done that setup (including
adding `pinkpistolsdenver.org` to Authentication → Settings →
Authorized domains), there's nothing more to do here; this function
reuses the same Firebase project and Google Sign-In configuration.

## Local testing

```bash
npm install
npm test
```

Tests the pure logic (domain check, the 48-hour window boundary, and
grouping tickets/add-ons by buyer) — no live Ticket Tailor API or
Firebase Auth needed for these.

## Deploy

```bash
npm run deploy
```

Same Domain Restricted Sharing issue as the other two functions in
this project applies here too — see `waiver-backend`'s README for the
full explanation. Run this once, right after your first deploy:

```bash
gcloud run services update getupcomingattendees \
  --region=us-central1 \
  --no-invoker-iam-check
```

(Cloud Run lowercases the function name for the underlying service —
double check the exact service name gcloud reports after your first
deploy if this doesn't match.)
