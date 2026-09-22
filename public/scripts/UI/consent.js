// Privacy / local-storage consent. MetroMark uses no advertising or tracking
// cookies; the banner explains the local/session storage the app uses and lets
// visitors decline non-essential preference persistence. Declining does not
// break sign-in (the auth token is necessary for the Service to function).

(function () {
  var CONSENT_KEY = "metromark_consent";
  var ACCEPTED = "accepted";
  var DECLINED = "declined";

  function readConsent() {
    try {
      return localStorage.getItem(CONSENT_KEY);
    } catch {
      return ACCEPTED;
    }
  }

  function storageConsentAllowed() {
    return readConsent() !== DECLINED;
  }

  window.storageConsentAllowed = storageConsentAllowed;

  function syncBannerLayout() {
    var banner = document.getElementById("consentBanner");
    if (!banner || banner.hidden) {
      document.body.classList.remove("consent-open");
      document.documentElement.style.removeProperty("--consent-h");
      return;
    }
    document.body.classList.add("consent-open");
    document.documentElement.style.setProperty("--consent-h", banner.getBoundingClientRect().height + "px");
  }

  function showBanner() {
    var banner = document.getElementById("consentBanner");
    if (banner) {
      banner.hidden = false;
    }
    syncBannerLayout();
  }

  function hideBanner() {
    var banner = document.getElementById("consentBanner");
    if (banner) {
      banner.hidden = true;
    }
    syncBannerLayout();
  }

  function recordChoice(choice) {
    try {
      localStorage.setItem(CONSENT_KEY, choice);
    } catch {
      // Storage unavailable — nothing to record.
    }
    hideBanner();
    window.dispatchEvent(new CustomEvent("metromark:consent-change", { detail: { consent: choice } }));
  }

  function bind() {
    if (readConsent()) {
      return;
    }
    var acceptBtn = document.getElementById("consentAcceptBtn");
    var declineBtn = document.getElementById("consentDeclineBtn");
    if (acceptBtn) {
      acceptBtn.addEventListener("click", function () {
        recordChoice(ACCEPTED);
      });
    }
    if (declineBtn) {
      declineBtn.addEventListener("click", function () {
        recordChoice(DECLINED);
      });
    }
    showBanner();
    window.addEventListener("resize", syncBannerLayout);
    window.addEventListener("orientationchange", syncBannerLayout);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
