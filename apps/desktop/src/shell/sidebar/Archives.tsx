import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import { isArchived, type Project, type Session } from '@ledge/protocol';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../../i18n/lang';
import { spanOf } from '../../list/time';
import { taskOf } from '../../nav/agents';
import { ProjectSwatch } from '../../projects/ProjectSwatch';
import { cls } from '../cls';
import { SHELL_ICONS } from '../icons';
import { SessionBot } from '../SessionBot';
import { filterArchived } from './model';

/** « 12 min » / « 1 h » / « 3 d », or the list's « just now ». Same units as the tree. */
function shortWhen(iso: string | undefined, units: { min: string; h: string; d: string }, nowLabel: string): string {
  const span = spanOf(Date.now() - (Date.parse(iso ?? '') || 0));
  return span === 'now' ? nowLabel : `${span.n} ${units[span.unit]}`;
}

/** Brings an archive row into view once it is rendered (the key is compared as data, never built into a selector). */
function scrollArchive(id: string) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = [...document.querySelectorAll<HTMLElement>('.st [data-arch-key]')].find(x => x.dataset.archKey === id);
    el?.scrollIntoView?.({ block: 'nearest' });
  }));
}

/** Archives, folded until one is opened or the header pill asks: archiving the session being read leaves them as they are. Past four, a filter; each row reads, puts back, resumes or deletes. No auto-archive delay. */
export function Archives(p: {
  archived: readonly Session[];
  current: string | null;
  projectName: (s: Session) => string;
  project: (s: Session) => Pick<Project, 'color'> | null;
  reveal: number;
  onRead(id: string): void;
  onRestore(id: string): void;
  onResume(id: string): void;
  onDelete(ids: string[]): void;
  allowed(id: string): boolean;
  paused: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const sectionRef = useRef<HTMLElement>(null);
  const reading = p.archived.some(s => s.id === p.current && isArchived(s));
  const showFilter = p.archived.length > 4;
  const shown = filterArchived(p.archived, showFilter ? q : '', p.projectName);

  // The last current session seen live: archiving it while it is read must not unfold the section, opening an archive does.
  const live = useRef<string | null>(null);
  useEffect(() => {
    if (!p.current) return;
    if (!reading) { live.current = p.current; return; }
    if (live.current === p.current) return;
    setOpen(true);
    scrollArchive(p.current);
  }, [p.current, reading]);
  // `reveal` only: a later navigation must not unfold again. The values below are the ones from the click.
  useEffect(() => {
    if (!p.reveal) return;
    setOpen(true);
    const id = reading ? p.current : null;
    requestAnimationFrame(() => sectionRef.current?.scrollIntoView?.({ block: 'nearest' }));
    if (id) scrollArchive(id);
  }, [p.reveal]);

  return (
    <section ref={sectionRef} className="st-archives" aria-label={t.side.archives}>
      <div className="st-label">
        <button type="button" className="st-arch-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          <span className={open ? 'open' : undefined}><Icon d={ICONS.chevronRight.d} size={12} /></span>
          <Icon d={SHELL_ICONS.archive} size={13} />{t.side.archives}{p.archived.length > 0 && <small>{p.archived.length}</small>}
        </button>
      </div>
      {open && <>
        {showFilter && (
          <label className="st-arch-q">
            <Icon d={SHELL_ICONS.search} size={12} />
            <input type="search" aria-label={t.side.archiveFilter} placeholder={t.side.archiveFilterPh} value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setQ(''); } }} />
          </label>
        )}
        <div role="list">
          {shown.map(s => {
            const name = p.projectName(s);
            const task = taskOf(s);
            const when = shortWhen(s.archivedAt, t.list.when.units, t.list.when.now);
            const kids = s.helpers.length;
            const ok = p.allowed(s.id);
            const selected = p.current === s.id;
            return (
              <div key={s.id} role="listitem" className={cls('st-row st-agent st-arch', selected && 'sel')} style={{ '--d': 0 } as CSSProperties}>
                <span className="st-bot"><SessionBot session={{ ...s, state: 'exited' }} size={16} paused={p.paused} /></span>
                <button type="button" className="st-main" data-arch-key={s.id} aria-current={selected ? 'page' : undefined}
                  aria-label={t.side.read(s.name, name, task, when)} onClick={() => p.onRead(s.id)}>
                  <strong><ProjectSwatch project={p.project(s)} />{s.name}</strong>{task && <span>{task}</span>}
                </button>
                {kids > 0 && <span className="st-kids" title={t.side.kids(kids)}>{kids}</span>}
                <span className="st-time" title={when}>{when}</span>
                <span className="st-acts">
                  <button type="button" aria-label={t.side.restoreOne(s.name)} title={t.manage.archivedBanner.restore} disabled={!ok} onClick={() => p.onRestore(s.id)}><Icon d={SHELL_ICONS.restore} size={13} /></button>
                  <button type="button" aria-label={t.side.resumeOne(s.name)} title={t.manage.menu.resume} disabled={!ok} onClick={() => p.onResume(s.id)}><Icon d={SHELL_ICONS.resume} size={13} /></button>
                  <button type="button" className="danger" aria-label={t.side.deleteOne(s.name)} title={t.manage.archivedBanner.delete} disabled={!ok} onClick={() => p.onDelete([s.id])}><Icon d={SHELL_ICONS.trash} size={13} /></button>
                </span>
              </div>
            );
          })}
          {shown.length === 0 && <p className="st-help">{p.archived.length ? t.side.archiveNone : t.side.archiveEmpty}</p>}
        </div>
      </>}
    </section>
  );
}
