function toMultiLineStringGeometry(geometry) {
  if (!geometry || !geometry.type || !Array.isArray(geometry.coordinates)) {
    return null;
  }
  if (geometry.type === "MultiLineString") {
    return {
      type: "MultiLineString",
      coordinates: geometry.coordinates
    };
  }
  if (geometry.type === "LineString") {
    return {
      type: "MultiLineString",
      coordinates: [geometry.coordinates]
    };
  }
  return null;
}

function routeToFeature(route) {
  const geometry = toMultiLineStringGeometry(route.geometry);
  if (!geometry) {
    return null;
  }
  return {
    type: "Feature",
    id: route.lineKey,
    properties: {
      line_key: route.lineKey,
      route_type: route.routeType,
      line_name: route.lineName,
      color: route.color,
      operator_name: route.operatorName,
      mode: route.mode,
      onestop_id: route.routeOnestopId
    },
    geometry
  };
}

module.exports = {
  toMultiLineStringGeometry,
  routeToFeature
};
