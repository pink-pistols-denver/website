"use strict";

const functions = require("@google-cloud/functions-framework");
const { Firestore, FieldValue } = require("@google-cloud/firestore");
const admin = require("firebase-admin");
const crypto = require("crypto");

const firestore = new Firestore({
    projectId: "pinkpistolsdenver-website"
});

admin.initializeApp({
    projectId: "pinkpistolsdenver-website"
});

/* ==========================================================
   Configuration

   CURRENT_WAIVER_VERSION must match the value of the
   hidden #waiverVersion field in waiver/index.html.
   A mismatch is treated as a validation failure, so the
   front end and this function should be redeployed together
   whenever the waiver text changes.

   APP_CHECK_MODE controls App Check enforcement rollout:
     "off"     - skip verification entirely
     "monitor" - verify and log the result, but never block
     "enforce" - reject requests with a missing/invalid token
   Start on "monitor", confirm real submissions show up as
   verified in the logs, then switch to "enforce" and redeploy.
========================================================== */

const CURRENT_WAIVER_VERSION = "2026-07-15";

const APP_CHECK_MODE = "monitor";

const ALLOWED_ORIGINS = new Set([
    "https://pinkpistolsdenver.org",
    "https://www.pinkpistolsdenver.org"
    // Add a localhost origin here temporarily for local testing,
    // e.g. "http://localhost:5500" — remove it before deploying.
]);

const REQUIRED_ACKNOWLEDGEMENT_FIELDS = [
    "assumptionOfRisk",
    "releaseAndWaiver",
    "consideration",
    "lostOrStolenProperty",
    "removalFromEvents",
    "indemnification",
    "medicalConsent",
    "governingLaw",
    "termOfAgreement",
    "disputeResolution",
    "limitationOfLiability"
];

const REQUIRED_SAFETY_FIELDS = [
    "safeDirection",
    "fingerOffTrigger",
    "keepUnloaded",
    "eyeAndEarProtection",
    "followInstructorCommands"
];

const REQUIRED_AFFIRMATION_FIELDS = [
    "over18",
    "notProhibited",
    "notImpaired",
    "capableToParticipate",
    "ceaseFireAuthority"
];

const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ==========================================================
   HTTP Entry Point
========================================================== */

