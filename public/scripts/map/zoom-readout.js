function initZoomReadout() {
  if (!appState.map) {
    return;
  }

  const container = appState.map.getContainer();
  if (!container) {
    return;
  }

  const zoomInBtn = container.querySelector(".maplibregl-ctrl-zoom-in");
  const zoomOutBtn = container.querySelector(".maplibregl-ctrl-zoom-out");
  if (!zoomInBtn || !zoomOutBtn) {
    return;
  }

  const existing = container.querySelector(".zoom-readout");
  if (existing) {
    existing.remove();
  }

  const readout = document.createElement("div");
  readout.className = "zoom-readout";
  readout.setAttribute("aria-hidden", "true");
  readout.title = "Current zoom level";

  const update = () => {
    if (!appState.map) {
      return;
    }
    readout.textContent = Number(appState.map.getZoom()).toFixed(1);
  };

  zoomInBtn.insertAdjacentElement("afterend", readout);
  update();

  appState.map.on("zoom", update);
  appState.map.on("zoomend", update);
}
