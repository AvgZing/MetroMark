const STORAGE_KEY = "metromark_admin_key";
const OVERRIDE_STORAGE_KEY = "metromark_admin_override_key";

const els = {
  adminKeyInput: document.getElementById("adminKeyInput"),
  overrideKeyInput: document.getElementById("overrideKeyInput"),
  saveKeyBtn: document.getElementById("saveKeyBtn"),
  refreshAllBtn: document.getElementById("refreshAllBtn"),
  statusMessage: document.getElementById("statusMessage"),
  usageStats: document.getElementById("usageStats"),
  harvestStats: document.getElementById("harvestStats"),
  storageStats: document.getElementById("storageStats"),
  runHarvestBtn: document.getElementById("runHarvestBtn"),
  runBackupBtn: document.getElementById("runBackupBtn"),
  queueCitySelect: document.getElementById("queueCitySelect"),
  queueCityBtn: document.getElementById("queueCityBtn"),
  overrideStationKey: document.getElementById("overrideStationKey"),
  overrideManualName: document.getElementById("overrideManualName"),
  overrideManualLat: document.getElementById("overrideManualLat"),
  overrideManualLon: document.getElementById("overrideManualLon"),
  overrideNote: document.getElementById("overrideNote"),
  applyOverrideBtn: document.getElementById("applyOverrideBtn"),
  queueBody: document.getElementById("queueBody"),
  actionLog: document.getElementById("actionLog")
};

const state = {
  adminKey: localStorage.getItem(STORAGE_KEY) || "",
  overrideKey: localStorage.getItem(OVERRIDE_STORAGE_KEY) || "",
  refreshTimer: null
};

function appendLog(message, payload = null) {
  const prefix = `[${new Date().toISOString()}] ${message}`;
  const next = payload ? `${prefix}\n${JSON.stringify(payload, null, 2)}` : prefix;
  const current = String(els.actionLog.textContent || "").trim();
  const output = current ? `${next}\n\n${current}` : next;
  els.actionLog.textContent = output.slice(0, 40000);
}

function setStatus(text, isError = false) {
  els.statusMessage.textContent = text;
  els.statusMessage.style.color = isError ? "#a22828" : "#5a5a5a";
}

