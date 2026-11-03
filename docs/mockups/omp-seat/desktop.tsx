import React, { type CSSProperties } from 'react';
import { Bot } from '../../../packages/ui/src/bots/Bot';
import { Icon, ICONS } from '../../../packages/ui/src/ui/icons';
import type { BotState } from '../../../packages/ui/src/bots/poseFor';

/* Desktop: the « Rigs » section of the sidebar (RigGroups, its own classes) and what opening an OMP seat shows. */

const RIG = ['M12 2.5 20.5 7.25v9.5L12 21.5l-8.5-4.75v-9.5z', 'M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7'];
const DENSE = ['M4 4h16', 'M4 8h16', 'M4 12h16', 'M4 16h16', 'M4 20h16'];
const FOLD = ['m7 20 5-5 5 5', 'm7 4 5 5 5-5'];

export type DesktopState = 'live' | 'stopped';
interface Seat { id: string; name: string; tool: 'claude' | 'codex' | 'omp'; role: string; state: BotState | 'stopped'; sel?: boolean }
/** The mascots follow the page's theme, as SessionBot passes it in the app. */
const theme = (): 'light' | 'dark' => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
const roleWord = (r: string) => r.replace(/\.agent$|\.lead$|\.worker$/, '');

function SeatRow({ s, depth }: { s: Seat; depth: number }) {
  const stopped = s.state === 'stopped';
  return (
    <div role="treeitem" aria-level={depth + 1} aria-selected={!!s.sel} className={'st-row st-agent' + (s.sel ? ' sel' : '') + (stopped ? ' off' : '')} style={{ '--d': depth } as CSSProperties}>
      <span className="st-gap" />
      <span className="st-bot"><Bot theme={theme()} tool={s.tool} state={stopped ? 'done' : s.state} size={18} seed={s.name} frozen={stopped} /></span>
      <button type="button" className="st-main"><strong>{s.name}</strong><span className="mono">{[roleWord(s.role), s.tool].join(' · ')}</span></button>
      <span className="st-time">{stopped ? 'arrêté' : ''}</span>
    </div>
  );
}

function RigHead({ name, where, work }: { name: string; where: string; work?: number }) {
  return (
    <div role="treeitem" aria-level={1} aria-expanded className="st-row st-project st-rig" style={{ '--d': 0 } as CSSProperties}>
      <button type="button" className="st-chev"><span className="open"><Icon d={ICONS.chevronRight.d} size={12} /></span></button>
      <span className="st-rig-hex"><Icon d={RIG} size={13} /></span>
      <button type="button" className="st-main"><strong>{name}</strong><span className="mono">{where}</span></button>
      <span className="st-tally">{work ? <span className="t-work"><i />{work}</span> : null}</span>
    </div>
  );
}

function Sidebar({ state }: { state: DesktopState }) {
  const devOmp: Seat[] = [{ id: 'a', name: 'Ivo', tool: 'omp', role: 'dev.agent', state: 'working', sel: true }, { id: 'b', name: 'Pia', tool: 'omp', role: 'review.reviewer', state: 'idle' }];
  const ledgeDev: Seat[] = [{ id: 'c', name: 'Lu', tool: 'claude', role: 'pilot.lead', state: 'idle' }, { id: 'd', name: 'Ida', tool: 'claude', role: 'dev.back', state: 'working' }];
  const split: Seat[] = [{ id: 'e', name: 'Ana', tool: 'omp', role: 'analysis.analyst', state: 'idle' }, { id: 'f', name: 'Sol', tool: 'omp', role: 'review.reviewer', state: 'idle' },
    ...(state === 'stopped' ? [{ id: 'g', name: 'Tom', tool: 'omp', role: 'split.splitter', state: 'stopped' } as Seat] : [])];
  return (
    <aside className="sidebar st mk-sidebar">
      <div className="st-scroll">
        <section className="st-kernel-box" aria-label="Kernel">
          <div className="st-label"><span className="st-kernel-hex"><Icon d={RIG} size={12} /></span><span className="st-kernel-name">Kernel</span><span className="st-fill" /><span className="st-kernel-tag" data-state="ready"><i />opérationnel</span></div>
          <div role="tree"><SeatRow s={{ id: 'k', name: 'Kit', tool: 'claude', role: 'operator.agent', state: 'idle' }} depth={0} /></div>
        </section>
        <section aria-label="Rigs">
          <div className="st-label"><span>Rigs</span><span className="st-fill" />
            <button type="button" className="st-icon"><Icon d={DENSE} size={14} /></button><button type="button" className="st-icon"><Icon d={FOLD} size={14} /></button><button type="button" className="st-icon"><Icon d={ICONS.plus.d} size={14} /></button>
          </div>
          <div role="tree">
            <RigHead name="dev-omp" where="work" work={1} />
            {devOmp.map(s => <SeatRow key={s.id} s={s} depth={1} />)}
            <RigHead name="ledge-dev" where="ledge" work={1} />
            {ledgeDev.map(s => <SeatRow key={s.id} s={s} depth={1} />)}
            <RigHead name="split-omp" where="work" />
            {split.map(s => <SeatRow key={s.id} s={s} depth={1} />)}
          </div>
        </section>
      </div>
    </aside>
  );
}

/** The seat's runner mirror, in the shape `tmux capture-pane -t dev-agent@dev-omp` showed it on 2026-11-03. */
const MIRROR = `you > Story ST7-412 : implémente le refus d'un IBAN vide, en TDD strict.

Je commence par le test rouge : un IBAN vide doit être refusé avec
INVALID_IBAN.

  ⚙ read …
  ⚙ read done
  ⚙ edit done
  ⚙ bash …
  ⚙ bash FAILED

Le test échoue comme attendu (rouge). Je commite cette étape.

  ⚙ bash …
  ⚙ bash done
  ⚙ edit done
  ⚙ bash …`;

function SeatPage() {
  return (
    <div className="mk-page">
      <header className="mk-page-head">
        <Bot theme={theme()} tool="omp" state="working" size={30} seed="Ivo" />
        <div className="mk-page-id">
          <div><strong>Ivo</strong><span className="rig-tag">dev-omp</span></div>
          <span className="mono">dev.agent · OMP · au travail</span>
        </div>
      </header>
      <div className="mk-page-body">
        <div className="mk-nothread" role="status">
          <Icon d={ICONS.text.d} size={18} />
          <p><strong>Pas de fil pour ce siège.</strong> Ledge ne lit pas la conversation d’un siège OMP lancé par OpenRig. Son terminal est ouvert à côté : ce que tu y tapes lui est envoyé.</p>
        </div>
        <section className="mk-term" aria-label="Terminal de dev-agent@dev-omp">
          <div className="mk-term-tabs"><span className="mk-term-tab">Ivo · agent</span><span className="mk-fill" /><span className="mk-term-status"><i />Attaché · tmux · dev-agent@dev-omp</span></div>
          <pre className="mk-term-body">{MIRROR}{'\n'}<span className="mk-caret">▏</span></pre>
        </section>
      </div>
    </div>
  );
}

export function DesktopView({ state }: { state: DesktopState }) {
  return <div className="mk-desk"><Sidebar state={state} /><SeatPage /></div>;
}
