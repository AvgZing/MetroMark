const SESSION_KEY = "metromark_admin_session_token";

const els = {
  adminLoginShell: document.getElementById("adminLoginShell"),
  adminApp: document.getElementById("adminApp"),
  adminEmailInput: document.getElementById("adminEmailInput"),
  adminPasswordInput: document.getElementById("adminPasswordInput"),
  loginBtn: document.getElementById("loginBtn"),
  adminLoginForm: document.getElementById("adminLoginForm"),
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
  citySlugInput: document.getElementById("citySlugInput"),
  cityNameInput: document.getElementById("cityNameInput"),
  cityCountryInput: document.getElementById("cityCountryInput"),
  cityPublishedCb: document.getElementById("cityPublishedCb"),
  saveCityBtn: document.getElementById("saveCityBtn"),
  clearCityBtn: document.getElementById("clearCityBtn"),
  adminCitiesList: document.getElementById("adminCitiesList"),
  adminCitiesStatus: document.getElementById("adminCitiesStatus"),
  reviewQueueCard: document.getElementById("reviewQueueCard"),
  reviewQueueSummary: document.getElementById("reviewQueueSummary"),
  refreshReviewQueueBtn: document.getElementById("refreshReviewQueueBtn"),
  reviewFlagsJumpBtn: document.getElementById("reviewFlagsJumpBtn"),
  reviewIssuesJumpBtn: document.getElementById("reviewIssuesJumpBtn"),
  reharvestFlagsAnchor: document.getElementById("reharvestFlagsAnchor"),
  issueReportsAnchor: document.getElementById("issueReportsAnchor"),
};

const state = {
  token: sessionStorage.getItem(SESSION_KEY) || "",
  refreshTimer: null,
  editingCitySlug: "",
  editingCity: null,
  adminCities: [],
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
  els.statusMessage.classList.toggle("is-error", isError);
  els.statusMessage.style.color = "";
}

const STATUS_KIND_CLASSES = ["is-ok", "is-warn", "is-error"];

// Status text + theme-aware color class.
function setTextStatus(el, text, kind = "") {
  if (!el) {
    return;
  }
  el.textContent = text;
  STATUS_KIND_CLASSES.forEach((name) => el.classList.toggle(name, name === kind));
  el.style.color = "";
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
  const el = els.usageHistory;
  el.innerHTML = "";
  const rows = Array.isArray(history) ? history : [];
  if (!rows.length) {
    el.textContent = "No usage recorded yet.";
    return;
  }
  const max = Math.max(
    1,
    ...rows.map((row) => Math.max(Number(row.restApiCalls) || 0, Number(row.vectorTileCalls) || 0))
  );

  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const rest = Number(row.restApiCalls) || 0;
    const vector = Number(row.vectorTileCalls) || 0;

    const wrap = document.createElement("div");
    wrap.className = "usage-history-row";
    wrap.title = `${row.dayKey || ""}: ${rest.toLocaleString()} REST API calls, ${vector.toLocaleString()} vector tile calls`;

    const day = document.createElement("span");
    day.className = "usage-history-day";
    day.textContent = row.dayKey || "";

    const bars = document.createElement("div");
    bars.className = "usage-history-bars";
    for (const [cls, label, value] of [
      ["is-rest", "REST", rest],
      ["is-vector", "Tiles", vector]
    ]) {
      const line = document.createElement("div");
      line.className = "usage-history-barline";

      const lab = document.createElement("span");
      lab.className = "usage-history-bar-label";
      lab.textContent = label;

      const track = document.createElement("div");
      track.className = "usage-history-track";
      const bar = document.createElement("div");
      bar.className = `usage-history-bar ${cls}`;
      bar.style.width = `${Math.max(1, Math.round((value / max) * 100))}%`;
      track.append(bar);

      const count = document.createElement("span");
      count.className = "usage-history-count";
      count.textContent = value.toLocaleString();

      line.append(lab, track, count);
      bars.append(line);
    }

    wrap.append(day, bars);
    fragment.append(wrap);
  }
  el.append(fragment);
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

