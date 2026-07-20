"use strict";

const crypto = require("crypto");

/* ==========================================================
   Configuration constants used by the pure logic below
========================================================== */

const MAX_WEBHOOK_AGE_SECONDS = 5 * 60;

/* ==========================================================
   Signature Verification

   TicketTailor signs each webhook with HMAC-SHA256 over
   `timestamp + rawBody`, sent as:
     Tickettailor-Webhook-Signature: t=<timestamp>,v1=<signature>
   functions-framework preserves the exact raw bytes on
   req.rawBody specifically for cases like this — verifying
   against the parsed-and-reserialized body would not
   reliably match what TicketTailor actually signed.
========================================================== */

function verifySignature(req, secret) {

    const header = req.header("Tickettailor-Webhook-Signature");

    if (!header) {
        return false;
    }

    const parts = {};

    for (const segment of header.split(",")) {
        const [key, value] = segment.split("=");
        parts[key] = value;
    }

    const timestamp = parts.t;
    const signature = parts.v1;

    if (!timestamp || !signature) {
        return false;
    }

    const expectedSignature = crypto
        .createHmac("sha256", secret)
        .update(timestamp + req.rawBody)
        .digest("hex");

    const signaturesMatch =

        expectedSignature.length === signature.length &&
        crypto.timingSafeEqual(
            Buffer.from(expectedSignature),
            Buffer.from(signature)
        );

    const ageSeconds = Math.floor(Date.now() / 1000) - Number(timestamp);

    const isRecent = ageSeconds >= 0 && ageSeconds <= MAX_WEBHOOK_AGE_SECONDS;

    return signaturesMatch && isRecent;

}

/* ==========================================================
   Visibility Filtering

   Note: TicketTailor sends booleans as the strings
   "true"/"false", not JSON booleans.
========================================================== */

function isPubliclyVisible(ticketTailorEvent) {

    return (
        ticketTailorEvent.status === "published" &&
        ticketTailorEvent.private !== "true" &&
        ticketTailorEvent.hidden !== "true"
    );

}

/* ==========================================================
   Deterministic Calendar Event ID

   Google Calendar custom event ids must be lowercase
   letters a-v and digits 0-9, 5-1024 characters. A hex
   SHA-1 digest (0-9a-f) satisfies this automatically, and
   gives every TicketTailor event a stable, deterministic
   Calendar event id — so create/update/delete all work
   without needing a separate database to track the mapping.
========================================================== */

function calendarEventId(ticketTailorEventId) {

    return "tt" + crypto
        .createHash("sha1")
        .update(ticketTailorEventId)
        .digest("hex");

}

/* ==========================================================
   Mapping: TicketTailor Event -> Google Calendar Event
========================================================== */

function buildCalendarEventBody(ticketTailorEvent) {

    const location = [
        ticketTailorEvent.venue?.name,
        ticketTailorEvent.venue?.postal_code,
        ticketTailorEvent.venue?.country
    ]
        .filter(Boolean)
        .join(", ");

    const descriptionParts = [
        htmlToText(ticketTailorEvent.description)
    ];

    if (ticketTailorEvent.url) {
        descriptionParts.push(`Tickets / details: ${ticketTailorEvent.url}`);
    }

    const requestBody = {

        summary: ticketTailorEvent.name,

        description: descriptionParts.filter(Boolean).join("\n\n"),

        location,

        start: {
            dateTime: ticketTailorEvent.start.iso,
            timeZone: ticketTailorEvent.timezone
        },

        end: {
            dateTime: ticketTailorEvent.end.iso,
            timeZone: ticketTailorEvent.timezone
        }

    };

    if (ticketTailorEvent.url) {

        requestBody.source = {
            title: "View on Ticket Tailor",
            url: ticketTailorEvent.url
        };

    }

    return requestBody;

}

/* ==========================================================
   HTML -> Plain Text

   TicketTailor event descriptions come as simple semantic
   HTML (p, ul/li, b, u, br, a). Calendar's rendering of
   embedded HTML is inconsistent across web/mobile/embed
   clients, so we convert to clean plain text instead —
   that renders identically everywhere, and Calendar
   auto-links bare URLs in plain text reliably on every
   client.
========================================================== */

function htmlToText(html) {

    if (!html) {
        return "";
    }

    return html
        .replace(/<li[^>]*>/gi, "- ")
        .replace(/<\/li>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

}

/* ==========================================================
   Webhook Event Classification

   TicketTailor's docs show lowercase event type strings
   ("event.created"), but real webhook deliveries send them
   uppercase ("EVENT.CREATED") — normalize defensively
   either way rather than trusting either casing.
========================================================== */

function classifyWebhookEvent(eventType) {

    const normalized = (eventType || "").toLowerCase();

    if (normalized === "event.deleted") {
        return "deleted";
    }

    if (normalized === "event.created" || normalized === "event.updated") {
        return "upsert";
    }

    return "unhandled";

}

module.exports = {
    MAX_WEBHOOK_AGE_SECONDS,
    verifySignature,
    isPubliclyVisible,
    calendarEventId,
    buildCalendarEventBody,
    htmlToText,
    classifyWebhookEvent
};