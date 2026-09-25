// Cities menu content + city mode. Open/close is owned by sheet.js; this only
// fills the list and tracks the active city. "" = Globe View (no filter).

function publishedCityBySlug(slug) {
  const key = String(slug || "").trim();
  if (!key) {
    return null;
  }
  return (appState.publishedCities || []).find((city) => String(city.slug || "") === key) || null;
}

function cityModeActive() {
  return Boolean(
    appState.activeCitySlug &&
      appState.cityRouteKeysBySlug instanceof Map &&
      appState.cityRouteKeysBySlug.has(appState.activeCitySlug)
  );
}

function closeCitiesSheet() {
  if (typeof window.setCitiesSheetOpen === "function") {
    window.setCitiesSheetOpen(false);
    return;
  }
  if (dom.citiesBackdrop) {
    dom.citiesBackdrop.hidden = true;
    document.body.classList.remove("cities-panel-open");
  }
}

function updateCityRecenterButton() {
  if (!dom.cityRecenterBtn) {
    return;
  }
  const active = cityModeActive();
  dom.cityRecenterBtn.hidden = !active;
  if (active) {
    const city = publishedCityBySlug(appState.activeCitySlug);
    const title = `Recenter on ${city ? city.name || city.slug : "city"}`;
    dom.cityRecenterBtn.title = title;
    dom.cityRecenterBtn.setAttribute("aria-label", title);
  }
}

function flyToCity(slug) {
  const city = publishedCityBySlug(slug);
  if (!city || !appState.map || !appState.mapReady) {
    return;
  }
  const center = Array.isArray(city.center) ? city.center.map(Number) : null;
  const zoom = Number(city.defaultZoom);
  if (center && center.length === 2 && center.every(Number.isFinite) && Number.isFinite(zoom)) {
    appState.map.flyTo({ center, zoom, duration: 900 });
    return;
  }
  if (Array.isArray(city.bbox) && city.bbox.length === 4 && typeof fitToArea === "function") {
    fitToArea({ bbox: city.bbox });
  }
}

function refreshForCityMode() {
  if (typeof renderLineList === "function") renderLineList();
  if (typeof renderMapData === "function") renderMapData();
  if (typeof renderProgress === "function") renderProgress();
  if (typeof renderStatusBar === "function") renderStatusBar();
}

function setActiveCitySlug(slug, options = {}) {
  const key = String(slug || "").trim();
  const valid = Boolean(
    key && appState.cityRouteKeysBySlug instanceof Map && appState.cityRouteKeysBySlug.has(key)
  );
  appState.activeCitySlug = valid ? key : "";
  try {
    if (appState.activeCitySlug) {
      localStorage.setItem("metromark_active_city_slug", appState.activeCitySlug);
    } else {
      localStorage.removeItem("metromark_active_city_slug");
    }
  } catch {
    // storage unavailable — session-only
  }
  updateCityRecenterButton();
  if (options.fly !== false && appState.activeCitySlug) {
    flyToCity(appState.activeCitySlug);
  }
  refreshForCityMode();
  renderCitiesMenu();
  // Persist via the preferences pipeline (localStorage or account).
  if (typeof saveUserPreferences === "function") {
    saveUserPreferences({ activeCitySlug: appState.activeCitySlug }).catch(() => {});
  }
}

function cityMenuOption({ label, meta, active, onClick }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cities-menu-option" + (active ? " is-active" : "");
  button.setAttribute("aria-pressed", active ? "true" : "false");

  const text = document.createElement("span");
  text.className = "cities-menu-option-text";
  const name = document.createElement("span");
  name.className = "cities-menu-option-name";
  name.textContent = label;
  const metaEl = document.createElement("span");
  metaEl.className = "cities-menu-option-meta";
  metaEl.textContent = meta;
  text.append(name, metaEl);
  button.append(text);

  if (active) {
    const check = document.createElement("span");
    check.className = "cities-menu-option-check";
    check.setAttribute("aria-hidden", "true");
    check.textContent = "✓";
    button.append(check);
  }

  button.addEventListener("click", onClick);
  return button;
}

function renderCitiesMenu() {
  const list = dom.citiesMenuList;
  if (!list) {
    return;
  }
  list.innerHTML = "";
  updateCityRecenterButton();

  list.append(
    cityMenuOption({
      label: "Globe View",
      meta: "All routes · move anywhere",
      active: !appState.activeCitySlug,
      onClick: () => {
        setActiveCitySlug("", { fly: false });
        closeCitiesSheet();
      }
    })
  );

  const cities = appState.publishedCities || [];
  if (!cities.length) {
    const note = document.createElement("p");
    note.className = "cities-menu-note";
    note.textContent = "No vetted cities published yet.";
    list.append(note);
    return;
  }

  for (const city of cities) {
    list.append(
      cityMenuOption({
        label: city.name || city.slug,
        meta: `${city.routeCount || 0} routes`,
        active: appState.activeCitySlug === city.slug,
        onClick: () => {
          setActiveCitySlug(city.slug);
          closeCitiesSheet();
        }
      })
    );
  }
}

// Bootstrap calls this to restore the last city on startup.
function applyStartupCityMode() {
  updateCityRecenterButton();
  renderCitiesMenu();
  if (appState.activeCitySlug) {
    flyToCity(appState.activeCitySlug);
  }
}

function bindCityRecenter() {
  if (dom.cityRecenterBtn) {
    dom.cityRecenterBtn.addEventListener("click", () => {
      if (appState.activeCitySlug) {
        flyToCity(appState.activeCitySlug);
      }
    });
  }
}

// Fill the list when the sheet becomes visible (open/close is sheet.js's).
function observeCitiesSheet() {
  const backdrop = dom.citiesBackdrop;
  if (!backdrop || typeof MutationObserver !== "function") {
    return;
  }
  new MutationObserver(() => {
    if (!backdrop.hidden) {
      renderCitiesMenu();
    }
  }).observe(backdrop, { attributes: true, attributeFilter: ["hidden"] });
}

bindCityRecenter();
observeCitiesSheet();
updateCityRecenterButton();
