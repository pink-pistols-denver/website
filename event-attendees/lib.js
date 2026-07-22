"use strict";

/* ==========================================================
   Pure logic for the event-attendees function, kept separate
   from index.js so it can be unit tested without live
   Firestore Auth tokens or a real Ticket Tailor API key.
========================================================== */

const AUTHORIZED_DOMAIN = "pinkpistolsdenver.org";

// How far ahead to look for events. Intentionally short and
// non-configurable per request: this tool is meant for "who's
// showing up and what did they buy" at a specific upcoming
// event, not a general-purpose event browser — narrowing the
// window is what makes skipping the searchWaivers-style
// per-person allowlist (see isAuthorizedDomain below)
// reasonable for this tool.
const WINDOW_HOURS = 48;

/* ==========================================================
   Auth

   Deliberately domain-only, no authorizedSearchers-style
   Firestore allowlist (unlike waiver-lookup) — this data is
   lower-sensitivity (no email addresses surfaced, see
   summarizeAttendees) and short-lived (only ever the next 48
   hours of events), so any signed-in board member/lead/
   volunteer with a pinkpistolsdenver.org account is trusted
   with it rather than requiring per-person setup.
========================================================== */

function isAuthorizedDomain(decodedToken) {

    if (!decodedToken || typeof decodedToken.email !== "string") {
        return false;
    }

    if (decodedToken.email_verified !== true) {
        return false;
    }

    return decodedToken.email.toLowerCase().endsWith(`@${AUTHORIZED_DOMAIN}`);

}

/* ==========================================================
   Event Window
========================================================== */

function isWithinWindow(event, now = new Date()) {

    const startUnix = event?.start?.unix;

    if (typeof startUnix !== "number") {
        return false;
    }

    const startMs = startUnix * 1000;
    const windowEndMs = now.getTime() + WINDOW_HOURS * 60 * 60 * 1000;

    return startMs >= now.getTime() && startMs <= windowEndMs;

}

/* ==========================================================
   Attendee Grouping

   Ticket Tailor represents a purchased add-on (e.g. a patch
   or sticker) as its own issued-ticket-like record sharing
   the buyer's order_id — not nested under the ticket it was
   bought alongside. This groups everything back together per
   buyer so a volunteer sees one line per person with
   everything they're owed.
========================================================== */

function summarizeAttendees(issuedTickets, ticketTypeNamesById, productNamesById) {

    const byOrder = new Map();

    for (const ticket of issuedTickets) {

        if (ticket.status !== "valid") {
            continue;
        }

        const key = ticket.order_id ?? ticket.id;

        if (!byOrder.has(key)) {

            byOrder.set(key, {
                name: ticket.full_name ?? "Unknown",
                ticketTypeCounts: new Map(),
                merchCounts: new Map()
            });

        }

        const entry = byOrder.get(key);

        if (ticket.ticket_type_id) {

            const typeName = ticketTypeNamesById.get(ticket.ticket_type_id) ?? "Unknown ticket type";

            entry.ticketTypeCounts.set(typeName, (entry.ticketTypeCounts.get(typeName) ?? 0) + 1);

        }

        if (ticket.add_on_id) {

            const productName = productNamesById.get(ticket.add_on_id) ?? "Unknown item";

            entry.merchCounts.set(productName, (entry.merchCounts.get(productName) ?? 0) + 1);

        }

    }

    return Array.from(byOrder.values()).map(entry => ({
        name: entry.name,
        // "General Admission x2" — count suffixed onto the type,
        // since it reads naturally in the Ticket column.
        ticketTypes: formatCounts(entry.ticketTypeCounts, "suffix"),
        // "2x Embroidered Patch Logo" — count prefixed instead,
        // since merch renders as standalone badges rather than
        // inline text (see assets/attendees.js).
        merch: formatCounts(entry.merchCounts, "prefix")
    }));

}

function formatCounts(countsByLabel, style) {

    return Array.from(countsByLabel.entries()).map(([label, count]) => {

        if (count <= 1) {
            return label;
        }

        return style === "prefix" ? `${count}x ${label}` : `${label} x${count}`;

    });

}

module.exports = {
    WINDOW_HOURS,
    isAuthorizedDomain,
    isWithinWindow,
    summarizeAttendees
};
