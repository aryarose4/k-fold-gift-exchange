// Shared theme handling for every standalone page.
//
// Applies the saved theme (or ?theme=), wires the Light/dark toggle, and,
// when the page is framed by the author's website, reports its content
// height and accepts live theme changes. Opened directly it is just a toggle.
//
// The localStorage key ("theme") is the same one the host site uses, so on the
// published same-origin deployment the two share a light/dark preference.
(function () {
  var params = new URLSearchParams(location.search);
  var root = document.documentElement;

  function systemTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function applyStored() {
    if (params.get("theme")) { root.setAttribute("data-theme", params.get("theme")); return; }
    var stored = null;
    try { stored = localStorage.getItem("theme"); } catch (e) {}
    if (stored === "dark" || stored === "light") root.setAttribute("data-theme", stored);
    else if (stored === "system") root.setAttribute("data-theme", systemTheme());
  }
  applyStored();

  var toggle = document.getElementById("theme-toggle");
  if (toggle) {
    toggle.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) {}
    });
  }

  if (window.parent === window) return;

  function parentOrigin() {
    try {
      if (document.location.ancestorOrigins && document.location.ancestorOrigins.length) {
        return document.location.ancestorOrigins[0];
      }
      if (document.referrer) return new URL(document.referrer).origin;
    } catch (e) {}
    return "*";
  }

  function postHeight() {
    try {
      window.parent.postMessage(
        { type: "ge-height", height: document.documentElement.scrollHeight },
        parentOrigin()
      );
    } catch (e) {}
  }
  if (window.ResizeObserver) new ResizeObserver(postHeight).observe(document.body);
  window.addEventListener("load", postHeight);
  window.addEventListener("resize", postHeight);
  postHeight();

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (data && data.type === "ge-theme" && (data.theme === "dark" || data.theme === "light")) {
      root.setAttribute("data-theme", data.theme);
    }
  });
})();
