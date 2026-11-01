import type { LedgeDecision } from '@ledge/protocol';

/** Collects newly recorded Ledge decisions and sends one summary per minute. */
export function createDecisionBatch(read: () => LedgeDecision[], send: (count: number) => void) {
  const known = new Set(read().map(d => d.id));
  let count = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    changed() {
      const decisions = read();
      for (const decision of decisions) {
        if (!known.has(decision.id) && decision.by === 'ledge') count += 1;
        known.add(decision.id);
      }
      if (known.size > 400) { known.clear(); for (const decision of decisions) known.add(decision.id); }
      if (!count || timer) return;
      timer = setTimeout(() => { timer = undefined; const ready = count; count = 0; send(ready); }, 60_000);
      timer.unref?.();
    },
    close() { if (timer) clearTimeout(timer); timer = undefined; count = 0; }
  };
}
