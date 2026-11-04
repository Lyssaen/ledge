import { PROTOCOL_PORT } from '@ledge/protocol';

/** How this Desktop reaches its daemon (spec 2026-11-03 §4.2.4): `native` on Windows without WSL, where Desktop runs the
 *  daemon itself, `wsl` otherwise. Set once at boot (native/mode.ts), before the first render. Kept apart from the shell's
 *  bridge so the copy (i18n/messages.ts) can read it without loading the bridge. */
export interface NativeInfo { mode: 'native' | 'wsl'; port: number }

export const WSL_MODE: NativeInfo = { mode: 'wsl', port: PROTOCOL_PORT };
let current: NativeInfo = WSL_MODE;

export const nativeInfo = (): NativeInfo => current;
export const setNativeInfo = (info: NativeInfo): void => { current = info; };
export const isNative = (): boolean => current.mode === 'native';
