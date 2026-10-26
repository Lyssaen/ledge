import { useEffect, useState } from 'react';
import type { MobileStore } from '../state/store';

/** An object URL for an image, fetched once `enabled` (through the store's single queue); `failed` once the PC refused. */
export function useImageUrl(store: MobileStore, id: string | undefined, preview: boolean, enabled = true): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ key: string; url: string | null; failed: boolean }>({ key: '', url: null, failed: false });
  const key = id ? `${id}|${preview}` : '';
  useEffect(() => {
    if (!id || !enabled) return;
    let live = true;
    store.imageUrl(id, preview).then(url => { if (live) setState({ key, url, failed: false }); }, () => { if (live) setState({ key, url: null, failed: true }); });
    return () => { live = false; };
  }, [store, id, preview, enabled, key]);
  return state.key === key && key !== '' ? { url: state.url, failed: state.failed } : { url: null, failed: false };
}
