"use strict";

/* ==========================================================
   Pure logic for the waiver-lookup function, kept separate
   from index.js so it can be unit tested without a live
   Firestore instance or Firebase Auth.
========================================================== */

const AUTHORIZED_DOMAIN = "pinkpistolsdenver.org";

const MAX_RESULTS = 25;

const MIN_FRAGMENT_LENGTH = 2;
const MAX_FRAGMENT_LENGTH = 100;

const CONFIRMATION_NUMBER_PATTERN = /^PPD-\d{6}-\d{6}$/i;

// Must match waiver-backend/index.js's CURRENT_WAIVER_VERSION.
// Waivers recorded under any other version are flagged so a
// lead reviewing search results knows the signed text may not
// match what's currently posted.
const CURRENT_WAIVER_VERSION = "2026-07-18.2";

// Policy discussed but not enforced anywhere else: waivers are
// kept on file ~1 year (see waiver-backend/README.md, "Waiver
// retention policy"). Nothing deletes them automatically, so
// this just flags older results for a lead's judgment call.
const STALE_AFTER_DAYS = 365;

/* ==========================================================
   Auth
========================================================== */

function isAuthorizedDomain(decodedToken) {

    if (!decodedToken || typeof decodedToken.email !== "string") {
        return false;
    }

    if (decodedToken.email_verified !== true) {
        return false;
    }

    const email = decodedToken.email.toLowerCase();

    return email.endsWith(`@${AUTHORIZED_DOMAIN}`);

}

/* ==========================================================
   Query classification
========================================================== */

function isPlausibleConfirmationNumber(query) {

    if (typeof query !== "string") {
        return false;
    }

    return CONFIRMATION_NUMBER_PATTERN.test(query.trim());

}

function normalizeSearchFragment(query) {

    if (typeof query !== "string") {
        return { valid: false, normalized: "" };
    }

    const normalized = query.trim().toLowerCase();

    if (normalized.length < MIN_FRAGMENT_LENGTH || normalized.length > MAX_FRAGMENT_LENGTH) {
        return { valid: false, normalized };
    }

    return { valid: true, normalized };

}

/* ==========================================================
   Result shaping

   A search result only needs enough to identify the waiver
   and flag it for follow-up — not the full acknowledgement/
   safety/affirmation checkbox states, which can't vary
   (the submission form requires all of them checked before
   it will submit at all, see waiver-backend/index.js's
   REQUIRED_* field lists).
========================================================== */

function annotateWaiver(waiverData) {

    return {
        confirmationNumber: waiverData.confirmationNumber,
        waiverVersion: waiverData.waiverVersion,
        participant: {
            legalName: waiverData.participant?.legalName ?? null,
            email: waiverData.participant?.email ?? null
        },
        signedAt: waiverData.serverMetadata?.receivedAt ?? null,
        flags: {
            outdatedVersion: waiverData.waiverVersion !== CURRENT_WAIVER_VERSION,
            stale: isStale(waiverData)
        }
    };

}

function isStale(waiverData) {

    const receivedAt = toDate(waiverData?.serverMetadata?.receivedAt);

    if (!receivedAt) {
        return false;
    }

    const ageInDays = (Date.now() - receivedAt.getTime()) / (1000 * 60 * 60 * 24);

    return ageInDays > STALE_AFTER_DAYS;

}

function toDate(value) {

    if (!value) {
        return null;
    }

    // Firestore Timestamp instances expose toDate().
    if (typeof value.toDate === "function") {
        return value.toDate();
    }

    const parsed = new Date(value);

    return Number.isNaN(parsed.getTime()) ? null : parsed;

}

module.exports = {
    MAX_RESULTS,
    isAuthorizedDomain,
    normalizeSearchFragment,
    isPlausibleConfirmationNumber,
    annotateWaiver
};
