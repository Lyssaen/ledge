import { useEffect, useState } from 'react';

export type TermKey = 'thread' | 'copy' | 'paste' | 'panel' | 'pass';

type KeyLike = Pick<KeyboardEvent, 'type' | 'code' | 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

/** What a key does inside the terminal, as Windows Terminal does it: by physical key (`code`), so AZERTY's ² is the focus key too.
 *  Ctrl+Alt is AltGr on Windows and types a character, so it always goes to the terminal. With the IDE on (`ide`), Ctrl+J is the
 *  bottom panel's toggle even here, as VS Code does; Ctrl+B stays the terminal's (tmux's prefix). */
export function termKey(e: KeyLike, hasSelection: boolean, ide = false): TermKey {
  if (e.type !== 'keydown' || !e.ctrlKey || e.altKey || e.metaKey) return 'pass';
  if (e.code === 'Backquote') return 'thread';
  if (e.code === 'KeyC' && (e.shiftKey || hasSelection)) return 'copy';
  if (e.code === 'KeyV') return 'paste';
  if (ide && e.code === 'KeyJ' && !e.shiftKey) return 'panel';
  return 'pass';
}

type LayoutKeyboard = { getLayoutMap?(): Promise<Map<string, string>> };

/** The character the focus key prints on this layout (² on AZERTY), for the shortcuts help; a backquote where the browser won't say. */
export async function backquoteLabel(): Promise<string> {
  try {
    const map = await (navigator as Navigator & { keyboard?: LayoutKeyboard }).keyboard?.getLayoutMap?.();
    return map?.get('Backquote') || '`';
  } catch {
    return '`';
  }
}

/** The focus key as the user's layout prints it (² on AZERTY). */
export function useBackquote(): string {
  const [key, setKey] = useState('`');
  useEffect(() => {
    let live = true;
    void backquoteLabel().then(k => { if (live && k !== '`') setKey(k); });
    return () => { live = false; };
  }, []);
  return key;
}
