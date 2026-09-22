// "Report a data issue" control. Captures the current map view (bbox, zoom,
// center, and a downscaled screenshot of the map canvas), lets the user add an
// optional description, and saves the report for the admin dashboard. Works for
// signed-out visitors; signed-in reports carry the account email.

(function () {
  let capture = null;
  let capturePending = false;
  let captureToken = 0;

  function openModal() {
    if (typeof appState === "undefined" || !appState.map || !appState.mapReady) {
      setIssueStatus("The map is still loading. Please try again in a moment.", true);
      return;
    }
    capture = captureViewport();
    const token = (captureToken += 1);
    capturePending = true;
    renderPreview();
    captureScreenshot().then((dataUrl) => {
      if (token !== captureToken) {
        return;
      }
      capturePending = false;
      if (capture) {
        capture.screenshot = dataUrl;
      }
      renderPreview();
    });
    const description = document.getElementById("reportDescriptionInput");
    if (description) {
      description.value = "";
    }
    const modal = document.getElementById("reportModal");
    if (modal) {
      modal.hidden = false;
    }
    setIssueStatus("");
  }

  function closeModal() {
    captureToken += 1;
    capturePending = false;
    const modal = document.getElementById("reportModal");
    if (modal) {
      modal.hidden = true;
    }
  }

  function setIssueStatus(message, isError) {
    const statusEl = document.getElementById("reportIssueStatus");
    if (!statusEl) {
      return;
    }
    if (!message) {
      statusEl.hidden = true;
      statusEl.textContent = "";
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = message;
    statusEl.style.color = isError ? "#a22828" : "#2e7d32";
  }

  function captureViewport() {
    const map = appState?.map;
    const bounds = map && typeof map.getBounds === "function" ? map.getBounds() : null;
    if (!bounds) {
      return { bbox: null, zoom: null, center: null, screenshot: "" };
    }
    const round = (value) => Number(Number(value).toFixed(6));
    return {
      bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].map(round),
      center: {
        lon: round(bounds.getCenter().lng),
        lat: round(bounds.getCenter().lat)
      },
      zoom: map.getZoom ? Math.round(map.getZoom() * 10) / 10 : null,
      screenshot: ""
    };
  }

  // The map canvas is WebGL with preserveDrawingBuffer off, so it must be read
  // during a render frame; reading it at rest returns a cleared (blank) buffer.
  function captureScreenshot() {
    const map = appState?.map;
    const canvas = map && typeof map.getCanvas === "function" ? map.getCanvas() : null;
    if (!map || !canvas) {
      return Promise.resolve("");
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        map.off("render", finish);
        resolve(encodeScreenshot(canvas));
      };

      map.once("render", finish);
      map.triggerRepaint();
      window.setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        map.off("render", finish);
        resolve("");
      }, 700);
    });
  }

  // JPEG keeps the payload well under the server's JSON body limit; the steps
  // drop resolution/quality if a busy viewport still encodes too large.
  function encodeScreenshot(canvas) {
    const maxChars =
      typeof REPORT_SCREENSHOT_MAX_CHARS === "number" ? REPORT_SCREENSHOT_MAX_CHARS : 600000;
    const steps = [
      { width: 900, quality: 0.72 },
      { width: 720, quality: 0.65 },
      { width: 560, quality: 0.6 }
    ];

    let smallest = "";
    for (const step of steps) {
      let dataUrl = "";
      try {
        const scale = Math.min(1, step.width / canvas.width);
        const width = Math.max(1, Math.round(canvas.width * scale));
        const height = Math.max(1, Math.round(canvas.height * scale));
        const offscreen = document.createElement("canvas");
        offscreen.width = width;
        offscreen.height = height;
        const context = offscreen.getContext("2d");
        if (!context) {
          return "";
        }
        context.drawImage(canvas, 0, 0, width, height);
        dataUrl = offscreen.toDataURL("image/jpeg", step.quality);
      } catch {
        // A tainted canvas (external imagery without CORS) cannot be exported.
        return "";
      }
      if (!smallest || dataUrl.length < smallest.length) {
        smallest = dataUrl;
      }
      if (dataUrl.length <= maxChars) {
        return dataUrl;
      }
    }

    return smallest.length <= maxChars ? smallest : "";
  }

  function renderPreview() {
    const bboxText = document.getElementById("reportBboxText");
    if (bboxText) {
      bboxText.textContent = capture && capture.bbox
        ? capture.bbox.map((value) => value.toFixed(4)).join(", ")
        : "-";
    }
    const zoomText = document.getElementById("reportZoomText");
    if (zoomText) {
      zoomText.textContent = capture && capture.zoom !== null && capture.zoom !== undefined
        ? String(capture.zoom)
        : "-";
    }
    const preview = document.getElementById("reportCapturePreview");
    if (!preview) {
      return;
    }
    if (capturePending) {
      preview.textContent = "Capturing screenshot…";
      return;
    }
    if (capture && capture.screenshot) {
      preview.innerHTML = "";
      const img = document.createElement("img");
      img.src = capture.screenshot;
      img.alt = "Map viewport screenshot";
      preview.appendChild(img);
    } else {
      preview.textContent = "No screenshot captured.";
    }
  }

  async function submitReport() {
    if (!capture || !capture.bbox) {
      setIssueStatus("No map view to report. Please wait for the map to load.", true);
      return;
    }
    const description = String(document.getElementById("reportDescriptionInput")?.value || "").trim();
    const submitBtn = document.getElementById("reportSubmitBtn");
    if (submitBtn) {
      submitBtn.disabled = true;
    }
    setIssueStatus("Sending report…");

    try {
      const headers = { "Content-Type": "application/json" };
      if (appState && appState.token) {
        headers.Authorization = `Bearer ${appState.token}`;
      }
      const response = await fetch("/api/issues/report", {
        method: "POST",
        headers,
        body: JSON.stringify({
          bbox: capture.bbox,
          zoom: capture.zoom,
          center: capture.center,
          screenshot: capture.screenshot,
          description
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `Request failed (${response.status}).`);
      }
      setIssueStatus("Report sent. Thank you — the area has been flagged for review.");
      if (typeof setStatus === "function") {
        setStatus("Issue report sent. Thank you!", "ok");
      }
      window.setTimeout(closeModal, 1400);
    } catch (error) {
      setIssueStatus(`Failed to send report: ${error.message}`, true);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
      }
    }
  }

  function bind() {
    const reportBtn = document.getElementById("reportIssueBtn");
    if (reportBtn) {
      reportBtn.addEventListener("click", openModal);
    }
    const closeBtn = document.getElementById("reportModalCloseBtn");
    if (closeBtn) {
      closeBtn.addEventListener("click", closeModal);
    }
    const submitBtn = document.getElementById("reportSubmitBtn");
    if (submitBtn) {
      submitBtn.addEventListener("click", submitReport);
    }
    const backdrop = document.getElementById("reportModal");
    if (backdrop) {
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) {
          closeModal();
        }
      });
    }
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeModal();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
