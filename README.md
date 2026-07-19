# Pink Pistols Denver — Website

Source for [pinkpistolsdenver.org](https://pinkpistolsdenver.org), a
static site served via GitHub Pages, plus the digital waiver system
that backs it.

## Repo structure

```text
.
├── index.html            Homepage
├── calendar.html          Events calendar
├── assets/                Shared CSS/JS/images for the main site and waiver
│   ├── style.css          Main site styling
│   ├── waiver.css          Waiver wizard styling
│   ├── waiver.js           Waiver wizard logic (validation, submission, App Check)
│   └── logo_banner.png
├── library/               Guides & Resources section, built with Zensical
├── waiver/
│   └── index.html          The waiver wizard itself (7-step form)
├── waiver-backend/         Cloud Function that validates + records waiver submissions
│   ├── index.js
│   ├── package.json
│   ├── firestore.rules
│   ├── sample-payload.json, bad-payload-*.json   (test fixtures)
│   └── README.md           Full setup, deploy, and troubleshooting docs — start here
│                            for anything backend-related
└── .github/workflows/       GitHub Actions deploy pipeline
```

## Deployment

The site deploys via GitHub Actions on every push to `main` (see
`.github/workflows/`). The workflow builds the `library/` docs with
Zensical, then copies an **explicit allowlist** of files/folders into
the published output — `index.html`, `calendar.html`, `assets`,
`waiver`, and the built library. This is intentionally an allowlist
rather than a denylist: anything not explicitly listed (including all
of `waiver-backend/`, which is backend source code, not something that
should ever be publicly served) simply never gets published, even if
it's accidentally left in the repo. If you add a new top-level
file/folder that needs to be live on the site, it has to be added to
that `cp` line in the workflow, or it will 404 even though the deploy
"succeeds."

## The waiver system

Event attendees complete a digital liability waiver at `/waiver/`
instead of signing on paper. It's split into two independent pieces:

- **Frontend** (`waiver/index.html` + `assets/waiver.js` +
  `assets/waiver.css`) — a multi-step wizard with full client-side
  validation, an electronic signature step, and a downloadable copy of
  the completed waiver generated entirely in the browser.
- **Backend** (`waiver-backend/`) — a Google Cloud Function (2nd gen)
  that re-validates every submission server-side, verifies a Firebase
  App Check / reCAPTCHA v3 token to block scripted/bot submissions, and
  writes the record to Firestore with a server-generated confirmation
  number.

**For anything involving deployment, Firestore, IAM, App Check, the
budget alert, or troubleshooting a broken submission, see
[`waiver-backend/README.md`](waiver-backend/README.md)** — that file
has the actual step-by-step instructions and a running list of gotchas
already hit (and fixed) during setup. It also has the current
**Roadmap** — what's done, what's been deliberately decided against,
and what's deferred to post-1.0 — so that's the place to check before
assuming a feature was simply forgotten.

## Status

Actively used for real events. Core waiver flow, validation, Firestore
persistence, App Check/reCAPTCHA enforcement, and an accessibility
pass are all complete. See the Roadmap in `waiver-backend/README.md`
for what's intentionally still open.