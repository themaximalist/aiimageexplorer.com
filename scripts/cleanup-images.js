#!/usr/bin/env node

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Sequelize, QueryTypes } = require("sequelize");

const execute = process.argv.includes("--execute");
const assetDir = process.env.ASSET_DIR || "public";
const imagesDir = path.resolve(assetDir, "images");

async function main() {
    if (!fs.existsSync(imagesDir)) {
        console.error(`Images directory not found: ${imagesDir}`);
        process.exit(2);
    }

    const sequelize = new Sequelize(process.env.DATABASE_URI, { logging: false });

    try {
        await sequelize.authenticate();
        console.log("Connected to database.");
    } catch (err) {
        console.error("Failed to connect to database:", err.message);
        process.exit(2);
    }

    // Build a set of all image URLs referenced by Results
    const rows = await sequelize.query(
        `SELECT image_url, thumbnail_url FROM "Results"`,
        { type: QueryTypes.SELECT }
    );

    const referencedUrls = new Set();
    for (const row of rows) {
        if (row.image_url) referencedUrls.add(row.image_url);
        if (row.thumbnail_url) referencedUrls.add(row.thumbnail_url);
    }

    // List all files on disk
    const allFiles = fs.readdirSync(imagesDir).filter(f => {
        const full = path.join(imagesDir, f);
        return fs.statSync(full).isFile();
    });

    // Check each file against the DB
    const orphanedFiles = [];
    const referencedFiles = [];

    for (const filename of allFiles) {
        const url = `/images/${filename}`;
        if (referencedUrls.has(url)) {
            referencedFiles.push(filename);
        } else {
            orphanedFiles.push(filename);
        }
    }

    // Report
    console.log(`\nFiles on disk:         ${allFiles.length}`);
    console.log(`Referenced by Results: ${referencedFiles.length}`);
    console.log(`Orphaned (no Result):  ${orphanedFiles.length}`);

    if (orphanedFiles.length === 0) {
        console.log("\nNo orphaned images found. Filesystem is clean.");
        await sequelize.close();
        process.exit(0);
    }

    // Calculate total size of orphaned files
    let totalBytes = 0;
    for (const filename of orphanedFiles) {
        const full = path.join(imagesDir, filename);
        totalBytes += fs.statSync(full).size;
    }
    const mb = (totalBytes / 1024 / 1024).toFixed(2);
    console.log(`Orphaned disk usage:   ${mb} MB`);

    console.log(`\nOrphaned files:`);
    for (const filename of orphanedFiles) {
        const full = path.join(imagesDir, filename);
        const size = (fs.statSync(full).size / 1024).toFixed(1);
        console.log(`  ${size} KB  ${filename}`);
    }

    if (!execute) {
        console.log("\n--- DRY RUN --- No files deleted.");
        console.log("Re-run with --execute to delete orphaned images.");
        await sequelize.close();
        process.exit(1);
    }

    // Execute deletions
    console.log("\n--- EXECUTING CLEANUP ---\n");

    let deleted = 0;
    let errors = 0;
    for (const filename of orphanedFiles) {
        const full = path.join(imagesDir, filename);
        try {
            fs.unlinkSync(full);
            deleted++;
        } catch (err) {
            console.error(`  Error deleting ${filename}: ${err.message}`);
            errors++;
        }
    }

    console.log(`Deleted ${deleted} orphaned images.`);
    if (errors > 0) console.log(`Failed to delete ${errors} files.`);

    console.log("\nCleanup complete.");
    await sequelize.close();
    process.exit(0);
}

main().catch(err => {
    console.error("Unexpected error:", err);
    process.exit(2);
});
