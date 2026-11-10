function protomapsFlavor(theme) {
  const value = String(new URLSearchParams(location.search).get("basemap") || "").toLowerCase();
  if (value === "protomaps-white") {
    return "white";
  }
  if (value === "protomaps-black") {
    return "black";
  }
  return theme === "dark" ? "black" : "white";
}

function protomapsSpriteUrl(flavor) {
  return `https://protomaps.github.io/basemaps-assets/sprites/v4/${flavor}`;
}

function protomapsGlyphsUrl() {
  return "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf";
}

function protomapsLayers(flavor) {
  const prefix = `basemap-${flavor}-`;
  return basemaps.layers("streets", basemaps.namedFlavor(flavor), { lang: "en" }).map((layer) => ({
    ...layer,
    id: `${prefix}${layer.id}`,
    layout: {
      ...(layer.layout || {}),
      visibility: "visible"
    }
  }));
}

function protomapsMapStyle(theme) {
  if (typeof basemaps === "undefined") {
    return null;
  }
  const flavor = protomapsFlavor(theme);
  return {
    version: 8,
    projection: { type: "globe" },
    glyphs: protomapsGlyphsUrl(),
    sprite: protomapsSpriteUrl(flavor),
    sources: {
      streets: {
        type: "vector",
        url: cartoVectorTileJsonUrl(),
        attribution: cartoAttribution()
      },
      satellite: {
        type: "raster",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256,
        attribution: "Esri"
      }
    },
    layers: [
      ...protomapsLayers(flavor),
      {
        id: "satellite-base",
        type: "raster",
        source: "satellite",
        layout: { visibility: "none" }
      }
    ]
  };
}

function applyProtomapsTheme(map, theme) {
  if (!map || typeof map.getStyle !== "function") {
    return false;
  }
  const style = map.getStyle();
  if (!style.sources || !style.sources.streets) {
    return false;
  }
  const flavor = protomapsFlavor(theme);
  const prefix = `basemap-${flavor}-`;
  const currentIds = (style.layers || [])
    .map((layer) => layer.id)
    .filter((id) => id.startsWith("basemap-"));

  if (!map.getLayer(`${prefix}background`)) {
    for (const id of currentIds) {
      map.removeLayer(id);
    }
    const beforeId = map.getLayer("satellite-base") ? "satellite-base" : undefined;
    for (const layer of protomapsLayers(flavor)) {
      map.addLayer(layer, beforeId);
    }
  }

  if (typeof map.setSprite === "function") {
    map.setSprite(protomapsSpriteUrl(flavor));
  }
  return true;
}
