const SESSION_KEY = "metromark_admin_session_token";

const els = {
  adminKeyInput: document.getElementById("adminKeyInput"),
  overrideKeyInput: document.getElementById("overrideKeyInput"),
  saveKeyBtn: document.getElementById("saveKeyBtn"),
  refreshAllBtn: document.getElementById("refreshAllBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  statusMessage: document.getElementById("statusMessage"),
  adminLoginShell: document.getElementById("adminLoginShell"),
  adminApp: document.getElementById("adminApp"),
  usageStats: document.getElementById("usageStats"),
  harvestStats: document.getElementById("harvestStats"),
  storageStats: document.getElementById("storageStats"),
  accountStats: document.getElementById("accountStats"),
  performanceStats: document.getElementById("performanceStats"),
  transitlandStats: document.getElementById("transitlandStats"),
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
  routeLineKey: document.getElementById("routeLineKey"),
  routeCitySlug: document.getElementById("routeCitySlug"),
  loadRouteBtn: document.getElementById("loadRouteBtn"),
  saveRouteBtn: document.getElementById("saveRouteBtn"),
  deleteRouteBtn: document.getElementById("deleteRouteBtn"),
  routePayload: document.getElementById("routePayload"),
  queueBody: document.getElementById("queueBody"),
  actionLog: document.getElementById("actionLog"),
};

const state = {
  adminKey: sessionStorage.getItem(SESSION_KEY) || "",
  overrideKey: "",
  refreshTimer: null,
};

function setAdminSession(token) {
  state.adminKey = String(token || "").trim();
  if (state.adminKey) {
    sessionStorage.setItem(SESSION_KEY, state.adminKey);
  } else {
    sessionStorage.removeItem(SESSION_KEY);
  }
}

function clearAdminSession() {
  setAdminSession("");
}

function setAdminLocked(locked) {
  if (els.adminLoginShell) {
    els.adminLoginShell.hidden = !locked;
  }
  if (els.adminApp) {
    els.adminApp.hidden = locked;
  }
  document.body.classList.toggle("admin-locked", Boolean(locked));
}

function appendLog(message, payload = null) {
  const prefix = `[${new Date().toISOString()}] ${message}`;
  const next = payload
    ? `${prefix}\n${JSON.stringify(payload, null, 2)}`
    : prefix;
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
      ...(requestKey ? { Authorization: `Bearer ${requestKey}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      payload?.error || `Request failed with status ${response.status}`;
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
      entry.lastError || "",
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

  const cacheKinds = payload.cache?.byKind
    ? Object.entries(payload.cache.byKind)
        .map(([kind, count]) => `${kind}:${count}`)
        .join(", ")
    : "";

  renderKv(els.usageStats, [
    { label: "UTC Day", value: payload.usage.dayKey },
    {
      label: "REST",
      value: `${payload.usage.rest.calls}/${payload.usage.rest.limit} (${payload.usage.rest.burnRatePct}%)`,
    },
    {
      label: "Vector",
      value: `${payload.usage.vector.calls}/${payload.usage.vector.limit} (${payload.usage.vector.burnRatePct}%)`,
    },
    {
      label: "Routing",
      value: `${payload.usage.routing.calls}/${payload.usage.routing.limit} (${payload.usage.routing.burnRatePct}%)`,
    },
    {
      label: "Background Allowed",
      value: payload.usage.backgroundHarvestAllowed ? "yes" : "no",
    },
  ]);

  renderKv(els.harvestStats, [
    {
      label: "Active Cached Cities",
      value: String(payload.harvest.activeCachedCities),
    },
    {
      label: "Pending Harvests",
      value: String(payload.harvest.pendingHarvests),
    },
    { label: "In Progress", value: String(payload.harvest.inProgress) },
    { label: "Ready", value: String(payload.harvest.ready) },
    { label: "Total", value: String(payload.harvest.totalCities) },
  ]);

  renderKv(els.storageStats, [
    { label: "Cache Rows", value: String(payload.cache.total) },
    {
      label: "City-Tagged Cache Rows",
      value: String(payload.cache.withCitySlug),
    },
    { label: "Cache Kinds", value: cacheKinds || "-" },
    { label: "Database Size", value: `${payload.database.sizeMb} MB` },
    { label: "Database Bytes", value: String(payload.database.sizeBytes) },
    { label: "Storage Path", value: payload.database.path },
  ]);

  renderKv(els.accountStats, [
    { label: "Profiles Total", value: String(payload.accounts.profilesTotal) },
    {
      label: "Profiles Active",
      value: String(payload.accounts.profilesActive),
    },
    {
      label: "Visited Rows",
      value: String(payload.accounts.visitedStationRows),
    },
    {
      label: "Latest Login",
      value: payload.accounts.latestLoginAtMs
        ? new Date(payload.accounts.latestLoginAtMs).toLocaleString()
        : "-",
    },
  ]);

  renderKv(els.performanceStats, [
    { label: "Uptime", value: `${payload.performance.processUptimeSec}s` },
    { label: "Node", value: String(payload.performance.nodeVersion || "-") },
    {
      label: "RSS",
      value: `${(Number(payload.performance.memory.rssBytes || 0) / (1024 * 1024)).toFixed(2)} MB`,
    },
    {
      label: "Heap Used",
      value: `${(Number(payload.performance.memory.heapUsedBytes || 0) / (1024 * 1024)).toFixed(2)} MB`,
    },
    {
      label: "CPU (user/system)",
      value: `${Number(payload.performance.cpu.userMicros || 0)}/${Number(payload.performance.cpu.systemMicros || 0)} us`,
    },
  ]);

  renderKv(els.transitlandStats, [
    {
      label: "REST (req/fail)",
      value: `${Number(payload.transitland.restApiRequests || 0)}/${Number(payload.transitland.restApiFailures || 0)}`,
    },
    {
      label: "Vector (req/fail)",
      value: `${Number(payload.transitland.vectorTileRequests || 0)}/${Number(payload.transitland.vectorTileFailures || 0)}`,
    },
    {
      label: "Routing (req/fail)",
      value: `${Number(payload.transitland.routingApiRequests || 0)}/${Number(payload.transitland.routingApiFailures || 0)}`,
    },
    {
      label: "Postgres (req/fail)",
      value: `${Number(payload.postgres?.queries || 0)}/${Number(payload.postgres?.failures || 0)}`,
    },
    {
      label: "Last REST",
      value: payload.transitland.lastRestRequestAt
        ? new Date(payload.transitland.lastRestRequestAt).toLocaleString()
        : "-",
    },
    {
      label: "Last Vector",
      value: payload.transitland.lastVectorTileRequestAt
        ? new Date(payload.transitland.lastVectorTileRequestAt).toLocaleString()
        : "-",
    },
    {
      label: "Last Routing",
      value: payload.transitland.lastRoutingRequestAt
        ? new Date(payload.transitland.lastRoutingRequestAt).toLocaleString()
        : "-",
    },
    {
      label: "Last Postgres",
      value: payload.postgres?.lastQueryAt
        ? new Date(payload.postgres.lastQueryAt).toLocaleString()
        : "-",
    },
  ]);

  return payload;
}

async function refreshQueue() {
  const payload = await apiRequest("/api/admin/harvest/queue?limit=50", {
    method: "GET",
  });
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
    setAdminLocked(true);
    setStatus("Log in first.", true);
    return;
  }

  try {
    await Promise.all([refreshStats(), refreshQueue()]);
    setAdminLocked(false);
    setStatus("Admin data refreshed.");
    if (!state.refreshTimer) {
      startPolling();
    }
  } catch (error) {
    setAdminLocked(true);
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
    setStatus("Log in first.", true);
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
    const username = String(els.adminKeyInput.value || "").trim();
    const password = String(els.overrideKeyInput.value || "");

    if (!username || !password) {
      setStatus("Username and password are required.", true);
      return;
    }

    apiRequest("/api/admin/login", {
      method: "POST",
      body: { username, password }
    }).then((result) => {
      setAdminSession(result.token || "");
      setAdminLocked(false);
      setStatus("Logged in.");
      refreshAll().catch(() => {});
    }).catch((error) => {
      clearAdminSession();
      setStatus(error.message, true);
    });
  });

  if (els.logoutBtn) {
    els.logoutBtn.addEventListener("click", () => {
      apiRequest("/api/admin/logout", { method: "POST" }).catch(() => {});
      clearAdminSession();
      setAdminLocked(true);
      setStatus("Logged out.");
    });
  }

  els.refreshAllBtn.addEventListener("click", () => {
    refreshAll().catch(() => {});
  });

  els.runHarvestBtn.addEventListener("click", () => {
    runAction("harvest", () =>
      apiRequest("/api/admin/actions/harvest-core", { method: "POST" }),
    );
  });

  els.runBackupBtn.addEventListener("click", () => {
    runAction("backup", () =>
      apiRequest("/api/admin/actions/backup-nonrecoverable", {
        method: "POST",
      }),
    );
  });

  els.queueCityBtn.addEventListener("click", () => {
    const slug = String(els.queueCitySelect.value || "").trim();
    if (!slug) {
      return;
    }

    runAction(`queue-city:${slug}`, () =>
      apiRequest(`/api/admin/actions/queue-city/${encodeURIComponent(slug)}`, {
        method: "POST",
      }),
    );
  });

  els.applyOverrideBtn.addEventListener("click", () => {
    const stationKey = String(els.overrideStationKey.value || "").trim();
    if (!stationKey) {
      setStatus("stationKey is required for overrides.", true);
      return;
    }

    const overrideAdminKey = String(state.adminKey || "").trim();
    if (!overrideAdminKey) {
      setStatus("Login before applying overrides.", true);
      return;
    }

    const manualLatRaw = String(els.overrideManualLat.value || "").trim();
    const manualLonRaw = String(els.overrideManualLon.value || "").trim();

    const body = {
      stationKey,
      manualName: String(els.overrideManualName.value || "").trim(),
      note: String(els.overrideNote.value || "").trim(),
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
        body,
      }),
    );
  });

  // Route overrides
  els.loadRouteBtn.addEventListener("click", async () => {
    const lineKey = String(els.routeLineKey.value || "").trim();
    if (!lineKey) return setStatus("lineKey is required to load.", true);
    const adminKey = String(state.adminKey || "").trim();
    try {
      setStatus("Loading route override...");
      const payload = await apiRequest(`/api/admin/overrides/route/${encodeURIComponent(lineKey)}`, { method: "GET", adminKey });
      if (payload && payload.override) {
        els.routeCitySlug.value = payload.override.city_slug || "";
        els.routePayload.value = JSON.stringify(payload.override.payload || {}, null, 2);
        setStatus("Loaded route override.");
      } else {
        els.routePayload.value = "";
        setStatus("No override found.");
      }
    } catch (err) {
      setStatus(err.message, true);
      appendLog("Load route override failed", { error: err.message });
    }
  });

  els.saveRouteBtn.addEventListener("click", async () => {
    const lineKey = String(els.routeLineKey.value || "").trim();
    if (!lineKey) return setStatus("lineKey is required to save.", true);
    const adminKey = String(state.adminKey || "").trim();
    let parsed = null;
    try {
      parsed = JSON.parse(String(els.routePayload.value || "{}"));
    } catch (e) {
      return setStatus("Payload must be valid JSON.", true);
    }

    try {
      setStatus("Saving route override...");
      const body = { lineKey, citySlug: String(els.routeCitySlug.value || "").trim(), payload: parsed };
      const result = await apiRequest("/api/admin/overrides/route", { method: "POST", adminKey, body });
      setStatus("Route override saved.");
      appendLog("Saved route override", result);
      await refreshAll();
    } catch (err) {
      setStatus(err.message, true);
      appendLog("Save route override failed", { error: err.message });
    }
  });

  els.deleteRouteBtn.addEventListener("click", async () => {
    const lineKey = String(els.routeLineKey.value || "").trim();
    if (!lineKey) return setStatus("lineKey is required to delete.", true);
    const adminKey = String(state.adminKey || "").trim();
    try {
      setStatus("Deleting route override...");
      const result = await apiRequest(`/api/admin/overrides/route/${encodeURIComponent(lineKey)}`, { method: "DELETE", adminKey });
      setStatus("Route override deleted.");
      appendLog("Deleted route override", result);
      await refreshAll();
    } catch (err) {
      setStatus(err.message, true);
      appendLog("Delete route override failed", { error: err.message });
    }
  });
}

async function init() {
  els.adminKeyInput.value = "";
  els.overrideKeyInput.value = "";
  bindEvents();
  await refreshCities();

  if (state.adminKey) {
    try {
      await apiRequest("/api/admin/session");
      setAdminLocked(false);
      setStatus("Logged in.");
      await refreshAll();
      startPolling();
      return;
    } catch {
      clearAdminSession();
    }
  }

  setAdminLocked(true);
  setStatus("Log in to access the admin console.");
}

init().catch((error) => {
  setStatus(error.message, true);
  appendLog("Admin page init failed", { error: error.message });
});
