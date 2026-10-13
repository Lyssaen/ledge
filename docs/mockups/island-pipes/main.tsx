import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Tool } from '@ledge/protocol';
import { Bot } from '../../../apps/overlay/src/bots/Bot';
import { ResidentMascot } from '../../../apps/overlay/src/bots/ResidentMascot';
import type { BotState } from '../../../apps/overlay/src/bots/poseFor';
import { Button } from '../../../apps/overlay/src/ui/Button';
import { Icon, ICONS } from '../../../apps/overlay/src/ui/icons';
import { LangProvider } from '../../../apps/overlay/src/i18n/lang';
import { Shoulders } from '../../../apps/overlay/src/surface/Shoulders';
import { ISLAND, SIZES } from '../../../apps/overlay/src/surface/geometry';
import '../../../apps/overlay/src/styles/base.css';
import '../multi-machine-chat/preview.css';
import './pipes.css';

type Variant = 'current' | 'each' | 'machine';
interface MockBot { id: string; name: string; tool: Tool; state: BotState; pose: 1 | 2 | 3; pending: boolean; machine: 'local' | 'server' }
const ALL: MockBot[] = [
  { id: 'ida', name: 'Ida', tool: 'claude', state: 'working', pose: 1, pending: false, machine: 'local' },
  { id: 'otto', name: 'Otto', tool: 'codex', state: 'approval', pose: 2, pending: true, machine: 'server' },
  { id: 'nova', name: 'Nova', tool: 'claude', state: 'idle', pose: 3, pending: false, machine: 'local' },
  { id: 'rex', name: 'Rex', tool: 'cursor', state: 'working', pose: 1, pending: false, machine: 'server' },
  { id: 'lia', name: 'Lia', tool: 'claude', state: 'done', pose: 2, pending: false, machine: 'local' },
  { id: 'max', name: 'Max', tool: 'codex', state: 'working', pose: 3, pending: false, machine: 'server' },
  { id: 'zoe', name: 'Zoé', tool: 'claude', state: 'idle', pose: 1, pending: false, machine: 'server' },
  { id: 'kai', name: 'Kai', tool: 'claude', state: 'working', pose: 2, pending: false, machine: 'local' }
];
const MACHINES = { local: 'Cette machine', server: 'dev-server' };

/** The order and the separators of each variant: `true` before a bot means a pipe in front of it. */
function arrange(bots: MockBot[], variant: Variant): Array<{ bot: MockBot; pipe: boolean }> {
  if (variant === 'machine') {
    // Grouped by machine (this machine first); asks first inside each machine.
    const groups = (['local', 'server'] as const).map(m => bots.filter(b => b.machine === m)).filter(g => g.length);
    const ordered = groups.flatMap(g => [...g.filter(b => b.pending), ...g.filter(b => !b.pending)]);
    return ordered.map((bot, i) => ({ bot, pipe: i > 0 && ordered[i - 1]!.machine !== bot.machine }));
  }
  const ordered = [...bots.filter(b => b.pending), ...bots.filter(b => !b.pending)];
  return ordered.map((bot, i) => ({ bot, pipe: variant === 'each' && i > 0 }));
}

const Pipe = ({ title }: { title?: string }) => <span data-separator aria-hidden="true" title={title} style={{ display: 'block', flexShrink: 0, width: SIZES.separatorH, height: 16, marginLeft: ISLAND.sepGap, marginRight: ISLAND.sepGap - ISLAND.gap, background: 'var(--sidebar-border)' }} />;

