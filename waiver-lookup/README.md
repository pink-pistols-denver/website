# Pink Pistols Denver — Waiver Lookup

Lets authorized board members/leads search signed waivers by first-name
fragment or confirmation number. Two independent checks gate every
request: the caller must sign in with a `pinkpistolsdenver.org` Google
account, **and** that specific email must be listed in a Firestore
allowlist — being on the Workspace domain alone is not enough.

Confirmation-number search is a prefix match, not an exact match —
searching just the date code (e.g. `PPD-260722`, no random suffix)
returns every waiver signed that day, same idea as the name-fragment
search below.

Search cost is proportional to matches, not to total waivers stored,
forever — see `legalNameLower` in `waiver-backend/index.js` and the
design discussion this came out of. No caching, no full-collection
reads, nothing that gets more expensive as history grows.

## One-time setup

### 1. Dedicated service account (separate from calendar-sync and the waiver function)

```bash
gcloud iam service-accounts create waiver-lookup \
  --project=pinkpistolsdenver-website \
  --display-name="Waiver Lookup"
```

Grant it Firestore read access:

```bash
gcloud projects add-iam-policy-binding pinkpistolsdenver-website \
  --member="serviceAccount:waiver-lookup@pinkpistolsdenver-website.iam.gserviceaccount.com" \
  --role="roles/datastore.viewer"
```

`datastore.viewer` (read-only), not `datastore.user` — this function
only ever reads waivers, never writes or deletes, so it doesn't need
that permission at all.

### 2. Enable Google Sign-In in Firebase

Firebase console → Authentication → Sign-in method → enable **Google**.
Same Firebase project as the waiver App Check setup — no new project
needed.

Also add the site's real domain(s) to Authentication → Settings →
**Authorized domains**: `pinkpistolsdenver.org` and
`www.pinkpistolsdenver.org` (if used). This is separate from the
sign-in provider toggle above and from the App Check setup — without
it, `signInWithPopup` opens a popup that immediately closes with
`auth/unauthorized-domain`, which looks like a generic sign-in
failure rather than a config problem.

### 3. Seed the authorized-searchers allowlist

For each board member/lead who should have access, add a document to
Firestore's `authorizedSearchers` collection, **using their email
address (lowercase) as the document ID**:

```
Collection: authorizedSearchers
Document ID: michellee@pinkpistolsdenver.org
Fields: { addedAt: <timestamp>, addedBy: "..." }
```

The document's *existence* is what grants access — the fields inside
are just for your own audit trail, the code doesn't read them. Add/
remove people by adding/deleting documents here, no redeploy needed.

### 4. Backfill existing waivers (legalNameLower field)

Waivers submitted before this feature existed don't have the
`legalNameLower` field yet. Run this once, from `waiver-backend/`
(needs the same Firestore credentials already set up there):

```bash
cd waiver-backend
node backfill-name-tokens.js
```

Safe to re-run — it skips any waiver that already has the field.

## Local testing

```bash
npm install
npm test
```

Tests the pure logic (domain check, fragment validation, confirmation
number detection, age/version flag computation) — no live Firestore or
Firebase Auth needed for these.

## Deploy

```bash
npm run deploy
```

Same `--no-invoker-iam-check` step as the other two functions in this
project will be needed on first deploy (Domain Restricted Sharing
applies here too) — see waiver-backend's README for the full
explanation if needed:

```bash
gcloud run services update searchwaivers \
  --region=us-central1 \
  --no-invoker-iam-check
```

## Not yet built

**The frontend.** This function is the backend only — a page for leads
to actually sign in and search from doesn't exist yet. Next session's
starting point.
