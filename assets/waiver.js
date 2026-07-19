"use strict";

/* ==========================================================
   Configuration
========================================================== */

const CONFIG = {

    apiEndpoint: "https://us-central1-pinkpistolsdenver-website.cloudfunctions.net/submitWaiver",

    scrollBehavior: "smooth"

};

/* ==========================================================
   Firebase App Check

   Verifies submissions come from this real page (via
   invisible reCAPTCHA v3 scoring) before the Cloud Function
   touches Firestore. The API key and site key below are
   meant to be public — App Check's security model doesn't
   depend on hiding them, only on the reCAPTCHA secret key
   never being exposed, which never appears in client code.
========================================================== */

const firebaseConfig = {
    apiKey: "AIzaSyCV2ZNL-kbuH1K2JuUWIGjaOdDb7_oXvlQ",
    authDomain: "pinkpistolsdenver-website.firebaseapp.com",
    projectId: "pinkpistolsdenver-website",
    storageBucket: "pinkpistolsdenver-website.firebasestorage.app",
    messagingSenderId: "323323001620",
    appId: "1:323323001620:web:a8f44b80b2b89de4896001",
    measurementId: "G-E1XQC6GXT2"
};

let appCheck = null;

try {

    if (typeof firebase !== "undefined") {

        firebase.initializeApp(firebaseConfig);

        appCheck = firebase.appCheck();

        appCheck.activate(
            new firebase.appCheck.ReCaptchaV3Provider(
                "6Leea1ktAAAAAPctjPpl22liUSswjPbwyduLFV6B"
            ),
            true // isTokenAutoRefreshEnabled
        );

    }

    else {

        console.warn(
            "Firebase SDK did not load — App Check disabled for this session."
        );

    }

}

catch (error) {

    console.warn(
        "App Check initialization failed:",
        error
    );

}

/* ==========================================================
   Application State
========================================================== */

const state = {

    currentPage: 0

};

let lastWaiverSummaryHTML = null;

/* ==========================================================
   UI References
========================================================== */

const ui = {

    form:
        document.getElementById("waiver-form"),

    pages:
        Array.from(
            document.querySelectorAll(".wizard-page")
        ).filter(page =>
            page.id !== "step-success"
        ),

    successPage:
        document.getElementById("step-success"),

    progressFill:
        document.getElementById("progress-fill"),

    currentStep:
        document.getElementById("current-step"),

    totalSteps:
        document.getElementById("total-steps"),

    currentStepTitle:
        document.getElementById("current-step-title")

};

/* ==========================================================
   Initialization
========================================================== */

document.addEventListener(

    "DOMContentLoaded",

    initialize

);

function initialize() {

    ui.totalSteps.textContent =
        ui.pages.length;

    initializePageHeaders();

    initializeButtons();

    initializeWaiverDownload();

    showPage(0);

}

/* ==========================================================
   Page Headers
========================================================== */

function initializePageHeaders() {

    ui.pages.forEach((page, index) => {

        page.querySelector(".page-step").textContent =

            `Step ${index + 1} of ${ui.pages.length}`;

        page.querySelector(".page-title").textContent =

            page.dataset.title ?? "";

        page.querySelector(".page-subtitle").textContent =

            page.dataset.subtitle ?? "";

    });

}

/* ==========================================================
   Navigation
========================================================== */

function showPage(index) {

    ui.pages.forEach(page =>

        page.classList.remove("active")

    );

    ui.pages[index].classList.add("active");

    state.currentPage = index;

    updateProgress();

    window.scrollTo({

        top: 0,

        behavior: CONFIG.scrollBehavior

    });

}

function nextPage() {

    if (!validateCurrentPage()) {

        return;

    }

    if (

        state.currentPage < ui.pages.length - 1

    ) {

        showPage(

            state.currentPage + 1

        );

    }

}

function previousPage() {

    if (

        state.currentPage > 0

    ) {

        showPage(

            state.currentPage - 1

        );

    }

}

/* ==========================================================
   Progress
========================================================== */

function updateProgress() {

    ui.currentStep.textContent =

        state.currentPage + 1;

    ui.currentStepTitle.textContent =

        ui.pages[state.currentPage].dataset.title ?? "";

    const percent =

        (

            (state.currentPage + 1)

            /

            ui.pages.length

        ) * 100;

    ui.progressFill.style.width =

        `${percent}%`;

}

/* ==========================================================
   Button Wiring
========================================================== */

function initializeButtons() {

    document

        .querySelectorAll(".next-button")

        .forEach(button =>

            button.addEventListener(

                "click",

                nextPage

            )

        );

    document

        .querySelectorAll(".back-button")

        .forEach(button =>

            button.addEventListener(

                "click",

                previousPage

            )

        );

    ui.form.addEventListener(

        "submit",

        handleSubmit

    );

}

