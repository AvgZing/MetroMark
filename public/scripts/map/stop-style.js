// Stop marker styling shared by the map paint (route-layer-defs.js) and the
// line-view stop list (lineview.js): outline = route colour, fill = status.

var STOP_STYLE = {
  visitedFill: "#1a9b66",
  // Light enough to read against the visited green in both themes.
  unvisitedFill: "#c2c7cd",
  strokeWidth: 1.4
};

function stopMarkerColorExpression() {
  return [
    "case",
    ["==", ["coalesce", ["to-number", ["feature-state", "visited"]], 0], 1],
    STOP_STYLE.visitedFill,
    STOP_STYLE.unvisitedFill
  ];
}

function stopFillForVisited(visited) {
  return visited ? STOP_STYLE.visitedFill : STOP_STYLE.unvisitedFill;
}
