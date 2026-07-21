"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    MAX_RESULTS,
    isAuthorizedDomain,
    normalizeSearchFragment,
    isPlausibleConfirmationNumber,
    annotateWaiver
} = require("./lib.js");

/* ==========================================================
   isAuthorizedDomain
========================================================== */

test("isAuthorizedDomain accepts a verified pinkpistolsdenver.org email", () => {
    assert.equal(
        isAuthorizedDomain({ email: "Lead@PinkPistolsDenver.org", email_verified: true }),
        true
    );
});

test("isAuthorizedDomain rejects a different domain", () => {
    assert.equal(
        isAuthorizedDomain({ email: "lead@gmail.com", email_verified: true }),
        false
    );
});

test("isAuthorizedDomain rejects an unverified email", () => {
    assert.equal(
        isAuthorizedDomain({ email: "lead@pinkpistolsdenver.org", email_verified: false }),
        false
    );
});

test("isAuthorizedDomain rejects a missing token", () => {
    assert.equal(isAuthorizedDomain(null), false);
    assert.equal(isAuthorizedDomain({}), false);
});

/* ==========================================================
   isPlausibleConfirmationNumber
========================================================== */

test("isPlausibleConfirmationNumber accepts the PPD-YYMMDD-NNNNNN shape", () => {
    assert.equal(isPlausibleConfirmationNumber("PPD-260718-000042"), true);
});

test("isPlausibleConfirmationNumber is case-insensitive and trims whitespace", () => {
    assert.equal(isPlausibleConfirmationNumber("  ppd-260718-000042  "), true);
});

test("isPlausibleConfirmationNumber rejects a name fragment", () => {
    assert.equal(isPlausibleConfirmationNumber("michelle"), false);
});

test("isPlausibleConfirmationNumber rejects a malformed confirmation number", () => {
    assert.equal(isPlausibleConfirmationNumber("PPD-2607-000042"), false);
});

/* ==========================================================
   normalizeSearchFragment
========================================================== */

test("normalizeSearchFragment lowercases and trims a valid fragment", () => {
    assert.deepEqual(normalizeSearchFragment("  Michelle  "), {
        valid: true,
        normalized: "michelle"
    });
});

test("normalizeSearchFragment rejects fragments under 2 characters", () => {
    assert.equal(normalizeSearchFragment("m").valid, false);
});

test("normalizeSearchFragment rejects fragments over the max length", () => {
    assert.equal(normalizeSearchFragment("a".repeat(101)).valid, false);
});

test("normalizeSearchFragment rejects non-string input", () => {
    assert.equal(normalizeSearchFragment(undefined).valid, false);
});

/* ==========================================================
   annotateWaiver
========================================================== */

test("annotateWaiver flags a waiver signed under an old version", () => {
    const annotated = annotateWaiver({ waiverVersion: "2025-01-01.0" });
    assert.equal(annotated.flags.outdatedVersion, true);
});

test("annotateWaiver does not flag the current version", () => {
    const annotated = annotateWaiver({ waiverVersion: "2026-07-18.2" });
    assert.equal(annotated.flags.outdatedVersion, false);
});

test("annotateWaiver flags a waiver older than 365 days", () => {
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    const annotated = annotateWaiver({
        waiverVersion: "2026-07-18.2",
        serverMetadata: { receivedAt: twoYearsAgo.toISOString() }
    });

    assert.equal(annotated.flags.stale, true);
});

test("annotateWaiver does not flag a recent waiver as stale", () => {
    const annotated = annotateWaiver({
        waiverVersion: "2026-07-18.2",
        serverMetadata: { receivedAt: new Date().toISOString() }
    });

    assert.equal(annotated.flags.stale, false);
});

test("annotateWaiver treats a Firestore-Timestamp-like value the same as a Date", () => {
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    const annotated = annotateWaiver({
        waiverVersion: "2026-07-18.2",
        serverMetadata: {
            receivedAt: { toDate: () => twoYearsAgo }
        }
    });

    assert.equal(annotated.flags.stale, true);
});

test("annotateWaiver does not flag staleness when receivedAt is missing", () => {
    const annotated = annotateWaiver({ waiverVersion: "2026-07-18.2" });
    assert.equal(annotated.flags.stale, false);
});

test("annotateWaiver leaves the original waiver data intact", () => {
    const waiver = { waiverVersion: "2026-07-18.2", confirmationNumber: "PPD-260718-000042" };
    const annotated = annotateWaiver(waiver);
    assert.equal(annotated.confirmationNumber, "PPD-260718-000042");
});

/* ==========================================================
   MAX_RESULTS
========================================================== */

test("MAX_RESULTS is a positive number", () => {
    assert.equal(typeof MAX_RESULTS, "number");
    assert.ok(MAX_RESULTS > 0);
});
