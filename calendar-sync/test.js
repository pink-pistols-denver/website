"use strict";

const assert = require("assert");
const crypto = require("crypto");

const {
    verifySignature,
    isPubliclyVisible,
    calendarEventId,
    buildCalendarEventBody,
    htmlToText,
    classifyWebhookEvent
} = require("./lib.js");

let passed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`PASS  ${name}`);
        passed++;
    } catch (error) {
        console.error(`FAIL  ${name}`);
        console.error(`      ${error.message}`);
        process.exitCode = 1;
    }
}

/* ==========================================================
   Real sample events (trimmed from the actual /v1/events
   response used to build this function)
========================================================== */

const publicEvent = {
    object: "event",
    id: "ev_7973406",
    name: "Casual Range Event",
    description:
        "<p>Looking to get some range time in with good people? Our Casual Range Day is a laid-back meetup.</p>\n" +
        "<p>Bring your own gear, work on what you want to work on.</p>\n" +
        "<p><a href=\"https://www.goshootindoors.com/locations/denver/\" target=\"_blank\">https://www.goshootindoors.com/locations/denver/</a></p>",
    hidden: "false",
    private: "true",
    status: "published",
    start: { iso: "2026-04-24T18:00:00-06:00" },
    end: { iso: "2026-04-24T20:00:00-06:00" },
    timezone: "America/Denver",
    venue: { name: "Shoot Indoors: Denver", country: "US", postal_code: "80204" },
    url: "https://www.tickettailor.com/events/pinkpistolsdenverchapter/2154406"
};

const newShooterEvent = {
    object: "event",
    id: "ev_7396612",
    name: "Pink Pistols' New Shooter Event",
    description:
        "<p>Never handled a firearm before? This event is for you!</p>" +
        "<ul><li>One certified instructor</li><li>6 slots available</li></ul>" +
        "<p><b>JOIN THE DISCORD: https://linktr.ee/pinkpistolsdenver</b></p>",
    hidden: "false",
    private: "false",
    status: "published",
    start: { iso: "2026-01-25T10:00:00-07:00" },
    end: { iso: "2026-01-25T12:00:00-07:00" },
    timezone: "America/Denver",
    venue: { name: "Shoot Indoors: Denver", country: "US", postal_code: "80204" },
    url: "https://www.tickettailor.com/events/pinkpistolsdenverchapter/1999705"
};

/* ==========================================================
   Filtering
========================================================== */

test("public, non-private, non-hidden published event IS publicly visible", () => {
    assert.strictEqual(isPubliclyVisible(newShooterEvent), true);
});

test("private:\"true\" event is NOT publicly visible, even if hidden:\"false\"", () => {
    assert.strictEqual(isPubliclyVisible(publicEvent), false);
});

test("hidden:\"true\" event is NOT publicly visible", () => {
    assert.strictEqual(
        isPubliclyVisible({ ...newShooterEvent, hidden: "true" }),
        false
    );
});

test("non-published status is NOT publicly visible", () => {
    assert.strictEqual(
        isPubliclyVisible({ ...newShooterEvent, status: "draft" }),
        false
    );
});

test("real boolean `false` (not the string) is not mistaken for the string \"false\"", () => {
    // Guards against a JS-boolean-vs-TicketTailor-string mixup regression.
    assert.strictEqual(
        isPubliclyVisible({ ...newShooterEvent, private: false }),
        true
    );
});

/* ==========================================================
   Webhook event classification

   Regression coverage for a real bug: TicketTailor's docs
   show lowercase event type strings, but live webhook
   deliveries send them uppercase — a naive exact-match
   comparison silently ignored every real webhook while
   appearing to work against lowercase test fixtures.
========================================================== */

test("classifyWebhookEvent handles TicketTailor's documented lowercase form", () => {
    assert.strictEqual(classifyWebhookEvent("event.created"), "upsert");
    assert.strictEqual(classifyWebhookEvent("event.updated"), "upsert");
    assert.strictEqual(classifyWebhookEvent("event.deleted"), "deleted");
});

test("classifyWebhookEvent handles the real uppercase form TicketTailor actually sends", () => {
    assert.strictEqual(classifyWebhookEvent("EVENT.CREATED"), "upsert");
    assert.strictEqual(classifyWebhookEvent("EVENT.UPDATED"), "upsert");
    assert.strictEqual(classifyWebhookEvent("EVENT.DELETED"), "deleted");
});

test("classifyWebhookEvent handles mixed case defensively", () => {
    assert.strictEqual(classifyWebhookEvent("Event.Created"), "upsert");
});

test("classifyWebhookEvent returns 'unhandled' for unrecognized types, not a crash", () => {
    assert.strictEqual(classifyWebhookEvent("order.created"), "unhandled");
    assert.strictEqual(classifyWebhookEvent(""), "unhandled");
    assert.strictEqual(classifyWebhookEvent(undefined), "unhandled");
});

/* ==========================================================
   Calendar event id
========================================================== */

