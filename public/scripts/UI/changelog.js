// Version metadata + user-facing changelog.
//
// APP_VERSION is the current release. When you ship a user-visible change:
//   1. Bump APP_VERSION (semver, e.g. "0.11.0-beta").
//   2. Prepend a new object to CHANGELOG_RELEASES (newest first) with a short
//      title and concise, user-friendly bullets — only things that actually
//      change what a visitor experiences. Do not copy GitHub commit messages.
//
// Signed-in visitors see the releases newer than the last version stored on
// their account (preferences.lastSeenChangelogVersion); guests and the
// "What's new" footer link see the latest release.

var APP_VERSION = "0.10.0-beta";

var CHANGELOG_RELEASES = [
  {
    version: "0.10.0-beta",
    date: "2026-09-09",
    title: "Faster map data, refreshed routes, and easier reporting",
    changes: [
      "Routes now render from vector tiles for every area that's been harvested — the map is faster and no longer reloads route data on every pan.",
      "New areas you visit are fetched and archived automatically, so coverage builds up over time.",
      "Line view got an overhaul: clearer stop ordering, visited progress, and controls for how stops are sorted.",
      "Route data can be force-refreshed for an area when transit agencies change service (the admin tools were rebuilt around this).",
      "Added a \u201cReport Issue\u201d button on the map for flagging areas that look outdated or wrong.",
      "The installable app now updates cleanly when new versions ship — this notice is the first thing powered by that.",
      "Various bug fixes and polish across route highlighting, satellite mode, and filters."
    ]
  }
];

function normalizeVersion(value) {
  var text = String(value || "").trim();
  var match = /^(\d+)\.(\d+)\.(\d+)/.exec(text);
  if (!match) {
    return [0, 0, 0];
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isVersionNewer(a, b) {
  var pa = normalizeVersion(a);
  var pb = normalizeVersion(b);
  for (var i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) {
      return pa[i] > pb[i];
    }
  }
  return false;
}

function lastSeenChangelogVersion() {
  var prefs = appState?.user?.preferences;
  return prefs && typeof prefs === "object" ? String(prefs.lastSeenChangelogVersion || "").trim() : "";
}

function getReleasesNewerThan(seenVersion, maxReleases) {
  var max = Number.isFinite(Number(maxReleases)) ? Number(maxReleases) : 3;
  var releases = [];
  for (var i = 0; i < CHANGELOG_RELEASES.length && releases.length < max; i += 1) {
    var release = CHANGELOG_RELEASES[i];
    if (!seenVersion || isVersionNewer(release.version, seenVersion)) {
      releases.push(release);
    }
  }
  return releases;
}

function whatsNewContent() {
  var wrap = document.createElement("div");
  var releases = getReleasesNewerThan(lastSeenChangelogVersion(), 3);
  if (!releases.length) {
    releases = [CHANGELOG_RELEASES[0]].filter(Boolean);
  }
  for (var r = 0; r < releases.length; r += 1) {
    var release = releases[r];
    var section = document.createElement("section");
    var heading = document.createElement("h3");
    heading.textContent = release.version + " \u00b7 " + release.date;
    section.appendChild(heading);
    if (release.title) {
      var sub = document.createElement("p");
      sub.className = "whatsnew-title";
      sub.textContent = release.title;
      section.appendChild(sub);
    }
    var list = document.createElement("ul");
    (release.changes || []).forEach(function (change) {
      var item = document.createElement("li");
      item.textContent = change;
      list.appendChild(item);
    });
    section.appendChild(list);
    wrap.appendChild(section);
  }
  return wrap;
}

function openWhatsNew() {
  var content = document.getElementById("whatsnewContent");
  if (!content) {
    return;
  }
  content.innerHTML = "";
  content.appendChild(whatsNewContent());
  var modal = document.getElementById("whatsnewModal");
  if (modal) {
    modal.hidden = false;
  }
}

function closeWhatsNew() {
  var modal = document.getElementById("whatsnewModal");
  if (modal) {
    modal.hidden = true;
  }
  markChangelogSeen();
}

function markChangelogSeen() {
  var seen = lastSeenChangelogVersion();
  if (seen === APP_VERSION || !appState?.user) {
    return;
  }
  if (appState.user.preferences) {
    appState.user.preferences.lastSeenChangelogVersion = APP_VERSION;
  }
  apiRequest("/api/auth/me/preferences", {
    method: "PATCH",
    body: JSON.stringify({ preferences: { lastSeenChangelogVersion: APP_VERSION } })
  }).catch(function () {});
}

function maybeShowWhatsNew() {
  if (!appState?.user) {
    return;
  }
  var releases = getReleasesNewerThan(lastSeenChangelogVersion(), 3);
  if (releases.length) {
    openWhatsNew();
  }
}

function bindWhatsNew() {
  var openBtn = document.getElementById("whatsNewLink");
  if (openBtn) {
    openBtn.addEventListener("click", function (event) {
      event.preventDefault();
      openWhatsNew();
    });
  }
  var closeBtn = document.getElementById("whatsnewCloseBtn");
  if (closeBtn) {
    closeBtn.addEventListener("click", closeWhatsNew);
  }
  var modal = document.getElementById("whatsnewModal");
  if (modal) {
    modal.addEventListener("click", function (event) {
      if (event.target === modal) {
        closeWhatsNew();
      }
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindWhatsNew);
} else {
  bindWhatsNew();
}
