import { useEffect, useState } from 'react';
import { platformAvailable } from '../link/webauthn';

/** Whether this device has a built-in authenticator that verifies the user; false until it is known. */
export function usePlatform(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let on = true;
    void platformAvailable().then(v => { if (on) setAvailable(v); });
    return () => { on = false; };
  }, []);
  return available;
}

/** Face ID is the device check on an iPhone or iPad (an iPad may say it is a Mac, but then it has a touch screen). */
export function isApple(): boolean {
  const nav = globalThis.navigator;
  if (!nav) return false;
  return /iPhone|iPad/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
}
