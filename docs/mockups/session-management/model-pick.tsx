import React, { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon, ICONS } from '../../../apps/overlay/src/ui/icons';
import { HARNESS_LABELS, type PreviewTool } from './harness';

export type ModelChoice = { model: string | null; effort: string | null };
type DemoModel = { id: string | null; label: string; description: string; efforts?: readonly string[]; defaultEffort?: string };
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const CODEX_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;
const OMP_EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;

// Preview-only catalogs, not machine discovery. Adapted from Desktop's ModelMenu / ModelPicker.
const DEMO_MODELS: Record<PreviewTool, readonly DemoModel[]> = {
  claude: [
    { id: null, label: 'Par défaut', description: 'Le choix de Claude Code · aucun modèle imposé', efforts: CLAUDE_EFFORTS, defaultEffort: 'high' },
    { id: 'fable', label: 'Fable', description: 'Le plus capable · tâches complexes', efforts: CLAUDE_EFFORTS, defaultEffort: 'high' },
    { id: 'opus', label: 'Opus', description: 'Raisonnement approfondi · plus lent', efforts: CLAUDE_EFFORTS, defaultEffort: 'high' },
    { id: 'sonnet', label: 'Sonnet', description: 'Équilibré · travail quotidien', efforts: CLAUDE_EFFORTS, defaultEffort: 'high' },
    { id: 'haiku', label: 'Haiku', description: 'Rapide et économique' },
  ],
  codex: [
    { id: null, label: 'Par défaut', description: 'Le choix de Codex · aucun modèle imposé', efforts: CODEX_EFFORTS, defaultEffort: 'medium' },
    { id: 'gpt-5.4', label: 'GPT-5.4', description: 'Code et raisonnement général', efforts: CODEX_EFFORTS, defaultEffort: 'medium' },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', description: 'Développement agentique · longues tâches', efforts: CODEX_EFFORTS, defaultEffort: 'medium' },
    { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini', description: 'Petites corrections · rapide et économique', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
  ],
  cursor: [
    { id: null, label: 'Par défaut', description: 'Le choix de Cursor · aucun modèle imposé' },
    { id: 'auto', label: 'Auto', description: 'Sélection automatique par Cursor' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: 'Anthropic · équilibré pour le code' },
    { id: 'claude-opus-4-8[effort=high]', label: 'Claude Opus 4.8 · High', description: 'Anthropic · effort high encodé dans le nom' },
    { id: 'gpt-5.4', label: 'GPT-5.4', description: 'OpenAI · code et raisonnement' },
  ],
  omp: [
    { id: null, label: 'Par défaut', description: 'Le choix d’omp · fournisseur configuré', efforts: OMP_EFFORTS, defaultEffort: 'medium' },
    { id: 'anthropic/claude-sonnet-4-6', label: 'Anthropic · Claude Sonnet 4.6', description: 'Équilibré · fournisseur Anthropic', efforts: ['off', 'low', 'medium', 'high'], defaultEffort: 'medium' },
    { id: 'anthropic/claude-opus-4-8', label: 'Anthropic · Claude Opus 4.8', description: 'Raisonnement approfondi · fournisseur Anthropic', efforts: OMP_EFFORTS, defaultEffort: 'high' },
    { id: 'openai-codex/gpt-5.4', label: 'OpenAI Codex · GPT-5.4', description: 'Code et outils · fournisseur OpenAI Codex', efforts: OMP_EFFORTS, defaultEffort: 'medium' },
    { id: 'cursor/auto', label: 'Cursor · Auto', description: 'Routage automatique · fournisseur Cursor' },
  ],
};
const GLYPHS = {
  chip: ['M12 8V4H8', 'M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z', 'M2 14h2', 'M20 14h2', 'M15 13v2', 'M9 13v2'],
  upDown: ['m7 15 5 5 5-5', 'm7 9 5-5 5 5'],
  search: ['M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14', 'm20 20-3.5-3.5'],
  minus: ['M5 12h14'],
} as const;

// Exact ModelIdSchema constraints, kept local so this mockup has no protocol/runtime dependency.
// Do not trim: whitespace and CLI flags (including -p) are not valid raw model IDs.
function validModelId(value: string): boolean {
  return value.length >= 1 && value.length <= 200 && /^[A-Za-z0-9][A-Za-z0-9._:/@[\]=,+-]*$/.test(value);
}

function position(anchor: HTMLElement): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const viewport = window.visualViewport;
  const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0;
  const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
  const panelWidth = Math.min(Math.max(rect.width, 360), Math.max(0, width - 16));
  const top = Math.max(y + 8, Math.min(rect.top, y + height - 8));
  const bottom = Math.max(y + 8, Math.min(rect.bottom, y + height - 8));
  const below = Math.max(0, y + height - 8 - bottom - 6), above = Math.max(0, top - y - 8 - 6);
  const up = below < 330 && above > below;
  const maxHeight = Math.min(390, up ? above : below);
  return {
    left: Math.max(x + 8, Math.min(rect.left, x + width - panelWidth - 8)), width: panelWidth, maxHeight,
    ...(up ? { top: top - 6, transform: 'translateY(-100%)' } : { top: bottom + 6 }),
  };
}

