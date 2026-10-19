#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const config = require("./config");
const { query: localQuery, initializeLocalPostgres } = require("../processors/postgres");
const { requireSupabaseClients } = require("../processors/supabase");
const { createLogger } = require("./logger");

const log = createLogger("restore");

const LOCAL_TABLES = [
  {
    table: "city_preset",
    columns: [
      "slug",
      "name",
      "country",
      "center_lon",
      "center_lat",
      "bbox",
      "default_zoom",
      "published",
      "notes",
      "sort_order",
      "updated_at"
    ],
    conflict: ["slug"],
    jsonColumns: ["bbox"]
  },
  {
    table: "city_preset_route",
    columns: [
      "city_slug",
      "line_key",
      "included",
      "vetted_accuracy",
      "vetted_up_to_date",
      "vetted_stop_order",
      "vetted_at",
      "vetted_by",
      "sort_order",
      "updated_at"
    ],
    conflict: ["city_slug", "line_key"]
  },
  {
    table: "city_preset_operator",
    columns: ["city_slug", "operator_name", "included", "sort_order", "updated_at"],
    conflict: ["city_slug", "operator_name"]
  },
  {
    table: "station_override",
    columns: ["stable_key", "manual_name", "manual_lat", "manual_lon", "note", "updated_at"],
    conflict: ["stable_key"]
  },
  {
    table: "route_override",
    columns: ["line_key", "city_slug", "payload", "updated_at"],
    conflict: ["line_key"],
    jsonColumns: ["payload"]
  },
  {
    table: "route_review",
    columns: ["line_key", "city_slug", "problematic_override", "updated_at"],
    conflict: ["line_key"]
  },
  {
    table: "agency_review",
    columns: ["city_slug", "operator_name", "allowed_override", "updated_at"],
    conflict: ["city_slug", "operator_name"]
  },
  {
    table: "route_ordering_vote",
    columns: ["line_key", "user_id", "city_slug", "ordering_mode", "vote_source", "updated_at"],
    conflict: ["line_key", "user_id"]
  },
  {
    table: "issue_report",
    columns: [
      "id",
      "bbox",
      "zoom",
      "center",
      "screenshot",
      "description",
      "reporter_name",
      "reporter_email",
      "status",
      "created_at",
      "resolved_at"
    ],
    conflict: ["id"],
    jsonColumns: ["bbox", "center"]
  },
  {
    table: "reharvest_flag",
    columns: ["id", "kind", "line_key", "station_key", "message", "status", "created_at", "resolved_at"],
    conflict: ["id"]
  },
  {
    table: "route_suggestion",
    columns: [
      "id",
      "line_key",
      "city_slug",
      "payload",
      "note",
      "status",
      "reporter_name",
      "reporter_email",
      "created_at",
      "resolved_at",
      "resolved_by"
    ],
    conflict: ["id"],
    jsonColumns: ["payload"]
  }
];

const LOCAL_BACKUP_KEYS = {
  city_preset: "cityPresets",
  city_preset_route: "cityPresetRoutes",
  city_preset_operator: "cityPresetOperators",
  station_override: "stationOverrides",
  route_override: "routeOverrides",
  route_review: "routeReviews",
  agency_review: "agencyReviews",
  route_ordering_vote: "routeOrderingVotes",
  issue_report: "issueReports",
  reharvest_flag: "reharvestFlags",
  route_suggestion: "routeSuggestions"
};

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function backupPath() {
  const explicit = argValue("--file");
  if (explicit) {
    return path.resolve(explicit);
  }
  const dir = String(config.BACKUP_OUTPUT_DIR || "data/backups").trim() || "data/backups";
  return path.resolve(dir, "nonrecoverable-backup-latest.json");
}

function readBackup(filePath) {
  const snapshot = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!snapshot?.nonrecoverable || typeof snapshot.nonrecoverable !== "object") {
    throw new Error("This is not a MetroMark nonrecoverable backup.");
  }
  return snapshot;
}

