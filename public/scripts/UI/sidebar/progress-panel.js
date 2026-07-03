function getVisitedSetForLine(lineKey) {
  const set = state.visitedByLine.get(lineKey);
  if (set) {
    return set;
  }
  const fresh = new Set();
  state.visitedByLine.set(lineKey, fresh);
  return fresh;
}

function renderProgress() {
  if (!state.user) {
    els.progressSummary.textContent = "Sign in to track progress.";
    els.lineProgressList.innerHTML = "";
    const overallProgressCard = document.getElementById("overallProgressCard");
    if (overallProgressCard) {
      overallProgressCard.hidden = true;
    }
    els.lineProgressList.hidden = true;
    return;
  }

  const overallProgressCard = document.getElementById("overallProgressCard");
  if (overallProgressCard) {
    overallProgressCard.hidden = false;
  }
  els.lineProgressList.hidden = false;

  if (!state.transit) {
    els.progressSummary.textContent = "Pan or zoom the map and routes will load automatically.";
    els.lineProgressList.innerHTML = "";
    return;
  }

  const visibleLines = getShownLines();
  if (!visibleLines.length) {
    els.progressSummary.textContent = "No routes are visible for the active mode/frequency filters.";
    els.lineProgressList.innerHTML = "";
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

  const withKnownStops = rows.filter((row) => row.total > 0).length;
  els.progressSummary.textContent = `${visibleLines.length} visible routes. ${withKnownStops} with loaded stop totals.`;

  // Calculate and render overall progress
  const totalVisited = rows.reduce((sum, row) => sum + row.visited, 0);
  const totalStops = rows.reduce((sum, row) => sum + row.total, 0);
  const overallPercent = totalStops > 0 ? Math.round((totalVisited / totalStops) * 100) : 0;
  
  const overallProgressText = document.getElementById("overallProgressText");
  const overallProgressFill = document.getElementById("overallProgressFill");
  
  if (overallProgressText) {
    overallProgressText.textContent = `${totalVisited} / ${totalStops} (${overallPercent}%)`;
  }
  
  if (overallProgressFill) {
    overallProgressFill.style.width = `${overallPercent}%`;
  }

  els.lineProgressList.innerHTML = "";

  for (const row of rows) {
    const wrapper = document.createElement("div");
    wrapper.className = "line-progress-row";

    // Get the line to access its color
    const line = state.lineSummaries.find((l) => l.lineKey === row.lineKey);
    const lineColor = line?.color || "#177ca2";

    // Create color dot
    const colorDot = document.createElement("div");
    colorDot.className = "line-progress-color-dot";
    colorDot.style.backgroundColor = lineColor;

    const label = document.createElement("button");
    label.type = "button";
    label.className = "line-progress-name";
    label.textContent =
      row.total > 0
        ? `${row.lineName} (${row.visited}/${row.total})`
        : `${row.lineName} (${row.visited} visited, total unknown)`;

    label.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof openLineView === "function") {
        openLineView(row.lineKey);
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

    els.lineProgressList.append(wrapper);
  }
}
