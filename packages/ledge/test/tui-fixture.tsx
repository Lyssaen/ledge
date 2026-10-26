import { createHash } from 'node:crypto';
import { render } from 'ink-testing-library';
import { attachClient, daemonStore, type DaemonClient } from '@ledge/fleet';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { AttachmentErrorReason, ImageMime, Projects, Session } from '@ledge/protocol';
import { App } from '../src/tui/App.js';
import type { ClipboardImage } from '../src/tui/clipboard.js';
import { createTuiFleet } from '../src/tui/fleet.js';
import { glyphsFor } from '../src/tui/glyphs.js';
import type { Lang } from '../src/tui/i18n/lang.js';
import { setTone, type ThemeChoice, type Tone } from '../src/tui/theme.js';
import { until } from './helpers.js';

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

/** The mockup's eight sessions (two projects, one remote machine), as the daemon would list them. */
export function mockupSessions(): Session[] {
  // Started one minute apart, in the mockup's order (the daemon lists sessions by start).
  const started = (i: number) => new Date(Date.parse('2026-10-09T16:00:00.000Z') + i * 60_000).toISOString();
  return [
    fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', repo: 'ledge', repoPath: '/w/ledge', project: 'ledge', branch: 'release/LEDGE-42-v0.5.0', topic: 'Câbler la liste des sessions', state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' }, model: 'opus', effort: 'high', lastActivityAt: ago(5), helpers: [{ id: 'h1', kind: 'Explore', task: 'Lire le code', state: 'working' }] }),
    fakeSession('nova', { name: 'Nova', tool: 'codex', cwd: '/w/ledge-ssh', repo: 'ledge', repoPath: '/w/ledge', project: 'ledge', branch: 'fix/LEDGE-42-ssh-reconnect', topic: 'Reconnexion ssh du fleet', state: 'working', model: 'gpt-5.5', effort: 'medium', lastActivityAt: ago(1) }),
    fakeSession('bix', { name: 'Bix', tool: 'cursor', cwd: '/w/ledge-docs', repo: 'ledge', repoPath: '/w/ledge', project: 'ledge', branch: 'docs/protocol', topic: 'Documenter le protocole', state: 'idle', lastActivityAt: ago(12) }),
    fakeSession('luna', { name: 'Luna', cwd: '/w/website', repo: 'website', repoPath: '/w/website', project: 'website', branch: 'feat/WEB-18-homepage', topic: 'Nouvelle page d’accueil', state: 'waiting_input', pending: { kind: 'question', text: 'Quel port pour le serveur de dev ?', options: ['3000', '5173', '8080', 'Type something.'], source: 'hook' }, lastActivityAt: ago(4) })
  ].map((s, i) => ({ ...s, startedAt: started(i) }));
}

export const PROJECTS: Projects = {
  projects: [
    { id: 'ledge', name: 'Ledge', color: 'blue', repos: [{ machine: 'local', path: '/w/ledge' }, { machine: 'local', path: '/w/ledge-ssh' }, { machine: 'local', path: '/w/ledge-docs' }] },
    { id: 'website', name: 'Website', color: 'green', repos: [{ machine: 'local', path: '/w/website' }] }
  ] as Projects['projects'],
  rules: []
};

/** A TUI on a mock daemon: its frame, its keyboard, the daemon, and a cleanup. */
export async function startTui(o: { sessions?: Session[]; projects?: Projects; lang?: Lang; run?: (argv: string[]) => Promise<number>; save?: (l: Lang) => void; theme?: ThemeChoice; background?: Tone; env?: NodeJS.ProcessEnv;
  /** The clipboard reader and the viewer launcher the TUI is given (none by default: no image, nothing opened). `refusePut`: the daemon's reason for refusing every `attachment.put`. */
  readImage?: () => Promise<ClipboardImage | null>; openFile?: (file: string) => Promise<void>; refusePut?: AttachmentErrorReason } = {}) {
  daemonStore.reset();
  const daemon = await createMockDaemon();
  for (const s of o.sessions ?? mockupSessions()) daemon.sessions.set(s.id, s);
  if (o.projects ?? PROJECTS) daemon.projects(o.projects ?? PROJECTS);
  daemon.extras.daemon = { version: '0.16.0', install: 'npm', systemd: false, models: true, modelSwitch: true, archive: true };
  daemon.extras.launcher = ['node', '/opt/ledge/cli.js'];
  // The daemon's attachment store: a put keeps the bytes under their sha256, a get gives them back.
  const attachments = new Map<string, { mime: ImageMime; data: string }>();
  daemon.onMessage(m => {
    if (m.type === 'attachment.put') {
      if (o.refusePut) { daemon.push({ type: 'attachment.error', requestId: m.requestId, reason: o.refusePut }); return; }
      const bytes = Buffer.from(m.image.data, 'base64');
      const id = createHash('sha256').update(bytes).digest('hex');
      attachments.set(id, { mime: m.image.mime, data: m.image.data });
      daemon.push({ type: 'attachment.stored', requestId: m.requestId, ref: { id, mime: m.image.mime, width: 1, height: 1, bytes: bytes.length, preview: !!m.image.preview } });
    } else if (m.type === 'attachment.get') {
      const a = attachments.get(m.attachment);
      daemon.push(a ? { type: 'attachment.data', requestId: m.requestId, attachment: m.attachment, ...a } : { type: 'attachment.error', requestId: m.requestId, reason: 'not_found' });
    }
  });
  const client: DaemonClient = createTuiFleet({ port: daemon.port, minBackoffMs: 50, maxBackoffMs: 100, token: null });
  const detach = attachClient(client);
  client.connect();
  const saved: Lang[] = [], themes: ThemeChoice[] = [];
  const ui = render(<App client={client} lang={o.lang ?? 'fr'} saveLang={l => { (o.save ?? (x => saved.push(x)))(l); }} theme={o.theme} background={o.background} saveTheme={x => { themes.push(x); }} notify="off" glyphs={glyphsFor({})} env={o.env ?? {}} run={o.run} readImage={o.readImage ?? (async () => null)} openFile={o.openFile ?? (async () => {})} />);
  await until(() => daemonStore.getState().sessions.length > 0);
  await until(() => (ui.lastFrame() ?? '').includes('Otto') || (o.sessions !== undefined && o.sessions.length === 0));
  const press = async (keys: string) => { ui.stdin.write(keys); await new Promise(r => setTimeout(r, 30)); };
  return {
    stdin: ui.stdin as { write(data: string): void }, daemon, client, attachments, saved, themes, press,
    frame: () => ui.lastFrame() ?? '',
    /** All that went to the terminal, the frames and the sequences written beside them (a title, a bell). */
    written: () => ui.stdout.frames.join(''),
    /** The terminal resized to `columns` × `rows`, as a real one says it (a `resize` on stdout). */
    async resize(columns: number, rows: number) {
      Object.defineProperty(ui.stdout, 'columns', { configurable: true, get: () => columns });
      Object.defineProperty(ui.stdout, 'rows', { configurable: true, get: () => rows });
      ui.stdout.emit('resize');
      await new Promise(r => setTimeout(r, 50));
    },
    async cleanup() { ui.unmount(); detach(); client.close(); await daemon.close(); daemonStore.reset(); setTone('dark'); }
  };
}
