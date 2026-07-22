# Pink Pistols Denver — Waiver Submission Function

Receives waiver submissions from `waiver/index.html`, validates them
server-side, and writes them to Firestore. This is the source of truth —
the front end's validation is UX only; this function is what actually
protects the integrity of the record.

## One-time project setup

```bash
# Set your project
gcloud config set project pinkpistolsdenver-website

# Enable the APIs you'll need
gcloud services enable cloudfunctions.googleapis.com \
    cloudbuild.googleapis.com \
    firestore.googleapis.com \
    run.googleapis.com

# Create a Firestore database in Native mode, if you haven't already
gcloud firestore databases create --location=nam5 --type=firestore-native
```

The Compute Engine default service account (the runtime identity gen2
functions use by default — visible as `serviceAccountEmail` in your
deploy output) needs the `roles/datastore.user` role so it can read and
write Firestore:

```bash
PROJECT_NUMBER=$(gcloud projects describe pinkpistolsdenver-website --format="value(projectNumber)")

gcloud projects add-iam-policy-binding pinkpistolsdenver-website \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role="roles/datastore.user"
```

(This is a different account from `pinkpistolsdenver-website@appspot.gserviceaccount.com`,
which is what 1st-gen Cloud Functions used by default — easy to mix up,
and worth double-checking against your own deploy output's
`serviceAccountEmail` field if Firestore writes ever fail silently.)

## Local testing

The Firestore Admin SDK needs credentials to run. On Cloud Functions this
happens automatically via the function's service account — locally, you
need to provide Application Default Credentials (ADC) once per machine:

```bash
gcloud auth application-default login
```

This opens a browser to log in with your own Google account and stores
credentials in a well-known local file that `@google-cloud/firestore`
picks up automatically — no key file to manage or accidentally commit
to git, and you only need to do this once per machine, not per project.

Your account needs at least the `roles/datastore.user` role on
`pinkpistolsdenver-website` for local writes to actually succeed — the
same role the IAM step above grants to the function's service account,
just for your own account instead:

```bash
gcloud projects add-iam-policy-binding pinkpistolsdenver-website \
    --member="user:YOUR_EMAIL@example.com" \
    --role="roles/datastore.user"
```

```bash
npm install
npm start
```

This runs the function locally with `functions-framework`. While testing,
temporarily add your local origin (e.g. `http://localhost:5500`, whatever
your local dev server uses) to `ALLOWED_ORIGINS` in `index.js` — remove it
again before deploying.

Test it directly with curl using the included sample payload:

```bash
curl -X POST http://localhost:8080 \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5500" \
  -d @sample-payload.json
```

Change the `Origin` header to match whatever local origin you added to
`ALLOWED_ORIGINS`. A successful response looks like
`{"confirmationNumber":"PPD-260717-000123"}`; a validation failure
returns a 400 with `{"error": "..."}` describing what's missing —
edit `sample-payload.json` and flip a field to `false` to see that path.

## Deploy

```bash
npm run deploy
```

Equivalent to:

```bash
gcloud functions deploy submitWaiver \
  --gen2 \
  --runtime=nodejs22 \
  --region=us-central1 \
  --source=. \
  --entry-point=submitWaiver \
  --trigger-http \
  --memory=256Mi \
  --max-instances=10
```

`--max-instances=10` is a cheap guardrail against a runaway bill if the
endpoint gets hammered; raise it if you expect real concurrent traffic
during a busy event.

**First deploy only** — make the service publicly callable. This
project is attached to a Google Workspace organization, which enables
Domain Restricted Sharing by default and blocks the usual
`--allow-unauthenticated` flag (see Troubleshooting below for why). Use
this instead, once, right after your first successful deploy:

```bash
gcloud run services update submitWaiver \
  --region=us-central1 \
  --no-invoker-iam-check
```

This setting lives on the underlying Cloud Run service and persists
across future `npm run deploy` runs — you only need to run it once, not
after every redeploy.

After deploying, `gcloud` prints the function's HTTPS URL. Put that in
`CONFIG.apiEndpoint` in `assets/waiver.js`.

## Firestore security rules

`firestore.rules` locks the `waivers` collection down completely — no
client reads or writes. The Cloud Function uses the Admin SDK, which
bypasses these rules entirely, so this is defense in depth rather than
something required for the function to work. Deploy it with:

```bash
gcloud firestore rules deploy firestore.rules
```

(or via the Firebase CLI, if you set this project up with Firebase
instead of raw GCP — mechanically identical either way.)

## Keeping the waiver version in sync

`CURRENT_WAIVER_VERSION` in `index.js` must match the `value` of the
hidden `#waiverVersion` field in `waiver/index.html`. A mismatch is
treated as a validation failure and the submission is rejected — this
is intentional (fail closed rather than silently accepting a submission
against stale legal text), but it means the front end and this function
need to be redeployed together whenever the waiver text changes.

