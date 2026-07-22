"use strict";

const functions = require("@google-cloud/functions-framework");
const admin = require("firebase-admin");

const {
    WINDOW_HOURS,
    isAuthorizedDomain,
    isWithinWindow,
    summarizeAttendees
} = require("./lib.js");

admin.initializeApp({
    projectId: "pinkpistolsdenver-website"
});

const TICKET_TAILOR_API_KEY = process.env.TICKETTAILOR_API_KEY;
const TICKET_TAILOR_BASE_URL = "https://api.tickettailor.com/v1";

const ALLOWED_ORIGINS = new Set([
    "https://pinkpistolsdenver.org",
    "https://www.pinkpistolsdenver.org"
]);

/* ==========================================================
   HTTP Entry Point
========================================================== */

functions.http("getUpcomingAttendees", async (req, res) => {

    applyCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }

    if (req.method !== "GET" && req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed." });
        return;
    }

    if (!isAllowedOrigin(req.headers.origin)) {
        res.status(403).json({ error: "Origin not allowed." });
        return;
    }

    if (!TICKET_TAILOR_API_KEY) {
        console.error("TICKETTAILOR_API_KEY is not set — refusing all requests.");
        res.status(500).json({ error: "Server misconfigured." });
        return;
    }

    let authorizedEmail;

    try {
        authorizedEmail = await requireAuthorizedCaller(req);
    }

    catch (error) {
        console.warn(`Rejected attendee list request: ${error.message}`);
        res.status(401).json({ error: "Not authorized." });
        return;
    }

    try {

        const events = await getUpcomingEventsWithAttendees();

        console.log(`Attendee list viewed by ${authorizedEmail}: ${events.length} event(s) in the next ${WINDOW_HOURS}h.`);

        res.status(200).json({ events });

    }

    catch (error) {

        console.error("Fetching upcoming attendees failed:", error);
        res.status(500).json({ error: "Failed to load attendee list." });

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

    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

}

function isAllowedOrigin(origin) {
    return Boolean(origin) && ALLOWED_ORIGINS.has(origin);
}

/* ==========================================================
   Auth

   Domain-only — see lib.js's isAuthorizedDomain comment for
   why this tool doesn't also require the searchWaivers-style
   Firestore allowlist.
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

    return decodedToken.email.toLowerCase();

}

/* ==========================================================
   Ticket Tailor API
========================================================== */

async function ticketTailorGet(path, params = {}) {

    const url = new URL(`${TICKET_TAILOR_BASE_URL}${path}`);

    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
            url.searchParams.set(key, value);
        }
    }

    const response = await fetch(url, {
        headers: {
            "Accept": "application/json",
            // Ticket Tailor's documented format: the API key alone,
            // base64-encoded, with no ":" or password appended.
            "Authorization": `Basic ${Buffer.from(TICKET_TAILOR_API_KEY).toString("base64")}`
        }
    });

    if (!response.ok) {
        throw new Error(`Ticket Tailor API returned ${response.status} for ${path}`);
    }

    return response.json();

}

async function ticketTailorGetAllPages(path, params = {}) {

    const results = [];
    let startingAfter;

    for (;;) {

        const page = await ticketTailorGet(path, { ...params, starting_after: startingAfter });

        results.push(...page.data);

        if (!page.links?.next) {
            break;
        }

        startingAfter = results[results.length - 1].id;

    }

    return results;

}

async function getUpcomingEventsWithAttendees() {

    const allEvents = await ticketTailorGetAllPages("/events", { status: "published" });
    const windowEvents = allEvents.filter(event => isWithinWindow(event));

    if (windowEvents.length === 0) {
        return [];
    }

    const products = await ticketTailorGetAllPages("/products");
    const productNamesById = new Map(products.map(product => [product.id, product.name]));

    const events = [];

    for (const event of windowEvents) {

        const ticketTypeNamesById = new Map(
            (event.ticket_types ?? []).map(ticketType => [ticketType.id, ticketType.name])
        );

        const issuedTickets = await ticketTailorGetAllPages("/issued_tickets", {
            event_id: event.id,
            status: "valid"
        });

        events.push({
            id: event.id,
            name: event.name,
            venue: event.venue?.name ?? null,
            start: event.start?.iso ?? null,
            attendees: summarizeAttendees(issuedTickets, ticketTypeNamesById, productNamesById)
        });

    }

    events.sort((a, b) => new Date(a.start) - new Date(b.start));

    return events;

}
