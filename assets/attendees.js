"use strict";

/* ==========================================================
   Configuration
========================================================== */

const CONFIG = {

    apiEndpoint: "https://us-central1-pinkpistolsdenver-website.cloudfunctions.net/getUpcomingAttendees",

    authorizedDomain: "pinkpistolsdenver.org"

};

const firebaseConfig = {
    apiKey: "AIzaSyCV2ZNL-kbuH1K2JuUWIGjaOdDb7_oXvlQ",
    authDomain: "pinkpistolsdenver-website.firebaseapp.com",
    projectId: "pinkpistolsdenver-website",
    storageBucket: "pinkpistolsdenver-website.firebasestorage.app",
    messagingSenderId: "323323001620",
    appId: "1:323323001620:web:a8f44b80b2b89de4896001",
    measurementId: "G-E1XQC6GXT2"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();

/* ==========================================================
   UI References
========================================================== */

const ui = {

    signinSection:
        document.getElementById("signin-section"),

    signinButton:
        document.getElementById("google-signin-button"),

    signinError:
        document.getElementById("signin-error"),

    accountBar:
        document.getElementById("account-bar"),

    accountEmail:
        document.getElementById("account-email"),

    signoutButton:
        document.getElementById("signout-button"),

    statusSection:
        document.getElementById("status-section"),

    loadStatus:
        document.getElementById("load-status"),

    refreshButton:
        document.getElementById("refresh-button"),

    eventsList:
        document.getElementById("events-list")

};

/* ==========================================================
   Initialization
========================================================== */

document.addEventListener("DOMContentLoaded", initialize);

function initialize() {

    ui.signinButton.addEventListener("click", handleSignIn);
    ui.signoutButton.addEventListener("click", handleSignOut);
    ui.refreshButton.addEventListener("click", loadAttendees);

    auth.onAuthStateChanged(handleAuthStateChanged);

}

/* ==========================================================
   Auth
========================================================== */

async function handleSignIn() {

    ui.signinError.hidden = true;

    const provider = new firebase.auth.GoogleAuthProvider();

    provider.setCustomParameters({
        hd: CONFIG.authorizedDomain
    });

    try {

        await auth.signInWithPopup(provider);

    }

    catch (error) {

        console.error("Sign-in failed:", error);

        showSignInError("Sign-in failed. Please try again.");

    }

}

function handleSignOut() {

    auth.signOut();

    clearEvents();

}

function handleAuthStateChanged(user) {

    if (!user) {

        ui.signinSection.hidden = false;
        ui.accountBar.hidden = true;
        ui.statusSection.hidden = true;

        return;

    }

    const email = user.email ?? "";

    if (!email.toLowerCase().endsWith(`@${CONFIG.authorizedDomain}`)) {

        showSignInError(
            `${email} isn't a @${CONFIG.authorizedDomain} account. Please sign in with your Pink Pistols Denver Google account.`
        );

        auth.signOut();

        return;

    }

    ui.signinSection.hidden = true;
    ui.accountBar.hidden = false;
    ui.statusSection.hidden = false;

    ui.accountEmail.textContent = email;

    loadAttendees();

}

function showSignInError(message) {

    ui.signinError.textContent = message;
    ui.signinError.hidden = false;

}

/* ==========================================================
   Loading
========================================================== */

async function loadAttendees() {

    setLoadStatus("Loading...", false);

    clearEvents();

    ui.refreshButton.disabled = true;

    try {

        const user = auth.currentUser;

        if (!user) {

            setLoadStatus("You've been signed out. Please sign in again.", true);

            return;

        }

        const idToken = await user.getIdToken();

        const response = await fetch(CONFIG.apiEndpoint, {

            method: "GET",

            headers: {
                "Authorization": `Bearer ${idToken}`
            }

        });

        if (response.status === 401) {

            setLoadStatus(
                "Not authorized. This tool requires a pinkpistolsdenver.org account.",
                true
            );

            return;

        }

        if (!response.ok) {

            const errorBody = await response.json().catch(() => null);

            setLoadStatus(
                errorBody?.error ?? `Failed to load (server returned ${response.status}).`,
                true
            );

            return;

        }

        const { events } = await response.json();

        renderEvents(events);

        setLoadStatus(
            events.length === 0
                ? "No events in the next 48 hours."
                : `${events.length} event${events.length === 1 ? "" : "s"} in the next 48 hours.`,
            false
        );

    }

    catch (error) {

        console.error("Loading attendees failed:", error);

        setLoadStatus("Failed to load. Please try again.", true);

    }

    finally {

        ui.refreshButton.disabled = false;

    }

}

function setLoadStatus(message, isError) {

    ui.loadStatus.textContent = message;

    ui.loadStatus.classList.toggle("error", isError);

}

function clearEvents() {

    ui.eventsList.innerHTML = "";

}

/* ==========================================================
   Rendering
========================================================== */

function renderEvents(events) {

    clearEvents();

    if (events.length === 0) {

        const empty = document.createElement("li");

        empty.className = "no-events";
        empty.textContent = "Nothing in the next 48 hours.";

        ui.eventsList.appendChild(empty);

        return;

    }

    events.forEach(event => {

        ui.eventsList.appendChild(buildEventCard(event));

    });

}

function buildEventCard(event) {

    const item = document.createElement("li");

    item.className = "event-card";

    const startDate = formatDate(event.start);

    const rowsHTML = event.attendees
        .map(attendee => `
            <tr>
                <td>${escapeHTML(attendee.name)}</td>
                <td>${escapeHTML(attendee.ticketTypes.join(", "))}</td>
                <td>${buildMerchHTML(attendee.merch)}</td>
            </tr>
        `)
        .join("");

    const tableHTML = event.attendees.length
        ? `
            <table class="attendee-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Ticket</th>
                        <th>Merch</th>
                    </tr>
                </thead>
                <tbody>${rowsHTML}</tbody>
            </table>
        `
        : `<p class="event-meta">No attendees yet.</p>`;

    item.innerHTML = `
        <div class="event-name">${escapeHTML(event.name ?? "")}</div>
        <div class="event-meta">${escapeHTML(startDate)}${event.venue ? " — " + escapeHTML(event.venue) : ""}</div>
        ${tableHTML}
    `;

    return item;

}

function buildMerchHTML(merch) {

    if (!merch || merch.length === 0) {
        return "";
    }

    return merch
        .map(item => `<span class="merch-badge">${escapeHTML(item)}</span>`)
        .join("");

}

function formatDate(value) {

    if (!value) {
        return "Unknown";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "Unknown";
    }

    return date.toLocaleString("en-US", {
        dateStyle: "long",
        timeStyle: "short"
    });

}

function escapeHTML(value) {

    const div = document.createElement("div");

    div.textContent = value ?? "";

    return div.innerHTML;

}