async function restoreLocalTable(spec, rows) {
  if (!rows.length) {
    return 0;
  }
  const jsonColumns = new Set(spec.jsonColumns || []);
  const updates = spec.columns
    .filter((column) => !spec.conflict.includes(column))
    .map((column) => `${column} = excluded.${column}`)
    .join(", ");
  let restored = 0;
  for (const row of rows) {
    const values = spec.columns.map((column) => {
      if (column === "updated_at" && !row[column]) {
        return new Date().toISOString();
      }
      if (jsonColumns.has(column)) {
        return row[column] === undefined || row[column] === null ? null : JSON.stringify(row[column]);
      }
      return row[column] === undefined ? null : row[column];
    });
    const placeholders = spec.columns.map((column, index) =>
      jsonColumns.has(column) ? `$${index + 1}::jsonb` : `$${index + 1}`
    );
    await localQuery(
      `insert into public.${spec.table} (${spec.columns.join(", ")})
       values (${placeholders.join(", ")})
       on conflict (${spec.conflict.join(", ")}) do update set ${updates}`,
      values
    );
    restored += 1;
  }
  return restored;
}

async function restoreSequences() {
  await localQuery(
    `select setval(
       pg_get_serial_sequence('public.issue_report', 'id'),
       greatest(coalesce((select max(id) from public.issue_report), 0) + 1, 1),
       false
     )`
  );
  await localQuery(
    `select setval(
       pg_get_serial_sequence('public.reharvest_flag', 'id'),
       greatest(coalesce((select max(id) from public.reharvest_flag), 0) + 1, 1),
       false
     )`
  );
  await localQuery(
    `select setval(
       pg_get_serial_sequence('public.route_suggestion', 'id'),
       greatest(coalesce((select max(id) from public.route_suggestion), 0) + 1, 1),
       false
     )`
  );
}

async function restoreAuthUsers(users, dryRun) {
  const { serviceClient } = requireSupabaseClients();
  let restored = 0;
  let skipped = 0;
  for (const user of users) {
    if (!user?.id || !user?.email) {
      skipped += 1;
      continue;
    }
    const existing = await serviceClient.auth.admin.getUserById(user.id);
    if (existing?.data?.user) {
      skipped += 1;
      continue;
    }
    if (dryRun) {
      restored += 1;
      continue;
    }
    const result = await serviceClient.auth.admin.createUser({
      id: user.id,
      email: user.email,
      email_confirm: Boolean(user.emailConfirmedAt),
      user_metadata: user.userMetadata || {},
      app_metadata: user.appMetadata || {}
    });
    if (result.error) {
      log.warn(`Could not restore auth user ${user.email}: ${result.error.message}`);
      skipped += 1;
    } else {
      restored += 1;
    }
  }
  return { restored, skipped };
}

async function restoreSupabaseTable(table, rows, conflict, dryRun) {
  if (!rows.length || dryRun) {
    return rows.length;
  }
  const { serviceClient } = requireSupabaseClients();
  const { error } = await serviceClient.from(table).upsert(rows, { onConflict: conflict });
  if (error) {
    throw new Error(`Unable to restore ${table}: ${error.message}`);
  }
  return rows.length;
}

async function restoreBackup() {
  const filePath = backupPath();
  const dryRun = process.argv.includes("--dry-run");
  const snapshot = readBackup(filePath);
  const data = snapshot.nonrecoverable;
  log.info(`${dryRun ? "Dry run: " : ""}restoring ${filePath}`);
  log.info(`Backup created at ${snapshot.createdAtIso || "unknown"}; schema ${snapshot.schemaVersion || "unknown"}.`);

  await initializeLocalPostgres();

  const auth = await restoreAuthUsers(data.authUsers || [], dryRun);
  log.info(`Auth users: ${auth.restored} restored, ${auth.skipped} kept/skipped.`);

  const profiles = await restoreSupabaseTable("profiles", data.profiles || [], "id", dryRun);
  const presets = await restoreSupabaseTable(
    "user_filter_presets",
    data.filterPresets || [],
    "user_id,city_slug,name",
    dryRun
  );
  const visits = await restoreSupabaseTable(
    "user_station_visit",
    data.userStationVisits || [],
    "user_id,line_key,station_key",
    dryRun
  );

  const localCounts = {};
  for (const spec of LOCAL_TABLES) {
    const rows = data[LOCAL_BACKUP_KEYS[spec.table]] || [];
    localCounts[spec.table] = dryRun ? rows.length : await restoreLocalTable(spec, rows);
  }
  if (!dryRun) {
    await restoreSequences();
  }

  log.info(`Supabase rows: ${JSON.stringify({ profiles, presets, visits })}`);
  log.info(`Local rows: ${JSON.stringify(localCounts)}`);
  if (!dryRun) {
    log.warn("Auth passwords are not in this backup. Restored users must use password reset, or existing auth users keep their current passwords.");
  }
}

restoreBackup().catch((error) => {
  log.error("Restore failed:", error);
  process.exitCode = 1;
});
