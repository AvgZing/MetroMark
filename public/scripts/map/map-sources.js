const MAP_SOURCE_DEFS = [
  {
    id: "routes",
    type: "geojson",
    promoteId: "feature_id",
    data: emptyFeatureCollection()
  },
  {
    id: "stops",
    type: "geojson",
    promoteId: "feature_id",
    data: emptyFeatureCollection()
  },
  {
    id: "routes-vector",
    type: "vector",
    url: "pmtiles:///api/tiles/routes.pmtiles",
    promoteId: "line_key",
    versioned: true
  }
];

if (typeof maplibregl !== "undefined" && typeof pmtiles !== "undefined") {
  const pmtilesProtocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);
}

function registerMapSources(map) {
  for (const sourceDef of MAP_SOURCE_DEFS) {
    try {
      const { id, versioned, ...sourceOptions } = sourceDef;
      if (versioned && typeof vectorSourceUrl === "function") {
        // The archive URL carries its build stamp so a rebuilt archive is a new
        // URL for every cache in the chain.
        sourceOptions.url = vectorSourceUrl();
      }
      map.addSource(id, sourceOptions);
    } catch (error) {
      console.warn(`Failed to add source "${sourceDef.id}":`, error);
    }
  }
}

function unregisterMapSources(map) {
  for (const sourceDef of MAP_SOURCE_DEFS) {
    try {
      if (map.getSource(sourceDef.id)) {
        map.removeSource(sourceDef.id);
      }
    } catch (error) {
      // Source not present; nothing to remove
    }
  }
}
