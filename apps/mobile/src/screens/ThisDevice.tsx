import { useState } from 'react';
import { DEVICE_NAME_MAX } from '@ledge/protocol';
import { copy, locale } from '../copy';
import type { PinnedPc } from '../link/keys';
import { defaultDeviceName } from '../link/label';
import { useMobile, type MobileStore } from '../state/store';
import { Button } from '../ui/Button';
import { Sheet } from '../ui/Dialog';
import { FIELD } from '../ui/field';
import { Icon } from '../ui/icons';

const D = copy.connection.device;

/** This device's name as the PC shows it, or the one it would give itself until the PC says. */
export const ownName = (name: string | undefined): string =>
  name ?? defaultDeviceName(globalThis.navigator?.userAgent ?? '', globalThis.navigator?.maxTouchPoints ?? 0);

/**
 * « Cet appareil » (docs/mockups/mobile-multi-device.html, part 3): its kind, its name, when it was linked, and « Renommer »,
 * which asks the PC through the sealed channel. Shown once the PC says which device this is (an older PC does not).
 */
export function ThisDevice({ store, pinned }: { store: MobileStore; pinned: PinnedPc | null }) {
  const state = useMobile(store);
  const [editing, setEditing] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const device = state.device;
  if (!device?.id) return null;
  const name = ownName(device.name);
  const linked = pinned ? new Date(pinned.pinnedAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  const draft = editing?.trim() ?? '';
  const save = () => {
    if (!draft || draft.length > DEVICE_NAME_MAX) return;
    if (store.renameDevice(draft) === null) { setFailed(true); return; }
    setFailed(false);
    setEditing(null);
  };
  return (
    <section aria-labelledby="device-title" className="flex flex-col gap-2.5">
      <h2 id="device-title" className="text-small font-medium text-muted">{D.title}</h2>
      <div className="flex items-center gap-3 rounded-[10px] border border-line bg-surface px-4 py-3">
        <span className="grid size-9 flex-none place-items-center rounded-[10px] bg-raised" aria-hidden="true"><Icon name={device.kind === 'tablet' ? 'tablet' : 'phone'} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold [overflow-wrap:anywhere]">{name}</p>
          {linked && <p className="text-meta text-muted">{D.linkedOn(linked)}</p>}
        </div>
        <Button size="sm" aria-label={D.renameLabel(name)} onClick={() => { setFailed(false); setEditing(name); }}>{D.rename}</Button>
      </div>
      {failed && <p role="status" className="text-small text-danger-fg">{D.failed}</p>}
      <p className="text-small text-muted">{D.others}</p>
      {editing !== null && (
        <Sheet labelledBy="rename-title" onClose={() => setEditing(null)}>
          <h2 id="rename-title" className="text-heading leading-[1.3] font-semibold tracking-[-.5px]">{D.sheetTitle}</h2>
          <p className="text-body text-muted">{D.sheetBody}</p>
          <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); save(); }}>
            <label className="flex flex-col gap-1.5">
              <span className="sr-only">{D.field}</span>
              <input className={FIELD} value={editing} maxLength={DEVICE_NAME_MAX} autoFocus aria-describedby="rename-count" onChange={e => setEditing(e.target.value)} />
              <span id="rename-count" className="self-end text-meta text-muted">{editing.length}/{DEVICE_NAME_MAX}</span>
            </label>
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setEditing(null)}>{D.cancel}</Button>
              <Button variant="primary" type="submit" className="flex-[2]" disabled={!draft}>{D.save}</Button>
            </div>
          </form>
        </Sheet>
      )}
    </section>
  );
}