// Chrome blocks top-level navigation to data: URLs, so hand the browser an
// object URL built from the stored screenshot instead.
function openReportScreenshot(dataUrl) {
  try {
    const [meta, base64] = String(dataUrl).split(",");
    const mime = /data:([^;]+)/.exec(meta)?.[1] || "image/png";
    const binary = atob(base64 || "");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
    window.open(objectUrl, "_blank");
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  } catch {
    window.open(dataUrl, "_blank");
  }
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
    els.kpiRoutesSub.textContent = `${payload.routeCoverage?.coveredHeadway || 0} with headway · ${payload.routeCoverage?.coveredStops || 0} stops checked · ${payload.routeCoverage?.distinctOperators || 0} operators`;
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
    { label: "Stops checked", value: payload.routeCoverage?.coveredStops },
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
    refreshReviewQueue().catch(() => {});
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
  async function submitAdminLogin() {
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
      await loadAdminCities();
      await refreshReviewQueue();
    } catch (error) {
      clearAdminSession();
      els.loginStatusMessage.textContent = error.message;
    }
  }

  if (els.adminLoginForm) {
    els.adminLoginForm.addEventListener("submit", (event) => {
      event.preventDefault();
      submitAdminLogin();
    });
  } else if (els.loginBtn) {
    els.loginBtn.addEventListener("click", () => submitAdminLogin());
  }

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
    loadAdminCities().catch(() => {});
  });

  if (els.saveCityBtn) {
    els.saveCityBtn.addEventListener("click", () => {
      saveCity().catch(() => {});
    });
  }
  if (els.clearCityBtn) {
    els.clearCityBtn.addEventListener("click", clearCityForm);
  }

  if (els.refreshReviewQueueBtn) {
    els.refreshReviewQueueBtn.addEventListener("click", () => {
      refreshReviewQueue().catch(() => {});
    });
  }
  if (els.reviewFlagsJumpBtn) {
    els.reviewFlagsJumpBtn.addEventListener("click", () => jumpToElement(els.reharvestFlagsAnchor));
  }
  if (els.reviewIssuesJumpBtn) {
    els.reviewIssuesJumpBtn.addEventListener("click", () => jumpToElement(els.issueReportsAnchor));
  }

  els.runBackupBtn.addEventListener("click", () => {
    runAction("backup", () => apiRequest("/api/admin/actions/backup-nonrecoverable", { method: "POST" }));
  });

  if (els.rebuildTilesBtn) {
    els.rebuildTilesBtn.addEventListener("click", () => {
      runAction("rebuild-tiles", () => apiRequest("/api/admin/actions/rebuild-tiles", { method: "POST" }));
    });
  }

  const reloadFlagsBtn = document.getElementById("reloadFlagsBtn");
  if (reloadFlagsBtn) {
    reloadFlagsBtn.addEventListener("click", () => {
      loadReharvestFlags();
    });
  }

  const reloadIssuesBtn = document.getElementById("reloadIssuesBtn");
  const issuesShowResolvedCb = document.getElementById("issuesShowResolvedCb");
  if (reloadIssuesBtn) {
    reloadIssuesBtn.addEventListener("click", () => {
      loadIssueReports({ showResolved: Boolean(issuesShowResolvedCb && issuesShowResolvedCb.checked) });
    });
  }
  if (issuesShowResolvedCb) {
    issuesShowResolvedCb.addEventListener("change", () => {
      loadIssueReports({ showResolved: issuesShowResolvedCb.checked });
    });
  }
}

async function loadReharvestFlags() {
  const body = document.getElementById("reharvestFlagsBody");
  const statusEl = document.getElementById("reharvestFlagsStatus");
  if (!body) {
    return;
  }
  setTextStatus(statusEl, "Loading flags…");
  try {
    const payload = await apiRequest("/api/admin/reharvest/flags?status=open", { method: "GET" });
    const flags = Array.isArray(payload?.flags) ? payload.flags : [];
    body.innerHTML = "";
    if (!flags.length) {
      setTextStatus(statusEl, "No open reharvest flags.", "is-ok");
      return;
    }
    setTextStatus(
      statusEl,
      `${flags.length} open flag(s). Resolve a flag after you have reviewed the affected route data.`,
      "is-warn"
    );
    for (const flag of flags) {
      const row = document.createElement("tr");
      const cellId = document.createElement("td");
      cellId.textContent = String(flag.id);
      const cellKind = document.createElement("td");
      cellKind.textContent = flag.kind || "";
      const cellLine = document.createElement("td");
      cellLine.textContent = flag.lineKey || flag.stationKey || "";
      const cellMessage = document.createElement("td");
      cellMessage.textContent = flag.message || "";
      const cellStatus = document.createElement("td");
      cellStatus.textContent = flag.status || "";
      const cellAction = document.createElement("td");
      const resolveBtn = document.createElement("button");
      resolveBtn.type = "button";
      resolveBtn.textContent = "Resolve";
      resolveBtn.addEventListener("click", async () => {
        try {
          await apiRequest(`/api/admin/reharvest/flags/${flag.id}/resolve`, { method: "POST" });
          loadReharvestFlags();
        } catch (error) {
          setTextStatus(statusEl, `Failed to resolve flag: ${error.message}`, "is-error");
        }
      });
      cellAction.appendChild(resolveBtn);
      row.append(cellId, cellKind, cellLine, cellMessage, cellStatus, cellAction);
      body.appendChild(row);
    }
  } catch (error) {
    setTextStatus(statusEl, `Failed to load flags: ${error.message}`, "is-error");
  }
}

function formatReportTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}

// Open an issue report's saved view in the Map Editor, where the area refresh
// now lives (the console no longer takes a hand-typed bbox).
function openIssueInMapEditor(issue) {
  if (!Array.isArray(issue?.bbox) || issue.bbox.length !== 4) {
    return;
  }
  const params = new URLSearchParams({
    bbox: issue.bbox.map((value) => Number(value).toFixed(6)).join(",")
  });
  const zoom = Number(issue.zoom);
  if (Number.isFinite(zoom)) {
    params.set("zoom", String(zoom));
  }
  window.open(`/admin/override?${params.toString()}`, "_blank", "noopener");
}

async function loadIssueReports(options = {}) {
  const body = document.getElementById("issueReportsBody");
  const statusEl = document.getElementById("issueReportsStatus");
  if (!body) {
    return;
  }
  setTextStatus(statusEl, "Loading issue reports…");
  try {
    const status = options.showResolved ? "resolved" : "open";
    const payload = await apiRequest(`/api/admin/issues?status=${status}`, { method: "GET" });
    const issues = Array.isArray(payload?.issues) ? payload.issues : [];
    body.innerHTML = "";
    if (!issues.length) {
      setTextStatus(
        statusEl,
        `No ${options.showResolved ? "resolved" : "open"} issue reports.`,
        "is-ok"
      );
      return;
    }
    setTextStatus(statusEl, `${issues.length} ${options.showResolved ? "resolved" : "open"} report(s).`);

    for (const issue of issues) {
      const row = document.createElement("tr");

      const cellId = document.createElement("td");
      cellId.textContent = String(issue.id);

      const cellCreated = document.createElement("td");
      cellCreated.textContent = formatReportTime(issue.createdAt);

      const reporterName = issue.reporterName || issue.reporterEmail || "guest";
      const cellReporter = document.createElement("td");
      cellReporter.textContent = reporterName;

      const cellView = document.createElement("td");
      if (issue.screenshot) {
        const viewBtn = document.createElement("button");
        viewBtn.type = "button";
        viewBtn.textContent = "Screenshot";
        viewBtn.addEventListener("click", () => {
          openReportScreenshot(issue.screenshot);
        });
        cellView.appendChild(viewBtn);
      } else {
        cellView.textContent = "-";
      }

      const cellBbox = document.createElement("td");
      const bboxText = Array.isArray(issue.bbox) ? issue.bbox.map((v) => Number(v).toFixed(4)).join(", ") : "-";
      cellBbox.textContent = bboxText;

      const cellZoom = document.createElement("td");
      cellZoom.textContent = issue.zoom !== null && issue.zoom !== undefined ? String(issue.zoom) : "-";

      const cellDescription = document.createElement("td");
      cellDescription.textContent = issue.description || "-";

      const cellStatus = document.createElement("td");
      cellStatus.textContent = issue.status || "";

      const cellActions = document.createElement("td");
      if (issue.status !== "resolved") {
        const mapBtn = document.createElement("button");
        mapBtn.type = "button";
        mapBtn.textContent = "Open in map";
        mapBtn.title = "Open this view in the Map Editor and refresh the area";
        mapBtn.addEventListener("click", () => {
          openIssueInMapEditor(issue);
        });
        cellActions.appendChild(mapBtn);

        const resolveBtn = document.createElement("button");
        resolveBtn.type = "button";
        resolveBtn.textContent = "Resolve";
        resolveBtn.addEventListener("click", async () => {
          try {
            await apiRequest(`/api/admin/issues/${issue.id}/resolve`, { method: "POST" });
            loadIssueReports({ showResolved: Boolean(options.showResolved) });
          } catch (error) {
            setTextStatus(statusEl, `Failed to resolve report: ${error.message}`, "is-error");
          }
        });
        cellActions.appendChild(resolveBtn);
      } else {
        const reopenBtn = document.createElement("button");
        reopenBtn.type = "button";
        reopenBtn.textContent = "Reopen";
        reopenBtn.addEventListener("click", async () => {
          try {
            await apiRequest(`/api/admin/issues/${issue.id}/reopen`, { method: "POST" });
            loadIssueReports({ showResolved: true });
          } catch (error) {
            setTextStatus(statusEl, `Failed to reopen report: ${error.message}`, "is-error");
          }
        });
        cellActions.appendChild(reopenBtn);
      }

      row.append(cellId, cellCreated, cellReporter, cellView, cellBbox, cellZoom, cellDescription, cellStatus, cellActions);
      body.appendChild(row);
    }
  } catch (error) {
    setTextStatus(statusEl, `Failed to load issue reports: ${error.message}`, "is-error");
  }
}

