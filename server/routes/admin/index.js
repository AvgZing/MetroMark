const express = require("express");
const { createLogger } = require("../../admin/logger");
const { getAdminSession, isAdminAuthorized } = require("./auth");

const router = express.Router();
const log = createLogger("admin-actions");

const LOGGED_BODY_KEYS = [
  "lineKey",
  "lineKeys",
  "citySlug",
  "slug",
  "stationKey",
  "operatorId",
  "operatorName",
  "included",
  "role",
  "isActive",
  "published",
  "status",
  "action",
  "bbox",
  "query"
];

function summarizeAdminBody(body) {
  if (!body || typeof body !== "object") {
    return {};
  }
  const summary = {};
  for (const key of LOGGED_BODY_KEYS) {
    if (body[key] !== undefined) {
      summary[key] = body[key];
    }
  }
  if (body.payload && typeof body.payload === "object") {
    summary.payloadKeys = Object.keys(body.payload);
  }
  return summary;
}

router.use(require("./auth").router);
router.use(async (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }
  const session = getAdminSession(req);
  if (!session && !(await isAdminAuthorized(req))) {
    return next();
  }
  const startedAt = Date.now();
  res.on("finish", () => {
    const details = {
      admin: session?.username || "admin-token",
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      ...summarizeAdminBody(req.body)
    };
    const message = `${req.method} ${req.originalUrl}`;
    if (res.statusCode >= 500) {
      log.error(message, details);
    } else if (res.statusCode >= 400) {
      log.warn(message, details);
    } else {
      log.info(message, details);
    }
  });
  return next();
});
router.use(require("./stats"));
router.use(require("./actions"));
router.use(require("./accounts"));
router.use(require("./overrides"));
router.use(require("./reviews"));
router.use(require("./reharvest"));
router.use(require("./routes"));
router.use(require("./cities"));
router.use(require("./issues"));
router.use(require("./suggestions"));

module.exports = router;
