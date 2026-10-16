import { useEffect, useState } from 'react';
import type { Session } from '@ledge/protocol';
import { botState } from '@ledge/ui/bots/poseFor';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { searchSessions, taskOf } from '../nav/agents';
import { SHELL_ICONS } from './icons';
import { Modal } from './Modal';
import { SessionBot, StateBadge } from './SessionBot';

/** « Aller à une session » (Ctrl K): the search field, the matching sessions and the keys' reminder. ↑ ↓ choose, Enter opens. */
export function SearchPalette({ sessions, projectName, order, onOpen, onClose }: {
  sessions: readonly Session[]; projectName: (s: Session) => string; order: readonly Session[]; onOpen: (id: string) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const results = searchSessions(sessions, query, projectName);
  const current = results[Math.min(index, results.length - 1)];
  const activeId = current ? `result-${current.id}` : undefined;
  useEffect(() => { if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' }); }, [activeId]);
  return (
    <Modal title={t.search.title} className="command-palette" onClose={onClose}>
      <div className="palette-search">
        <Icon d={SHELL_ICONS.search} />
        <input autoFocus role="combobox" aria-label={t.side.searchLabel} placeholder={t.search.placeholder} value={query}
          aria-expanded="true" aria-autocomplete="list" aria-controls="session-results" aria-activedescendant={activeId}
          onChange={e => { setQuery(e.target.value); setIndex(0); }}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setIndex(Math.max(0, Math.min(results.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))); }
            else if (e.key === 'Enter' && current) { e.preventDefault(); onOpen(current.id); }
          }} />
      </div>
      <div id="session-results" role="listbox" aria-label={t.search.results} className="palette-results">
        {results.map(s => {
          const rank = order.indexOf(s);
          return (
            <button key={s.id} id={`result-${s.id}`} role="option" tabIndex={-1} aria-selected={s === current} onMouseMove={() => setIndex(results.indexOf(s))} onClick={() => onOpen(s.id)}>
              <SessionBot session={s} size={32} />
              <span><strong>{s.name} <small>· {projectName(s)}</small></strong><small>{[taskOf(s), s.machineName].filter(Boolean).join(' · ')}</small></span>
              <StateBadge state={botState(s)} offline={!!s.offline} />
              {rank >= 0 && rank < 9 && <Kbd>Alt {rank + 1}</Kbd>}
            </button>
          );
        })}
        {!results.length && <p className="empty-attention">{t.search.empty}</p>}
      </div>
      <div className="palette-footer"><Kbd>↑ ↓</Kbd> {t.search.browse} <Kbd>{t.search.enter}</Kbd> {t.search.open} <Kbd>{t.search.escape}</Kbd> {t.search.closeKey}</div>
    </Modal>
  );
}
