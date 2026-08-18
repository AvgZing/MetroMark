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
  }
];

function registerMapSources(map) {
  for (const sourceDef of MAP_SOURCE_DEFS) {
    try {
      const { id, ...sourceOptions } = sourceDef;
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
