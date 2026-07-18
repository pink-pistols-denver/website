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

        const result =
            await postToGoogleCloud(payload);

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