const db = require("../../processors/data");
const {
  sanitizeText
} = require("./helpers");

async function applyRouteOrderingMetadataToPayload(payload) {
  const lineSummaries = Array.isArray(payload?.lineSummaries) ? payload.lineSummaries : [];
  if (!lineSummaries.length) {
    return payload;
  }

  const lineKeys = Array.from(
    new Set(lineSummaries.map((line) => sanitizeText(line?.lineKey)).filter(Boolean))
  );

  if (!lineKeys.length) {
    return payload;
  }

  const metadataByLineKey = await db.getRouteOrderingMetadataByLineKeys(lineKeys);
  if (!metadataByLineKey || metadataByLineKey.size === 0) {
    return payload;
  }

  const decorateLine = (line) => {
    const lineKey = sanitizeText(line?.lineKey);
    if (!lineKey || !metadataByLineKey.has(lineKey)) {
      return line;
    }

    const metadata = metadataByLineKey.get(lineKey) || {};
    return {
      ...line,
      lineViewOrderingDefaultMode: sanitizeText(metadata.orderingModeDefaultMode || "auto") || "auto",
      lineViewOrderingDefaultSource: sanitizeText(metadata.orderingModeDefaultSource || "auto") || "auto",
      lineViewOrderingAdminMode: sanitizeText(metadata.orderingModeAdminMode || ""),
      lineViewOrderingVoteCounts: metadata.orderingModeVoteCounts || {},
      lineViewOrderingVoteTotal: Number(metadata.orderingModeVoteTotal || 0)
    };
  };

  const nextRoutesGeoJson =
    payload?.routesGeoJson && Array.isArray(payload.routesGeoJson.features)
      ? {
          ...payload.routesGeoJson,
          features: payload.routesGeoJson.features.map((feature) => {
            const lineKey = sanitizeText(feature?.properties?.line_key);
            if (!lineKey || !metadataByLineKey.has(lineKey)) {
              return feature;
            }

            const metadata = metadataByLineKey.get(lineKey) || {};
            return {
              ...feature,
              properties: {
                ...feature.properties,
                line_view_ordering_default_mode: sanitizeText(metadata.orderingModeDefaultMode || "auto") || "auto",
                line_view_ordering_default_source: sanitizeText(metadata.orderingModeDefaultSource || "auto") || "auto",
                line_view_ordering_admin_mode: sanitizeText(metadata.orderingModeAdminMode || ""),
                line_view_ordering_vote_total: Number(metadata.orderingModeVoteTotal || 0)
              }
            };
          })
        }
      : payload?.routesGeoJson;

  return {
    ...payload,
    lineSummaries: lineSummaries.map(decorateLine),
    routesGeoJson: nextRoutesGeoJson
  };
}

module.exports = {
  applyRouteOrderingMetadataToPayload
};
