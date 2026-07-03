#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const config = require("./config");
const db = require("../processors/data");
const { query: localQuery } = require("../processors/postgres");
const { requireSupabaseClients } = require("../processors/supabase");

function timestampForFile() {
  const date = new Date();
  const y = String(date.getUTCFullYear());
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}${m}${d}-${hh}${mm}${ss}`;
}

function ensureOutputDir() {
  const configured = String(config.BACKUP_OUTPUT_DIR || "data/backups").trim() || "data/backups";
  const outputDir = path.isAbsolute(configured)
    ? configured
    : path.resolve(process.cwd(), configured);

  fs.mkdirSync(outputDir, { recursive: true });
  return outputDir;
}

async function listAllAuthUsers() {
  const { serviceClient } = requireSupabaseClients();
  const users = [];

  let page = 1;
  while (page <= 20) {
    const result = await serviceClient.auth.admin.listUsers({
      page,
      perPage: 1000
    });

    if (result.error) {
      throw new Error(`Unable to list auth users: ${result.error.message}`);
    }

    const pageUsers = Array.isArray(result.data?.users) ? result.data.users : [];
    users.push(...pageUsers);

    if (pageUsers.length < 1000) {
      break;
    }

    page += 1;
  }

  return users.map((entry) => ({
    id: entry.id,
    email: entry.email || "",
    emailConfirmedAt: entry.email_confirmed_at || null,
    createdAt: entry.created_at || null,
    lastSignInAt: entry.last_sign_in_at || null,
    appMetadata: entry.app_metadata || {},
    userMetadata: entry.user_metadata || {}
  }));
}

async function readTable(tableName, columns) {
  const { serviceClient } = requireSupabaseClients();
  const result = await serviceClient.from(tableName).select(columns).limit(50000);
  if (result.error) {
    throw new Error(`Unable to read ${tableName}: ${result.error.message}`);
  }
  return result.data || [];
}

async function readLocalTable(tableName, columns) {
  const result = await localQuery(`select ${columns} from public.${tableName} limit 50000`);
  return result.rows || [];
}

async function buildSnapshot(triggerSource = "script") {
  const users = await listAllAuthUsers();
  const profiles = await readTable(
    "profiles",
    "id,email,display_name,role,is_active,last_login_at,created_at"
  );
  const filterPresets = await readTable(
    "user_filter_presets",
    "id,user_id,name,city_slug,snapshot,created_at,updated_at"
  );
  const userStationVisits = await readTable(
    "user_station_visit",
    "user_id,line_key,station_key,station_name,lat,lon,visited,updated_at"
  );
  const stationOverrides = await readLocalTable(
    "station_override",
    "stable_key,manual_name,manual_lat,manual_lon,note,updated_at"
  );

  return {
    createdAtIso: new Date().toISOString(),
    schemaVersion: 2,
    triggerSource,
    storageBackend: "hybrid-supabase-local-postgres",
    nonrecoverable: {
      authUsers: users,
      profiles,
      filterPresets,
      userStationVisits,
      stationOverrides
    }
  };
}

async function runNonrecoverableBackup(options = {}) {
  await db.initializeStorage();

  const outputDir = ensureOutputDir();
  const stamp = timestampForFile();
  const fileName = `nonrecoverable-backup-${stamp}.json`;
  const filePath = path.join(outputDir, fileName);
  const latestPath = path.join(outputDir, "nonrecoverable-backup-latest.json");

  const snapshot = await buildSnapshot(String(options.triggerSource || "script"));
  const json = `${JSON.stringify(snapshot, null, 2)}\n`;

  fs.writeFileSync(filePath, json, "utf8");
  fs.writeFileSync(latestPath, json, "utf8");

  console.log("Backup written:");
  console.log(`- ${filePath}`);
  console.log(`- ${latestPath}`);
  console.log("Row counts:");
  console.log(`- authUsers: ${snapshot.nonrecoverable.authUsers.length}`);
  console.log(`- profiles: ${snapshot.nonrecoverable.profiles.length}`);
  console.log(`- filterPresets: ${snapshot.nonrecoverable.filterPresets.length}`);
  console.log(`- userStationVisits: ${snapshot.nonrecoverable.userStationVisits.length}`);
  console.log(`- stationOverrides: ${snapshot.nonrecoverable.stationOverrides.length}`);

  return {
    filePath,
    latestPath,
    counts: {
      authUsers: snapshot.nonrecoverable.authUsers.length,
      profiles: snapshot.nonrecoverable.profiles.length,
      filterPresets: snapshot.nonrecoverable.filterPresets.length,
      userStationVisits: snapshot.nonrecoverable.userStationVisits.length,
      stationOverrides: snapshot.nonrecoverable.stationOverrides.length
    }
  };
}

module.exports = {
  runNonrecoverableBackup
};

if (require.main === module) {
  runNonrecoverableBackup()
    .then(() => {})
    .catch((error) => {
      console.error("[backup-nonrecoverable] Unhandled error", error);
      process.exitCode = 1;
    });
}