/** Shared by the full Desktop launcher and each docked Ledge launch card; no daemon calls. */
export function ModelPick(p: { tool: PreviewTool; pick: ModelChoice; onPick: (pick: ModelChoice) => void; disabled?: boolean; outdated?: boolean }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const models = DEMO_MODELS[p.tool];
  const shown = models.find(m => m.id === p.pick.model);
  const label = shown?.label ?? p.pick.model ?? 'Par défaut';
  const legend = `Modèle de ${HARNESS_LABELS[p.tool]}`;
  useEffect(() => { setOpen(false); }, [p.tool, p.disabled, p.outdated]);
  if (p.outdated) return null;
  return (
    <div className="preview-model-pick">
      <button ref={trigger} type="button" className={`preview-model-trigger${open ? ' open' : ''}`} disabled={p.disabled}
        aria-label={`${legend} : ${label}`} aria-haspopup="dialog" aria-expanded={open}
        title={`${p.pick.model ?? 'Par défaut · aucun ID transmis'}${shown ? ` — ${shown.description}` : ''}${p.pick.effort ? ` · effort ${p.pick.effort}` : ''}`}
        onClick={() => setOpen(value => !value)}>
        <Icon d={GLYPHS.chip} size={15} /><strong>{label}</strong>
        {p.pick.effort && <span className="preview-model-badge">{p.pick.effort}</span>}
        <span className="preview-model-desc">{shown?.description ?? 'Identifiant exact'}</span>
        <Icon d={GLYPHS.upDown} size={15} />
      </button>
      {open && !p.disabled && trigger.current && <ModelMenu key={p.tool} anchor={trigger.current} tool={p.tool} models={models} pick={p.pick}
        label={legend} onPick={p.onPick} onClose={() => setOpen(false)} />}
    </div>
  );
}