/* ==========================================================
   Validation
========================================================== */

function validateCurrentPage() {

    clearValidation();

    const page =

        ui.pages[state.currentPage];

    let valid = true;

    page

        .querySelectorAll(

            "[data-validation-group='page']"

        )

        .forEach(field => {

            let fieldValid = true;

            if (

                field.type === "checkbox"

            ) {

                fieldValid =

                    field.checked;

            }

            else {

                fieldValid =

                    field.value.trim() !== "";

            }

            if (!fieldValid) {

                valid = false;

                markInvalid(field);

            }

        });

    if (

        page.id === "step-signature"

    ) {

        valid =
            validateSignatureMatch(page) && valid;

        valid =
            validateEmailFormat(page) && valid;

    }

    if (!valid) {

        showValidationMessage(

            page,

            "Please complete all required fields before continuing."

        );

    }

    return valid;

}

/* ==========================================================
   Signature Page Extra Checks
========================================================== */

function validateSignatureMatch(page) {

    const nameField =
        ui.form.elements["legalName"];

    const sigField =
        ui.form.elements["electronicSignature"];

    const mismatchNote =
        document.getElementById(
            "signature-mismatch"
        );

    const normalize = value =>

        value
            .trim()
            .toLowerCase()
            .replace(/\s+/g, " ");

    const namesMatch =

        nameField.value.trim() !== "" &&
        sigField.value.trim() !== "" &&
        normalize(nameField.value) ===
            normalize(sigField.value);

    if (!namesMatch) {

        markInvalid(sigField);

        if (mismatchNote) {

            mismatchNote.hidden = false;

        }

    }

    else if (mismatchNote) {

        mismatchNote.hidden = true;

    }

    return namesMatch;

}

function validateEmailFormat(page) {

    const emailField =
        ui.form.elements["email"];

    if (!emailField || emailField.value.trim() === "") {

        return true;

    }

    const emailPattern =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    const isValid =
        emailPattern.test(
            emailField.value.trim()
        );

    if (!isValid) {

        markInvalid(emailField);

    }

    return isValid;

}

function markInvalid(field) {

    const card =

        field.closest(".checkbox-card");

    if (card) {

        card.classList.add(

            "validation-error"

        );

    }

    else {

        field.classList.add(

            "validation-error"

        );

    }

}

function clearValidation() {

    document

        .querySelectorAll(

            ".validation-error"

        )

        .forEach(element =>

            element.classList.remove(

                "validation-error"

            )

        );

    document

        .querySelectorAll(

            ".validation-message"

        )

        .forEach(message =>

            message.remove()

        );

}

function showValidationMessage(

    page,

    message

) {

    const div =

        document.createElement("div");

    div.className =

        "validation-message";

    div.textContent =

        message;

    page.appendChild(div);

}

/* ==========================================================
   Structured Form Data
========================================================== */

function collectFormData() {

    return {

        version:
            getValue("waiverVersion"),

        submittedAt:
            new Date().toISOString(),

        participant: {

            legalName:
                getValue("legalName"),

            email:
                getValue("email"),

            electronicSignature:
                getValue("electronicSignature"),

            electronicSignatureCertification:
                getChecked("electronicSignatureCertification")

        },

        acknowledgements: {

            assumptionOfRisk:
                getChecked("assumptionOfRisk"),

            releaseAndWaiver:
                getChecked("releaseAndWaiver"),

            consideration:
                getChecked("consideration"),

            lostOrStolenProperty:
                getChecked("lostOrStolenProperty"),

            removalFromEvents:
                getChecked("removalFromEvents"),

            indemnification:
                getChecked("indemnification"),

            medicalConsent:
                getChecked("medicalConsent"),

            governingLaw:
                getChecked("governingLaw"),

            termOfAgreement:
                getChecked("termOfAgreement"),

            disputeResolution:
                getChecked("disputeResolution"),

            limitationOfLiability:
                getChecked("limitationOfLiability")

        },

        safetyRules: {

            safeDirection:
                getChecked("safeDirection"),

            fingerOffTrigger:
                getChecked("fingerOffTrigger"),

            keepUnloaded:
                getChecked("keepUnloaded"),

            eyeAndEarProtection:
                getChecked("eyeAndEarProtection"),

            followInstructorCommands:
                getChecked("followInstructorCommands")

        },

        affirmations: {

            over18:
                getChecked("over18"),

            notProhibited:
                getChecked("notProhibited"),

            notImpaired:
                getChecked("notImpaired"),

            capableToParticipate:
                getChecked("capableToParticipate"),

            ceaseFireAuthority:
                getChecked("ceaseFireAuthority")

        }

    };

}

/* ==========================================================
   Form Helpers
========================================================== */

