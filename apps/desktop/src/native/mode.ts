import { nativeInfo as askShell } from '../tauri/bridge';
import { isNative, nativeInfo, setNativeInfo, WSL_MODE, type NativeInfo } from './state';

export { isNative, nativeInfo, type NativeInfo };

/** Asks the shell once, at boot (main.tsx); outside Tauri, or when it cannot say, WSL mode on the usual port. */
export async function loadNativeInfo(): Promise<NativeInfo> {
  setNativeInfo((await askShell()) ?? WSL_MODE);
  return nativeInfo();
}

/** The local daemon's address. */
export const localUrl = (): string => `ws://127.0.0.1:${nativeInfo().port}`;

/** What this Desktop offers. Native mode's first round offers only the acceptance bar (spec §1): launch and follow Claude
 *  and Codex sessions, answer them, type in their terminal, and see the SSH machines with their OpenRig seats. */
export interface Features {
  chat: boolean; atelier: boolean; documents: boolean; captures: boolean; tasks: boolean; broadcast: boolean;
  island: boolean; mobile: boolean; shells: boolean;
}

export function features(native: boolean): Features {
  const on = !native;
  return { chat: on, atelier: on, documents: on, captures: on, tasks: on, broadcast: on, island: on, mobile: on, shells: on };
}

/** The features of this window (the mode is fixed at boot, so a plain read). */
export const useFeatures = (): Features => features(isNative());
