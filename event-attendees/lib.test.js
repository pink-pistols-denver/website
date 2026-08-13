"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    WINDOW_HOURS,
    LOOKBACK_HOURS,
    isAuthorizedDomain,
    isWithinWindow,
    summarizeAttendees
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
        isAuthorizedDomain({ email: "volunteer@gmail.com", email_verified: true }),
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
   isWithinWindow
========================================================== */

const NOW = new Date("2026-07-22T12:00:00-06:00");

test("isWithinWindow accepts an event starting in 10 hours", () => {
    const event = { start: { unix: Math.floor(NOW.getTime() / 1000) + 10 * 60 * 60 } };
    assert.equal(isWithinWindow(event, NOW), true);
});

test("isWithinWindow accepts an event that's currently running", () => {
    const nowUnix = Math.floor(NOW.getTime() / 1000);
    const event = {
        start: { unix: nowUnix - 30 * 60 },
        end: { unix: nowUnix + 90 * 60 }
    };
    assert.equal(isWithinWindow(event, NOW), true);
});

test("isWithinWindow accepts an event that ended within the lookback buffer", () => {
    const nowUnix = Math.floor(NOW.getTime() / 1000);
    const event = {
        start: { unix: nowUnix - 4 * 60 * 60 },
        end: { unix: nowUnix - 1 * 60 * 60 }
    };
    assert.equal(isWithinWindow(event, NOW), true);
});

test(`isWithinWindow rejects an event that ended more than ${LOOKBACK_HOURS}h ago`, () => {
    const nowUnix = Math.floor(NOW.getTime() / 1000);
    const event = {
        start: { unix: nowUnix - 6 * 60 * 60 },
        end: { unix: nowUnix - (LOOKBACK_HOURS + 1) * 60 * 60 }
    };
    assert.equal(isWithinWindow(event, NOW), false);
});

test("isWithinWindow falls back to the start time when there's no end time", () => {
    const nowUnix = Math.floor(NOW.getTime() / 1000);

    // Started just under the lookback buffer ago, no end field —
    // should still count as recent using start as a stand-in.
    const recentNoEnd = { start: { unix: nowUnix - (LOOKBACK_HOURS - 1) * 60 * 60 } };
    assert.equal(isWithinWindow(recentNoEnd, NOW), true);

    // Started well past the lookback buffer ago, no end field —
    // should now be excluded.
    const staleNoEnd = { start: { unix: nowUnix - (LOOKBACK_HOURS + 1) * 60 * 60 } };
    assert.equal(isWithinWindow(staleNoEnd, NOW), false);
});

test(`isWithinWindow rejects an event starting after ${WINDOW_HOURS}h`, () => {
    const event = { start: { unix: Math.floor(NOW.getTime() / 1000) + (WINDOW_HOURS + 1) * 60 * 60 } };
    assert.equal(isWithinWindow(event, NOW), false);
});

test("isWithinWindow accepts an event exactly at the window boundary", () => {
    const event = { start: { unix: Math.floor(NOW.getTime() / 1000) + WINDOW_HOURS * 60 * 60 } };
    assert.equal(isWithinWindow(event, NOW), true);
});

test("isWithinWindow rejects a malformed event", () => {
    assert.equal(isWithinWindow({}, NOW), false);
    assert.equal(isWithinWindow({ start: {} }, NOW), false);
});

/* ==========================================================
   summarizeAttendees
========================================================== */

test("summarizeAttendees groups a ticket and its add-on under the same buyer", () => {

    const issuedTickets = [
        { order_id: "or_1", full_name: "John Smith", status: "valid", ticket_type_id: "tt_ga", add_on_id: null },
        { order_id: "or_1", full_name: "John Smith", status: "valid", ticket_type_id: null, add_on_id: "pr_patch" }
    ];

    const ticketTypeNamesById = new Map([["tt_ga", "General Admission"]]);
    const productNamesById = new Map([["pr_patch", "Patch and/or Sticker"]]);

    const summary = summarizeAttendees(issuedTickets, ticketTypeNamesById, productNamesById);

    assert.deepEqual(summary, [
        { name: "John Smith", ticketTypes: ["General Admission"], merch: ["Patch and/or Sticker"] }
    ]);

});

test("summarizeAttendees ignores voided tickets", () => {

    const issuedTickets = [
        { order_id: "or_1", full_name: "Jane Doe", status: "voided", ticket_type_id: "tt_ga", add_on_id: null }
    ];

    const summary = summarizeAttendees(issuedTickets, new Map(), new Map());

    assert.deepEqual(summary, []);

});

test("summarizeAttendees keeps separate buyers separate", () => {

    const issuedTickets = [
        { order_id: "or_1", full_name: "John Smith", status: "valid", ticket_type_id: "tt_ga", add_on_id: null },
        { order_id: "or_2", full_name: "Jane Doe", status: "valid", ticket_type_id: "tt_ga", add_on_id: null }
    ];

    const ticketTypeNamesById = new Map([["tt_ga", "General Admission"]]);

    const summary = summarizeAttendees(issuedTickets, ticketTypeNamesById, new Map());

    assert.equal(summary.length, 2);
    assert.deepEqual(summary.map(a => a.name).sort(), ["Jane Doe", "John Smith"]);

});

test("summarizeAttendees counts multiple tickets of the same type for one buyer", () => {

    const issuedTickets = [
        { order_id: "or_1", full_name: "Michelle Eggleston", status: "valid", ticket_type_id: "tt_ga", add_on_id: null },
        { order_id: "or_1", full_name: "Michelle Eggleston", status: "valid", ticket_type_id: "tt_ga", add_on_id: null }
    ];

    const ticketTypeNamesById = new Map([["tt_ga", "General Admission"]]);

    const summary = summarizeAttendees(issuedTickets, ticketTypeNamesById, new Map());

    assert.deepEqual(summary, [
        { name: "Michelle Eggleston", ticketTypes: ["General Admission x2"], merch: [] }
    ]);

});

test("summarizeAttendees counts multiple merch purchases of the same item for one buyer", () => {

    const issuedTickets = [
        { order_id: "or_1", full_name: "Michelle Eggleston", status: "valid", ticket_type_id: null, add_on_id: "pr_patch" },
        { order_id: "or_1", full_name: "Michelle Eggleston", status: "valid", ticket_type_id: null, add_on_id: "pr_patch" },
        { order_id: "or_1", full_name: "Michelle Eggleston", status: "valid", ticket_type_id: null, add_on_id: "pr_sticker" }
    ];

    const productNamesById = new Map([
        ["pr_patch", "Embroidered Patch Logo"],
        ["pr_sticker", "Sticker"]
    ]);

    const summary = summarizeAttendees(issuedTickets, new Map(), productNamesById);

    assert.deepEqual(summary, [
        { name: "Michelle Eggleston", ticketTypes: [], merch: ["2x Embroidered Patch Logo", "Sticker"] }
    ]);

});

test("summarizeAttendees falls back gracefully for unknown ticket types and products", () => {

    const issuedTickets = [
        { order_id: "or_1", full_name: "John Smith", status: "valid", ticket_type_id: "tt_unknown", add_on_id: "pr_unknown" }
    ];

    const summary = summarizeAttendees(issuedTickets, new Map(), new Map());

    assert.deepEqual(summary, [
        { name: "John Smith", ticketTypes: ["Unknown ticket type"], merch: ["Unknown item"] }
    ]);

});