function getValue(name) {

    const field = ui.form.elements[name];

    return field
        ? field.value.trim()
        : "";

}

function getChecked(name) {

    const field = ui.form.elements[name];

    return Boolean(
        field && field.checked
    );

}

/* ==========================================================
   Submission
========================================================== */

async function handleSubmit(event) {

    event.preventDefault();

    if (!validateCurrentPage()) {

        return;

    }

    const submitButton =

        document.getElementById(
            "submit-button"
        );

    submitButton.disabled = true;

    submitButton.textContent =
        "Submitting...";

    try {

        const payload = collectFormData();

        payload.metadata = {

            submittedAt:
                new Date().toISOString(),

            waiverVersion:
                getValue("waiverVersion"),

            userAgent:
                navigator.userAgent,

            language:
                navigator.language,

            timezone:
                Intl.DateTimeFormat()
                    .resolvedOptions()
                    .timeZone

        };

        // Captured from the DOM now, while the wizard pages
        // are still intact — this becomes the actual content
        // of the downloadable/printable waiver copy, so it
        // reflects exactly what this participant read and
        // agreed to, independent of any later edits to the
        // live site's text.
        const waiverContent =
            captureWaiverContent();

        const result =
            await postToGoogleCloud(payload);

        lastWaiverSummaryHTML =

            buildWaiverSummaryHTML(
                payload,
                result.confirmationNumber,
                waiverContent
            );

        showSuccessPage(
            result.confirmationNumber
        );

    }

    catch (error) {

        console.error(error);

        alert(
            "Unable to submit your waiver. Please try again."
        );

        submitButton.disabled = false;

        submitButton.textContent =
            "Submit Waiver";

    }

}

/* ==========================================================
   Google Cloud Function
========================================================== */

async function postToGoogleCloud(payload) {

    const headers = {

        "Content-Type":
            "application/json"

    };

    try {

        if (appCheck) {

            const appCheckTokenResult =
                await appCheck.getToken();

            headers["X-Firebase-AppCheck"] =
                appCheckTokenResult.token;

        }

    }

    catch (error) {

        // Fail open here — if App Check can't
        // load (network issue, blocked script),
        // let the request through without a token.
        // The Cloud Function's rollout mode decides
        // whether that's acceptable.
        console.warn(
            "Could not get App Check token:",
            error
        );

    }

    const response =

        await fetch(

            CONFIG.apiEndpoint,

            {

                method: "POST",

                headers,

                body:
                    JSON.stringify(payload)

            }

        );

    if (!response.ok) {

        const errorBody =

            await response
                .json()
                .catch(() => null);

        throw new Error(

            errorBody?.error ??
                `Server returned ${response.status}`

        );

    }

    return response.json();

}

/* ==========================================================
   Waiver Copy (Download / Print)

   Builds a standalone, self-contained HTML document
   reflecting exactly what this participant read and
   agreed to — captured from the live DOM at signing
   time, not reconstructed later from whatever text
   happens to be on the site. This keeps old signers'
   copies accurate even if the waiver text is revised
   afterward.
========================================================== */

function captureWaiverContent() {

    const sections = [];

    ui.pages.forEach(page => {

        const detailsBlocks =
            Array.from(
                page.querySelectorAll("details")
            );

        const legalTexts =

            detailsBlocks
                .map(details => ({

                    title:
                        details
                            .querySelector("summary")
                            ?.textContent.trim() ?? "",

                    text:
                        details
                            .querySelector(".legal-text")
                            ?.textContent.trim() ?? ""

                }))
                .filter(item => item.text);

        const checkboxLabels =

            Array.from(
                page.querySelectorAll(".checkbox-card span")
            )
                .map(span => span.textContent.trim())
                .filter(Boolean);

        if (legalTexts.length === 0 && checkboxLabels.length === 0) {
            return;
        }

        sections.push({

            title: page.dataset.title ?? "",

            legalTexts,

            checkboxLabels

        });

    });

    return sections;

}

