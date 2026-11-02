import type { RigInfo, ThreadItem } from '@ledge/protocol';

/** OpenRig's thread items, as the daemon makes them (packages/protocol/src/rigMessages.ts). */
export const at = (h: number, m: number) => new Date(2026, 10, 2, h, m).toISOString();
const base = (id: string, t: string) => ({ id, at: t, turn: 1 });
const ENVELOPE = (from: string, body: string) => `From: ${from}\nTo: design-ux@ledge-dev-2\nSent: 11-02 18:01Z · gen 6a740950\n---\n${body}\n---\n↩ Reply: rig send ${from} "..."`;

export const rigReceived = (id: string, t: string, body: string, extra: Partial<RigInfo> = {}, peer?: string): ThreadItem => ({
  kind: 'received', ...base(id, t), from: extra.from ?? 'pilot-lead@ledge-dev-2', text: body, ...(peer ? { peer } : {}),
  rig: { kind: 'message', from: 'pilot-lead@ledge-dev-2', to: 'design-ux@ledge-dev-2', raw: ENVELOPE(extra.from ?? 'pilot-lead@ledge-dev-2', body), ...extra }
});

export const rigHandoff = (id: string, t: string, summary: string, extra: Partial<RigInfo> = {}, more: { outgoing?: true; peer?: string } = {}): ThreadItem => ({
  kind: 'notice', ...base(id, t), notice: 'other', text: `Queue handoff: qitem-20261102190205-c0704682203041b9 - check your queue. Summary: ${summary}`,
  name: 'pilot-lead@ledge-dev-2', ...(more.outgoing ? { outgoing: true as const } : {}), ...(more.peer ? { peer: more.peer } : {}),
  rig: { kind: 'handoff', from: 'pilot-lead@ledge-dev-2', qitem: 'qitem-20261102190205-c0704682203041b9', summary, raw: `Queue handoff: qitem-20261102190205-c0704682203041b9 - check your queue. Summary: ${summary}`, ...extra }
});

export const rigNotice = (id: string, t: string, text: string, rig: Omit<RigInfo, 'raw'> & { raw?: string }): ThreadItem => ({
  kind: 'notice', ...base(id, t), notice: 'other', text, rig: { raw: text, ...rig }
});

export const rigSent = (id: string, t: string, body: string, status: 'sending' | 'delivered' | 'read' | 'failed' = 'delivered', peer?: string): ThreadItem => ({
  kind: 'sent', ...base(id, t), to: 'dev-front@ledge-dev-2', text: body, status, ...(peer ? { peer } : {}),
  rig: { kind: 'message', to: 'dev-front@ledge-dev-2', command: `rig send dev-front@ledge-dev-2 "${body}"`, raw: `rig send dev-front@ledge-dev-2 "${body}"\nSent to dev-front@ledge-dev-2` }
});

export const prompt = (id: string, t: string, text: string): ThreadItem => ({ kind: 'prompt', ...base(id, t), text });
