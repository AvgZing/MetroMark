/** Restore the user session from a stored token and refresh auth-dependent UI state. */
async function hydrateSession() {
  if (!state.token) {
    updateAuthUi();
    return;
  }

  try {
    const me = await apiRequest("/api/auth/me", { method: "GET" });
    state.user = me.user;
    if (state.lineViewOrderingVoteClickSetsByLineKey) {
      state.lineViewOrderingVoteClickSetsByLineKey.clear();
    }
    if (typeof applyUserPreferences === "function") {
      applyUserPreferences(me.user?.preferences || {});
    }
    updateAuthUi();
  } catch {
    setToken("");
    state.user = null;
    if (state.lineViewOrderingVoteClickSetsByLineKey) {
      state.lineViewOrderingVoteClickSetsByLineKey.clear();
    }
    updateAuthUi();
  }
}

/** Sync the auth panel DOM to reflect the current login state and user identity. */
function updateAuthUi() {
  const loggedIn = Boolean(state.user);
  els.authLoggedOut.hidden = loggedIn;
  els.authLoggedIn.hidden = !loggedIn;
  els.currentUserLabel.textContent = loggedIn ? `${state.user.displayName} (${state.user.email})` : "-";
  if (typeof window.updateFilterPresetAuthState === "function") {
    window.updateFilterPresetAuthState();
  }
  if (typeof window.refreshFilterPresets === "function") {
    window.refreshFilterPresets({ silent: true }).catch(function() {});
  }
  renderUserStatus();
  renderLineView({ forceStopRefresh: true });
}

/** Complete a login flow using a payload promise, then refresh UI and apply user state. */
async function loginWithPayload(payloadPromise, options) {
  options = options || {};
  const payload = await payloadPromise;
  if (typeof setAuthFeedback === "function") {
    setAuthFeedback();
  }
  setToken(payload.token, Boolean(options.remember));
  state.user = payload.user;
  if (state.lineViewOrderingVoteClickSetsByLineKey) {
    state.lineViewOrderingVoteClickSetsByLineKey.clear();
  }
  if (typeof applyUserPreferences === "function") {
    applyUserPreferences(payload.user?.preferences || {});
  }
  updateAuthUi();
  closePopups();
  await loadProgress();

  if (typeof loadFilterPresets === "function") {
    try {
      await loadFilterPresets({ silent: true });
      if (typeof cachedPresets !== "undefined" && Array.isArray(cachedPresets)) {
        var defaultPreset = cachedPresets.find(function(p) { return String(p.name || "").trim() === "__defaults__"; });
        if (defaultPreset && typeof applyFilterSnapshot === "function") {
          applyFilterSnapshot(defaultPreset.snapshot || {});
        }
      }
    } catch (e) {
      // non-fatal
    }
  }

  var customMessage = String(options.successMessage || "").trim();
  var statusMessage = customMessage || "Signed in as " + payload.user.displayName + ".";
  setStatus(statusMessage, "ok");
}
