function getVisitedSetForLine(lineKey) {
  const set = appState.visitedByLine.get(lineKey);
  if (set) {
    return set;
  }
  const fresh = new Set();
  appState.visitedByLine.set(lineKey, fresh);
  return fresh;
}

function renderProgress() {
  const demo = !appState.user;

  const overallProgressCard = document.getElementById("overallProgressCard");
  if (overallProgressCard) {
    overallProgressCard.hidden = false;
  }
  dom.lineProgressList.hidden = false;

  if (!appState.transit && !demo) {
    dom.progressSummary.textContent = "Pan or zoom the map and routes will load automatically.";
    dom.lineProgressList.innerHTML = "";
    return;
  }

  let visibleLines = getShownLines();
  if (!visibleLines.length && demo) {
    visibleLines = (Array.isArray(appState.lineSummaries) ? appState.lineSummaries : []).slice(0, 8);
  }
  if (!visibleLines.length) {
    dom.progressSummary.textContent = "No routes are visible for the active mode/frequency filters.";
    dom.lineProgressList.innerHTML = "";
    return;
  }

  const rows = visibleLines
    .map((line) => {
      const metrics = lineProgressMetrics(line.lineKey, Number(line.stopCount || 0));

      return {
        lineKey: line.lineKey,
        lineName: lineDisplayName(line),
        visited: metrics.visited,
        total: metrics.total,
        percent: metrics.percent
      };
    })
    .sort((a, b) => {
      const percentDiff = b.percent - a.percent;
      if (percentDiff !== 0) {
        return percentDiff;
      }

      const visitedDiff = b.visited - a.visited;
      if (visitedDiff !== 0) {
        return visitedDiff;
      }

      return a.lineName.localeCompare(b.lineName);
    });

  if (demo) {
    const factors = [0.62, 0.41, 0.78, 0.29, 0.55, 0.33];
    rows.forEach((row, index) => {
      const total = row.total > 0 ? row.total : 14 + ((row.lineName.length * 7) % 26);
      row.total = total;
      row.visited = Math.round(total * factors[index % factors.length]);
      row.percent = total ? Math.round((row.visited / total) * 100) : 0;
    });
    rows.sort((a, b) => (b.percent - a.percent) || (b.visited - a.visited) || a.lineName.localeCompare(b.lineName));
    if (rows.length > 6) {
      rows.length = 6;
    }
  }

  const loading = !demo && Boolean(appState.inFlightLineStopKeys && appState.inFlightLineStopKeys.size > 0);
  const card = document.getElementById("overallProgressCard");
  if (card) {
    card.classList.toggle("is-loading", loading);
  }
  if (loading) {
    return;
  }

  const withKnownStops = rows.filter((row) => row.total > 0).length;
  dom.progressSummary.hidden = demo;
  if (!demo) {
    dom.progressSummary.textContent = `${withKnownStops}/${visibleLines.length} routes with stop data.`;
  }

  if (card) {
    card.classList.toggle("is-demo", demo);
  }
  const cta = document.getElementById("progressSignInCta");
  if (cta) {
    cta.hidden = !demo;
    cta.onclick = () => {
      if (typeof setActivePopup === "function") {
        setActivePopup("account");
      }
    };
  }

  // Calculate and render overall progress
  const totalVisited = rows.reduce((sum, row) => sum + row.visited, 0);
  const totalStops = rows.reduce((sum, row) => sum + row.total, 0);
  const overallPercent = totalStops > 0 ? Math.round((totalVisited / totalStops) * 100) : 0;

  const overallProgressPercent = document.getElementById("overallProgressPercent");
  const overallProgressText = document.getElementById("overallProgressText");
  const overallProgressFill = document.getElementById("overallProgressFill");

  if (overallProgressPercent) {
    overallProgressPercent.textContent = `${overallPercent}%`;
  }
  if (overallProgressText) {
    overallProgressText.textContent = `${totalVisited} of ${totalStops} stations`;
  }
  if (overallProgressFill) {
    overallProgressFill.style.width = `${overallPercent}%`;
  }

  dom.lineProgressList.innerHTML = "";

  // Cap the per-route progress rows to keep the panel usable when thousands of
  // routes are visible at global scale. The overall progress summary stays exact.
  const MAX_PROGRESS_ROWS = 120;
  const renderRows = rows.slice(0, MAX_PROGRESS_ROWS);

  for (const row of renderRows) {
    const wrapper = document.createElement("div");
    wrapper.className = "line-progress-row";

    // Get the line to access its color
    const line = appState.lineSummaries.find((l) => l.lineKey === row.lineKey);
    const lineColor = line?.color || "#177ca2";

    // Create color dot
    const colorDot = document.createElement("div");
    colorDot.className = "line-progress-color-dot";
    colorDot.style.backgroundColor = lineColor;

    const label = document.createElement("button");
    label.type = "button";
    label.className = "line-progress-name";
    label.dataset.lineKey = row.lineKey;
    label.textContent =
      row.total > 0
        ? `${row.lineName} (${row.visited}/${row.total})`
        : `${row.lineName} (${row.visited} visited, total unknown)`;

    label.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof openLineView === "function") {
        openLineView(row.lineKey, { zoom: true });
      }
    });

    const meter = document.createElement("div");
    meter.className = "progress-track";

    const fill = document.createElement("div");
    fill.className = "progress-fill";
    fill.style.backgroundColor = lineColor; // Also color the progress fill

    const linePercent = row.total ? Math.round((row.visited / row.total) * 100) : 0;
    fill.style.width = `${linePercent}%`;

    meter.append(fill);

    const mainRow = document.createElement("div");
    mainRow.className = "line-progress-main";
    mainRow.append(colorDot, label);

    const percentLabel = document.createElement("span");
    percentLabel.textContent = `${linePercent}%`;

    wrapper.append(mainRow, percentLabel);
    wrapper.append(meter);

    dom.lineProgressList.append(wrapper);
  }

  if (rows.length > MAX_PROGRESS_ROWS) {
    const note = document.createElement("p");
    note.className = "microcopy";
    note.textContent = `Showing first ${MAX_PROGRESS_ROWS} routes.`;
    dom.lineProgressList.append(note);
  }

  // Expanded progress dialog mirrors the same values; the sidebar copy stays.
  const overlayPercent = document.getElementById("overlayProgressPercent");
  if (overlayPercent) {
    overlayPercent.textContent = `${overallPercent}%`;
  }
  const overlayText = document.getElementById("overlayProgressText");
  if (overlayText) {
    overlayText.textContent = `${totalVisited} of ${totalStops} stations`;
  }
  const overlayFill = document.getElementById("overlayProgressFill");
  if (overlayFill) {
    overlayFill.style.width = `${overallPercent}%`;
  }
  const overlaySummary = document.getElementById("overlayProgressSummary");
  if (overlaySummary) {
    overlaySummary.hidden = demo;
    overlaySummary.textContent = `${withKnownStops}/${visibleLines.length} routes with stop data.`;
  }
  const overlayCta = document.getElementById("overlayProgressSignInCta");
  if (overlayCta) {
    overlayCta.hidden = !demo;
    overlayCta.onclick = () => {
      if (typeof setActivePopup === "function") {
        setActivePopup("account");
      }
    };
  }
  const overlayList = document.getElementById("overlayProgressList");
  if (overlayList) {
    overlayList.innerHTML = dom.lineProgressList.innerHTML;
  }
}
