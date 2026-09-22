// Values shared by the app and the admin override tool.
// Station-level stop location types requested from /api/transit/route-stops.
// Mirrors DEFAULT_STOP_TYPES in server/routes/helpers.js.
var ROUTE_STOP_TYPES = [0, 1];
var ROUTE_STOP_TYPES_KEY = ROUTE_STOP_TYPES.join("-");
var ROUTE_STOP_TYPES_QUERY = ROUTE_STOP_TYPES.join(",");

// Maximum characters for an issue-report screenshot data URL. Mirrors
// MAX_SCREENSHOT_CHARS in server/processors/data/issue-reports.js.
var REPORT_SCREENSHOT_MAX_CHARS = 600000;
