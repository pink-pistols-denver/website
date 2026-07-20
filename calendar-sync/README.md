# Pink Pistols Denver — TicketTailor → Calendar Sync

Syncs events published in TicketTailor to the public Google Calendar
embedded at pinkpistolsdenver.org/calendar. Event-driven via
TicketTailor's webhooks (`event.created`, `event.updated`,
`event.deleted`) — no polling, no third-party automation service.

Lives in the same GCP project as the waiver system
(`pinkpistolsdenver-website`), but is a completely separate Cloud
Function with its own, more narrowly-scoped service account (see
below) — it has no access to Firestore or anything waiver-related, and
the waiver function has no access to your calendar.

## How it works

1. You create or edit an event in TicketTailor.
2. TicketTailor sends a signed webhook to this function.
3. This function verifies the signature, checks whether the event
   should be public (published, not private, not hidden), and
   creates/updates/deletes the matching Google Calendar event.

Each TicketTailor event gets a **deterministic** Google Calendar event
ID (a hash of its TicketTailor ID), so there's no separate database
needed to track which Calendar event corresponds to which TicketTailor
event — re-processing the same webhook twice just harmlessly rewrites
the same Calendar entry.

## One-time setup

### 1. Create a dedicated service account

This function only needs to touch one Google Calendar — it
deliberately does **not** reuse the waiver function's service account,
so a compromise or bug in one system can't touch the other.

```bash
gcloud iam service-accounts create calendar-sync \
  --project=pinkpistolsdenver-website \
  --display-name="TicketTailor Calendar Sync"
```

This gives you a service account email like:

```text
calendar-sync@pinkpistolsdenver-website.iam.gserviceaccount.com
```

### 2. Share your Google Calendar with that service account

This is **not** a GCP IAM permission — it's Google Calendar's own
sharing system, same as sharing a calendar with a coworker:

1. Open Google Calendar → find the calendar shown on your site →
   Settings and sharing.
2. Under "Share with specific people," add the service account email
   from step 1.
3. Set its permission to **"Make changes to events."**
4. While you're on that settings page, copy the **Calendar ID** (under
   "Integrate calendar") — you'll need it in step 4.

### 3. Create a webhook in TicketTailor

1. TicketTailor dashboard → Box Office Settings → API → Webhooks →
   Create new webhook.
2. URL: the Cloud Function's URL (you'll get this after first deploy —
   see below; you can create the webhook now with a placeholder and
   edit it once deployed).
3. Subscribe to: `event.created`, `event.updated`, `event.deleted`.
4. Copy the **shared secret** shown for this webhook — you'll need it
   in step 5.

### 4. Set the Calendar ID

Edit `GOOGLE_CALENDAR_ID` near the top of `index.js` with the value
from step 2.

### 5. Set the webhook secret

Unlike the waiver project's Firebase config (which is meant to be
public), this secret must **not** be committed to git or hardcoded —
anyone who has it can forge webhook requests. Store it as a Secret
Manager secret:

```bash
printf '%s' 'YOUR_SECRET_FROM_TICKETTAILOR' | \
  gcloud secrets create tickettailor-webhook-secret \
    --project=pinkpistolsdenver-website \
    --data-file=-
```

## Local testing

The pure logic (signature verification, the public/private filter, the
HTML→text conversion, and the TicketTailor→Calendar field mapping) has
zero external dependencies and is fully unit-tested against real
example data — no Google credentials or network access needed to run
it:

```bash
npm test
```

This does **not** test the actual Google Calendar API calls (those
need real credentials and network access) — only the logic that
decides *what* would be sent. Test that end-to-end after deploying, by
creating a test event in TicketTailor and checking it appears on the
calendar.

## Deploy

```bash
npm install
gcloud functions deploy syncTicketTailorEvent \
  --gen2 \
  --runtime=nodejs22 \
  --region=us-central1 \
  --source=. \
  --entry-point=syncTicketTailorEvent \
  --trigger-http \
  --memory=256Mi \
  --max-instances=10 \
  --service-account=calendar-sync@pinkpistolsdenver-website.iam.gserviceaccount.com \
  --set-secrets=TICKETTAILOR_WEBHOOK_SECRET=tickettailor-webhook-secret:latest
```

**First deploy only** — make the endpoint publicly callable. As with
the waiver function, this project is under Domain Restricted Sharing,
so the usual `--allow-unauthenticated` flag will fail here the same
way it did there. Use this instead, once, right after the first
successful deploy (see the waiver-backend README's Troubleshooting
section for the full explanation if you want the details):

```bash
gcloud run services update synctickettailorevent \
  --region=us-central1 \
  --no-invoker-iam-check
```

(Cloud Run service names are lowercase-only, same gotcha as before —
if that exact name 404s, check the actual service name Cloud Console
shows you and use that instead.)

After deploying, `gcloud` prints the function's HTTPS URL. Put that URL
into the TicketTailor webhook you created in setup step 3.

The IAM roles the underlying build needs
(`roles/logging.logWriter`, `roles/artifactregistry.writer`,
`roles/storage.objectViewer` on the Compute Engine default service
account) were already granted at the project level while setting up
the waiver function — those apply to every Cloud Function in this
project, so you should **not** need to redo that step here.

## Troubleshooting

If a real TicketTailor event doesn't show up on the calendar, check
the logs:

```bash
gcloud functions logs read syncTicketTailorEvent --region=us-central1 --gen2 --limit=20
```

Common causes:

- **401 Invalid signature** — the secret in Secret Manager doesn't
  match what's shown in TicketTailor's webhook settings, or the
  webhook is pointed at the wrong URL.
- **500 Sync failed, Calendar API permission error** — the service
  account wasn't actually shared on the calendar (step 2), or was
  shared with only "See all event details" instead of "Make changes
  to events."
- **Nothing happens at all, no logs** — check that the TicketTailor
  webhook is actually subscribed to `event.created`/`updated`/`deleted`
  and pointed at the current deployed URL.

## Not yet handled here

- **Venue precision.** TicketTailor's venue data is just a name,
  postal code, and country — no street address. The Calendar event's
  location field is best-effort and may not pin precisely on a map.
- **Retention/cleanup.** If a TicketTailor event is deleted long after
  its Calendar counterpart was created, the delete webhook removes it
  correctly — but there's no periodic reconciliation job that would
  catch a webhook that TicketTailor failed to deliver (rare, but
  possible). Not worth building unless it turns out to be a real
  problem in practice.
