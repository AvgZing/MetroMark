// "Suggest changes" — lets a user propose route corrections from the line view.
// Desktop shows the editor inline in the line-view panel; portrait mobile moves
// the same form into a modal. Submissions go to /api/suggestions for review.

let suggestLineKey = "";
let suggestBaseline = { operatorName: "", color: "", mode: "" };
let suggestUsingModal = false;

function suggestEl(id) {
  return document.getElementById(id);
}

function suggestIsMobile() {
  return typeof isPortraitMobileLayout === "function" && isPortraitMobileLayout();
}

function openSuggest() {
  const raw = appState.lineViewLineKey || appState.focusedLineKey || "";
  const lineKey = typeof resolveCanonicalLineKey === "function" ? resolveCanonicalLineKey(raw) : String(raw).trim();
  if (!lineKey) {
    if (typeof setStatus === "function") {
      setStatus("Open a route first, then suggest changes.", "error");
    }
    return;
  }

  const line = (appState.lineSummaries || []).find((entry) => entry.lineKey === lineKey) || {};
  suggestLineKey = lineKey;
  suggestBaseline = {
    operatorName: String(line.operatorName || ""),
    color: String(line.color || ""),
    mode: line.routeType !== null && line.routeType !== undefined ? String(line.routeType) : ""
  };

  suggestEl("suggestShortNameInput").value = "";
  suggestEl("suggestLongNameInput").value = "";
  suggestEl("suggestOperatorInput").value = suggestBaseline.operatorName;
  suggestEl("suggestColorInput").value = suggestBaseline.color;
  suggestEl("suggestModeInput").value = suggestBaseline.mode;
  suggestEl("suggestNoteInput").value = "";
  suggestEl("suggestRouteLabel").textContent = `${line.lineName || lineKey} (${lineKey}) — an admin reviews every suggestion.`;
  const statusEl = suggestEl("suggestStatus");
  statusEl.hidden = true;
  statusEl.textContent = "";

  const form = suggestEl("suggestForm");
  suggestUsingModal = suggestIsMobile();
  if (suggestUsingModal) {
    const modalBody = suggestEl("suggestModalBody");
    if (modalBody && form.parentElement !== modalBody) {
      modalBody.appendChild(form);
    }
    suggestEl("suggestModal").hidden = false;
  } else {
    const slot = suggestEl("lineViewSuggestSlot");
    if (slot && form.parentElement !== slot) {
      slot.appendChild(form);
    }
    suggestEl("suggestModal").hidden = true;
  }
  form.hidden = false;
  suggestEl("suggestShortNameInput").focus();
}

function closeSuggest() {
  const form = suggestEl("suggestForm");
  if (form) {
    form.hidden = true;
    const slot = suggestEl("lineViewSuggestSlot");
    if (slot && form.parentElement !== slot) {
      slot.appendChild(form);
    }
  }
  const modal = suggestEl("suggestModal");
  if (modal) {
    modal.hidden = true;
  }
  suggestUsingModal = false;
  suggestLineKey = "";
}

async function submitRouteSuggestion() {
  if (!suggestLineKey) {
    return;
  }
  const payload = {};
  const short = suggestEl("suggestShortNameInput").value.trim();
  const long = suggestEl("suggestLongNameInput").value.trim();
  const operator = suggestEl("suggestOperatorInput").value.trim();
  const color = suggestEl("suggestColorInput").value.trim();
  const mode = suggestEl("suggestModeInput").value.trim();

  if (short) payload.lineShortName = short;
  if (long) payload.lineLongName = long;
  if (operator && operator !== suggestBaseline.operatorName) payload.operatorName = operator;
  if (color && color !== suggestBaseline.color) payload.color = color;
  if (mode !== "" && mode !== suggestBaseline.mode) payload.mode = Number(mode);

  const statusEl = suggestEl("suggestStatus");
  if (!Object.keys(payload).length) {
    statusEl.hidden = false;
    statusEl.textContent = "Enter at least one change to suggest.";
    return;
  }

  const button = suggestEl("suggestSubmitBtn");
  button.disabled = true;
  statusEl.hidden = false;
  statusEl.textContent = "Sending…";
  try {
    const response = await fetch("/api/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lineKey: suggestLineKey,
        citySlug: appState.activeCitySlug || "",
        payload,
        note: suggestEl("suggestNoteInput").value.trim()
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || `HTTP ${response.status}`);
    }
    statusEl.textContent = "Thanks! Your suggestion was sent for review.";
    window.setTimeout(closeSuggest, 1200);
  } catch (error) {
    statusEl.textContent = `Failed to send: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

function initRouteSuggest() {
  const openBtn = suggestEl("lineViewSuggestBtn");
  if (openBtn) {
    openBtn.addEventListener("click", () => {
      const form = suggestEl("suggestForm");
      if (form && !form.hidden) {
        closeSuggest();
      } else {
        openSuggest();
      }
    });
  }
  const closeBtn = suggestEl("suggestInlineCloseBtn");
  if (closeBtn) {
    closeBtn.addEventListener("click", closeSuggest);
  }
  const submitBtn = suggestEl("suggestSubmitBtn");
  if (submitBtn) {
    submitBtn.addEventListener("click", submitRouteSuggestion);
  }
  const modal = suggestEl("suggestModal");
  if (modal) {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeSuggest();
      }
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && suggestEl("suggestForm") && !suggestEl("suggestForm").hidden) {
      closeSuggest();
    }
  });
}

initRouteSuggest();
