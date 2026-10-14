import { randomInt, timingSafeEqual } from 'node:crypto';
import { PAIR_CODE_TTL_MS, PAIR_MAX_ATTEMPTS, type PairErrorReason } from '@ledge/protocol';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';
import type { MobileConfig } from '../mobile/config.js';
import type { DeviceStore } from './devices.js';
import { registrationOptions, verifyRegistration } from './webauthn.js';
import { log } from '../log.js';

export class PairError extends Error {
  constructor(readonly reason: PairErrorReason) { super(`pairing: ${reason}`); this.name = 'PairError'; }
}

export interface Pairing {
  /** Opens the window (replacing any previous one) and returns the code shown on the PC. */
  begin(): { code: string; expiresAt: string; url: string };
  /** The phone proves the code and gets the registration options; their challenge is the one `complete` accepts. */
  options(code: string): Promise<{ options: PublicKeyCredentialCreationOptionsJSON; expiresAt: string }>;
  /** Verifies the key, records the device and closes the window. The token is returned here only. */
  complete(code: string, deviceName: string, response: unknown): Promise<{ token: string; deviceId: string }>;
}

interface Window { code: string; expiresAt: number; attempts: number; locked: boolean; challenge: string | null }

const DEFAULT_NAME = 'iPhone';
const NAME_MAX = 60;

const sixDigits = () => String(randomInt(0, 1e6)).padStart(6, '0');
const sameCode = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * The pairing window (decision D5): one at a time, a six-digit code shown on the PC for `PAIR_CODE_TTL_MS`,
 * locked after `PAIR_MAX_ATTEMPTS` wrong codes. The phone registers its WebAuthn key inside it.
 */
export function createPairing(deps: { config: () => MobileConfig | null; devices: DeviceStore; now?: () => number; randomCode?: () => string }): Pairing {
  const now = deps.now ?? Date.now;
  const randomCode = deps.randomCode ?? sixDigits;
  let win: Window | null = null;

  const configured = (): MobileConfig => {
    const cfg = deps.config();
    if (!cfg) throw new PairError('not_configured');
    return cfg;
  };

  /** Every wrong code counts; the last allowed one locks the window until the next `begin`. */
  const check = (code: string): Window => {
    const w = win;
    if (!w) throw new PairError('no_window');
    if (w.locked) throw new PairError('locked');
    if (now() > w.expiresAt) throw new PairError('expired');
    if (!sameCode(code, w.code)) {
      w.attempts++;
      if (w.attempts >= PAIR_MAX_ATTEMPTS) { w.locked = true; w.challenge = null; log('pairing locked after too many wrong codes'); throw new PairError('locked'); }
      throw new PairError('invalid_code');
    }
    return w;
  };

  return {
    begin() {
      const cfg = configured();
      const expiresAt = now() + PAIR_CODE_TTL_MS;
      win = { code: randomCode(), expiresAt, attempts: 0, locked: false, challenge: null };
      return { code: win.code, expiresAt: new Date(expiresAt).toISOString(), url: `${cfg.origin}/m/#/pair` };
    },

    async options(code) {
      const cfg = configured();
      const w = check(code);
      const options = await registrationOptions(cfg, DEFAULT_NAME);
      // A begin during the await opened another window: this challenge belongs to none.
      if (win !== w) throw new PairError('no_window');
      w.challenge = options.challenge;
      return { options, expiresAt: new Date(w.expiresAt).toISOString() };
    },

    async complete(code, deviceName, response) {
      const cfg = configured();
      const w = check(code);
      // A challenge serves once: taken before the await, so two concurrent completes cannot both use it.
      const challenge = w.challenge;
      w.challenge = null;
      if (!challenge) throw new PairError('webauthn_failed');
      let credential;
      try {
        credential = await verifyRegistration(cfg, response, challenge);
      } catch (e) {
        log(`pairing: key registration refused: ${(e as Error).message}`);
        throw new PairError('webauthn_failed');
      }
      if (win !== w) throw new PairError('no_window');
      win = null;
      const name = deviceName.trim().slice(0, NAME_MAX).trim() || DEFAULT_NAME;
      const { device, token } = await deps.devices.create(name, credential);
      return { token, deviceId: device.id };
    }
  };
}
