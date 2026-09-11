/* Anonymous, cookie-free usage counts via GoatCounter (https://www.goatcounter.com).
   Off until GOATCOUNTER_CODE is set to your GoatCounter site code, e.g. "measureme" for
   https://measureme.goatcounter.com. Never runs on localhost.
   Sends page views plus a few events; no names, profile data, or answers are ever sent. */
const GOATCOUNTER_CODE = "";

(function loadCounter() {
  if (!GOATCOUNTER_CODE || !/^https?:$/.test(location.protocol) || /^(localhost|127\.|0\.0\.0\.0)/.test(location.hostname)) return;
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://gc.zgo.at/count.js";
  s.dataset.goatcounter = `https://${GOATCOUNTER_CODE}.goatcounter.com/count`;
  document.head.appendChild(s);
})();

// Count an event, e.g. track("daily-start"). A no-op when analytics is off or blocked.
function track(event, title) {
  try {
    if (window.goatcounter && typeof window.goatcounter.count === "function")
      window.goatcounter.count({ path: event, title: title || event, event: true });
  } catch (e) {}
}
