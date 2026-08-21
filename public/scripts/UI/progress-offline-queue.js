// Offline progress queue: visited-station toggles are stored in IndexedDB when
// the network is unavailable and flushed to the server when the app comes back
// online (window "online" event, app open, or tab refocus).

const QUEUE_DB_NAME = "metromark-progress-queue";
const QUEUE_STORE = "pending";
const QUEUE_VERSION = 1;

let queueDbPromise = null;

function openQueueDb() {
  if (queueDbPromise) {
    return queueDbPromise;
  }
  if (!window.indexedDB) {
    queueDbPromise = Promise.reject(new Error("indexedDB unavailable"));
    return queueDbPromise;
  }

  queueDbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(QUEUE_DB_NAME, QUEUE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      queueDbPromise = null;
      reject(request.error);
    };
  });

  return queueDbPromise;
}

async function enqueueProgressOp(op) {
  try {
    const db = await openQueueDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, "readwrite");
      tx.objectStore(QUEUE_STORE).add({
        payload: op.payload,
        queuedAt: Date.now()
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("queue write failed"));
    });
    return true;
  } catch {
    return false;
  }
}

async function pendingProgressOps() {
  try {
    const db = await openQueueDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, "readonly");
      const request = tx.objectStore(QUEUE_STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

async function removeProgressOp(id) {
  try {
    const db = await openQueueDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, "readwrite");
      tx.objectStore(QUEUE_STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // non-critical
  }
}

async function flushProgressQueue() {
  if (!appState.user || !appState.token) {
    return 0;
  }

  const ops = await pendingProgressOps();
  if (!ops.length) {
    return 0;
  }

  let flushed = 0;
  for (const op of ops) {
    try {
      await apiRequest("/api/progress/toggle", {
        method: "POST",
        body: op.payload
      });
      await removeProgressOp(op.id);
      flushed += 1;
    } catch {
      // Still offline — stop and retry on the next online event.
      break;
    }
  }

  if (flushed > 0 && typeof setStatus === "function") {
    setStatus(
      `Offline progress synced (${flushed} station${flushed === 1 ? "" : "s"}).`,
      "ok"
    );
  }

  return flushed;
}

function initProgressQueueSync() {
  if (typeof flushProgressQueue !== "function") {
    return;
  }
  flushProgressQueue().catch(() => {});
  window.addEventListener("online", () => {
    flushProgressQueue().catch(() => {});
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      flushProgressQueue().catch(() => {});
    }
  });
}
