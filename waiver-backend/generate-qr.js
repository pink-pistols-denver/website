"use strict";

const QRCode = require("qrcode");
const path = require("path");

/* ==========================================================
   This is a one-time generator, not something the deployed
   Cloud Function needs — it's a devDependency, and this file
   (along with its output) stays excluded from what actually
   gets deployed (see .gcloudignore in this folder).

   The waiver URL is fixed and entirely under our own control
   (our own domain, our own path), so there's no need for a
   URL shortener or third-party QR service that could change
   pricing/limits later — generate this once, done. Re-run
   this only if the waiver's actual URL changes.

   Output is deliberately written here in waiver-backend/, not
   into assets/ — assets/ is published to the live site by the
   GitHub Actions deploy, and this QR code is for printing on
   physical materials, not for display on the website itself.
   waiver-backend/ is already excluded from that deploy
   allowlist entirely, so nothing further is needed to keep
   this out of the public site.
========================================================== */

const WAIVER_URL = "https://pinkpistolsdenver.org/waiver";

const OUTPUT_PATH = path.join(__dirname, "waiver-qr.svg");

async function generate() {

    await QRCode.toFile(OUTPUT_PATH, WAIVER_URL, {

        type: "svg",
        width: 1024,
        margin: 2,
        errorCorrectionLevel: "M",

        // Plain black-on-white, deliberately not brand pink —
        // QR modules need strong contrast to scan reliably
        // across varied lighting and print quality (a cheap
        // printer or dim event lighting can turn a marginal-
        // contrast code unscannable). Put branding in a
        // border/frame around the code instead, not in the
        // modules themselves, if a branded look is wanted.
        color: {
            dark: "#000000",
            light: "#FFFFFF"
        }

    });

    console.log(`QR code for ${WAIVER_URL}`);
    console.log(`written to ${OUTPUT_PATH}`);
    console.log("");
    console.log("Test-scan this with an actual phone before using it on any");
    console.log("printed material — this script was written without the");
    console.log("ability to verify a real scan.");

}

generate().catch(error => {

    console.error("Failed to generate QR code:", error);
    process.exit(1);

});
