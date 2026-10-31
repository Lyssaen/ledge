import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { escalateCategory, revisitDecision, setRule, updateMandate, useEscalations, useLedgeDecisionList, useLedgeRules, useMandate, useRigs, type DaemonClient } from '@ledge/fleet';
import type { MandateCategory, ServerMessage } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import type { FleetView } from '../../fleet/useFleet';
import { useI18n } from '../../i18n/lang';
import { Modal } from '../../shell/Modal';
import { cls } from '../../shell/cls';
import { CategoryDetail } from './CategoryDetail';
import { CategoryList } from './CategoryList';
import { Memories } from './Memories';
import { categoryStats, mandatePath, mandateSides } from './model';

type Sub = 'settles' | 'memories';

/** « Ouvrir » (C26): the mandate in a field, saved through `mandate.update`; a refusal stays in the dialog. */
function MandateEditor({ text, saving, error, onSave, onCancel }: { text: string; saving: boolean; error: string | null; onSave(text: string): void; onCancel(): void }): JSX.Element {
  const { t } = useI18n();
  const e = t.mandate.editor;
  const [value, setValue] = useState(text);
  return (
    <Modal title={e.title} wide className="md-editor" onClose={onCancel}>
      <div className="confirm-content">
        <textarea aria-label={e.title} className="md-editor-field" value={value} spellCheck={false} autoFocus onChange={x => setValue(x.target.value)} />
        {error && <p className="md-editor-error" role="alert">{e.refused(error)}</p>}
        <div className="confirm-actions">
          <Button onClick={onCancel}>{e.cancel}</Button>
          <Button variant="primary" disabled={saving} onClick={() => onSave(value)}>{saving ? e.saving : e.save}</Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The Mandat tab of the Ledge screen (lot 7, maquette p-ledge-mandat): the sub-tabs « Ce que Ledge tranche » and « Souvenirs · n » (n = the
 * rules kept), and « Mandat lu dans ~/.ledge/mandat.md ». It reads the mandate, the rules and the decisions the local daemon serves, and acts
 * through `category.escalate`, `rule.set`, `decision.revisit` and `mandate.update`. It never turns the brain on (that is BrainOffer's and
 * Réglages › Ledge's).
 */
export function MandateTab({ client, view }: { client: DaemonClient; view: FleetView }): JSX.Element {
  const { t } = useI18n();
  const m = t.mandate;
  const mandate = useMandate();
  const rules = useLedgeRules();
  const decisions = useLedgeDecisionList();
  const escalations = useEscalations(client);
  const rigs = useRigs(client);
  const offline = !view.machines.find(x => x.id === 'local')?.ready;
  const [sub, setSub] = useState<Sub>('settles');
  const [chosen, setChosen] = useState<MandateCategory | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const savingRef = useRef<string | null>(null);
  savingRef.current = saving;

  const sides = useMemo(() => mandateSides(mandate?.text ?? ''), [mandate?.text]);
  const stats = useMemo(() => categoryStats(decisions, escalations, new Date().toISOString()), [decisions, escalations]);
  const files = mandatePath(mandate?.path);
  const category = chosen ?? sides.self[0] ?? sides.user[0] ?? null;

  // The answer to « Enregistrer »: its `rig.result` (a local daemon's, or one a machine relays), or the fleet's own refusal.
  useEffect(() => {
    const handle = (msg: ServerMessage) => {
      const rid = savingRef.current;
      if (!rid) return;
      if (msg.type === 'rig.result' && msg.rid === rid) {
        setSaving(null);
        if (msg.ok) { setEditing(false); setError(null); setNotice(msg.reason ?? null); } else setError(msg.reason ?? msg.code ?? 'failed');
      } else if (msg.type === 'error' && msg.request === 'mandate.update') { setSaving(null); setError(msg.message); }
    };
    const offs = [client.onMessage(handle), ...(client.fleet ? [client.fleet.onMachineMessage((_, msg) => handle(msg))] : [])];
    return () => { for (const off of offs) off(); };
  }, [client]);

  const labels: Record<Sub, string> = { settles: m.settles, memories: m.memories(rules.length) };
  const revisit = (d: { id: string }) => revisitDecision(client, d.id);
  const onSetRule = (id: string, status: 'active' | 'rejected') => setRule(client, id, status);
  return (
    <div className="rigs-tab md-tab" role="tabpanel" aria-label={t.home.tabs.mandat}>
      <div className="rigs-bar">
        <div className="rigs-subtabs" role="tablist" aria-label={m.views}>
          {(['settles', 'memories'] as const).map(x => (
            <button key={x} type="button" role="tab" aria-selected={sub === x} className={cls(sub === x && 'on')} onClick={() => setSub(x)}>{labels[x]}</button>
          ))}
        </div>
        <span className="md-read">{m.readIn} <code>{files.file}</code></span>
      </div>
      {notice && <p className="rigs-banner" role="status">{notice}</p>}
      <div className="rigs-body">
        {mandate === undefined ? <p className="lp-none" role="status">{m.loading}</p>
          : sub === 'memories' ? <Memories rules={rules} decisions={decisions} rigs={rigs} offline={offline} onSetRule={onSetRule} onRevisit={revisit} />
          : (
            <div className="rigs-specs md-settles">
              <CategoryList self={sides.self} user={sides.user} stats={stats} chosen={category} onChoose={setChosen} />
              {category && (
                <CategoryDetail category={category} isSelf={sides.self.includes(category)} week={stats[category].week} pending={stats[category].pending}
                  rules={rules} decisions={decisions} files={files} offline={offline}
                  onEscalate={c => escalateCategory(client, c)} onSetRule={onSetRule} onRevisit={revisit}
                  onOpen={() => { setError(null); setEditing(true); }} />
              )}
            </div>
          )}
      </div>
      {editing && mandate && (
        <MandateEditor text={mandate.text} saving={saving !== null} error={error}
          onCancel={() => { setEditing(false); setSaving(null); setError(null); }}
          onSave={text => { setError(null); setSaving(updateMandate(client, text)); }} />
      )}
    </div>
  );
}
