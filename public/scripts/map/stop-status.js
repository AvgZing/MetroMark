// Colorblind-mode stop glyphs (check/cross on the fill). MapLibre rejects
// feature-state in layout, so each status is its own layer with a paint gate.

var STOP_STATUS_ICON_LAYER_PREFIX = "stops-status-icon-";
var STOP_STATUS_ICON_CANVAS = 32;

function stopStatusIconSpecs() {
  return [
    { status: "visited", imageId: "stop-status-visited", glyph: "check" },
    { status: "unvisited", imageId: "stop-status-unvisited", glyph: "cross" }
  ];
}

function drawStopStatusGlyph(ctx, glyph, size) {
  const draw = (width, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    if (glyph === "check") {
      ctx.moveTo(size * 0.26, size * 0.53);
      ctx.lineTo(size * 0.43, size * 0.7);
      ctx.lineTo(size * 0.76, size * 0.29);
    } else if (glyph === "cross") {
      ctx.moveTo(size * 0.31, size * 0.31);
      ctx.lineTo(size * 0.69, size * 0.69);
      ctx.moveTo(size * 0.69, size * 0.31);
      ctx.lineTo(size * 0.31, size * 0.69);
    } else {
      // Non check/cross glyphs render as text (future numbered statuses).
      ctx.fillStyle = color;
      ctx.font = `${Math.round(size * 0.6)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(glyph), size / 2, size / 2 + size * 0.03);
      return;
    }
    ctx.stroke();
  };

  ctx.clearRect(0, 0, size, size);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Dark halo under a light glyph so the mark reads on both fills.
  draw(size * 0.22, "rgba(0, 0, 0, 0.5)");
  draw(size * 0.12, "#ffffff");
}

function createStopStatusImage(glyph, size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  drawStopStatusGlyph(ctx, glyph, size);
  return ctx.getImageData(0, 0, size, size);
}

function ensureStopStatusIcons(map) {
  for (const spec of stopStatusIconSpecs()) {
    if (!map.hasImage(spec.imageId)) {
      map.addImage(spec.imageId, createStopStatusImage(spec.glyph, STOP_STATUS_ICON_CANVAS));
    }
  }
}

function stopStatusBaseOpacity() {
  return [
    "case",
    ["==", ["coalesce", ["to-number", ["feature-state", "visible"]], 0], 1],
    [
      "case",
      ["==", ["coalesce", ["to-number", ["feature-state", "show_all"]], 0], 1],
      1,
      ["case", ["==", ["coalesce", ["to-number", ["feature-state", "focused"]], 0], 1], 0.94, 0.32]
    ],
    0
  ];
}

function stopStatusVisitedMatch() {
  return ["==", ["coalesce", ["to-number", ["feature-state", "visited"]], 0], 1];
}

function stopStatusOpacityFor(spec) {
  const gate = spec.status === "visited"
    ? ["case", stopStatusVisitedMatch(), 1, 0]
    : ["case", stopStatusVisitedMatch(), 0, 1];
  return ["*", stopStatusBaseOpacity(), gate];
}

function stopStatusIconsEnabled() {
  return Boolean(typeof appState !== "undefined" && appState.colorblindMode);
}

function applyStopStatusIcons() {
  const map = typeof appState !== "undefined" ? appState.map : null;
  if (!map || typeof map.getSource !== "function" || !map.getSource("stops")) {
    return;
  }

  ensureStopStatusIcons(map);
  const visibility = stopStatusIconsEnabled() ? "visible" : "none";

  for (const spec of stopStatusIconSpecs()) {
    const layerId = `${STOP_STATUS_ICON_LAYER_PREFIX}${spec.status}`;
    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: "symbol",
        source: "stops",
        layout: {
          "icon-image": spec.imageId,
          "icon-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4,
            0.17,
            8,
            0.25,
            11,
            0.33,
            14,
            0.42
          ],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-anchor": "center",
          visibility
        },
        paint: {
          "icon-opacity": stopStatusOpacityFor(spec)
        }
      });
      continue;
    }

    map.setLayoutProperty(layerId, "visibility", visibility);
    map.setPaintProperty(layerId, "icon-opacity", stopStatusOpacityFor(spec));
  }
}