// Console edits metadata only; center/bbox/zoom come from the Map Editor.
function cityFormPayload() {
  const existing = state.editingCity || {};
  return {
    slug: String(els.citySlugInput?.value || "").trim(),
    name: String(els.cityNameInput?.value || "").trim(),
    country: String(els.cityCountryInput?.value || "").trim(),
    center: Array.isArray(existing.center) ? existing.center : null,
    bbox: Array.isArray(existing.bbox) ? existing.bbox : null,
    defaultZoom: existing.defaultZoom ?? null,
    published: Boolean(els.cityPublishedCb?.checked)
  };
}

function clearCityForm() {
  state.editingCitySlug = "";
  state.editingCity = null;
  if (els.citySlugInput) {
    els.citySlugInput.value = "";
    els.citySlugInput.disabled = true;
  }
  if (els.cityNameInput) els.cityNameInput.value = "";
  if (els.cityCountryInput) els.cityCountryInput.value = "";
  if (els.cityPublishedCb) els.cityPublishedCb.checked = false;
  if (els.saveCityBtn) els.saveCityBtn.disabled = true;
  if (els.clearCityBtn) els.clearCityBtn.disabled = true;
  renderAdminCities(state.adminCities);
}

function fillCityForm(city) {
  state.editingCitySlug = city.slug;
  state.editingCity = city;
  els.citySlugInput.value = city.slug;
  els.citySlugInput.disabled = true;
  els.cityNameInput.value = city.name || "";
  els.cityCountryInput.value = city.country || "";
  els.cityPublishedCb.checked = Boolean(city.published);
  if (els.saveCityBtn) els.saveCityBtn.disabled = false;
  els.clearCityBtn.disabled = false;
  renderAdminCities(state.adminCities);
}

function renderAdminCities(cities) {
  const list = els.adminCitiesList;
  if (!list) {
    return;
  }
  list.innerHTML = "";
  if (!cities.length) {
    const p = document.createElement("p");
    p.className = "microcopy";
    p.textContent = "No cities yet. Create one in the Map Editor (City presets panel), then edit and publish it here.";
    list.append(p);
    return;
  }
  for (const city of cities) {
    const row = document.createElement("div");
    row.className = "city-row";

    const main = document.createElement("div");
    main.className = "city-row-main";
    const name = document.createElement("p");
    name.className = "city-row-name";
    name.textContent = city.name || city.slug;
    const meta = document.createElement("p");
    meta.className = "city-row-meta";
    meta.textContent = `${city.slug}${city.country ? " · " + city.country : ""} · ${city.routeCount || 0} route(s)${
      city.operatorCount ? ` · ${city.operatorCount} operator(s)` : ""
    }`;
    main.append(name, meta);

    const badge = document.createElement("span");
    badge.className = "city-badge" + (city.published ? " is-published" : "");
    badge.textContent = city.published ? "Published" : "Draft";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => fillCityForm(city));

    const publishBtn = document.createElement("button");
    publishBtn.type = "button";
    publishBtn.textContent = city.published ? "Unpublish" : "Publish";
    publishBtn.addEventListener("click", async () => {
      if (!city.published && !Number(city.routeCount || 0)) {
        if (!window.confirm(`"${city.name || city.slug}" has no routes yet. Publishing it will show nothing to users. Publish anyway?`)) {
          return;
        }
      }
      try {
        await apiRequest(`/api/admin/cities/${encodeURIComponent(city.slug)}/publish`, {
          method: "POST",
          body: { published: !city.published }
        });
        loadAdminCities();
      } catch (error) {
        setTextStatus(els.adminCitiesStatus, `Publish failed: ${error.message}`, "is-error");
      }
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async () => {
      if (!window.confirm(`Delete city ${city.slug}? Its route vetting will be removed.`)) {
        return;
      }
      try {
        await apiRequest(`/api/admin/cities/${encodeURIComponent(city.slug)}`, { method: "DELETE" });
        if (state.editingCitySlug === city.slug) {
          clearCityForm();
        }
        loadAdminCities();
      } catch (error) {
        setTextStatus(els.adminCitiesStatus, `Delete failed: ${error.message}`, "is-error");
      }
    });

    row.append(main, badge, editBtn, publishBtn, deleteBtn);
    list.append(row);
  }
}

