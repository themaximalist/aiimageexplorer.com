#!/usr/bin/env node

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Sequelize, QueryTypes } = require("sequelize");

const execute = process.argv.includes("--execute");
const assetDir = process.env.ASSET_DIR || "public";

async function main() {
    const sequelize = new Sequelize(process.env.DATABASE_URI, { logging: false });

    try {
        await sequelize.authenticate();
        console.log("Connected to database.\n");
    } catch (err) {
        console.error("Failed to connect to database:", err.message);
        process.exit(2);
    }

    // --- Find orphaned Concepts (QueryId references a deleted Query) ---
    const orphanedConcepts = await sequelize.query(
        `SELECT c.id, c."QueryId", c.prompt, c.style
         FROM "Concepts" c
         LEFT JOIN "Queries" q ON c."QueryId" = q.id
         WHERE q.id IS NULL`,
        { type: QueryTypes.SELECT }
    );

    // --- Find orphaned Results ---
    // A Result is orphaned if its ConceptId or QueryId no longer exists.
    // Using OR to catch both direct and transitive orphans.
    const orphanedResults = await sequelize.query(
        `SELECT r.id, r."ConceptId", r."QueryId", r.image_url, r.thumbnail_url
         FROM "Results" r
         LEFT JOIN "Concepts" c ON r."ConceptId" = c.id
         LEFT JOIN "Queries" q ON r."QueryId" = q.id
         WHERE c.id IS NULL OR q.id IS NULL`,
        { type: QueryTypes.SELECT }
    );

    // --- Collect image files to delete ---
    const filesToDelete = new Set();
    for (const result of orphanedResults) {
        for (const urlField of [result.image_url, result.thumbnail_url]) {
            if (!urlField) continue;
            const abs = path.resolve(assetDir, urlField.replace(/^\//, ""));
            filesToDelete.add(abs);
        }
    }

    // --- Report ---
    console.log(`Orphaned Concepts: ${orphanedConcepts.length}`);
    if (orphanedConcepts.length > 0) {
        for (const c of orphanedConcepts) {
            console.log(`  [Concept ${c.id}] QueryId=${c.QueryId}  prompt="${c.prompt.slice(0, 80)}"`);
        }
    }

    console.log(`\nOrphaned Results:  ${orphanedResults.length}`);
    if (orphanedResults.length > 0) {
        for (const r of orphanedResults) {
            console.log(`  [Result ${r.id}] ConceptId=${r.ConceptId}  QueryId=${r.QueryId}`);
            console.log(`    image:     ${r.image_url}`);
            console.log(`    thumbnail: ${r.thumbnail_url}`);
        }
    }

    console.log(`\nImage files to delete: ${filesToDelete.size}`);
    let existCount = 0;
    let missingCount = 0;
    for (const f of filesToDelete) {
        const exists = fs.existsSync(f);
        if (exists) existCount++;
        else missingCount++;
        console.log(`  ${exists ? "EXISTS " : "MISSING"} ${f}`);
    }
    if (filesToDelete.size > 0) {
        console.log(`  (${existCount} exist on disk, ${missingCount} already missing)`);
    }

    const totalOrphans = orphanedConcepts.length + orphanedResults.length;

    if (totalOrphans === 0 && filesToDelete.size === 0) {
        console.log("\nNo orphans found. Database is clean.");
        await sequelize.close();
        process.exit(0);
    }

    if (!execute) {
        console.log("\n--- DRY RUN --- No changes made.");
        console.log("Re-run with --execute to delete orphaned records and files.");
        await sequelize.close();
        process.exit(1);
    }

    // --- Execute deletions ---
    console.log("\n--- EXECUTING CLEANUP ---\n");

    const transaction = await sequelize.transaction();
    try {
        if (orphanedResults.length > 0) {
            const resultIds = orphanedResults.map(r => r.id);
            const [, deletedResults] = await sequelize.query(
                `DELETE FROM "Results" WHERE id IN (:ids)`,
                { replacements: { ids: resultIds }, type: QueryTypes.DELETE, transaction }
            );
            console.log(`Deleted ${deletedResults ?? resultIds.length} orphaned Results.`);
        }

        if (orphanedConcepts.length > 0) {
            const conceptIds = orphanedConcepts.map(c => c.id);
            const [, deletedConcepts] = await sequelize.query(
                `DELETE FROM "Concepts" WHERE id IN (:ids)`,
                { replacements: { ids: conceptIds }, type: QueryTypes.DELETE, transaction }
            );
            console.log(`Deleted ${deletedConcepts ?? conceptIds.length} orphaned Concepts.`);
        }

        await transaction.commit();
        console.log("Database cleanup committed.\n");
    } catch (err) {
        await transaction.rollback();
        console.error("Database cleanup failed, rolled back:", err.message);
        await sequelize.close();
        process.exit(2);
    }

    let filesDeleted = 0;
    let filesSkipped = 0;
    for (const f of filesToDelete) {
        try {
            if (fs.existsSync(f)) {
                fs.unlinkSync(f);
                filesDeleted++;
                console.log(`  Deleted: ${f}`);
            } else {
                filesSkipped++;
                console.log(`  Skipped (not found): ${f}`);
            }
        } catch (err) {
            console.error(`  Error deleting ${f}: ${err.message}`);
        }
    }
    console.log(`\nFiles deleted: ${filesDeleted}, skipped: ${filesSkipped}`);

    console.log("\nCleanup complete.");
    await sequelize.close();
    process.exit(0);
}

main().catch(err => {
    console.error("Unexpected error:", err);
    process.exit(2);
});
