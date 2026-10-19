const USER_DATA_BATCH_SIZE = 500;
const USER_DATA_BOOLEAN_KEYS = new Set([
  "lineViewAutoOpenEnabled",
  "showAllStops",
  "showPrivateOperators",
  "showProblematicGeometries",
  "colorblindMode"
]);
const USER_DATA_JSON_KEYS = new Set(["activeModeKeys", "activeFrequencyKeys", "manualLineVisibility"]);

function userDataEl(id) {
  return document.getElementById(id);
}

function setUserDataStatus(message, isError = false) {
  const el = userDataEl("userDataStatus");
  if (!el) {
    return;
  }
  el.textContent = message;
  el.classList.toggle("is-error", Boolean(isError));
}

function parseUserDataCsv(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\r" || char === "\n") {
      if (char === "\r" && source[index + 1] === "\n") {
        index += 1;
      }
      row.push(field);
      field = "";
      if (row.some((value) => value !== "")) {
        rows.push(row);
      }
      row = [];
      continue;
    }
    field += char;
  }

  row.push(field);
  if (row.some((value) => value !== "")) {
    rows.push(row);
  }
  return rows;
}

function parseUserDataSettingValue(key, raw) {
  const text = String(raw || "");
  if (USER_DATA_BOOLEAN_KEYS.has(key)) {
    return text.trim().toLowerCase() === "true";
  }
  if (USER_DATA_JSON_KEYS.has(key)) {
    try {
      return JSON.parse(text);
    } catch {
      return key === "manualLineVisibility" ? {} : [];
    }
  }
  if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function normalizeVisitedAt(value) {
  if (!value) {
    return "";
  }
  const text = String(value).trim();
  const minuteMatch = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/.exec(text);
  if (minuteMatch) {
    const parsed = new Date(`${minuteMatch[1]}T${minuteMatch[2]}:${minuteMatch[3] || "00"}Z`);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
  }
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric * 1000).toISOString();
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function parseUserDataFile(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const sourceLines = source.split(/\r?\n/);
  const comments = [];
  const tableLines = [];
  for (const line of sourceLines) {
    if (line.startsWith("#")) {
      comments.push(line.replace(/^#\s?/, "").trim());
    } else {
      tableLines.push(line);
    }
  }

  const rows = parseUserDataCsv(tableLines.join("\n"));
  if (!rows.length) {
    throw new Error("The CSV file is empty.");
  }
  const header = rows.shift().map((value) => String(value || "").trim().toLowerCase());
  const indexByKey = {};
  header.forEach((key, index) => {
    if (key) {
      indexByKey[key] = index;
    }
  });

  const hasRecordType = indexByKey.record_type !== undefined;
  const hasReadableHeader = indexByKey["line key"] !== undefined && indexByKey["station key"] !== undefined;
  if (!hasRecordType && !hasReadableHeader) {
    throw new Error("This does not look like a MetroMark CSV. Missing line/station columns.");
  }

  const cell = (row, key) => {
    const index = indexByKey[key];
    return index === undefined ? "" : String(row[index] ?? "").trim();
  };

  const visitsByKey = new Map();
  const settings = {};
  let format = "";
  let skipped = 0;

  for (const comment of comments) {
    if (/^MetroMark user data/i.test(comment)) {
      format = comment;
    }
    const settingMatch = /^Setting:\s*(.+?)\s*=\s*(.*)$/i.exec(comment);
    if (settingMatch) {
      const key = settingMatch[1].trim();
      settings[key] = parseUserDataSettingValue(key, settingMatch[2]);
    }
  }

  for (const row of rows) {
    const recordType = hasRecordType ? cell(row, "record_type").toLowerCase() : "visit";
    if (recordType === "meta") {
      if (cell(row, "key") === "format") {
        format = cell(row, "value");
      }
      continue;
    }
    if (recordType === "setting") {
      const key = cell(row, "key");
      if (!key) {
        skipped += 1;
        continue;
      }
      settings[key] = parseUserDataSettingValue(key, cell(row, "value"));
      continue;
    }
    if (recordType !== "visit" && recordType !== "progress") {
      skipped += 1;
      continue;
    }

    const lineKey = hasRecordType ? cell(row, "line_key") : cell(row, "line key");
    const stationKey = hasRecordType ? cell(row, "station_key") : cell(row, "station key");
    const stationName = (hasRecordType ? cell(row, "station_name") : cell(row, "station")) || "Unnamed Stop";
    const lat = Number(hasRecordType ? cell(row, "lat") : cell(row, "latitude"));
    const lon = Number(hasRecordType ? cell(row, "lon") : cell(row, "longitude"));
    const visitedAt = hasRecordType ? cell(row, "visited_at") : cell(row, "visited at (utc)");
    if (
      !lineKey ||
      !stationKey ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      skipped += 1;
      continue;
    }
    visitsByKey.set(`${lineKey}\u0000${stationKey}`, {
      lineKey,
      stationKey,
      stationName,
      lat,
      lon,
      visitedAt: normalizeVisitedAt(visitedAt)
    });
  }

  if (format && !/metromark-user-data|MetroMark user data/i.test(format)) {
    throw new Error("This CSV is not a MetroMark user-data export.");
  }

  return {
    visits: Array.from(visitsByKey.values()),
    settings,
    skipped
  };
}

async function exportUserData() {
  if (!appState.token) {
    setUserDataStatus("Sign in to export your data.", true);
    return;
  }
  const exportBtn = userDataEl("exportUserDataBtn");
  const importBtn = userDataEl("importUserDataBtn");
  if (exportBtn) exportBtn.disabled = true;
  if (importBtn) importBtn.disabled = true;
  setUserDataStatus("Preparing CSV…");
  try {
    const response = await fetch(`/api/progress/export?_=${Date.now()}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${appState.token}` }
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Export failed (${response.status}).`);
    }
    const disposition = response.headers.get("Content-Disposition") || "";
    const nameMatch = /filename="([^"]+)"/i.exec(disposition);
    const filename = nameMatch
      ? nameMatch[1]
      : `metromark-user-data-${new Date().toISOString().slice(0, 10)}.csv`;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setUserDataStatus("CSV export downloaded.");
  } catch (error) {
    setUserDataStatus(error.message, true);
  } finally {
    if (exportBtn) exportBtn.disabled = false;
    if (importBtn) importBtn.disabled = false;
  }
}

async function importUserData(file) {
  if (!appState.token) {
    setUserDataStatus("Sign in to import data.", true);
    return;
  }
  if (!file) {
    return;
  }
  const exportBtn = userDataEl("exportUserDataBtn");
  const importBtn = userDataEl("importUserDataBtn");
  if (exportBtn) exportBtn.disabled = true;
  if (importBtn) importBtn.disabled = true;
  setUserDataStatus("Reading CSV…");

  try {
    const text = await file.text();
    const parsed = parseUserDataFile(text);
    const settingCount = Object.keys(parsed.settings).length;
    const visitLabel = `${parsed.visits.length} visited station${parsed.visits.length === 1 ? "" : "s"}`;
    const settingLabel = `${settingCount} setting${settingCount === 1 ? "" : "s"}`;
    if (!parsed.visits.length && !settingCount) {
      throw new Error("The CSV contains no visits or settings.");
    }
    const confirmed = window.confirm(
      `Import ${visitLabel}${settingCount ? ` and ${settingLabel}` : ""}? ` +
      "Existing visits are kept; matching visits are updated."
    );
    if (!confirmed) {
      setUserDataStatus("Import cancelled.");
      return;
    }

    let imported = 0;
    let skipped = parsed.skipped;
    for (let index = 0; index < parsed.visits.length; index += USER_DATA_BATCH_SIZE) {
      const batch = parsed.visits.slice(index, index + USER_DATA_BATCH_SIZE);
      setUserDataStatus(`Importing visits ${Math.min(index + batch.length, parsed.visits.length)} of ${parsed.visits.length}…`);
      const result = await apiRequest("/api/progress/import", {
        method: "POST",
        body: { visits: batch }
      });
      imported += Number(result.imported || 0);
      skipped += Number(result.skipped || 0);
    }

    if (settingCount) {
      setUserDataStatus("Applying settings…");
      if (typeof saveUserPreferences === "function") {
        await saveUserPreferences(parsed.settings);
      }
    }

    await loadProgress({ forceRefresh: true });
    if (typeof renderLineView === "function") {
      renderLineView({ forceStopRefresh: true });
    }
    if (typeof renderProgress === "function") {
      renderProgress();
    }

    const skippedText = skipped ? ` ${skipped} row${skipped === 1 ? "" : "s"} skipped.` : "";
    setUserDataStatus(`Imported ${imported} visit${imported === 1 ? "" : "s"}${settingCount ? ` and ${settingLabel}` : ""}.${skippedText}`);
  } catch (error) {
    setUserDataStatus(error.message, true);
  } finally {
    if (exportBtn) exportBtn.disabled = false;
    if (importBtn) importBtn.disabled = false;
  }
}

function initUserDataTransfer() {
  const exportBtn = userDataEl("exportUserDataBtn");
  const importBtn = userDataEl("importUserDataBtn");
  const importInput = userDataEl("importUserDataInput");
  if (!exportBtn || !importBtn || !importInput) {
    return;
  }
  exportBtn.addEventListener("click", () => {
    exportUserData().catch(() => {});
  });
  importBtn.addEventListener("click", () => {
    importInput.click();
  });
  importInput.addEventListener("change", () => {
    const file = importInput.files && importInput.files[0];
    importUserData(file)
      .catch(() => {})
      .finally(() => {
        importInput.value = "";
      });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initUserDataTransfer);
} else {
  initUserDataTransfer();
}
