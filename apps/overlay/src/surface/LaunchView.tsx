import { useEffect, useRef, useState, type Ref } from 'react';
import type { FolderListing } from '../daemon/store';
import { FolderBrowser, type FolderRequest } from './FolderBrowser';
import { NAMES, pickName, type Recent, type Session, type Tool } from '@ledge/protocol';
import { loadDefaultTool, TOOLS } from '../defaultTool';
import { Bot } from '../bots/Bot';
import { poseFor } from '../bots/poseFor';
import { Button } from '../ui/Button';
import { Kbd } from '../ui/Kbd';
import { Icon, ICONS } from '../ui/icons';
import { transition } from '../motion';
import { toolName } from '../format';
import { DetailHeader } from './DetailHeader';
import { Segmented } from './SettingsView';
import { useI18n } from '../i18n/lang';

/** What the form sends: the daemon's `session.launch` fields, plus whether to open a terminal tab once it answers. */
export interface LaunchRequest { tool: Tool; cwd: string; name?: string; prompt?: string; continue: boolean; openTab: boolean }

/** The actions row under the scrolling body (its border included), added to the measured body by the surface. */
export const LAUNCH_FOOTER_H = 61;
const OPEN_TAB_KEY = 'ledge.launch.openTab';
const loadOpenTab = () => { try { return localStorage.getItem(OPEN_TAB_KEY) !== '0'; } catch { return true; } };
const saveOpenTab = (on: boolean) => { try { localStorage.setItem(OPEN_TAB_KEY, on ? '1' : '0'); } catch { /* in-memory only */ } };

/** The folder's last path segment, as the daemon will name the project. */
export const projectOf = (cwd: string) => cwd.trim().replace(/\/+$/, '').split('/').pop() || cwd.trim();

/** Another free name, never the current one: the dice of the Companion field. */
export function rollName(taken: Iterable<string>, current: string, random = Math.random): string {
  const used = new Set(taken); used.add(current);
  const free = NAMES.filter(n => !used.has(n));
  if (free.length === 0) return pickName(used);
  return free[Math.floor(random() * free.length)]!;
}

