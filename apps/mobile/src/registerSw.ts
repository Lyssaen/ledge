/** Registers the service worker under the app base (/m/). Production only: in dev Vite serves no `sw.js`. */
export function registerSw(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const base = import.meta.env.BASE_URL;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => { /* the app works online without it */ });
  });
}
