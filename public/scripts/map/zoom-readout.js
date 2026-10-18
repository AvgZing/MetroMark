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
  readout.setAttribute("role", "button");
  readout.tabIndex = 0;
  readout.setAttribute("aria-label", "Reset zoom to default");
  readout.title = "Click to reset zoom to 9.5";

  const resetZoom = () => {
    if (appState.map) {
      appState.map.easeTo({ zoom: 9.5, duration: 300 });
    }
  };
  readout.addEventListener("click", resetZoom);
  readout.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      resetZoom();
    }
  });

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
