"use strict";

/* ==========================================================
   Configuration
========================================================== */

const CONFIG = {

    apiEndpoint: "https://us-central1-pinkpistolsdenver-website.cloudfunctions.net/searchWaivers",

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

    searchSection:
        document.getElementById("search-section"),

    searchForm:
        document.getElementById("search-form"),

    searchQuery:
        document.getElementById("search-query"),

    searchButton:
        document.getElementById("search-button"),

    searchStatus:
        document.getElementById("search-status"),

    resultsList:
        document.getElementById("results-list")

};

/* ==========================================================
   Initialization
========================================================== */

document.addEventListener("DOMContentLoaded", initialize);

function initialize() {

    ui.signinButton.addEventListener("click", handleSignIn);
    ui.signoutButton.addEventListener("click", handleSignOut);
    ui.searchForm.addEventListener("submit", handleSearch);

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

        showSignInError(
            "Sign-in failed. Please try again."
        );

    }

}

function handleSignOut() {

    auth.signOut();

    clearResults();

}

function handleAuthStateChanged(user) {

    if (!user) {

        ui.signinSection.hidden = false;
        ui.accountBar.hidden = true;
        ui.searchSection.hidden = true;

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
    ui.searchSection.hidden = false;

    ui.accountEmail.textContent = email;

}

function showSignInError(message) {

    ui.signinError.textContent = message;
    ui.signinError.hidden = false;

}

/* ==========================================================
   Search
========================================================== */

async function handleSearch(event) {

    event.preventDefault();

    const query = ui.searchQuery.value.trim();

    if (!query) {
        return;
    }

    setSearchStatus("Searching...", false);

    clearResults();

    ui.searchButton.disabled = true;

    try {

        const user = auth.currentUser;

        if (!user) {

            setSearchStatus("You've been signed out. Please sign in again.", true);

            return;

        }

        const idToken = await user.getIdToken();

        const response = await fetch(CONFIG.apiEndpoint, {

            method: "POST",

            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${idToken}`
            },

            body: JSON.stringify({ query })

        });

        if (response.status === 401) {

            setSearchStatus(
                "Not authorized. Ask a board member to add your account to the searchers list.",
                true
            );

            return;

        }

        if (!response.ok) {

            const errorBody = await response.json().catch(() => null);

            setSearchStatus(
                errorBody?.error ?? `Search failed (server returned ${response.status}).`,
                true
            );

            return;

        }

        const { results } = await response.json();

        renderResults(results);

        setSearchStatus(
            results.length === 0
                ? "No matching waivers found."
                : `${results.length} result${results.length === 1 ? "" : "s"} found.`,
            false
        );

    }

    catch (error) {

        console.error("Search failed:", error);

        setSearchStatus("Search failed. Please try again.", true);

    }

    finally {

        ui.searchButton.disabled = false;

    }

}

function setSearchStatus(message, isError) {

    ui.searchStatus.textContent = message;

    ui.searchStatus.classList.toggle("error", isError);

}

function clearResults() {

    ui.resultsList.innerHTML = "";

}

/* ==========================================================
   Rendering
========================================================== */

function renderResults(results) {

    clearResults();

    results.forEach(waiver => {

        ui.resultsList.appendChild(
            buildResultCard(waiver)
        );

    });

}

function buildResultCard(waiver) {

    const item = document.createElement("li");

    item.className = "result-card";

    const signedDate = formatDate(waiver.signedAt);

    const emailLine = waiver.participant?.email
        ? `<div class="result-meta">Email: ${escapeHTML(waiver.participant.email)}</div>`
        : "";

    const flagsHTML = buildFlagsHTML(waiver.flags);

    item.innerHTML = `
        <div class="result-name">${escapeHTML(waiver.participant?.legalName ?? "")}</div>
        <div class="result-meta">Confirmation: ${escapeHTML(waiver.confirmationNumber ?? "")}</div>
        <div class="result-meta">Signed: ${escapeHTML(signedDate)}</div>
        ${emailLine}
        ${flagsHTML}
    `;

    return item;

}

function buildFlagsHTML(flags) {

    if (!flags) {
        return "";
    }

    const badges = [];

    if (flags.outdatedVersion) {

        badges.push(
            `<span class="flag-badge outdated-version">Outdated waiver version</span>`
        );

    }

    if (flags.stale) {

        badges.push(
            `<span class="flag-badge stale">Signed over a year ago</span>`
        );

    }

    if (badges.length === 0) {
        return "";
    }

    return `<div class="result-flags">${badges.join("")}</div>`;

}

function formatDate(value) {

    if (!value) {
        return "Unknown";
    }

    // Firestore Timestamps have no toJSON(), so over the wire
    // they arrive as {_seconds, _nanoseconds} rather than a
    // string — handle that shape as well as a parseable date.
    const date = typeof value._seconds === "number"
        ? new Date(value._seconds * 1000)
        : new Date(value);

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