/** The compact island, drawn like `Handle` (same sizes, same tokens), with the variant's separators. */
function Island({ bots, variant, theme, dnd }: { bots: MockBot[]; variant: Variant; theme: 'dark' | 'light'; dnd: boolean }) {
  const [hover, setHover] = useState<string | null>(null);
  const items = arrange(bots, variant);
  const shown = items.slice(0, ISLAND.max), extra = items.length - shown.length;
  const pipes = shown.filter(i => i.pipe).length;
  const w = ISLAND.padL + ISLAND.resident + (shown.length ? ISLAND.sepGap + SIZES.separatorH + ISLAND.sepGap + shown.length * ISLAND.companion + (shown.length - 1) * ISLAND.gap + pipes * (ISLAND.sepGap * 2 + SIZES.separatorH - ISLAND.gap) : 0) + (extra ? ISLAND.gap + ISLAND.pill : 0) + (dnd ? ISLAND.gap + ISLAND.moon : 0) + ISLAND.padR;
  return <div className="island-wrap" style={{ width: w }}>
    <Shoulders left={0} w={w} transition="none" opacity={1} />
    <div className="island" style={{ width: w, height: ISLAND.h, padding: `0 ${ISLAND.padR}px 0 ${ISLAND.padL}px` }}>
      <span style={{ display: 'grid', placeItems: 'center', flexShrink: 0, width: ISLAND.resident, height: ISLAND.resident }}><ResidentMascot size={ISLAND.resident} theme={theme} reducedMotion dnd={dnd} /></span>
      {shown.length > 0 && <Pipe />}
      {shown.map(({ bot, pipe }, i) => <span key={bot.id} style={{ display: 'contents' }}>
        {pipe && <Pipe title={variant === 'machine' ? MACHINES[bot.machine] : undefined} />}
        <button type="button" title={`${bot.name} · ${MACHINES[bot.machine]}`} onMouseEnter={() => setHover(bot.id)} onMouseLeave={() => setHover(null)}
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0, border: 0, borderRadius: 9999, cursor: 'pointer', width: ISLAND.companion, height: ISLAND.companion, marginLeft: ISLAND.gap, background: hover === bot.id ? 'var(--sidebar-accent)' : 'transparent', opacity: hover === bot.id || bot.pending ? 1 : bot.state === 'done' ? 0.55 : 0.8 }}>
          <span style={{ display: 'inline-flex', lineHeight: 0, transform: `scale(${bot.pending || hover === bot.id ? 1.25 : 1})` }}><Bot seed={bot.id} tool={bot.tool} state={bot.state} pose={bot.pose} size={ISLAND.companion} shownSize={ISLAND.companion} theme={theme} reducedMotion /></span>
        </button>
      </span>)}
      {extra > 0 && <span className="mono" style={{ flexShrink: 0, width: ISLAND.pill, height: 16, marginLeft: ISLAND.gap, borderRadius: 9999, background: 'var(--sidebar-accent)', color: 'var(--muted-foreground)', fontSize: 11, lineHeight: '16px', textAlign: 'center' }}>+{extra}</span>}
      {dnd && <svg aria-hidden="true" width={ISLAND.moon} height={ISLAND.moon} viewBox="0 0 24 24" fill="none" stroke="var(--muted-foreground)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginLeft: ISLAND.gap }}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>}
    </div>
  </div>;
}

function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [variant, setVariant] = useState<Variant>('each');
  const [count, setCount] = useState(4);
  const [dnd, setDnd] = useState(false);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const bots = ALL.slice(0, count);
  const variants = [['current', '00', 'Aujourd’hui', 'Un seul trait, après Ledge.'], ['each', 'A', 'Entre chaque session', 'Un trait entre tous les compagnons.'], ['machine', 'B', 'Entre les machines', 'Un trait quand on change de machine.']] as const;
  const caption = { current: 'L’île actuelle, pour comparer.', each: 'Chaque compagnon a sa propre case. Les demandes passent toujours en tête.', machine: 'Cette machine d’abord, puis dev-server. Les demandes passent en tête de leur machine.' }[variant];
  return <LangProvider lang="fr"><div className="design-page">
    <header className="studio-head"><span className="wordmark">Ledge<span>.</span></span><span className="studio-label">ÎLE / SÉPARATEURS</span><Button variant="ghost" size="sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon {...ICONS.dnd} />{theme === 'dark' ? 'Thème clair' : 'Thème sombre'}</Button></header>
    <div className="studio-layout">
      <aside className="notes"><div className="eyebrow">L’ÎLE REPLIÉE</div><h1>Un trait<br />entre les sessions.</h1><p>Le même séparateur qu’entre Ledge et ses compagnons.<br />Deux façons de le répéter.</p>
        <nav aria-label="Variantes">{variants.map(([id, n, title, hint]) => <button key={id} aria-pressed={variant === id} onClick={() => setVariant(id)}><span className="step-number">{n}</span><span><strong>{title}</strong><small>{hint}</small></span><Icon {...ICONS.chevronRight} size={14} /></button>)}</nav>
        <div className="pipes-controls">
          <span>Sessions</span><div className="pipes-seg">{[2, 4, 6, 8].map(n => <button key={n} aria-pressed={count === n} onClick={() => setCount(n)}>{n}</button>)}</div>
          <span>Ne pas déranger</span><div className="pipes-seg">{[false, true].map(v => <button key={String(v)} aria-pressed={dnd === v} onClick={() => setDnd(v)}>{v ? 'Oui' : 'Non'}</button>)}</div>
        </div>
        <small className="simulation">Maquette · vrais compagnons, tailles de l’île réelle<br />Otto attend votre accord (il passe en tête).</small>
      </aside>
      <section className="preview-area" aria-label="Aperçu de l’île"><div className="desktop-bar"><span>ÎLE REPLIÉE</span><span>AGRANDIE × 2 · TAILLE RÉELLE EN DESSOUS</span></div><div className="desktop pipes-desktop">
        <div className="pipes-zoom"><Island bots={bots} variant={variant} theme={theme} dnd={dnd} /></div>
        <div className="pipes-real"><Island bots={bots} variant={variant} theme={theme} dnd={dnd} /></div>
        <div className="pipes-legend">{bots.map(b => <span key={b.id}><i data-m={b.machine} />{b.name}</span>)}<em><i data-m="local" />Cette machine <i data-m="server" />dev-server</em></div>
        <div className="desktop-caption"><span className="caption-line" />{caption}</div>
      </div></section>
    </div>
  </div></LangProvider>;
}
createRoot(document.getElementById('root')!).render(<App />);