function ModelMenu(p: { anchor: HTMLButtonElement; tool: PreviewTool; models: readonly DemoModel[]; pick: ModelChoice; label: string; onPick: (pick: ModelChoice) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null), field = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(() => Math.max(0, p.models.findIndex(m => m.id === p.pick.model)));
  const [style, setStyle] = useState<CSSProperties>(() => position(p.anchor));
  const hits = p.models.filter(m => `${m.label} ${m.id ?? ''} ${m.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  const raw = validModelId(query) && !p.models.some(m => m.id === query) ? query : null;
  const options = raw ? [...hits, { id: raw, label: 'Utiliser tel quel', description: raw }] : hits;
  const current = p.models.find(m => m.id === p.pick.model);
  const efforts = current?.efforts ?? [];
  const effort = p.pick.effort ?? current?.defaultEffort;
  const effortIndex = effort ? efforts.indexOf(effort) : -1;

  useLayoutEffect(() => {
    const follow = () => setStyle(position(p.anchor));
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    window.visualViewport?.addEventListener('resize', follow);
    window.visualViewport?.addEventListener('scroll', follow);
    const resize = new ResizeObserver(follow);
    resize.observe(p.anchor);
    return () => {
      window.removeEventListener('resize', follow); window.removeEventListener('scroll', follow, true);
      window.visualViewport?.removeEventListener('resize', follow); window.visualViewport?.removeEventListener('scroll', follow);
      resize.disconnect();
    };
  }, [p.anchor]);
  useEffect(() => { field.current?.focus(); }, []);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!box.current?.contains(target) && !p.anchor.contains(target)) p.onClose();
    };
    // Escape closes the top menu even if a stepper reaching its boundary disabled the focused button.
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      p.onClose(); p.anchor.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [p.anchor, p.onClose]);
  useEffect(() => { document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active, listId, query]);

  const choose = (id: string | null) => {
    const next = p.models.find(m => m.id === id);
    p.onPick({ model: id, effort: p.pick.effort && next?.efforts?.includes(p.pick.effort) ? p.pick.effort : null });
    field.current?.focus();
  };
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); event.stopPropagation();
      setActive(index => Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
    } else if (event.key === 'Enter') {
      event.preventDefault(); event.stopPropagation();
      if (options[active]) choose(options[active].id);
    }
  };
  const setEffort = (value: string) => p.onPick({ model: p.pick.model, effort: value === current?.defaultEffort ? null : value });
  return createPortal(
    <div ref={box} className="preview-model-menu" style={style} role="dialog" aria-label={p.label}>
      <div className="preview-model-search">
        <Icon d={GLYPHS.search} size={15} />
        <input ref={field} role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-label="Rechercher un modèle"
          aria-activedescendant={options.length ? `${listId}-${active}` : undefined} spellCheck={false} autoComplete="off"
          placeholder="Nom, identifiant, description…" value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={keys} />
        <span className="preview-model-count" aria-live="polite">{hits.length} sur {p.models.length}</span>
      </div>
      <div className="preview-model-options" role="listbox" id={listId} aria-label={p.label}>
        {options.map((model, index) => {
          const isRaw = index === hits.length;
          const selected = model.id === p.pick.model;
          return <div key={model.id ?? 'default'} id={`${listId}-${index}`} role="option" aria-selected={selected}
            className={`preview-model-option${index === active ? ' active' : ''}${isRaw ? ' raw' : ''}`}
            title={`${model.id ?? 'Par défaut · aucun ID transmis'} — ${model.description}`}
            onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(model.id)}>
            <span className="preview-model-name">{model.label}</span>
            {model.id === null && <span className="preview-model-badge">défaut</span>}
            <span className="preview-model-desc">{model.description}</span>
            {selected && <Icon d={ICONS.check.d} size={15} />}
          </div>;
        })}
        {query && !validModelId(query) && <p className="preview-model-note">Identifiant brut invalide : 1–200 caractères, sans espace ni option commençant par « - ».</p>}
        {!options.length && !query && <p className="preview-model-note">Aucun modèle correspondant.</p>}
      </div>
      <div className="preview-model-foot">
        {p.tool === 'cursor' ? <p className="preview-model-note">Cursor : l’effort est encodé dans le nom du modèle, pas dans un réglage séparé.</p>
          : efforts.length ? <div className="preview-model-effort"><span>Effort</span>
            <div className="preview-effort-stepper" role="group" aria-label="Effort de raisonnement">
              <button type="button" aria-label="Moins d’effort" disabled={effortIndex <= 0} onClick={() => setEffort(efforts[effortIndex - 1]!)}><Icon d={GLYPHS.minus} size={14} /></button>
              <span className="preview-effort-value"><output aria-live="polite">{effort ?? 'Par défaut'}</output>
                <span className="preview-effort-dots" aria-hidden="true">{efforts.map((value, index) => <i key={value} className={index <= effortIndex ? 'on' : undefined} />)}</span>
              </span>
              <button type="button" aria-label="Plus d’effort" disabled={effortIndex >= efforts.length - 1} onClick={() => setEffort(efforts[effortIndex + 1]!)}><Icon d={ICONS.plus.d} size={14} /></button>
            </div>
          </div> : <p className="preview-model-note">{current ? 'Pas de réglage d’effort pour ce modèle de démonstration.' : 'Identifiant brut : capacités inconnues, aucun effort transmis.'}</p>}
        <div className="preview-model-actions"><small>Modèles de démonstration · ↑ ↓ Entrée · Échap</small><button type="button" onClick={() => { p.onClose(); p.anchor.focus(); }}>Terminé</button></div>
      </div>
    </div>, document.body,
  );
}
