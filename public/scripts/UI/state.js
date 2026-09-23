const SHOW_ALL_STOPS_STORAGE_KEY = "metromark_show_all_stops";

const DEFAULT_ACTIVE_MODE_KEYS = [MODE_FILTER_METRO, MODE_FILTER_TRAM, MODE_FILTER_RAIL, MODE_FILTER_OTHER];

const DEFAULT_ACTIVE_FREQUENCY_KEYS = [FREQUENCY_FILTER_ALL];

const LINE_VIEW_ORDERING_PREFERENCES_STORAGE_KEY = "metromark_line_view_ordering_preferences";
const MAX_SESSION_ROUTE_STOP_PAYLOADS = 30;

const appState = {
  map: null,
  mapReady: false,
  mapReadyResolver: null,
  mapMode: "streets",
  token: localStorage.getItem("metromark_token") || sessionStorage.getItem("metromark_token") || "",
  user: null,
  cities: [],
  transit: null,
  currentViewportBbox: null,
  transitCoverageCount: 0,
  lastMapFeatureStateSignature: "",
  lastStopsSourceKey: "",
  mapRouteFeatureStateCache: new Map(),
  mapStopFeatureStateCache: new Map(),
  lineSummaries: [],
  loadedLineSummaries: [],
  lineStopsCache: new Map(),
  routeStopsAutoLoadAttempts: new Map(),
  inFlightLineStopKeys: new Set(),
  inFlightHeadwayLineKeys: new Set(),
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
  colorblindMode: parseBooleanFromStorage("metromark_colorblind_mode", false),
  lineSearchQuery: "",
  initialCitySlug: localStorage.getItem("metromark_initial_city_slug") || "seattle",
  // City mode is opt-in: "" is Globe View (today's default, all routes). Kept
  // separate from initialCitySlug (review scoping) so publishing a city never
  // changes anyone's startup mode.
  activeCitySlug: localStorage.getItem("metromark_active_city_slug") || "",
  publishedCities: [],
  cityRouteKeysBySlug: new Map(),
  theme: localStorage.getItem("metromark_theme") || "dark",
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
  transitlandRestApiRequestCount: 0,
  transitlandRestApiFailureCount: 0,
  transitlandVectorTileRequestCount: 0,
  transitlandVectorTileFailureCount: 0,
  transitlandRoutingApiRequestCount: 0,
  transitlandRoutingApiFailureCount: 0,
  routeReviewsByCity: new Map(),
  agencyReviewsByCity: new Map(),
  routeOverridesByCity: new Map(),
  lastTileMetadataSignature: "",
  tileBackfillCount: 0,
  tileBackfillTotalMs: 0,
  tileBackfillAddedRoutes: 0,
  tileBackfillInFlight: false,
  tileBackfillCooldownUntil: 0,
  tileBackfillBboxes: new Set(),
  tileBackfillLastError: "",
  vectorArchiveVersion: "",
  tilesStats: null
};