functions.http("submitWaiver", async (req, res) => {

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

    if (APP_CHECK_MODE !== "off") {

        const appCheckResult =
            await verifyAppCheck(req);

        if (APP_CHECK_MODE === "monitor") {

            console.log(
                appCheckResult.verified
                    ? "App Check: verified"
                    : `App Check: FAILED - ${appCheckResult.error}`
            );

        }

        else if (APP_CHECK_MODE === "enforce" && !appCheckResult.verified) {

            console.log(
                `App Check: rejected - ${appCheckResult.error}`
            );

            res.status(401).json({
                error: "Unable to verify request. Please reload the page and try again."
            });

            return;

        }

    }

    const payload = req.body;

    const validationError = validatePayload(payload);

    if (validationError) {
        res.status(400).json({ error: validationError });
        return;
    }

    try {

        const confirmationNumber =
            await generateUniqueConfirmationNumber();

        const record = buildRecord(
            payload,
            confirmationNumber,
            req
        );

        await firestore
            .collection("waivers")
            .doc(confirmationNumber)
            .set(record);

        res.status(200).json({ confirmationNumber });

    }

    catch (error) {

        console.error("Waiver submission failed:", error);

        res.status(500).json({
            error: "Unable to record waiver. Please try again."
        });

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
    res.set("Access-Control-Allow-Headers", "Content-Type, X-Firebase-AppCheck");
    res.set("Access-Control-Max-Age", "3600");

}

function isAllowedOrigin(origin) {
    return Boolean(origin) && ALLOWED_ORIGINS.has(origin);
}

/* ==========================================================
   App Check
========================================================== */

async function verifyAppCheck(req) {

    const token = req.header("X-Firebase-AppCheck");

    if (!token) {
        return { verified: false, error: "No App Check token provided." };
    }

    try {

        await admin.appCheck().verifyToken(token);

        return { verified: true, error: null };

    }

    catch (error) {

        return { verified: false, error: error.message };

    }

}

/* ==========================================================
   Validation

   This mirrors the front-end validation in waiver.js.
   The front end exists for UX; this is what actually
   protects the integrity of the record, since anyone
   can POST to this endpoint directly.
========================================================== */

function validatePayload(payload) {

    if (!payload || typeof payload !== "object") {
        return "Missing or malformed request body.";
    }

    if (payload.version !== CURRENT_WAIVER_VERSION) {
        return "This waiver version is out of date. Please reload the page and try again.";
    }

    const participant = payload.participant;

    if (!participant || typeof participant !== "object") {
        return "Missing participant information.";
    }

    const legalName = safeTrim(participant.legalName);
    const signature = safeTrim(participant.electronicSignature);
    const email = safeTrim(participant.email);

    if (!legalName || legalName.length > MAX_NAME_LENGTH) {
        return "A valid legal name is required.";
    }

    if (!signature || signature.length > MAX_NAME_LENGTH) {
        return "A valid electronic signature is required.";
    }

    if (normalize(legalName) !== normalize(signature)) {
        return "The electronic signature does not match the legal name.";
    }

    if (email && (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email))) {
        return "The email address is not valid.";
    }

    if (participant.electronicSignatureCertification !== true) {
        return "Signature certification is required.";
    }

    const missingAck = findMissingRequiredField(
        payload.acknowledgements,
        REQUIRED_ACKNOWLEDGEMENT_FIELDS
    );

    if (missingAck) {
        return `Missing required acknowledgement: ${missingAck}`;
    }

    const missingSafety = findMissingRequiredField(
        payload.safetyRules,
        REQUIRED_SAFETY_FIELDS
    );

    if (missingSafety) {
        return `Missing required safety acknowledgement: ${missingSafety}`;
    }

    const missingAffirmation = findMissingRequiredField(
        payload.affirmations,
        REQUIRED_AFFIRMATION_FIELDS
    );

    if (missingAffirmation) {
        return `Missing required affirmation: ${missingAffirmation}`;
    }

    return null;

}

function findMissingRequiredField(group, requiredFields) {

    if (!group || typeof group !== "object") {
        return requiredFields[0];
    }

    for (const field of requiredFields) {
        if (group[field] !== true) {
            return field;
        }
    }

    return null;

}

function safeTrim(value) {
    return typeof value === "string" ? value.trim() : "";
}

function normalize(value) {
    return value.toLowerCase().replace(/\s+/g, " ");
}

/* ==========================================================
   Record Construction
========================================================== */

function buildRecord(payload, confirmationNumber, req) {

    const participant = payload.participant;

    return {

        confirmationNumber,

        waiverVersion: payload.version,

        participant: {
            legalName: safeTrim(participant.legalName),
            email: safeTrim(participant.email) || null,
            electronicSignature: safeTrim(participant.electronicSignature),
            electronicSignatureCertification:
                participant.electronicSignatureCertification === true
        },

        acknowledgements: payload.acknowledgements,

        safetyRules: payload.safetyRules,

        affirmations: payload.affirmations,

        clientMetadata: {
            submittedAt: payload.metadata?.submittedAt ?? null,
            userAgent: payload.metadata?.userAgent ?? null,
            language: payload.metadata?.language ?? null,
            timezone: payload.metadata?.timezone ?? null
        },

        serverMetadata: {
            receivedAt: FieldValue.serverTimestamp(),
            ipAddress: getClientIp(req)
        }

    };

}

function getClientIp(req) {

    const forwardedFor = req.headers["x-forwarded-for"];

    if (forwardedFor) {
        return forwardedFor.split(",")[0].trim();
    }

    return req.ip ?? null;

}

/* ==========================================================
   Confirmation Numbers

   Format matches the client-side dev-mode stand-in:
   PPD-YYMMDD-NNNNNN. Collisions are checked against
   Firestore and retried a handful of times before failing
   loudly rather than silently overwriting a record.
========================================================== */

async function generateUniqueConfirmationNumber() {

    const MAX_ATTEMPTS = 5;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {

        const candidate = buildConfirmationNumber();

        const existing =
            await firestore
                .collection("waivers")
                .doc(candidate)
                .get();

        if (!existing.exists) {
            return candidate;
        }

    }

    throw new Error(
        "Could not generate a unique confirmation number after several attempts."
    );

}

function buildConfirmationNumber() {

    const now = new Date();

    const datePart =
        now.toISOString().slice(2, 10).replace(/-/g, "");

    const randomPart =
        String(crypto.randomInt(0, 1000000)).padStart(6, "0");

    return `PPD-${datePart}-${randomPart}`;

}