## Budget alert (cheap insurance against abuse)

The endpoint is `--allow-unauthenticated` with no reCAPTCHA/App Check yet,
so the realistic cost risk isn't legitimate waiver traffic — it's someone
scripting junk requests at it. `--max-instances=10` caps how bad that can
get, but a budget alert means you'd get an email long before anything
becomes a real bill, rather than finding out at the end of the month.

First, find your billing account ID:

```bash
gcloud billing accounts list
```

Then create a small budget with alert thresholds at 50%, 90%, and 100%:

```bash
gcloud billing budgets create \
  --billing-account=YOUR_BILLING_ACCOUNT_ID \
  --display-name="Waiver function budget alert" \
  --budget-amount=5USD \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0
```

This doesn't cap or shut anything off — Google Cloud budgets are alerts,
not hard limits — but by default the alert emails go to the project's
Billing Account Administrators and Users, which is enough to catch a
problem within a day rather than a month. `$5` is arbitrary; the point
isn't the dollar amount, it's getting notified the moment you're no
longer at $0.

If you'd rather do this through the console instead of the CLI:
Billing → Budgets & alerts → Create budget, scope it to this project,
set the same amount and thresholds.

## Troubleshooting: build fails with missing roles/logging.logWriter

Since July 2024, Google no longer automatically grants the `Editor` role
to the default Compute Engine service account in new projects — so on a
freshly created project, the account that runs the gen2 build
(`PROJECT_NUMBER-compute@developer.gserviceaccount.com`) is often missing
the permissions a build needs. This shows up as a build failure
mentioning `roles/logging.logWriter`, and sometimes also
`roles/artifactregistry.writer` or `roles/storage.objectViewer` on a
later attempt once the first is fixed. Grant all three up front:

```bash
PROJECT_NUMBER=$(gcloud projects describe pinkpistolsdenver-website --format="value(projectNumber)")

gcloud projects add-iam-policy-binding pinkpistolsdenver-website \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/logging.logWriter"

gcloud projects add-iam-policy-binding pinkpistolsdenver-website \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding pinkpistolsdenver-website \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/storage.objectViewer"
```

(On Windows PowerShell, replace `$(...)` with a separate
`$PROJECT_NUMBER = gcloud projects describe ...` assignment and
line-continuation backticks instead of backslashes.)

Then re-run `npm run deploy`.

## Troubleshooting: deploy fails with "do not belong to a permitted customer"

This happens at the very last step of deployment, after the build and
service creation succeed — it's the `allUsers` IAM grant failing.
Since this project is attached to a Google Workspace organization
(`pinkpistolsdenver.org`), Domain Restricted Sharing is enabled by
default, which blocks granting IAM roles to `allUsers` — normally
exactly what you want blocked, since a public waiver form is the
legitimate exception.

**The fix is the `--no-invoker-iam-check` step in the Deploy section
above** — it makes the Cloud Run service public without touching IAM at
all, so it isn't affected by Domain Restricted Sharing and doesn't need
any special org-level permission. If you've already run that and public
access works, there's nothing further to do here.

<details>
<summary>Alternative, only if you need the actual allUsers IAM grant for some other reason</summary>

You can override the org policy for this project instead, but this
requires the Organization Policy Administrator role
(`roles/orgpolicy.policyAdmin`) at the organization level — a
higher-privilege role than deploying the function itself needs, and not
required for the fix above:

```bash
cat > /tmp/allow-public-access.yaml << 'EOF'
constraint: constraints/iam.allowedPolicyMemberDomains
listPolicy:
  allValues: ALLOW
EOF

gcloud resource-manager org-policies set-policy /tmp/allow-public-access.yaml \
  --project=pinkpistolsdenver-website
```

</details>

## Troubleshooting: client gets "Unable to record waiver. Please try again."

This is the deliberately generic message `index.js` returns for any
unexpected server-side failure — it's designed not to leak internals to
whoever's calling the endpoint, so it won't tell you the real cause.
Find that in Cloud Logging instead:

```bash
gcloud functions logs read submitWaiver --region=us-central1 --gen2 --limit=20
```

or via the Cloud Console link `gcloud functions deploy` printed after
your last deploy. Look for the line starting `Waiver submission failed:`
— that's the actual error `index.js` caught. The most common cause is
the runtime service account missing `roles/datastore.user` (see
"One-time project setup" above) — check `serviceAccountEmail` in your
deploy output against what you actually granted the role to.

## App Check (reCAPTCHA v3)

The front end (`waiver/index.html` + `assets/waiver.js`) attaches a
Firebase App Check token to every submission via an `X-Firebase-AppCheck`
header, using reCAPTCHA v3 as the underlying attestation provider. This
Cloud Function verifies that token before touching Firestore.

