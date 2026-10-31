import { createHash } from 'node:crypto';
import { render } from 'ink-testing-library';
import { attachClient, daemonStore, type DaemonClient } from '@ledge/fleet';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { AttachmentErrorReason, Escalation, ImageMime, OpenRigStatus, Projects, Rig, RigSeat, Session } from '@ledge/protocol';
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

/** A seat of the mockup's rigs: `ref` is `name@rig`, its address `@name` (orch-lead answers to `@lead`). */
const seat = (rig: string, name: string, state: RigSeat['state'], extra: Partial<RigSeat> = {}): RigSeat =>
  ({ ref: `${name}@${rig}`, address: `@${name === 'orch-lead' ? 'lead' : name}`, name, runtime: 'claude-code', model: 'opus', state, ...extra });
const rig = (id: string, seats: RigSeat[], extra: Partial<Rig> = {}): Rig =>
  ({ id, name: id, machine: 'local', cwd: '/w/ledge', projectId: 'ledge', offProject: false, lifecycle: 'running', kernel: false, seats, repos: [], ...extra });

/** The mockup's rigs on the local machine: factory (6 seats in Ledge, build paired to a session), starter (2 seats), the kernel. */
export function mockupRigs(): Rig[] {
  return [
    rig('factory', [seat('factory', 'orch-lead', 'working'), seat('factory', 'build', 'working', { sessionId: 'build' }), seat('factory', 'qa', 'working'),
      seat('factory', 'review-a', 'working'), seat('factory', 'review-b', 'idle'), seat('factory', 'design', 'idle')]),
    rig('starter', [seat('starter', 'dev-build', 'working'), seat('starter', 'dev-review', 'idle')]),
    rig('kernel', [seat('kernel', 'operator', 'idle', { runtime: 'codex' }), seat('kernel', 'queue', 'idle', { runtime: 'codex' }),
      seat('kernel', 'advisor', 'idle'), seat('kernel', 'human', 'idle', { runtime: 'terminal' })], { name: 'openrig', kernel: true, projectId: null, cwd: '/home/u/.openrig' })
  ];
}

/** The session paired to factory's build seat: a seat, not a standalone session. */
export function mockupSeatSession(): Session {
  return fakeSession('build', { name: 'build', cwd: '/w/ledge', repo: 'ledge', repoPath: '/w/ledge', project: 'ledge', branch: 'feat/rigs', topic: 'Reprise après reboot', state: 'working', lastActivityAt: ago(1),
    rig: { machine: 'local', rigId: 'factory', rigName: 'factory', seat: 'build@factory', pod: 'dev', member: 'build' } });
}

/** The mockup's one decision waiting: orch-lead@factory asks JSON or SQLite. */
export function mockupEscalations(): Escalation[] {
  const question = 'Sessions : passer du fichier JSON à SQLite ?';
  return [{ id: 'q-117', source: 'rig', machine: 'local', rigId: 'factory', from: 'orch-lead@factory', intent: 'decision', summary: question,
    questions: [{ id: 'q1', question, options: [{ id: 'sqlite', label: 'SQLite', recommended: true }, { id: 'json', label: 'Garder le JSON' }] }],
    createdAt: ago(6), state: 'pending', category: 'architecture', advice: 'SQLite. Tu as écarté deux fois les fichiers plats.' }];
}

export const MOCKUP_OPENRIG: OpenRigStatus = { machine: 'local', state: 'running', version: '0.6.14' };

/** A TUI on a mock daemon: its frame, its keyboard, the daemon, and a cleanup. */
export async function startTui(o: { sessions?: Session[]; projects?: Projects; lang?: Lang; run?: (argv: string[]) => Promise<number>; save?: (l: Lang) => void; theme?: ThemeChoice; background?: Tone; env?: NodeJS.ProcessEnv;
  /** The clipboard reader and the viewer launcher the TUI is given (none by default: no image, nothing opened). `refusePut`: the daemon's reason for refusing every `attachment.put`. */
  readImage?: () => Promise<ClipboardImage | null>; openFile?: (file: string) => Promise<void>; refusePut?: AttachmentErrorReason;
  /** The daemon announces `colorPreview` and answers a color subscription with these lines. */
  colorLines?: string[];
  /** OpenRig on the local daemon: the mockup's rigs, escalations and status pushed once connected, the seat's session listed. */
  openrig?: { rigs?: Rig[]; escalations?: Escalation[]; status?: OpenRigStatus } } = {}) {
  daemonStore.reset();
  const daemon = await createMockDaemon();
  for (const s of o.sessions ?? [...mockupSessions(), ...(o.openrig ? [mockupSeatSession()] : [])]) daemon.sessions.set(s.id, s);
  if (o.projects ?? PROJECTS) daemon.projects(o.projects ?? PROJECTS);
  daemon.extras.daemon = { version: '0.16.0', install: 'npm', systemd: false, models: true, modelSwitch: true, archive: true, ...(o.colorLines ? { colorPreview: true } : {}), ...(o.openrig ? { openrig: true } : {}) };
  if (o.colorLines) daemon.options.colorLines = o.colorLines;
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
  // The rig book is reset by each snapshot: OpenRig's messages come after it, as the daemon sends them.
  if (o.openrig) {
    const rigs = o.openrig.rigs ?? mockupRigs();
    daemon.push({ type: 'openrig.status', status: o.openrig.status ?? MOCKUP_OPENRIG });
    daemon.push({ type: 'rig.snapshot', machine: 'local', rigs });
    for (const escalation of o.openrig.escalations ?? mockupEscalations()) daemon.push({ type: 'escalation.updated', escalation });
    await until(() => client.fleet!.rigs().length === rigs.length);
  }
  const press = async (keys: string) => { ui.stdin.write(keys); await new Promise(r => setTimeout(r, 30)); };
  const frame = () => ui.lastFrame() ?? '';
  return {
    stdin: ui.stdin as { write(data: string): void }, daemon, client, attachments, saved, themes, press, frame,
    /** The home's selection moved with j until `name`'s session shows on the right (a terminal 100 columns wide or more). */
    async pick(name: string) {
      for (let i = 0; i < 30 && !frame().includes(`${name.toUpperCase()} · `); i++) await press('j');
      await until(() => frame().includes(`${name.toUpperCase()} · `));
    },
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
