function bindMapInteractionEvents(map) {
  const routeHoverLayers = ["routes-main-vector", "routes-background-main-vector"];
  const routeClickLayers = ["routes-hit"];

  for (const layerId of routeClickLayers) {
    map.on("click", layerId, (event) => {
      const now = Date.now();
      if (now - appState.lastStopClickAt < 260) {
        return;
      }
      if (now - appState.lastRouteClickAt < 160) {
        return;
      }

      const stopHits = map
        .queryRenderedFeatures(event.point, {
          layers: ["stops-layer"]
        })
        .filter((feature) => Number(stopFeatureState(feature)?.interactive || 0) === 1);
      if (
        Array.isArray(stopHits) &&
        stopHits.length > 0 &&
        appState.userStatusPinnedKind !== "station"
      ) {
        return;
      }

      const routeHits = map.queryRenderedFeatures(event.point, {
        layers: routeClickLayers
      });

      const seenLineKeys = new Set();
      const overlappedLines = [];
      for (const hit of routeHits || []) {
        const line = lineFromRouteFeature(hit);
        const candidateLineKey = String(line?.lineKey || "").trim();
        if (!line || !lineIsVisible(line) || !candidateLineKey || seenLineKeys.has(candidateLineKey)) {
          continue;
        }

        seenLineKeys.add(candidateLineKey);
        overlappedLines.push(line);
      }

      if (!overlappedLines.length) {
        return;
      }

      overlappedLines.sort((a, b) => lineDisplayName(a).localeCompare(lineDisplayName(b)));
      appState.lastRouteClickAt = now;

      if (overlappedLines.length === 1) {
        closeRouteSelectionPopup();
        setFocusedLine(overlappedLines[0].lineKey).catch((error) => {
          setStatus(error.message, "error");
        });
        return;
      }

      onRouteHoverLeave();
      openRouteSelectionPopup(overlappedLines, event.lngLat);
      setStatus(
        "Multiple routes overlap here.",
        "ok",
        `Pick one from the selector (${overlappedLines.length} routes).`
      );
    });
  }

  for (const layerId of routeHoverLayers) {
    map.on("mouseenter", layerId, () => {
      if (hoverInteractionsEnabled()) {
        map.getCanvas().style.cursor = "pointer";
      }
    });

    map.on("mousemove", layerId, (event) => {
      if (hoverInteractionsEnabled()) {
        onRouteHoverMove(event);
      }
    });

    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = "";
      onRouteHoverLeave();
    });
  }

  map.on("click", "stops-layer", onStopClicked);
  map.on("mouseenter", "stops-layer", (event) => {
    const feature = event.features && event.features[0];
    if (hoverInteractionsEnabled() && Number(stopFeatureState(feature)?.interactive || 0) === 1) {
      map.getCanvas().style.cursor = "pointer";
    }
  });
  map.on("mousemove", "stops-layer", (event) => {
    if (hoverInteractionsEnabled()) {
      onStopHoverMove(event);
    }
  });
  map.on("mouseleave", "stops-layer", () => {
    map.getCanvas().style.cursor = "";
    onStopHoverLeave();
  });

  map.on("click", (event) => {
    const now = Date.now();
    if (now - appState.lastStopClickAt < 260 || now - appState.lastRouteClickAt < 220) {
      return;
    }

    const point = event.point;
    const closePadding = 14;

    if (appState.routeSelectPopup) {
      const nearbyRoutes = map.queryRenderedFeatures(
        [
          [point.x - closePadding, point.y - closePadding],
          [point.x + closePadding, point.y + closePadding]
        ],
        {
          layers: routeClickLayers
        }
      );

      if (!Array.isArray(nearbyRoutes) || nearbyRoutes.length === 0) {
        closeRouteSelectionPopup();
      }
    }

    if (!appState.focusedLineKey) {
      return;
    }

    const nearby = map.queryRenderedFeatures(
      [
        [point.x - closePadding, point.y - closePadding],
        [point.x + closePadding, point.y + closePadding]
      ],
      {
        layers: ["stops-layer", "routes-hit", "routes-main-vector", "routes-background-main-vector"]
      }
    );

    const hasVisibleNearbyFeature = Array.isArray(nearby)
      ? nearby.some((feature) => {
          if (feature?.layer?.id === "stops-layer") {
            return Number(stopFeatureState(feature)?.interactive || 0) === 1;
          }

          const line = lineFromRouteFeature(feature);
          return Boolean(line && lineIsVisible(line));
        })
      : false;

    if (hasVisibleNearbyFeature) {
      return;
    }

    clearFocusedLine(
      "Route focus cleared.",
      "Clicked away from routes/stations. Click a route to focus it again."
    );
  });

  map.on("touchstart", () => {
    onStopHoverLeave();
    onRouteHoverLeave();
    closeRouteSelectionPopup();
  });

  map.on("movestart", () => {
    closeRouteSelectionPopup();
    if (!hoverInteractionsEnabled()) {
      onStopHoverLeave();
      onRouteHoverLeave();
    }
  });

  map.on("moveend", onMapMoveEnd);
}