test("calendarEventId is deterministic for the same TicketTailor id", () => {
    assert.strictEqual(
        calendarEventId("ev_7396612"),
        calendarEventId("ev_7396612")
    );
});

test("calendarEventId differs for different TicketTailor ids", () => {
    assert.notStrictEqual(
        calendarEventId("ev_7396612"),
        calendarEventId("ev_7973406")
    );
});

test("calendarEventId only uses characters valid for a Calendar event id (lowercase a-v, 0-9)", () => {
    const id = calendarEventId("ev_7396612");
    assert.match(id, /^[0-9a-v]+$/);
    assert.ok(id.length >= 5 && id.length <= 1024);
});

/* ==========================================================
   HTML -> text
========================================================== */

test("htmlToText strips tags and converts list items to bullet lines", () => {
    const text = htmlToText(newShooterEvent.description);
    assert.ok(!text.includes("<"), "should contain no HTML tags");
    assert.ok(text.includes("- One certified instructor"));
    assert.ok(text.includes("- 6 slots available"));
});

test("htmlToText handles empty/missing description", () => {
    assert.strictEqual(htmlToText(null), "");
    assert.strictEqual(htmlToText(undefined), "");
    assert.strictEqual(htmlToText(""), "");
});

/* ==========================================================
   Calendar event body mapping
========================================================== */

test("buildCalendarEventBody maps name, times, timezone, and location correctly", () => {
    const body = buildCalendarEventBody(newShooterEvent);
    assert.strictEqual(body.summary, "Pink Pistols' New Shooter Event");
    assert.strictEqual(body.start.dateTime, "2026-01-25T10:00:00-07:00");
    assert.strictEqual(body.end.dateTime, "2026-01-25T12:00:00-07:00");
    assert.strictEqual(body.start.timeZone, "America/Denver");
    assert.strictEqual(body.location, "Shoot Indoors: Denver, 80204, US");
    assert.ok(body.description.includes("Tickets / details:"));
    assert.ok(body.description.includes(newShooterEvent.url));
    assert.strictEqual(body.source.url, newShooterEvent.url);
});

test("buildCalendarEventBody handles a venue missing some fields gracefully", () => {
    const sparse = { ...newShooterEvent, venue: { name: "Somewhere" } };
    const body = buildCalendarEventBody(sparse);
    assert.strictEqual(body.location, "Somewhere");
});

/* ==========================================================
   Signature verification
========================================================== */

process.env.TICKETTAILOR_WEBHOOK_SECRET = "test_secret_for_local_testing_only";

function buildSignedRequest(bodyString, secret, timestampOverride) {

    const timestamp = timestampOverride ?? Math.floor(Date.now() / 1000);

    const signature = crypto
        .createHmac("sha256", secret)
        .update(timestamp + bodyString)
        .digest("hex");

    return {
        rawBody: bodyString,
        header(name) {
            if (name === "Tickettailor-Webhook-Signature") {
                return `t=${timestamp},v1=${signature}`;
            }
            return undefined;
        }
    };
}

test("verifySignature accepts a correctly signed, fresh request", () => {
    const body = JSON.stringify({ event: "event.created", payload: { id: "ev_1" } });
    const req = buildSignedRequest(body, process.env.TICKETTAILOR_WEBHOOK_SECRET);
    assert.strictEqual(verifySignature(req, process.env.TICKETTAILOR_WEBHOOK_SECRET), true);
});

test("verifySignature rejects a request signed with the wrong secret", () => {
    const body = JSON.stringify({ event: "event.created", payload: { id: "ev_1" } });
    const req = buildSignedRequest(body, "wrong_secret");
    assert.strictEqual(verifySignature(req, process.env.TICKETTAILOR_WEBHOOK_SECRET), false);
});

test("verifySignature rejects a tampered body (signature no longer matches)", () => {
    const body = JSON.stringify({ event: "event.created", payload: { id: "ev_1" } });
    const req = buildSignedRequest(body, process.env.TICKETTAILOR_WEBHOOK_SECRET);
    req.rawBody = JSON.stringify({ event: "event.created", payload: { id: "ev_2" } });
    assert.strictEqual(verifySignature(req, process.env.TICKETTAILOR_WEBHOOK_SECRET), false);
});

test("verifySignature rejects a timestamp older than 5 minutes (replay protection)", () => {
    const body = JSON.stringify({ event: "event.created", payload: { id: "ev_1" } });
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
    const req = buildSignedRequest(body, process.env.TICKETTAILOR_WEBHOOK_SECRET, oldTimestamp);
    assert.strictEqual(verifySignature(req, process.env.TICKETTAILOR_WEBHOOK_SECRET), false);
});

test("verifySignature rejects a missing signature header", () => {
    const req = { rawBody: "{}", header: () => undefined };
    assert.strictEqual(verifySignature(req, process.env.TICKETTAILOR_WEBHOOK_SECRET), false);
});

console.log(`\n${passed} test(s) passed.`);