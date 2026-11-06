/* global document, window */
// Runs before first paint (same-origin, so it satisfies the strict CSP) to avoid a theme flash.
// Keep the storage keys in sync with src/theme/prefs.ts.
(function applyStoredPreferences() {
  var root = document.documentElement;
  try {
    var theme = localStorage.getItem('bf.theme');
    root.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
    var motion = localStorage.getItem('bf.motion');
    var reduced =
      motion === 'reduced' ||
      (motion !== 'full' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    root.setAttribute('data-motion', reduced ? 'reduced' : 'full');
    if (
      sessionStorage.getItem('bf.demo.open') === '1' &&
      sessionStorage.getItem('bf.presentation') === 'on'
    ) {
      root.setAttribute('data-presentation', 'on');
    }
  } catch (_error) {
    root.setAttribute('data-theme', 'dark');
  }
})();