async function apiRequest(path, options = {}) {
  const requestKey = String(options.adminKey || state.adminKey || "").trim();
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": requestKey,
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error || `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

function renderKv(container, rows) {
  container.innerHTML = "";
  for (const row of rows) {
    const wrap = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = row.label;
    dd.textContent = row.value;
    wrap.appendChild(dt);
    wrap.appendChild(dd);
    container.appendChild(wrap);
  }
}

function renderQueue(rows) {
  els.queueBody.innerHTML = "";

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "No pending city harvests.";
    tr.appendChild(td);
    els.queueBody.appendChild(tr);
    return;
  }

  rows.forEach((entry) => {
    const tr = document.createElement("tr");
    const cells = [
      entry.cityName || entry.citySlug,
      entry.harvestStatus || "",
      entry.pendingRefresh ? "yes" : "no",
      String(entry.harvestPriority || ""),
      entry.updatedAt ? new Date(entry.updatedAt * 1000).toLocaleString() : "",
      entry.lastError || ""
    ];

    cells.forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    });

    els.queueBody.appendChild(tr);
  });
}

function renderCityOptions(cities) {
  const cityRows = Array.isArray(cities) ? cities : [];
  els.queueCitySelect.innerHTML = "";

  cityRows.forEach((city) => {
    const option = document.createElement("option");
    option.value = city.slug;
    option.textContent = `${city.name} (${city.slug})`;
    els.queueCitySelect.appendChild(option);
  });
}

async function refreshStats() {
  const payload = await apiRequest("/api/admin/stats", { method: "GET" });

  renderKv(els.usageStats, [
    { label: "UTC Day", value: payload.usage.dayKey },
    { label: "REST", value: `${payload.usage.rest.calls}/${payload.usage.rest.limit} (${payload.usage.rest.burnRatePct}%)` },
    {
      label: "Vector",
      value: `${payload.usage.vector.calls}/${payload.usage.vector.limit} (${payload.usage.vector.burnRatePct}%)`
    },
    {
      label: "Routing",
      value: `${payload.usage.routing.calls}/${payload.usage.routing.limit} (${payload.usage.routing.burnRatePct}%)`
    },
    {
      label: "Background Allowed",
      value: payload.usage.backgroundHarvestAllowed ? "yes" : "no"
    }
  ]);

  renderKv(els.harvestStats, [
    { label: "Active Cached Cities", value: String(payload.harvest.activeCachedCities) },
    { label: "Pending Harvests", value: String(payload.harvest.pendingHarvests) },
    { label: "In Progress", value: String(payload.harvest.inProgress) },
    { label: "Ready", value: String(payload.harvest.ready) },
    { label: "Total", value: String(payload.harvest.totalCities) }
  ]);

  renderKv(els.storageStats, [
    { label: "Cache Rows", value: String(payload.cache.total) },
    { label: "City-Tagged Cache Rows", value: String(payload.cache.withCitySlug) },
    { label: "Database Size", value: `${payload.database.sizeMb} MB` },
    { label: "Database Bytes", value: String(payload.database.sizeBytes) },
    { label: "Storage Path", value: payload.database.path }
  ]);

  return payload;
}

async function refreshQueue() {
  const payload = await apiRequest("/api/admin/harvest/queue?limit=50", { method: "GET" });
  renderQueue(Array.isArray(payload.pending) ? payload.pending : []);
  return payload;
}

async function refreshCities() {
  const payload = await fetch("/api/catalog/cities");
  const data = await payload.json().catch(() => ({ cities: [] }));
  renderCityOptions(data.cities || []);
}

async function refreshAll() {
  if (!state.adminKey) {
    setStatus("Set admin key first.", true);
    return;
  }

  try {
    await Promise.all([refreshStats(), refreshQueue()]);
    setStatus("Admin data refreshed.");
  } catch (error) {
    setStatus(error.message, true);
    appendLog("Refresh failed", { error: error.message });
  }
}

function startPolling() {
  if (state.refreshTimer) {
    window.clearInterval(state.refreshTimer);
  }

  state.refreshTimer = window.setInterval(() => {
    refreshAll().catch(() => {});
  }, 20000);
}

async function runAction(label, requestFactory) {
  if (!state.adminKey) {
    setStatus("Set admin key first.", true);
    return;
  }

  try {
    setStatus(`Running ${label}...`);
    const result = await requestFactory();
    appendLog(`${label} completed`, result);
    setStatus(`${label} complete.`);
    await refreshAll();
  } catch (error) {
    setStatus(error.message, true);
    appendLog(`${label} failed`, { error: error.message });
  }
}

function bindEvents() {
  els.saveKeyBtn.addEventListener("click", () => {
    state.adminKey = String(els.adminKeyInput.value || "").trim();
    state.overrideKey = String(els.overrideKeyInput.value || "").trim();
    localStorage.setItem(STORAGE_KEY, state.adminKey);
    if (state.overrideKey) {
      localStorage.setItem(OVERRIDE_STORAGE_KEY, state.overrideKey);
    } else {
      localStorage.removeItem(OVERRIDE_STORAGE_KEY);
    }
    setStatus(state.adminKey ? "Admin key(s) saved." : "Admin key cleared.");
    refreshAll().catch(() => {});
  });

  els.refreshAllBtn.addEventListener("click", () => {
    refreshAll().catch(() => {});
  });

  els.runHarvestBtn.addEventListener("click", () => {
    runAction("harvest", () => apiRequest("/api/admin/actions/harvest-core", { method: "POST" }));
  });

  els.runBackupBtn.addEventListener("click", () => {
    runAction("backup", () =>
      apiRequest("/api/admin/actions/backup-nonrecoverable", { method: "POST" })
    );
  });

  els.queueCityBtn.addEventListener("click", () => {
    const slug = String(els.queueCitySelect.value || "").trim();
    if (!slug) {
      return;
    }

    runAction(`queue-city:${slug}`, () =>
      apiRequest(`/api/admin/actions/queue-city/${encodeURIComponent(slug)}`, {
        method: "POST"
      })
    );
  });

  els.applyOverrideBtn.addEventListener("click", () => {
    const stationKey = String(els.overrideStationKey.value || "").trim();
    if (!stationKey) {
      setStatus("stationKey is required for overrides.", true);
      return;
    }

    const overrideAdminKey = String(state.overrideKey || state.adminKey || "").trim();
    if (!overrideAdminKey) {
      setStatus("Set an admin key before applying overrides.", true);
      return;
    }

    const manualLatRaw = String(els.overrideManualLat.value || "").trim();
    const manualLonRaw = String(els.overrideManualLon.value || "").trim();

    const body = {
      stationKey,
      manualName: String(els.overrideManualName.value || "").trim(),
      note: String(els.overrideNote.value || "").trim()
    };

    if (manualLatRaw) {
      body.manualLat = Number(manualLatRaw);
    }

    if (manualLonRaw) {
      body.manualLon = Number(manualLonRaw);
    }

    runAction(`override:${stationKey}`, () =>
      apiRequest("/api/admin/overrides/station", {
        method: "POST",
        adminKey: overrideAdminKey,
        body
      })
    );
  });
}

async function init() {
  els.adminKeyInput.value = state.adminKey;
  els.overrideKeyInput.value = state.overrideKey;
  bindEvents();
  await refreshCities();

  if (!state.adminKey) {
    setStatus("Set admin key first.", true);
    return;
  }

  await refreshAll();
  startPolling();
}

init().catch((error) => {
  setStatus(error.message, true);
  appendLog("Admin page init failed", { error: error.message });
});
