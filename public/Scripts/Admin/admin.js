const SESSION_KEY = "metromark_admin_session_token";

const els = {
  adminLoginShell: document.getElementById("adminLoginShell"),
  adminApp: document.getElementById("adminApp"),
  adminEmailInput: document.getElementById("adminEmailInput"),
  adminPasswordInput: document.getElementById("adminPasswordInput"),
  loginBtn: document.getElementById("loginBtn"),
  loginStatusMessage: document.getElementById("loginStatusMessage"),
  sessionEmail: document.getElementById("sessionEmail"),
  sessionSource: document.getElementById("sessionSource"),
  refreshAllBtn: document.getElementById("refreshAllBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  statusMessage: document.getElementById("statusMessage"),
  kpiUsers: document.getElementById("kpiUsers"),
  kpiUsersSub: document.getElementById("kpiUsersSub"),
  kpiVisits: document.getElementById("kpiVisits"),
  kpiRoutes: document.getElementById("kpiRoutes"),
  kpiRoutesSub: document.getElementById("kpiRoutesSub"),
  kpiCache: document.getElementById("kpiCache"),
  kpiCacheSub: document.getElementById("kpiCacheSub"),
  kpiDb: document.getElementById("kpiDb"),
  kpiBurn: document.getElementById("kpiBurn"),
  usageBars: document.getElementById("usageBars"),
  usageStatus: document.getElementById("usageStatus"),
  usageHistory: document.getElementById("usageHistory"),
  routeCoverage: document.getElementById("routeCoverage"),
  tilesServed: document.getElementById("tilesServed"),
  systemHealth: document.getElementById("systemHealth"),
  storageStats: document.getElementById("storageStats"),
  accountStats: document.getElementById("accountStats"),
  performanceStats: document.getElementById("performanceStats"),
  transitlandStats: document.getElementById("transitlandStats"),
  runBackupBtn: document.getElementById("runBackupBtn"),
  rebuildTilesBtn: document.getElementById("rebuildTilesBtn"),
  accountsBody: document.getElementById("accountsBody"),
  accountsStatus: document.getElementById("accountsStatus"),
  actionLog: document.getElementById("actionLog"),
};

const state = {
  token: sessionStorage.getItem(SESSION_KEY) || "",
  refreshTimer: null,
};

function setAdminSession(token) {
  state.token = String(token || "").trim();
  if (state.token) {
    sessionStorage.setItem(SESSION_KEY, state.token);
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
  const next = payload ? `${prefix}\n${JSON.stringify(payload, null, 2)}` : prefix;
  const current = String(els.actionLog.textContent || "").trim();
  els.actionLog.textContent = current ? `${next}\n\n${current}` : next;
  els.actionLog.textContent = els.actionLog.textContent.slice(0, 40000);
}

function setStatus(text, isError = false) {
  els.statusMessage.textContent = text;
  els.statusMessage.style.color = isError ? "#a22828" : "#5a5a5a";
}

async function apiRequest(path, options = {}) {
  const token = String(options.adminKey || state.token || "").trim();
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with status ${response.status}`);
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
    dd.textContent = String(row.value ?? "-");
    wrap.appendChild(dt);
    wrap.appendChild(dd);
    container.appendChild(wrap);
  }
}

function renderUsageBars(usage) {
  els.usageBars.innerHTML = "";
  const kinds = [
    ["rest", "REST"],
    ["vector", "Vector"],
    ["routing", "Routing"]
  ];
  for (const [key, label] of kinds) {
    const section = usage?.[key];
    if (!section) {
      continue;
    }
    const wrap = document.createElement("div");
    wrap.className = "usage-bar-row";

    const meta = document.createElement("div");
    meta.className = "usage-bar-meta";
    const name = document.createElement("span");
    name.textContent = label;
    const counts = document.createElement("span");
    counts.textContent = `${section.calls} / ${section.limit}`;
    meta.append(name, counts);

    const track = document.createElement("div");
    track.className = "usage-bar-track";
    const fill = document.createElement("div");
    fill.className = "usage-bar-fill" + (section.reached ? " is-reached" : "");
    fill.style.width = `${Math.min(100, Number(section.burnRatePct || 0))}%`;
    track.append(fill);

    wrap.append(meta, track);
    els.usageBars.append(wrap);
  }
  els.usageStatus.textContent = `Background harvest ${usage?.backgroundHarvestAllowed ? "allowed" : "paused (cap reached)"} · UTC day ${usage?.dayKey || "—"}`;
}

function renderUsageHistory(history) {
  els.usageHistory.innerHTML = "";
  const rows = Array.isArray(history) ? history : [];
  if (!rows.length) {
    els.usageHistory.textContent = "No usage recorded yet.";
    return;
  }
  const max = Math.max(1, ...rows.map((r) => r.vectorTileCalls || 0));
  for (const row of rows) {
    const wrap = document.createElement("div");
    wrap.className = "usage-history-row";
    const day = document.createElement("span");
    day.className = "usage-history-day";
    day.textContent = (row.dayKey || "").slice(5);
    const restBar = document.createElement("div");
    restBar.className = "usage-history-bar is-rest";
    restBar.style.width = `${Math.max(2, Math.round((row.restApiCalls / max) * 100))}%`;
    const vectorBar = document.createElement("div");
    vectorBar.className = "usage-history-bar is-vector";
    vectorBar.style.width = `${Math.max(2, Math.round((row.vectorTileCalls / max) * 100))}%`;
    const track = document.createElement("div");
    track.className = "usage-history-track";
    track.append(restBar, vectorBar);
    const counts = document.createElement("span");
    counts.className = "usage-history-counts";
    counts.textContent = `${row.restApiCalls}/${row.vectorTileCalls}`;
    wrap.append(day, track, counts);
    els.usageHistory.append(wrap);
  }
}

function renderAccounts(accounts) {
  els.accountsBody.innerHTML = "";
  const list = Array.isArray(accounts) ? accounts : [];
  if (!list.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.textContent = "No accounts found (Supabase unreachable or no users yet).";
    tr.appendChild(td);
    els.accountsBody.appendChild(tr);
    return;
  }

  for (const account of list) {
    const tr = document.createElement("tr");

    const emailTd = document.createElement("td");
    emailTd.textContent = account.email || account.id;
    emailTd.title = account.id;

    const roleTd = document.createElement("td");
    roleTd.textContent = account.role === "admin" ? "admin" : "user";
    if (account.role === "admin") {
      roleTd.classList.add("role-admin");
    }

    const activeTd = document.createElement("td");
    activeTd.textContent = account.isActive ? "yes" : "no";

    const loginTd = document.createElement("td");
    loginTd.textContent = account.lastLoginAt
      ? new Date(account.lastLoginAt * 1000).toLocaleString()
      : "-";

    const actionTd = document.createElement("td");
    const isAdmin = account.role === "admin";
    const actionBtn = document.createElement("button");
    actionBtn.type = "button";
    actionBtn.textContent = isAdmin ? "Revoke admin" : "Grant admin";
    actionBtn.addEventListener("click", async () => {
      actionBtn.disabled = true;
      try {
        const result = await apiRequest(`/api/admin/accounts/${encodeURIComponent(account.id)}/role`, {
          method: "POST",
          body: { role: isAdmin ? "user" : "admin" }
        });
        setStatus(`Role updated for ${account.email}.`);
        appendLog("Account role updated", result);
        await refreshAccounts();
      } catch (error) {
        setStatus(error.message, true);
        appendLog("Account role update failed", { error: error.message });
      } finally {
        actionBtn.disabled = false;
      }
    });
    actionTd.appendChild(actionBtn);

    tr.append(emailTd, roleTd, activeTd, loginTd, actionTd);
    els.accountsBody.appendChild(tr);
  }
}

function fmtMb(bytes) {
  return `${(Number(bytes || 0) / (1024 * 1024)).toFixed(1)} MB`;
}

async function refreshStats() {
  const payload = await apiRequest("/api/admin/stats", { method: "GET" });
  const accounts = payload.accounts;
  const accountsAvailable = accounts && !accounts.unavailable;

  els.kpiUsers.textContent = accountsAvailable ? String(accounts.profilesTotal || 0) : "—";
  els.kpiUsersSub.textContent = accountsAvailable
    ? `${accounts.profilesActive || 0} active`
    : "Supabase unreachable";
  els.kpiVisits.textContent = accountsAvailable ? String(accounts.visitedStationRows || 0) : "—";
  els.kpiRoutes.textContent = String(payload.routeCoverage?.totalRoutes ?? payload.harvest?.totalCities ?? "—");
  els.kpiRoutesSub.textContent = `${payload.routeCoverage?.coveredHeadway || 0} with headway · ${payload.routeCoverage?.distinctOperators || 0} operators`;
  els.kpiCache.textContent = String(payload.cache?.total ?? "—");
  const cacheKinds = payload.cache?.byKind
    ? Object.entries(payload.cache.byKind).map(([kind, count]) => `${kind}:${count}`).join(", ")
    : "";
  els.kpiCacheSub.textContent = cacheKinds || "—";
  els.kpiDb.textContent = fmtMb(payload.database?.sizeBytes);
  els.kpiBurn.textContent = `${payload.usage?.rest?.calls ?? 0} / ${payload.usage?.vector?.calls ?? 0} / ${payload.usage?.routing?.calls ?? 0}`;

  renderUsageBars(payload.usage);
  renderUsageHistory(payload.usageHistory);

  renderKv(els.routeCoverage, [
    { label: "Routes (metadata)", value: payload.routeCoverage?.totalRoutes },
    { label: "Headway covered", value: payload.routeCoverage?.coveredHeadway },
    { label: "Distinct operators", value: payload.routeCoverage?.distinctOperators },
    { label: "With stop counts", value: payload.routeCoverage?.routesWithStopCounts },
    { label: "Archive size", value: fmtMb(payload.archive?.sizeBytes) }
  ]);

  renderKv(els.tilesServed, [
    { label: "Requests", value: payload.tilesServed?.requests },
    { label: "Bytes served", value: fmtMb(payload.tilesServed?.bytesServed) },
    { label: "Avg response", value: `${payload.tilesServed?.averageMs} ms` },
    { label: "Last served", value: payload.tilesServed?.lastAt ? new Date(payload.tilesServed.lastAt).toLocaleString() : "-" }
  ]);

  renderKv(els.systemHealth, [
    { label: "Supabase", value: payload.system?.supabaseReachable ? "reachable" : "unreachable" },
    { label: "Service Worker", value: payload.system?.serviceWorkerEnabled ? "enabled" : "disabled" },
    { label: "App Env", value: payload.system?.appEnv || "-" },
    { label: "Env File", value: payload.system?.envFile || "-" }
  ]);

  renderKv(els.storageStats, [
    { label: "Cache Rows", value: payload.cache?.total },
    { label: "City-Tagged Rows", value: payload.cache?.withCitySlug },
    { label: "Cache Kinds", value: cacheKinds || "-" },
    { label: "Database Size", value: fmtMb(payload.database?.sizeBytes) },
    { label: "Database Bytes", value: payload.database?.sizeBytes },
    { label: "Storage Path", value: payload.database?.path }
  ]);

  renderKv(els.accountStats, [
    { label: "Profiles Total", value: accountsAvailable ? accounts.profilesTotal : "n/a" },
    { label: "Profiles Active", value: accountsAvailable ? accounts.profilesActive : "n/a" },
    { label: "Visited Station Rows", value: accountsAvailable ? accounts.visitedStationRows : "n/a" },
    {
      label: "Latest Login",
      value: accountsAvailable && accounts.latestLoginAtMs ? new Date(accounts.latestLoginAtMs).toLocaleString() : "-"
    }
  ]);

  renderKv(els.performanceStats, [
    { label: "Uptime", value: `${payload.performance?.processUptimeSec}s` },
    { label: "Node", value: payload.performance?.nodeVersion || "-" },
    { label: "RSS", value: fmtMb(payload.performance?.memory?.rssBytes) },
    { label: "Heap Used", value: fmtMb(payload.performance?.memory?.heapUsedBytes) },
    {
      label: "CPU (user/system)",
      value: `${Number(payload.performance?.cpu?.userMicros || 0)}/${Number(payload.performance?.cpu?.systemMicros || 0)} us`
    }
  ]);

  renderKv(els.transitlandStats, [
    { label: "REST (req/fail)", value: `${payload.transitland?.restApiRequests || 0}/${payload.transitland?.restApiFailures || 0}` },
    { label: "Vector (req/fail)", value: `${payload.transitland?.vectorTileRequests || 0}/${payload.transitland?.vectorTileFailures || 0}` },
    { label: "Routing (req/fail)", value: `${payload.transitland?.routingApiRequests || 0}/${payload.transitland?.routingApiFailures || 0}` },
    { label: "Postgres (req/fail)", value: `${payload.postgres?.queries || 0}/${payload.postgres?.failures || 0}` },
    { label: "Last REST", value: payload.transitland?.lastRestRequestAt ? new Date(payload.transitland.lastRestRequestAt).toLocaleString() : "-" },
    { label: "Last Vector", value: payload.transitland?.lastVectorTileRequestAt ? new Date(payload.transitland.lastVectorTileRequestAt).toLocaleString() : "-" },
    { label: "Last Routing", value: payload.transitland?.lastRoutingRequestAt ? new Date(payload.transitland.lastRoutingRequestAt).toLocaleString() : "-" },
    { label: "Last Postgres", value: payload.postgres?.lastQueryAt ? new Date(payload.postgres.lastQueryAt).toLocaleString() : "-" }
  ]);

  return payload;
}

async function refreshAccounts() {
  try {
    const payload = await apiRequest("/api/admin/accounts", { method: "GET" });
    renderAccounts(payload.accounts);
    els.accountsStatus.textContent = "";
  } catch (error) {
    renderAccounts([]);
    els.accountsStatus.textContent = error.message;
  }
}

async function refreshAll() {
  if (!state.token) {
    setAdminLocked(true);
    setStatus("Log in first.", true);
    return;
  }
  try {
    await Promise.all([refreshStats(), refreshAccounts()]);
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
  if (!state.token) {
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
  els.loginBtn.addEventListener("click", async () => {
    const email = String(els.adminEmailInput.value || "").trim();
    const password = String(els.adminPasswordInput.value || "");
    if (!email || !password) {
      els.loginStatusMessage.textContent = "Email and password are required.";
      return;
    }
    els.loginStatusMessage.textContent = "Signing in...";
    try {
      const result = await apiRequest("/api/admin/login", {
        method: "POST",
        body: { email, password }
      });
      setAdminSession(result.token);
      els.sessionEmail.textContent = result.email || email;
      els.sessionSource.textContent = result.bootstrap ? "env-designated admin" : "Supabase admin";
      setAdminLocked(false);
      els.loginStatusMessage.textContent = "Logged in.";
      await refreshAll();
    } catch (error) {
      clearAdminSession();
      els.loginStatusMessage.textContent = error.message;
    }
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

  els.runBackupBtn.addEventListener("click", () => {
    runAction("backup", () => apiRequest("/api/admin/actions/backup-nonrecoverable", { method: "POST" }));
  });

  if (els.rebuildTilesBtn) {
    els.rebuildTilesBtn.addEventListener("click", () => {
      runAction("rebuild-tiles", () => apiRequest("/api/admin/actions/rebuild-tiles", { method: "POST" }));
    });
  }

  const bboxInput = document.getElementById("viewportBboxInput");
  const updateBtn = document.getElementById("updateViewportBtn");
  const statusEl = document.getElementById("viewportUpdateStatus");
  if (bboxInput && updateBtn && statusEl) {
    updateBtn.addEventListener("click", async () => {
      const raw = String(bboxInput.value || "").trim();
      const parts = raw.split(",").map((value) => Number(value.trim()));
      const bbox = parts.length === 4 && parts.every((value) => Number.isFinite(value)) ? parts : null;
      if (!bbox || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) {
        statusEl.textContent = "Enter a valid bbox: west,south,east,north.";
        statusEl.style.color = "#a22828";
        return;
      }
      if (!state.token) {
        statusEl.textContent = "Log in first.";
        statusEl.style.color = "#a22828";
        return;
      }
      updateBtn.disabled = true;
      statusEl.textContent = "Fetching viewport routes from Transitland and rebuilding tiles...";
      statusEl.style.color = "#5a5a5a";
      try {
        const response = await fetch("/api/admin/tiles/backfill", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${state.token}`
          },
          body: JSON.stringify({ bbox, forceRefresh: true })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || `Request failed (${response.status}).`);
        }
        statusEl.textContent =
          `Done. +${payload.addedRoutes} added, ${payload.updatedRoutes} updated, ` +
          `${payload.skippedRoutes} skipped (${payload.fetchedRoutes} fetched), ` +
          `${payload.totalRoutesInArchive} routes in archive.`;
        statusEl.style.color = "#2e7d32";
      } catch (error) {
        statusEl.textContent = `Failed: ${error.message}`;
        statusEl.style.color = "#a22828";
      } finally {
        updateBtn.disabled = false;
      }
    });
  }
}

async function init() {
  els.adminEmailInput.value = "";
  els.adminPasswordInput.value = "";
  bindEvents();

  if (state.token) {
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
