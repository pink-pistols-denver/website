"use strict";

/* ==========================================================
   One-time backfill: adds legalNameLower to any existing
   waiver documents that predate this feature. New waivers
   already get this field at submission time (see
   waiver-backend/index.js) — this script only needs to run
   once, against whatever waivers already existed before that
   change deployed.

   Safe to re-run: skips documents that already have the
   field, so running it twice does nothing extra.
========================================================== */

const { Firestore } = require("@google-cloud/firestore");

const firestore = new Firestore({
    projectId: "pinkpistolsdenver-website"
});

async function backfill() {

    const snapshot = await firestore.collection("waivers").get();

    let updated = 0;
    let skipped = 0;

    for (const doc of snapshot.docs) {

        const data = doc.data();

        if (typeof data.legalNameLower === "string") {
            skipped++;
            continue;
        }

        const legalNameLower = (data.participant?.legalName ?? "").toLowerCase();

        await doc.ref.update({ legalNameLower });
        updated++;

        console.log(`Updated ${doc.id} (${data.participant?.legalName ?? "unknown name"})`);

    }

    console.log(`\nDone. Updated: ${updated}. Already had the field, skipped: ${skipped}.`);

}

backfill().catch(error => {
    console.error("Backfill failed:", error);
    process.exit(1);
});
