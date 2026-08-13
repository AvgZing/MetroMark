function setToken(token, remember = true) {
  appState.token = token || "";
  if (!appState.token) {
    localStorage.removeItem("metromark_token");
    sessionStorage.removeItem("metromark_token");
    return;
  }

  if (remember) {
    localStorage.setItem("metromark_token", appState.token);
    sessionStorage.removeItem("metromark_token");
  } else {
    sessionStorage.setItem("metromark_token", appState.token);
    localStorage.removeItem("metromark_token");
  }
}

async function apiRequest(path, options = {}) {
  const requestPath = String(path || "");
  const now = Date.now();
  const isTransitRequest = requestPath.startsWith("/api/transit/");

  if (isTransitRequest && Number(appState.transitApiCooldownUntil || 0) > now) {
    throw new Error("Transit API temporarily unavailable. Retrying shortly.");
  }

  appState.clientApiRequestCount += 1;
  renderApiCounter();

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (appState.token) {
    headers.Authorization = `Bearer ${appState.token}`;
  }

  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers
    });
  } catch (error) {
    if (isTransitRequest) {
      appState.transitApiCooldownUntil = Date.now() + 30000;
      setBackendStatus("Transit backend connection failed. Pausing transit requests briefly before retrying.");
    }
    throw error;
  }

  const payload = await response.json().catch(() => ({}));

  const nextRestRequests = Number(payload?.transitlandRestApiRequests);
  const nextRestFailures = Number(payload?.transitlandRestApiRequestFailures);
  const nextVectorRequests = Number(payload?.transitlandVectorTileRequests);
  const nextVectorFailures = Number(payload?.transitlandVectorTileRequestFailures);
  const nextRoutingRequests = Number(payload?.transitlandRoutingApiRequests);
  const nextRoutingFailures = Number(payload?.transitlandRoutingApiRequestFailures);
  const nextPostgresQueries = Number(payload?.postgresQueryCount);
  const nextPostgresFailures = Number(payload?.postgresQueryFailureCount);

  if (Number.isFinite(nextRestRequests) && nextRestRequests >= 0) {
    appState.transitlandRestApiRequestCount = nextRestRequests;
  }
  if (Number.isFinite(nextRestFailures) && nextRestFailures >= 0) {
    appState.transitlandRestApiFailureCount = nextRestFailures;
  }
  if (Number.isFinite(nextVectorRequests) && nextVectorRequests >= 0) {
    appState.transitlandVectorTileRequestCount = nextVectorRequests;
  }
  if (Number.isFinite(nextVectorFailures) && nextVectorFailures >= 0) {
    appState.transitlandVectorTileFailureCount = nextVectorFailures;
  }
  if (Number.isFinite(nextRoutingRequests) && nextRoutingRequests >= 0) {
    appState.transitlandRoutingApiRequestCount = nextRoutingRequests;
  }
  if (Number.isFinite(nextRoutingFailures) && nextRoutingFailures >= 0) {
    appState.transitlandRoutingApiFailureCount = nextRoutingFailures;
  }
  if (Number.isFinite(nextPostgresQueries) && nextPostgresQueries >= 0) {
    appState.postgresQueryCount = nextPostgresQueries;
  }
  if (Number.isFinite(nextPostgresFailures) && nextPostgresFailures >= 0) {
    appState.postgresQueryFailureCount = nextPostgresFailures;
  }
  renderApiCounter();

  if (!response.ok) {
    const message = payload.error || payload.detail || `Request failed (${response.status}).`;
    throw new Error(message);
  }

  return payload;
}

// Initialize line view ordering controls
function initializeDiagnostics() {
  const rerenderCurrentLineView = () => {
    if (!appState.lineViewOpen || !appState.lineViewLineKey) {
      syncLineViewOrderingControls();
      return;
    }

    const lineKey = String(appState.lineViewLineKey).trim();
    applyLineViewOrderingPreference(lineKey);
    renderLineViewStops(
      lineKey,
      appState.lineSummaries.find((entry) => entry.lineKey === lineKey)?.color || '#177ca2',
      { forceRefresh: true, orderingMode: appState.lineViewOrderingMode }
    ).catch((error) => console.error('Error re-rendering line view stops:', error));
  };

  const setOrderingMode = (newMode) => {
    const normalizedMode = normalizeLineViewOrderingMode(newMode);
    const lineKey = String(appState.lineViewLineKey || appState.focusedLineKey || "").trim();
    if (!lineKey) {
      appState.lineViewOrderingMode = normalizedMode;
      syncLineViewOrderingControls();
      return;
    }

    const current = getLineViewOrderingPreference(lineKey);
    if (current.mode === normalizedMode) {
      applyLineViewOrderingPreference(lineKey);
      syncLineViewOrderingControls();
      return;
    }

    setLineViewOrderingPreference(lineKey, { mode: normalizedMode });
    applyLineViewOrderingPreference(lineKey);
    rerenderCurrentLineView();
  };

  const toggleReverse = () => {
    const lineKey = String(appState.lineViewLineKey || appState.focusedLineKey || "").trim();
    if (!lineKey) {
      appState.lineViewOrderingReversed = !appState.lineViewOrderingReversed;
      syncLineViewOrderingControls();
      return;
    }

    const current = getLineViewOrderingPreference(lineKey);
    setLineViewOrderingPreference(lineKey, { reversed: !current.reversed });
    applyLineViewOrderingPreference(lineKey);
    rerenderCurrentLineView();
  };

  if (dom.lineViewOrderingAutoBtn) {
    dom.lineViewOrderingAutoBtn.addEventListener('click', () => setOrderingMode('auto'));
  }

  if (dom.lineViewOrderingGeometryRevisedBtn) {
    dom.lineViewOrderingGeometryRevisedBtn.addEventListener('click', () => setOrderingMode('geometry-revised'));
  }

  if (dom.lineViewOrderingGeometryBtn) {
    dom.lineViewOrderingGeometryBtn.addEventListener('click', () => setOrderingMode('legacy-geometry'));
  }

  if (dom.lineViewOrderingFractionsBtn) {
    dom.lineViewOrderingFractionsBtn.addEventListener('click', () => setOrderingMode('fractions'));
  }

  if (dom.lineViewOrderingReverseBtn) {
    dom.lineViewOrderingReverseBtn.addEventListener('click', toggleReverse);
  }
}