const label: React.CSSProperties = { fontSize: 14, lineHeight: '18px', fontWeight: 600 };
const hint: React.CSSProperties = { fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' };
const field: React.CSSProperties = { height: 36, boxSizing: 'border-box', padding: '0 12px', background: 'var(--well)', color: 'inherit', border: '1px solid var(--input)', borderRadius: 'var(--radius-md)', fontSize: 13, fontFamily: 'inherit', width: '100%' };
const Row = ({ children }: { children: React.ReactNode }) => <div style={{ display: 'flex', flexDirection: 'column', padding: '12px 0', borderBottom: '1px solid var(--sidebar-border)' }}>{children}</div>;

/** `last`: the body's last row, whose bottom border would double the actions row's top one. */
function Switch({ id, label: text, hint: why, checked, onChange, last }: { id: string; label: string; hint: string; checked: boolean; onChange: (on: boolean) => void; last?: boolean }) {
  return (
    <label className="dnd-switch" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', cursor: 'pointer', borderBottom: last ? undefined : '1px solid var(--sidebar-border)' }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1 }}>
        <span style={label}>{text}</span>
        <span style={hint}>{why}</span>
      </span>
      <input type="checkbox" role="switch" data-switch={id} checked={checked} onChange={e => onChange(e.target.checked)} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
      <span className="dnd-track" aria-hidden="true" style={{ flexShrink: 0, display: 'inline-block', width: 32, height: 18, borderRadius: 9999, background: checked ? 'var(--sidebar-primary)' : 'var(--muted)', border: '1px solid var(--input)', boxSizing: 'border-box', position: 'relative', transition: transition([['background-color', 'hover']]) }}>
        <span style={{ position: 'absolute', left: checked ? 16 : 2, top: 2, width: 12, height: 12, borderRadius: 9999, background: checked ? 'var(--primary-foreground)' : 'var(--muted-foreground)', transition: transition([['left', 'hover']]) }} />
      </span>
    </label>
  );
}

export interface LaunchViewProps {
  visible: boolean; recents: Recent[]; sessions: Session[];
  /** The daemon is unreachable: nothing can be sent (the reason is shown under the actions). */
  offline?: string | null;
  /** A launch is in flight (until the daemon answers), or why the last one failed. */
  busy?: boolean; failure?: string | null;
  onLaunch: (req: LaunchRequest) => void; onBack: () => void; onClose: () => void;
  /** The folder browser's daemon answers and requests; without `onFolders` there is no Browse button. */
  listing?: FolderListing | null; onFolders?: (m: FolderRequest) => void;
  theme?: 'dark' | 'light'; frozen?: boolean; reducedMotion?: boolean;
  /** The body's natural height, measured by the surface to size itself. */
  contentRef?: Ref<HTMLDivElement>;
  /** When the layer's fade-in starts, in ms (see `enterDelay` in motion). */
  enterDelay?: number;
}

/**
 * The "New session" form: folder, tool, companion name, first instruction, two options. Mounted fresh on each open
 * (the surface keys it), so a submitted form never shows its old values again; the terminal-tab option is remembered.
 */
export function LaunchView(p: LaunchViewProps) {
  const { t } = useI18n();
  const live = p.sessions.filter(s => s.state !== 'exited');
  const taken = live.map(s => s.name);
  const [cwd, setCwd] = useState(() => p.recents[0]?.cwd ?? '');
  const [tool, setTool] = useState<Tool>(loadDefaultTool);
  const [name, setName] = useState(() => pickName(taken));
  const [prompt, setPrompt] = useState('');
  const [resume, setResume] = useState(false);
  const [openTab, setOpenTab] = useState(loadOpenTab);
  const [browsing, setBrowsing] = useState(false);
  const browseRef = useRef<HTMLButtonElement>(null);
  const endBrowse = (chosen?: string) => { if (chosen !== undefined) setCwd(chosen); setBrowsing(false); };
  // Back from the browser, focus returns to the button that opened it (the form was inert meanwhile).
  const browsed = useRef(false);
  useEffect(() => { if (browsing) browsed.current = true; else if (browsed.current) browseRef.current?.focus(); }, [browsing]);
  const shownName = name.trim() || pickName(taken);
  const project = projectOf(cwd) || '…';
  const canStart = cwd.trim() !== '' && !p.busy && !p.offline;
  const submit = () => {
    if (!canStart) return;
    p.onLaunch({ tool, cwd: cwd.trim(), name: name.trim() || undefined, prompt: prompt.trim() || undefined, continue: resume, openTab });
  };
  const busyIn = (c: string) => live.find(s => s.cwd === c)?.name;
  return (
    <div data-layer="launch" data-delay={p.enterDelay ?? 120} inert={!p.visible} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', opacity: p.visible ? 1 : 0, pointerEvents: p.visible ? 'auto' : 'none', transition: transition([['opacity', p.visible ? 'fadeIn' : 'fadeOut', p.visible ? p.enterDelay ?? 120 : 0]]) }}>
      <div inert={browsing} style={{ display: 'contents', visibility: browsing ? 'hidden' : undefined }}>
      <DetailHeader title={t.launch.title} onBack={p.onBack} onClose={p.onClose} />
      <form data-launch-form onSubmit={e => { e.preventDefault(); submit(); }} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flexGrow: 1 }}>
        <div className="ledge-scroll" style={{ overflowY: 'auto', minHeight: 0, overscrollBehavior: 'contain' }}>
          <div ref={p.contentRef} style={{ display: 'flex', flexDirection: 'column', padding: '4px 17px 8px' }}>
            <Row>
              <label htmlFor="ledge-launch-cwd" style={label}>{t.launch.folder}</label>
              <span style={{ ...hint, marginTop: 3 }}>{t.launch.folderHint}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <input id="ledge-launch-cwd" data-launch-cwd className="ledge-field mono" value={cwd} onChange={e => setCwd(e.target.value)} placeholder={t.launch.folderPlaceholder} autoComplete="off" spellCheck={false} style={{ ...field, fontSize: 12, flexGrow: 1, width: 'auto', minWidth: 0 }} />
                {p.onFolders && <Button ref={browseRef} variant="outline" size="icon" aria-label={t.launch.browse} title={t.launch.browse} data-launch-browse disabled={!!p.offline} onClick={() => setBrowsing(true)}><Icon size={16} {...ICONS.folder} /></Button>}
              </div>
              <span style={{ ...hint, marginTop: 10, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>{t.launch.recents}</span>
              {p.recents.length === 0 && <span style={{ ...hint, marginTop: 4 }}>{t.launch.noRecents}</span>}
              <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                {p.recents.map(r => {
                  const who = busyIn(r.cwd); const on = r.cwd === cwd.trim();
                  return (
                    <button key={r.cwd} type="button" role="listitem" data-recent={r.cwd} aria-label={t.launch.pick(r.project, r.cwd)} aria-pressed={on} onClick={() => setCwd(r.cwd)} className="ledge-recent"
                      style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 8px', border: 'none', borderRadius: 'var(--radius-sm)', background: on ? 'var(--sidebar-accent)' : 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', transition: transition([['background-color', 'hover']]) }}>
                      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flexGrow: 1 }}>
                        <span style={{ fontSize: 13, lineHeight: '16px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.project}{who && <span style={{ ...hint, fontWeight: 400 }}> · {t.launch.busy(who)}</span>}</span>
                        <span className="mono" style={{ ...hint, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.cwd}</span>
                      </span>
                      {on && <Icon size={14} {...ICONS.check} />}
                    </button>
                  );
                })}
              </div>
            </Row>
            <div style={{ borderBottom: '1px solid var(--sidebar-border)' }}>
              <Segmented<Tool> name="ledge-launch-tool" label={t.launch.tool} hint={t.launch.toolHint} value={tool} onChange={setTool} options={TOOLS.map(v => ({ value: v, label: toolName(v) }))} />
            </div>
            <Row>
              <label htmlFor="ledge-launch-name" style={label}>{t.launch.bot}</label>
              <span style={{ ...hint, marginTop: 3 }}>{t.launch.botHint(`${shownName} · ${project}`)}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <span style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 'var(--radius-md)', background: 'var(--well)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Bot seed={shownName} tool={tool} state="starting" pose={poseFor(shownName, 'starting')} size={28} theme={p.theme ?? 'dark'} paused={!p.visible} frozen={p.frozen} reducedMotion={p.reducedMotion} />
                </span>
                <input id="ledge-launch-name" data-launch-name className="ledge-field" value={name} onChange={e => setName(e.target.value)} placeholder={t.launch.botPlaceholder} autoComplete="off" spellCheck={false} maxLength={24} style={{ ...field, flexGrow: 1, width: 'auto' }} />
                <Button variant="outline" size="icon" aria-label={t.launch.anotherName} title={t.launch.anotherName} onClick={() => setName(rollName(taken, shownName))}><Icon size={16} {...ICONS.dice} /></Button>
              </div>
            </Row>
            <Row>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <label htmlFor="ledge-launch-prompt" style={label}>{t.launch.prompt} <span style={{ fontWeight: 400, color: 'var(--muted-foreground)' }}>· {t.launch.optional}</span></label>
                <span data-launch-prompt-key title={t.launch.promptKey} aria-hidden="true"><Kbd>I</Kbd></span>
              </span>
              <span style={{ ...hint, marginTop: 3 }}>{t.launch.promptHint(shownName)}</span>
              <textarea id="ledge-launch-prompt" data-launch-prompt aria-keyshortcuts="I" className="ledge-field" rows={3} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder={t.launch.promptPlaceholder(shownName)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
                style={{ ...field, height: 72, padding: '8px 12px', lineHeight: '18px', resize: 'none', marginTop: 8 }} />
            </Row>
            <Switch id="resume" label={t.launch.resume} hint={t.launch.resumeHint} checked={resume} onChange={setResume} />
            <Switch id="openTab" label={t.launch.openTab} hint={t.launch.openTabHint} checked={openTab} onChange={on => { setOpenTab(on); saveOpenTab(on); }} last />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 17px 14px', borderTop: '1px solid var(--sidebar-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="outline" onClick={p.onBack}>{t.launch.cancel}</Button>
            <Button variant="primary" type="submit" disabled={!canStart}>{p.busy ? t.launch.starting : t.launch.start} <Kbd accent>↵</Kbd></Button>
          </div>
          {(p.offline || p.failure || cwd.trim() === '') && (
            <span role="status" style={{ ...hint, color: p.failure ? 'var(--danger-text)' : undefined }}>{p.offline ?? (p.failure ? t.launch.failed(p.failure) : t.launch.needFolder)}</span>
          )}
        </div>
      </form>
      </div>
      {browsing && p.onFolders && <FolderBrowser start={cwd} listing={p.listing ?? null} onFolders={p.onFolders} onChoose={endBrowse} onBack={() => endBrowse()} onClose={p.onClose} />}
    </div>
  );
}
