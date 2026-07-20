"use strict";

const functions = require("@google-cloud/functions-framework");
const { google } = require("googleapis");

const {
    verifySignature,
    isPubliclyVisible,
    calendarEventId,
    buildCalendarEventBody,
    classifyWebhookEvent
} = require("./lib.js");

/* ==========================================================
   Configuration
========================================================== */

// The calendar shown on pinkpistolsdenver.org/calendar.
// Find this under that calendar's Settings -> Integrate
// calendar -> Calendar ID.
const GOOGLE_CALENDAR_ID = "c_213d287c1cd3b961c6a3b6c69da6e5018cbd47837ba4d87333c7d1e4a60bb728@group.calendar.google.com";

// From TicketTailor: Box Office Settings -> API -> Webhooks
// -> (your webhook) -> shared secret. Read from an
// environment variable / Secret Manager, never hardcoded,
// since unlike the App Check keys in the waiver project,
// this one is a genuine secret — anyone with it can forge
// webhook requests.
const TICKETTAILOR_WEBHOOK_SECRET = process.env.TICKETTAILOR_WEBHOOK_SECRET;

const calendar = google.calendar({
    version: "v3",
    auth: new google.auth.GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/calendar.events"]
    })
});

/* ==========================================================
   HTTP Entry Point
========================================================== */

functions.http("syncTicketTailorEvent", async (req, res) => {

    if (req.method !== "POST") {
        console.warn(`Rejected ${req.method} request (only POST is accepted).`);
        res.status(405).send("Method not allowed.");
        return;
    }

    if (!TICKETTAILOR_WEBHOOK_SECRET) {
        console.error(
            "TICKETTAILOR_WEBHOOK_SECRET is not set — refusing all requests."
        );
        res.status(500).send("Server misconfigured.");
        return;
    }

    if (!verifySignature(req, TICKETTAILOR_WEBHOOK_SECRET)) {
        console.warn(
            "Rejected request: missing or invalid " +
            "Tickettailor-Webhook-Signature header (bad secret, " +
            "tampered body, or timestamp older than 5 minutes)."
        );
        res.status(401).send("Invalid signature.");
        return;
    }

    const webhook = req.body;

    if (!webhook || !webhook.event || !webhook.payload || !webhook.payload.id) {
        console.warn(
            "Rejected request: malformed webhook body. Received: " +
            JSON.stringify(webhook).slice(0, 500)
        );
        res.status(400).send("Malformed webhook payload.");
        return;
    }

    console.log(
        `Received ${webhook.event} for TicketTailor event ${webhook.payload.id}` +
        ` ("${webhook.payload.name ?? "unknown name"}").`
    );

    try {

        const wasHandled = await handleWebhook(webhook.event, webhook.payload);

        if (wasHandled) {
            console.log(`Successfully synced ${webhook.event} for ${webhook.payload.id}.`);
        }

        res.status(200).send("OK");

    }

    catch (error) {

        console.error(
            `Calendar sync failed for ${webhook.event} / ${webhook.payload.id}:`,
            error
        );
        res.status(500).send("Sync failed.");

    }

});

/* ==========================================================
   Webhook Handling

   Note on idempotency: TicketTailor recommends tracking
   processed webhook ids to avoid double-processing. We get
   this for free here without a separate database — every
   create/update maps to the same deterministic Calendar
   event id (see calendarEventId in lib.js), so reprocessing
   the same webhook just rewrites the same event with the
   same data. Deletes are idempotent too, since "already
   deleted" is treated as success, not an error.
========================================================== */

async function handleWebhook(eventType, ticketTailorEvent) {

    const classification = classifyWebhookEvent(eventType);

    if (classification === "deleted") {
        await deleteCalendarEvent(ticketTailorEvent.id);
        return true;
    }

    if (classification === "upsert") {

        if (isPubliclyVisible(ticketTailorEvent)) {
            await upsertCalendarEvent(ticketTailorEvent);
        }

        else {
            // Covers the case where an event was public and
            // has since been made private/hidden/unpublished —
            // it should disappear from the public calendar.
            await deleteCalendarEvent(ticketTailorEvent.id);
        }

        return true;

    }

    console.warn(`Ignoring unrecognized webhook event type: ${eventType}`);
    return false;

}

/* ==========================================================
   Google Calendar Sync
========================================================== */

async function upsertCalendarEvent(ticketTailorEvent) {

    const eventId = calendarEventId(ticketTailorEvent.id);
    const requestBody = buildCalendarEventBody(ticketTailorEvent);

    try {

        await calendar.events.update({
            calendarId: GOOGLE_CALENDAR_ID,
            eventId,
            requestBody
        });

    }

    catch (error) {

        if (error.code === 404) {

            await calendar.events.insert({
                calendarId: GOOGLE_CALENDAR_ID,
                requestBody: { id: eventId, ...requestBody }
            });

        }

        else {
            throw error;
        }

    }

}

async function deleteCalendarEvent(ticketTailorEventId) {

    const eventId = calendarEventId(ticketTailorEventId);

    try {

        await calendar.events.delete({
            calendarId: GOOGLE_CALENDAR_ID,
            eventId
        });

    }

    catch (error) {

        if (error.code === 404 || error.code === 410) {
            // Already gone — nothing to do.
            return;
        }

        throw error;

    }

}