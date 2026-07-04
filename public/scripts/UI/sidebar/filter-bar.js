function lineSummaryByKey() {
  return new Map(appState.lineSummaries.map((line) => [line.lineKey, line]));
}

function renderModeFilterBar() {
  dom.modeFilterBar.innerHTML = "";

  const linesForCounts = getToggleCountLines().filter((line) => lineEligibleForToggleCounts(line));
  const counts = new Map(MODE_DEFS.map((mode) => [mode.key, 0]));

  for (const line of linesForCounts) {
    const modeKey = lineModeKey(line);
    counts.set(modeKey, (counts.get(modeKey) || 0) + 1);
  }

  const chips = MODE_DEFS.map((modeDef) => ({
    key: modeDef.key,
    label: modeDef.label,
    count: modeDef.key === MODE_FILTER_ALL ? linesForCounts.length : counts.get(modeDef.key) || 0
  }));
  const uncertainCounts = areFilterCountsUncertain();

  for (const chip of chips) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mode-chip";
    button.textContent = `${chip.label} (${filterChipCountLabel(chip.count, uncertainCounts)})`;
    if (uncertainCounts) {
      button.title = "Route totals are still loading for this view.";
    }

    if (appState.activeModeKeys.has(chip.key)) {
      button.classList.add("is-active");
    }

    button.addEventListener("click", () => {
      if (chip.key === MODE_FILTER_ALL) {
        appState.activeModeKeys = new Set([MODE_FILTER_ALL]);
      } else {
        if (appState.activeModeKeys.has(chip.key)) {
          appState.activeModeKeys.delete(chip.key);
        } else {
          appState.activeModeKeys.delete(MODE_FILTER_ALL);
          appState.activeModeKeys.add(chip.key);
        }

        if (!appState.activeModeKeys.size) {
          appState.activeModeKeys.add(MODE_FILTER_ALL);
        }
      }

      normalizeModeSelection();
      clearStatusPin();
      resetClearRouteProgressConfirmation();

      const shown = getShownLines();
      if (appState.focusedLineKey && !shown.some((line) => line.lineKey === appState.focusedLineKey)) {
        appState.focusedLineKey = "";
      }

      renderModeFilterBar();
      renderLineList();
      renderMapData();
      renderProgress();
      restoreUserStatusFromFocus();

      const selectedLabels = MODE_DEFS.filter((modeDef) => appState.activeModeKeys.has(modeDef.key)).map(
        (modeDef) => modeDef.label
      );

      setStatus("Mode filter updated.", "ok", `Showing: ${selectedLabels.join(", ")}.`);

      loadVisibleTransit({ forceRefresh: false, reason: "mode-filter-change" }).catch((error) => {
        setBackendStatus(`Mode-filter fetch failed: ${error.message}`);
      });
      if (typeof saveDefaultPresetDebounced === "function") {
        try { saveDefaultPresetDebounced(); } catch (e) {}
      }
    });

    dom.modeFilterBar.append(button);
  }
}

function renderFrequencyFilterBar() {
  dom.frequencyFilterBar.innerHTML = "";

  const baseLines = getToggleCountLines().filter((line) =>
    lineEligibleForToggleCounts(line, {
      requireModeMatch: true
    })
  );

  const buckets = new Map([
    [FREQUENCY_FILTER_FREQUENT, 0],
    [FREQUENCY_FILTER_REGULAR, 0],
    [FREQUENCY_FILTER_LOCAL, 0],
    [FREQUENCY_FILTER_UNKNOWN, 0]
  ]);

  for (const line of baseLines) {
    const bucket = lineFrequencyBucket(line);
    buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
  }

  const chips = [
    {
      key: FREQUENCY_FILTER_ALL,
      label: frequencyBucketLabel(FREQUENCY_FILTER_ALL),
      count: baseLines.length
    },
    {
      key: FREQUENCY_FILTER_FREQUENT,
      label: frequencyBucketLabel(FREQUENCY_FILTER_FREQUENT),
      count: buckets.get(FREQUENCY_FILTER_FREQUENT) || 0
    },
    {
      key: FREQUENCY_FILTER_REGULAR,
      label: frequencyBucketLabel(FREQUENCY_FILTER_REGULAR),
      count: buckets.get(FREQUENCY_FILTER_REGULAR) || 0
    },
    {
      key: FREQUENCY_FILTER_LOCAL,
      label: frequencyBucketLabel(FREQUENCY_FILTER_LOCAL),
      count: buckets.get(FREQUENCY_FILTER_LOCAL) || 0
    },
    {
      key: FREQUENCY_FILTER_UNKNOWN,
      label: "Unknown",
      count: buckets.get(FREQUENCY_FILTER_UNKNOWN) || 0
    }
  ];

  for (const chip of chips) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mode-chip";
    button.textContent = `${chip.label} (${chip.count})`;

    if (appState.activeFrequencyKeys.has(chip.key)) {
      button.classList.add("is-active");
    }

    button.addEventListener("click", () => {
      if (chip.key === FREQUENCY_FILTER_ALL) {
        appState.activeFrequencyKeys = new Set([FREQUENCY_FILTER_ALL]);
      } else {
        if (appState.activeFrequencyKeys.has(chip.key)) {
          appState.activeFrequencyKeys.delete(chip.key);
        } else {
          appState.activeFrequencyKeys.delete(FREQUENCY_FILTER_ALL);
          appState.activeFrequencyKeys.add(chip.key);
        }

        if (!appState.activeFrequencyKeys.size) {
          appState.activeFrequencyKeys.add(FREQUENCY_FILTER_ALL);
        }
      }

      normalizeFrequencySelection();
      clearStatusPin();
      resetClearRouteProgressConfirmation();

      const shown = getShownLines();
      if (appState.focusedLineKey && !shown.some((line) => line.lineKey === appState.focusedLineKey)) {
        appState.focusedLineKey = "";
      }

      renderFrequencyFilterBar();
      renderLineList();
      renderMapData();
      renderProgress();
      restoreUserStatusFromFocus();

      const selected = Array.from(appState.activeFrequencyKeys)
        .map((value) => frequencyBucketLabel(value))
        .join(", ");

      setStatus("Frequency filter updated.", "ok", `Active frequencies: ${selected}.`);
      if (typeof saveDefaultPresetDebounced === "function") {
        try { saveDefaultPresetDebounced(); } catch (e) {}
      }
    });

    dom.frequencyFilterBar.append(button);
  }
}
