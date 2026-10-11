/** Manual browser preview: run beside Vite to read docs/reader-demo/README.md through the real file reader. */
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { parseClientMessage, type ServerMessage, type Session } from '@ledge/protocol';
import { readDocument } from '../../../packages/ledge/src/daemon/documents';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const now = new Date().toISOString();
const session: Session = {
  id: 'reader-demo', name: 'Otto', tool: 'claude', cwd: root, project: 'harness-assistant',
  title: 'Otto · Lecteur Markdown', topic: 'Lire un README', tmuxSession: 'ledge-reader-demo', state: 'idle',
  helpers: [], startedAt: now, lastActivityAt: now, source: 'launcher',
  lastReply: { at: now, text: 'Voici le README à consulter : [Ouvrir le README](docs/reader-demo/README.md).' }
};

const port = Number(process.env.LEDGE_READER_DEMO_PORT ?? 47832);
const server = new WebSocketServer({ host: '127.0.0.1', port });
server.on('connection', socket => {
  const send = (message: ServerMessage) => socket.send(JSON.stringify(message));
  send({ type: 'snapshot', sessions: [session] });
  socket.on('message', async raw => {
    let message;
    try { message = parseClientMessage(JSON.parse(String(raw))); } catch { return; }
    if (message.type === 'snapshot.request') send({ type: 'snapshot', sessions: [session] });
    if (message.type === 'document.read') {
      if (message.sessionId && message.sessionId !== session.id) {
        send({ type: 'document.error', requestId: message.requestId, path: message.path, code: 'session_missing' });
        return;
      }
      send(await readDocument(message, { cwd: session.cwd, home: process.env.HOME ?? root }));
    }
  });
});
server.on('listening', () => console.log(`Reader demo: ws://127.0.0.1:${port} · ${root}docs/reader-demo/README.md`));
server.on('error', error => { console.error('Reader demo could not start:', error); process.exitCode = 1; });