async function loadAdminCities() {
  if (!els.adminCitiesList) {
    return;
  }
  setTextStatus(els.adminCitiesStatus, "Loading cities…");
  try {
    const payload = await apiRequest("/api/admin/cities", { method: "GET" });
    state.adminCities = Array.isArray(payload?.cities) ? payload.cities : [];
    renderAdminCities(state.adminCities);
    setTextStatus(
      els.adminCitiesStatus,
      state.adminCities.length ? `${state.adminCities.length} city(ies).` : "No cities yet."
    );
  } catch (error) {
    setTextStatus(els.adminCitiesStatus, `Failed to load cities: ${error.message}`, "is-error");
  }
}

async function saveCity() {
  const payload = cityFormPayload();
  if (!state.editingCity) {
    setTextStatus(els.adminCitiesStatus, "Create cities in the Map Editor; select a city here to edit its name/country/publish.", "is-error");
    return;
  }
  setTextStatus(els.adminCitiesStatus, "Saving…");
  try {
    await apiRequest("/api/admin/cities", { method: "POST", body: payload });
    setTextStatus(els.adminCitiesStatus, `Saved ${payload.slug}.`);
    clearCityForm();
    loadAdminCities();
  } catch (error) {
    setTextStatus(els.adminCitiesStatus, `Save failed: ${error.message}`, "is-error");
  }
}

// ---------------------------------------------------------------------------
// Review queue (reharvest flags + issue reports; removals with data rank high).
// ---------------------------------------------------------------------------

function jumpToElement(el) {
  if (el && typeof el.scrollIntoView === "function") {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderReviewQueue(flags, issues) {
  const high = flags.filter((flag) => String(flag.kind || "").includes("removed")).length;
  if (els.reviewQueueCard) {
    els.reviewQueueCard.classList.toggle("is-attention", high > 0);
  }
  if (els.reviewFlagsJumpBtn) {
    els.reviewFlagsJumpBtn.hidden = flags.length === 0;
  }
  if (els.reviewIssuesJumpBtn) {
    els.reviewIssuesJumpBtn.hidden = issues.length === 0;
  }
  if (!els.reviewQueueSummary) {
    return;
  }
  const total = flags.length + issues.length;
  if (!total) {
    els.reviewQueueSummary.textContent = "Nothing needs review.";
    return;
  }
  const parts = [];
  if (flags.length) {
    parts.push(`${flags.length} reharvest flag(s)${high ? ` (${high} route removal${high > 1 ? "s" : ""})` : ""}`);
  }
  if (issues.length) {
    parts.push(`${issues.length} issue report(s)`);
  }
  els.reviewQueueSummary.textContent = `${total} open review item(s): ${parts.join(" · ")}.`;
}

async function refreshReviewQueue() {
  if (!els.reviewQueueSummary) {
    return;
  }
  try {
    const [flagsPayload, issuesPayload] = await Promise.all([
      apiRequest("/api/admin/reharvest/flags?status=open", { method: "GET" }),
      apiRequest("/api/admin/issues?status=open", { method: "GET" })
    ]);
    renderReviewQueue(
      Array.isArray(flagsPayload?.flags) ? flagsPayload.flags : [],
      Array.isArray(issuesPayload?.issues) ? issuesPayload.issues : []
    );
  } catch (error) {
    els.reviewQueueSummary.textContent = `Could not check the review queue: ${error.message}`;
  }
}

async function init() {
  els.adminEmailInput.value = "";
  els.adminPasswordInput.value = "";
  bindEvents();

  // Apply the saved light/dark theme and wire the toggle.
  if (typeof initAdminTheme === "function") {
    initAdminTheme(document.getElementById("themeToggleBtn"));
  }

  if (state.token) {
    try {
      await apiRequest("/api/admin/session");
      setAdminLocked(false);
      setStatus("Logged in.");
      await refreshAll();
      await loadAdminCities();
      await refreshReviewQueue();
      await loadReharvestFlags();
      await loadIssueReports({ showResolved: false });
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
