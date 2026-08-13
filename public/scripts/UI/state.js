// Postgres (cache-only) is primary at all zoom levels.
// Transitland fallback triggers at zoom 10+. Individual tile bboxes are
// validated server-side by BBOX_MAX_SPAN_DEGREES, and Transitland's own
// rate limits protect against abuse.
const MIN_VIEWPORT_FETCH_ZOOM = 10.0;
// Low-zoom views can span multiple metro regions; keep a larger request budget so
// distant cached areas (e.g. Seattle + DC at US scale) can load together.
const MAX_TARGET_TILES_PER_VIEW = 24;
const MAX_NEW_FETCHES_PER_VIEW = 36;
const MAX_PARALLEL_FETCHES = 4;
const MAX_SESSION_AREAS = 440;
const MAX_SESSION_ROUTE_STOP_PAYLOADS = 30;
const MIN_MOVE_FETCH_INTERVAL_MS = 1800;

const ROUTE_STOP_TYPES = [0, 1];
const ROUTE_STOP_TYPES_KEY = ROUTE_STOP_TYPES.join("-");
const ROUTE_STOP_TYPES_QUERY = ROUTE_STOP_TYPES.join(",");

const SHOW_ALL_STOPS_STORAGE_KEY = "metromark_show_all_stops";

const DEFAULT_ACTIVE_MODE_KEYS = [MODE_FILTER_METRO, MODE_FILTER_TRAM, MODE_FILTER_RAIL, MODE_FILTER_OTHER];

const DEFAULT_ACTIVE_FREQUENCY_KEYS = [FREQUENCY_FILTER_ALL];

const LINE_VIEW_ORDERING_PREFERENCES_STORAGE_KEY = "metromark_line_view_ordering_preferences";
const appState = {
  map: null,
  mapReady: false,
  mapReadyResolver: null,
  mapMode: "streets",
  token: localStorage.getItem("metromark_token") || sessionStorage.getItem("metromark_token") || "",
  user: null,
  cities: [],
  transit: null,
  _viewportPayload: null,
  _forceRefreshInFlight: false,
  mapRenderedTransit: null,
  lastMapFeatureStateSignature: "",
  mapRouteFeatureStateCache: new Map(),
  mapStopFeatureStateCache: new Map(),
  lineSummaries: [],
  loadedLineSummaries: [],
  viewportSummaryLineSummaries: [],
  viewportSummaryTransit: null,
  viewportSummaryRequestToken: 0,
  areaCache: new Map(),
  lineStopsCache: new Map(),
  routeStopsAutoLoadAttempts: new Map(),
  routeStopCountLoadAttempts: new Set(),
  inFlightLineStopKeys: new Set(),
  inFlightRouteStopCountKeys: new Set(),
  inFlightHeadwayLineKeys: new Set(),
  requestedAreaKeys: new Set(),
  currentViewportBbox: null,
  lastViewportFetchBbox: null,
  lastViewportFetchZoom: null,
  visibleAreaKeys: new Set(),
  activeAreaKeys: new Set(),
  fetchQueue: [],
  queuedAreaKeys: new Set(),
  inFlightAreaKeys: new Set(),
  queueDrainRunning: false,
  focusedLineKey: "",
  activeModeKeys: parseSetFromStorage("metromark_mode_filter_keys", DEFAULT_ACTIVE_MODE_KEYS),
  activeFrequencyKeys: parseSetFromStorage(
    "metromark_frequency_filter_keys",
    DEFAULT_ACTIVE_FREQUENCY_KEYS
  ),
  manualLineVisibility: parseVisibilityOverridesFromStorage("metromark_route_visibility_overrides"),
  showAllStops: parseBooleanFromStorage(SHOW_ALL_STOPS_STORAGE_KEY, false),
  showPrivateOperators: parseBooleanFromStorage("metromark_show_private_operators", false),
  showProblematicGeometries: parseBooleanFromStorage("metromark_show_problematic_geometries", false),
  lineSearchQuery: "",
  initialCitySlug: localStorage.getItem("metromark_initial_city_slug") || "seattle",
  theme: localStorage.getItem("metromark_theme") || "light",
  lastMoveFetchAt: 0,
  activePopup: "",
  hoverPopup: null,
  routeHoverPopup: null,
  routeSelectPopup: null,
  lastStopClickAt: 0,
  lastRouteClickAt: 0,
  mobilePanelsOpen: false,
  lineViewOpen: false,
  lineViewLineKey: "",
  lineViewReturn: null,
  lineViewOrderingPreferencesByLineKey: parseLineViewOrderingPreferencesFromStorage(LINE_VIEW_ORDERING_PREFERENCES_STORAGE_KEY),
  lineViewOrderingVoteClickSetsByLineKey: new Map(),
  lineViewOrderingMode: "auto",
  lineViewOrderingReversed: false,
  lineViewOrderingResolved: "geometry-revised",
  lineViewAutoOpenEnabled: localStorage.getItem("metromark_line_view_auto_open") !== "false", // Default to true
  userStatusPinnedKind: "",
  clearRouteProgressConfirmLineKey: "",
  clearRouteProgressConfirmTimeoutId: null,
  userFeedback: {
    message: "",
    kind: "neutral"
  },
  visitedByLine: new Map(),
  userStatus: {
    title: "No route selected.",
    subtitle: "Select a route or station.",
    details: [],
    routeLineKey: "",
    progress: null
  },
  clientApiRequestCount: 0,
  postgresQueryCount: 0,
  postgresQueryFailureCount: 0,
  viewportRequestCount: 0,
  postgresViewportHitCount: 0,
  postgresViewportMissCount: 0,
  transitlandViewportFetchCount: 0,
  transitlandRestApiRequestCount: 0,
  transitlandRestApiFailureCount: 0,
  transitlandVectorTileRequestCount: 0,
  transitlandVectorTileFailureCount: 0,
  transitlandRoutingApiRequestCount: 0,
  transitlandRoutingApiFailureCount: 0,
  transitApiCooldownUntil: 0,
  loadEpoch: 0,
  lastLoadStats: {
    requested: 0,
    cached: 0,
    queued: 0,
    deferred: 0,
    failed: 0,
    successful: 0
  },
  routeReviewsByCity: new Map(),
  agencyReviewsByCity: new Map(),
  renderBatchTimer: null,
  renderBatchToken: 0,
  loadTimings: []
};
