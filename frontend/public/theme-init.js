// Apply appearance before the UI paints; no inline script or external font is needed.
(function () {
  var theme = "system";
  try {
    var saved = localStorage.getItem("clusterlens.theme");
    if (saved === "light" || saved === "dark") theme = saved;
  } catch (_) {}
  var dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#101217" : "#f8f9fb");
})();
