function setToken(token, remember = true) {
  state.token = token || "";
  if (!state.token) {
    localStorage.removeItem("metromark_token");
    sessionStorage.removeItem("metromark_token");
    return;
  }

  if (remember) {
    localStorage.setItem("metromark_token", state.token);
    sessionStorage.removeItem("metromark_token");
  } else {
    sessionStorage.setItem("metromark_token", state.token);
    localStorage.removeItem("metromark_token");
  }
}

async function apiRequest(path, options = {}) {
  const requestPath = String(path || "");
  const now = Date.now();
  const isTransitRequest = requestPath.startsWith("/api/transit/");

  if (isTransitRequest && Number(state.transitApiCooldownUntil || 0) > now) {
    throw new Error("Transit API temporarily unavailable. Retrying shortly.");
  }

  state.clientApiRequestCount += 1;
  renderApiCounter();

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers
    });
  } catch (error) {
    if (isTransitRequest) {
      state.transitApiCooldownUntil = Date.now() + 30000;
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
    state.transitlandRestApiRequestCount = nextRestRequests;
  }
  if (Number.isFinite(nextRestFailures) && nextRestFailures >= 0) {
    state.transitlandRestApiFailureCount = nextRestFailures;
  }
  if (Number.isFinite(nextVectorRequests) && nextVectorRequests >= 0) {
    state.transitlandVectorTileRequestCount = nextVectorRequests;
  }
  if (Number.isFinite(nextVectorFailures) && nextVectorFailures >= 0) {
    state.transitlandVectorTileFailureCount = nextVectorFailures;
  }
  if (Number.isFinite(nextRoutingRequests) && nextRoutingRequests >= 0) {
    state.transitlandRoutingApiRequestCount = nextRoutingRequests;
  }
  if (Number.isFinite(nextRoutingFailures) && nextRoutingFailures >= 0) {
    state.transitlandRoutingApiFailureCount = nextRoutingFailures;
  }
  if (Number.isFinite(nextPostgresQueries) && nextPostgresQueries >= 0) {
    state.postgresQueryCount = nextPostgresQueries;
  }
  if (Number.isFinite(nextPostgresFailures) && nextPostgresFailures >= 0) {
    state.postgresQueryFailureCount = nextPostgresFailures;
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
    if (!state.lineViewOpen || !state.lineViewLineKey) {
      syncLineViewOrderingControls();
      return;
    }

    const lineKey = String(state.lineViewLineKey).trim();
    applyLineViewOrderingPreference(lineKey);
    renderLineViewStops(
      lineKey,
      state.lineSummaries.find((entry) => entry.lineKey === lineKey)?.color || '#177ca2',
      { forceRefresh: true, orderingMode: state.lineViewOrderingMode }
    ).catch((error) => console.error('Error re-rendering line view stops:', error));
  };

  const setOrderingMode = (newMode) => {
    const normalizedMode = normalizeLineViewOrderingMode(newMode);
    const lineKey = String(state.lineViewLineKey || state.focusedLineKey || "").trim();
    if (!lineKey) {
      state.lineViewOrderingMode = normalizedMode;
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
    const lineKey = String(state.lineViewLineKey || state.focusedLineKey || "").trim();
    if (!lineKey) {
      state.lineViewOrderingReversed = !state.lineViewOrderingReversed;
      syncLineViewOrderingControls();
      return;
    }

    const current = getLineViewOrderingPreference(lineKey);
    setLineViewOrderingPreference(lineKey, { reversed: !current.reversed });
    applyLineViewOrderingPreference(lineKey);
    rerenderCurrentLineView();
  };

  if (els.lineViewOrderingAutoBtn) {
    els.lineViewOrderingAutoBtn.addEventListener('click', () => setOrderingMode('auto'));
  }

  if (els.lineViewOrderingGeometryRevisedBtn) {
    els.lineViewOrderingGeometryRevisedBtn.addEventListener('click', () => setOrderingMode('geometry-revised'));
  }

  if (els.lineViewOrderingGeometryBtn) {
    els.lineViewOrderingGeometryBtn.addEventListener('click', () => setOrderingMode('legacy-geometry'));
  }

  if (els.lineViewOrderingFractionsBtn) {
    els.lineViewOrderingFractionsBtn.addEventListener('click', () => setOrderingMode('fractions'));
  }

  if (els.lineViewOrderingReverseBtn) {
    els.lineViewOrderingReverseBtn.addEventListener('click', toggleReverse);
  }
}