function buildWaiverSummaryHTML(

    payload,
    confirmationNumber,
    sections

) {

    const submittedDate =

        new Date(payload.metadata.submittedAt);

    const formattedDate =

        submittedDate.toLocaleString("en-US", {
            dateStyle: "long",
            timeStyle: "short"
        });

    const sectionsHTML =

        sections.map(section => {

            const legalHTML =

                section.legalTexts
                    .map(item => `
                        <h3>${escapeHTML(item.title)}</h3>
                        <p class="legal-body">${escapeHTML(item.text)}</p>
                    `)
                    .join("");

            const checklistHTML =

                section.checkboxLabels.length
                    ? `<ul>${
                        section.checkboxLabels
                            .map(label => `<li>${escapeHTML(label)}</li>`)
                            .join("")
                    }</ul>`
                    : "";

            return `
                <section>
                    <h2>${escapeHTML(section.title)}</h2>
                    ${legalHTML}
                    ${checklistHTML}
                </section>
            `;

        }).join("");

    const emailRow =

        payload.participant.email
            ? `<div><strong>Email:</strong> ${escapeHTML(payload.participant.email)}</div>`
            : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Waiver ${escapeHTML(confirmationNumber)}</title>
<style>
    body {
        font-family: Arial, Helvetica, sans-serif;
        color: #111;
        max-width: 800px;
        margin: 2rem auto;
        padding: 0 1rem;
        line-height: 1.5;
    }
    h1 { font-size: 1.5rem; }
    h2 {
        font-size: 1.15rem;
        margin-top: 2rem;
        border-bottom: 1px solid #ccc;
        padding-bottom: .25rem;
    }
    h3 { font-size: 1rem; margin-top: 1rem; margin-bottom: .25rem; }
    .legal-body { white-space: pre-wrap; color: #333; }
    .meta {
        background: #f5f5f5;
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 1rem;
        margin-bottom: 1.5rem;
    }
    .meta div { margin-bottom: .35rem; }
    ul { margin: .5rem 0 .5rem 1.25rem; }
    footer { margin-top: 2rem; font-size: .85rem; color: #666; }
</style>
</head>
<body>
    <h1>Pink Pistols Denver — Event Waiver</h1>
    <div class="meta">
        <div><strong>Confirmation Number:</strong> ${escapeHTML(confirmationNumber)}</div>
        <div><strong>Waiver Version:</strong> ${escapeHTML(payload.version)}</div>
        <div><strong>Legal Name:</strong> ${escapeHTML(payload.participant.legalName)}</div>
        ${emailRow}
        <div><strong>Electronic Signature:</strong> ${escapeHTML(payload.participant.electronicSignature)}</div>
        <div><strong>Signed:</strong> ${escapeHTML(formattedDate)}</div>
    </div>
    ${sectionsHTML}
    <footer>
        This is a copy of the waiver you completed and
        electronically signed. Please retain it for your
        records.
    </footer>
</body>
</html>`;

}

function escapeHTML(value) {

    const div =
        document.createElement("div");

    div.textContent = value ?? "";

    return div.innerHTML;

}

function initializeWaiverDownload() {

    const downloadButton =
        document.getElementById(
            "download-waiver-button"
        );

    downloadButton.addEventListener(
        "click",
        () => {

            if (!lastWaiverSummaryHTML) {
                return;
            }

            const confirmationNumber =

                document
                    .getElementById(
                        "confirmation-number"
                    )
                    .textContent
                    .trim();

            const blob =

                new Blob(
                    [lastWaiverSummaryHTML],
                    { type: "text/html" }
                );

            const url =
                URL.createObjectURL(blob);

            const link =
                document.createElement("a");

            link.href = url;

            link.download =
                `waiver-${confirmationNumber}.html`;

            document.body.appendChild(link);

            link.click();

            document.body.removeChild(link);

            URL.revokeObjectURL(url);

        }

    );

}

/* ==========================================================
   Success Screen
========================================================== */

function showSuccessPage(
    confirmationNumber
) {

    ui.pages.forEach(page =>

        page.classList.remove("active")

    );

    ui.successPage.classList.add(
        "active"
    );

    ui.progressFill.style.width =
        "100%";

    ui.currentStep.textContent =
        ui.pages.length;

    ui.currentStepTitle.textContent =
        "Submitted";

    document
        .getElementById(
            "confirmation-number"
        )
        .textContent =
        confirmationNumber;

    window.scrollTo({

        top: 0,

        behavior:
            CONFIG.scrollBehavior

    });

}

/* ==========================================================
   Live Validation
========================================================== */

document.addEventListener(

    "change",

    event => {

        const field =
            event.target;

        const card =
            field.closest(
                ".checkbox-card"
            );

        if (card) {

            card.classList.remove(
                "validation-error"
            );

        }

    }

);

document.addEventListener(

    "input",

    event => {

        event.target.classList.remove(
            "validation-error"
        );

        if (

            event.target.name === "legalName" ||
            event.target.name === "electronicSignature"

        ) {

            const mismatchNote =
                document.getElementById(
                    "signature-mismatch"
                );

            if (mismatchNote) {

                mismatchNote.hidden = true;

            }

        }

    }

);

/* ==========================================================
   Future Enhancements
========================================================== */

/*

Roadmap

□ Instructor authentication

□ Event selection

□ Event capacity lookup

□ QR-code check-in

□ Firestore persistence

□ Signed PDF generation

□ Email confirmation

□ Instructor dashboard

□ Search by confirmation number

□ Waiver version history

□ Emergency contact information

□ Minor / guardian workflow

□ WCAG accessibility audit

□ Offline service-worker support

*/