const { getBboxTransit } = require("./index");

async function handleBboxRequest(rawBbox, options = {}) {
  const bbox = Array.isArray(rawBbox)
    ? rawBbox
    : String(rawBbox || "")
        .split(",")
        .map((value) => Number(value.trim()));

  const zoom = Number(options.zoom);

  return getBboxTransit(bbox, {
    ...options,
    zoom: Number.isFinite(zoom) ? zoom : null
  });
}

module.exports = { handleBboxRequest };