**Rollout mode** is controlled by `APP_CHECK_MODE` near the top of
`index.js`:

- `"off"` — skip verification entirely
- `"monitor"` — verify and log the result, but never block a request
- `"enforce"` — reject requests with a missing or invalid token

**Deploy on `"monitor"` first.** After deploying, submit a real waiver
through the actual live site, then check the logs:

```bash
gcloud functions logs read submitWaiver --region=us-central1 --gen2 --limit=20
```

You should see `App Check: verified` for that real submission, and
`App Check: FAILED - ...` for the old `sample-payload.json` curl tests
(since those don't send a token at all). Once you've confirmed a real
browser submission comes back verified, change `APP_CHECK_MODE` to
`"enforce"` and redeploy.

**Front-end resilience:** if the Firebase SDK fails to load for any
reason (ad blocker, CDN issue, network hiccup), `waiver.js` catches that
and disables App Check for the session rather than breaking the wizard
— the submission still goes through, just without a token. In
`"enforce"` mode, that submission would then be rejected by the Cloud
Function with a "please reload and try again" message. In `"monitor"`
mode, it goes through and just logs as failed. Worth knowing this
tradeoff before flipping to `"enforce"`: a small number of real
participants behind aggressive ad/script blockers may see the reload
message. If that turns out to be a real problem in practice, the
`APP_CHECK_MODE` toggle lets you drop back to `"monitor"` without
touching any other code.

## QR code for the waiver page

```bash
npm install
npm run generate-qr
```

Writes `waiver-qr.svg` **into this `waiver-backend/` folder** — not
into `assets/`, since `assets/` is published to the live site by the
GitHub Actions deploy and this code is for printing on physical
materials (signage, flyers, check-in tables), not for display on the
website itself. `waiver-backend/` is already fully excluded from that
deploy's allowlist, and `.gcloudignore` also keeps this file (and the
generator script) out of the Cloud Function's own deploy — so it never
ends up published anywhere, deliberately.

Deliberately **not** using a URL shortener (Bitly, etc.) either: the
waiver URL is fixed, short, and already on a domain we own, so there's
no need for a third party's redirect indirection or an account that
might turn into a paywall later (as happened with Bitly's free tier).
Generate this once, done — no ongoing service, no maintenance.

Only re-run this if the waiver's actual URL ever changes.

**Test-scan the output with an actual phone before using it on any
printed material.** This was generated without the ability to verify a
real scan; the modules are plain black-on-white deliberately, since
color reduces contrast and hurts scan reliability in poor lighting or
low-quality printing — don't recolor it to match the brand palette
without confirming it still scans reliably afterward.

## Roadmap

### Done

- ✓ Firestore persistence
- ✓ App Check + reCAPTCHA v3 (enforced)
- ✓ WCAG accessibility audit
- ✓ Trusted-lead lookup/check-in tool — see `waiver-lookup/`
- ✓ Search by confirmation number — part of `waiver-lookup/`
- ✓ Waiver retention policy — waivers are kept on file indefinitely
  (nothing auto-deletes), but only treated as "in effect" for 1 year;
  `waiver-lookup/lib.js`'s `stale` flag surfaces anything past that
  to a lead as a manual judgment call rather than hiding or deleting it.

### Not planned (deliberately decided against, not overlooked)

- **Instructor authentication** — lead/admin access via a Google
  Sign-In allowlist is enough at this scale
- **Instructor dashboard**
- **QR-code check-in**
- **Waiver version history search**
- **Offline service-worker support** — worst case, use a paper waiver
- **Minor / guardian workflow** — handled via paper waiver, not the
  website, going forward
- **Automated billing kill-switch** (Pub/Sub-triggered auto-disable) —
  the existing budget alert plus the bounded worst-case cost from
  `--max-instances` is sufficient
- **Event selection / association per submission** — waivers are
  valid for a fixed term (currently 1 year) rather than tied to a
  specific event, so there's no need to know which event a given
  submission belongs to.
- **Event capacity lookup** — likely would have depended on the
  event-association work above, which is dropped; no longer has a
  clear purpose without it.
- **Email confirmation email** — decided against due to the ongoing
  concern and complexity of running an SMTP setup. The Download
  button on the success page covers "get a copy of what you signed"
  instead, without needing an email service at all.
- **Signed PDF generation** — the Download button's HTML copy is a
  faithful, self-contained record of exactly what was signed, and
  anyone who needs a literal PDF can print it to one; a separate PDF
  generation path would be duplicative.

### Post-1.0 (deferred, not dropped)

- **Emergency contact information** — good idea, but needs careful
  design given the LGBTQ community context (e.g. a contact may not be
  supportive of or aware of someone's participation).

