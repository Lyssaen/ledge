import type { ModelChoice } from '@ledge/protocol';
import { EffortSchema, ModelIdSchema } from '@ledge/protocol';

/**
 * `get_available_models` as the launch form's catalog. Nothing is written here: the list is whatever the OMP of the machine
 * offers, identified by `provider/id` (the id alone names different models across providers). It tells what is configured,
 * not that a key or a quota is valid (spec 2026-10-20 §7).
 */
export function ompChoices(raw: { models: unknown[]; current?: { id?: string; provider?: string } }): ModelChoice[] {
  const out: ModelChoice[] = [];
  for (const m of raw.models) {
    if (!m || typeof m !== 'object') continue;
    const { id, provider, name, thinking } = m as { id?: unknown; provider?: unknown; name?: unknown; thinking?: { efforts?: unknown } };
    if (typeof id !== 'string' || typeof provider !== 'string') continue;
    const full = `${provider}/${id}`;
    // Never an id that reads as a flag (`-p`, on either side of the slash), or with characters a command line could mangle.
    if (id.startsWith('-') || provider.startsWith('-') || !ModelIdSchema.safeParse(full).success) continue;
    const efforts = Array.isArray(thinking?.efforts) ? thinking.efforts.filter((e): e is string => typeof e === 'string' && EffortSchema.safeParse(e).success) : [];
    out.push({
      id: full, label: typeof name === 'string' && name ? name : id, description: provider,
      ...(efforts.length ? { efforts } : {}),
      ...(raw.current?.id === id && raw.current.provider === provider ? { isDefault: true } : {})
    });
  }
  return out;
}
