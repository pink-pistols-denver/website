"use strict";

const functions = require("@google-cloud/functions-framework");
const { Firestore, FieldPath } = require("@google-cloud/firestore");
const admin = require("firebase-admin");

const {
    MAX_RESULTS,
    isAuthorizedDomain,
    normalizeSearchFragment,
    isPlausibleConfirmationNumber,
    normalizeConfirmationNumberQuery,
    annotateWaiver
} = require("./lib.js");

const firestore = new Firestore({
    projectId: "pinkpistolsdenver-website"
});

admin.initializeApp({
    projectId: "pinkpistolsdenver-website"
});

const ALLOWED_ORIGINS = new Set([
    "https://pinkpistolsdenver.org",
    "https://www.pinkpistolsdenver.org"
]);

/* ==========================================================
   HTTP Entry Point
========================================================== */

functions.http("searchWaivers", async (req, res) => {

    applyCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }

    if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed." });
        return;
    }

    if (!isAllowedOrigin(req.headers.origin)) {
        res.status(403).json({ error: "Origin not allowed." });
        return;
    }

    let authorizedEmail;

    try {
        authorizedEmail = await requireAuthorizedCaller(req);
    }

    catch (error) {
        console.warn(`Rejected search request: ${error.message}`);
        res.status(401).json({ error: "Not authorized." });
        return;
    }

    const { query } = req.body ?? {};

    try {

        let results;

        if (isPlausibleConfirmationNumber(query)) {
            results = await searchByConfirmationNumber(normalizeConfirmationNumberQuery(query));
        }

        else {

            const { valid, normalized } = normalizeSearchFragment(query);

            if (!valid) {
                res.status(400).json({
                    error: "Search term must be at least 2 characters."
                });
                return;
            }

            results = await searchByNameToken(normalized);

        }

        console.log(
            `Search by ${authorizedEmail}: ${results.length} result(s).`
        );

        res.status(200).json({ results });

    }

    catch (error) {

        console.error("Waiver search failed:", error);
        res.status(500).json({ error: "Search failed." });

    }

});

/* ==========================================================
   CORS
========================================================== */

function applyCorsHeaders(req, res) {

    const origin = req.headers.origin;

    if (isAllowedOrigin(origin)) {
        res.set("Access-Control-Allow-Origin", origin);
    }

    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

}

function isAllowedOrigin(origin) {
    return Boolean(origin) && ALLOWED_ORIGINS.has(origin);
}

/* ==========================================================
   Auth

   Two independent checks, both required:
   1. A valid Firebase ID token, verified server-side, whose
      email belongs to the Workspace domain.
   2. That specific email exists in the authorizedSearchers
      Firestore collection — kept in Firestore rather than
      hardcoded so the people who can edit Firestore data
      (a tightly controlled group) aren't the same, broader
      group of people who can push code to the repo.
========================================================== */

async function requireAuthorizedCaller(req) {

    const authHeader = req.header("Authorization") ?? "";
    const match = authHeader.match(/^Bearer (.+)$/);

    if (!match) {
        throw new Error("Missing Authorization header.");
    }

    const decodedToken = await admin.auth().verifyIdToken(match[1]);

    if (!isAuthorizedDomain(decodedToken)) {
        throw new Error(`Email domain not authorized: ${decodedToken.email}`);
    }

    const email = decodedToken.email.toLowerCase();

    const allowlistDoc = await firestore
        .collection("authorizedSearchers")
        .doc(email)
        .get();

    if (!allowlistDoc.exists) {
        throw new Error(`Email not on authorized searchers list: ${email}`);
    }

    return email;

}

/* ==========================================================
   Search
========================================================== */

async function searchByNameToken(fragment) {

    const snapshot = await firestore
        .collection("waivers")
        .where("legalNameLower", ">=", fragment)
        .where("legalNameLower", "<", fragment + "\uf8ff")
        .limit(MAX_RESULTS)
        .get();

    return snapshot.docs.map(doc => annotateWaiver(doc.data()));

}

async function searchByConfirmationNumber(prefix) {

    // Range query on document ID rather than a single .doc().get()
    // — waiver doc IDs are the confirmation number itself, so this
    // matches any number of waivers sharing a prefix (e.g. a whole
    // day's worth via the date code) as well as one exact number.
    const snapshot = await firestore
        .collection("waivers")
        .where(FieldPath.documentId(), ">=", prefix)
        .where(FieldPath.documentId(), "<", prefix + "\uf8ff")
        .limit(MAX_RESULTS)
        .get();

    return snapshot.docs.map(doc => annotateWaiver(doc.data()));

}
