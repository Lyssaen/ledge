import { PROTOCOL_PORT } from '@ledge/protocol';
import { nativeInfo as askShell } from '../tauri/bridge';

/** How this Desktop reaches its daemon (spec 2026-11-03 §4.2.4): `native` on Windows without WSL, where Desktop runs the
 *  daemon itself, `wsl` otherwise. Set once at boot (main.tsx), before the first render: it never changes while the
 *  window lives. */
export interface NativeInfo { mode: 'native' | 'wsl'; port: number }

const WSL: NativeInfo = { mode: 'wsl', port: PROTOCOL_PORT };
let current: NativeInfo = WSL;

/** Asks the shell once; outside Tauri, or when it cannot say, WSL mode on the usual port. */
export async function loadNativeInfo(): Promise<NativeInfo> {
  current = (await askShell()) ?? WSL;
  return current;
}

export const nativeInfo = (): NativeInfo => current;
export const isNative = (): boolean => current.mode === 'native';
/** The local daemon's address. */
export const localUrl = (): string => `ws://127.0.0.1:${current.port}`;

/** What this Desktop offers. Native mode's first round offers only the acceptance bar (spec §1): launch and follow Claude
 *  and Codex sessions, answer them, type in their terminal, and see the SSH machines with their OpenRig seats. */
export interface Features {
  chat: boolean; atelier: boolean; documents: boolean; captures: boolean; tasks: boolean; broadcast: boolean;
  island: boolean; mobile: boolean; shells: boolean; daemonUpdates: boolean;
}

export function features(native: boolean): Features {
  const on = !native;
  return { chat: on, atelier: on, documents: on, captures: on, tasks: on, broadcast: on, island: on, mobile: on, shells: on, daemonUpdates: on };
}

/** The features of this window (the mode is fixed at boot, so a plain read). */
export const useFeatures = (): Features => features(isNative());
