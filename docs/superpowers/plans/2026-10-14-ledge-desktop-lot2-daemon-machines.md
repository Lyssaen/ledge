# Ledge Desktop, lot 2 : liste des machines partagée par le daemon — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le daemon local devient la source de vérité de la liste des machines (`~/.ledge/machines.json`), la sert par un message `machines` et l'accepte par `machines.set` ; l'île active la lecture depuis le daemon et migre sa liste locale ; le daemon accepte l'origine Vite de Desktop (port 1421).

**Architecture:** Le protocole gagne `MachineSchema`/`MachinesSchema` et deux messages additifs. Le daemon lit le fichier au démarrage, envoie `machines` après chaque `snapshot`, valide chaque `machines.set`, écrit le fichier puis diffuse `machines` à tous les clients locaux. Le fleet (`@ledge/fleet`, lot 1) remplace ses types locaux par ceux du protocole ; l'île passe `machinesFromDaemon: true` à `createFleetClient`, ce qui déclenche la migration « premier connecté gagne » (spec §5.3).

**Tech Stack:** TypeScript, zod (`@ledge/protocol`), Node 22+ (`@paradow/ledge` : daemon), `ws`, vitest, React 19 (overlay), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-14-ledge-desktop-design.md` (§5.1, §5.2, §5.3, §5.4, §12 « Daemon » et « Fleet », §13 lot 2, §14 « migration deux fronts », « ancien daemon »).

## Global Constraints

- Prérequis : lot 1 fusionné (`@ledge/fleet` avec `machinesFromDaemon`, `machinesSource()`, et les types locaux `Machine`/`isMachinesMessage` de `packages/fleet/src/fleet.ts` que ce lot remplace).
- Ajouts au protocole **optionnels et additifs** : un client ancien qui ignore `machines` continue de fonctionner ; un daemon ancien qui ne l'envoie jamais laisse le fleet en source `local` (spec §14 « ancien daemon »).
- `MachineSchema` : `id` `/^[a-zA-Z0-9_-]{1,64}$/`, `label` trim 1–80, `ssh` = `SshAliasSchema` optionnel ; `MachinesSchema` 1 à 20 entrées. Règles de `parseMachines` : la première est `local` sans `ssh` ; les autres ont un `ssh` ; ids et alias uniques (spec §5.1). L'URL loopback locale n'est plus persistée.
- Fichier `~/.ledge/machines.json` via `paths().machines` ; absent ou invalide → `[{ id: 'local', label: 'Local' }]` (spec §5.2). Écriture atomique (fichier temporaire puis `rename`) comme le journal si `Store.save()` le fait ; sinon `writeFileSync` suffit.
- `machines` n'est envoyé qu'aux **clients locaux** (`localClients`), jamais aux clients `/ssh/` ; le fleet ne lit `machines` que du pair `local` et n'envoie `machines.set` qu'à lui (spec §5.2).
- `ALLOWED_ORIGINS` gagne exactement `http://localhost:1421` et `http://127.0.0.1:1421` (spec §5.4).
- Migration : si le premier `machines` ne contient que `local` et que le stockage local a d'autres machines, envoyer une fois `machines.set` avec la liste locale puis effacer `ledge.machines` ; si le daemon a déjà une liste, elle gagne (spec §5.3). Déjà codée au lot 1, activée ici dans l'île.
- Style des fichiers voisins : tests `describe/it` avec fixtures locales (`mk`, `fakeTmux`, `handshake`, `until`), `LEDGE_HOME` isolé par test (`test/isolate-home.ts`). Commits en anglais : `feat(protocol): …`, `feat(daemon): …`, `feat(fleet): …`, `feat(overlay): …`.
- Branche `desktop/lot2-daemon-machines` depuis `main` après fusion du lot 1.

## Review Focus

1. Un `machines.set` dont la première entrée n'est pas `local`, ou dont deux entrées partagent un alias SSH, doit être **refusé** par un `error` et ne rien écrire ni diffuser : l'état des autres fronts ne bouge pas. Test ajouté à la tâche 3.
2. Un `machines.json` **corrompu** (JSON tronqué, tableau vide, 21 entrées) au démarrage ne doit pas empêcher le daemon de démarrer : liste par défaut, fichier réécrit au prochain `machines.set` seulement. Test ajouté à la tâche 2.
3. Deux fronts connectés : le second reçoit la diffusion issue du `machines.set` du premier **avant** d'avoir envoyé le sien ; sa propre liste locale ne doit pas écraser celle du daemon (premier connecté gagne). Test ajouté à la tâche 3 (côté daemon) ; le côté fleet est couvert par `machines-source.test.ts` du lot 1.
4. Un client `/ssh/` (daemon distant servi par le local) ne doit **jamais** recevoir `machines` ni pouvoir envoyer `machines.set` : la liste est privée au poste. Test ajouté à la tâche 3.
5. Une origine `http://localhost:1421` est acceptée mais `http://localhost:1422` et `http://evil:1421` restent refusées. Test ajouté à la tâche 4.

---

## Fichiers

| Fichier | Rôle |
|---|---|
| `packages/protocol/src/machines.ts` (créer) | `MachineSchema`, `MachinesSchema`, `Machine`, `Machines` |
| `packages/protocol/src/messages.ts` (modifier) | `machines.set` (client), `machines` (serveur) |
| `packages/protocol/src/index.ts` (modifier) | Export de `./machines.js` |
| `packages/protocol/test/machines.test.ts` (créer) | Validation du schéma et des deux messages |
| `packages/ledge/src/paths.ts` (modifier) | `machines: join(dir, 'machines.json')` |
| `packages/ledge/src/daemon/machines.ts` (créer) | `readMachines(file)`, `writeMachines(file, list)`, `DEFAULT_MACHINES` |
| `packages/ledge/src/daemon/server.ts` (modifier) | Envoi après `snapshot`, `case 'machines.set'`, diffusion, origines 1421 |
| `packages/ledge/test/machines.test.ts` (créer) | Lecture/écriture du fichier, valeurs invalides |
| `packages/ledge/test/server.test.ts` (modifier) | `machines`/`machines.set`, clients ssh exclus, allowlist |
| `packages/fleet/src/fleet.ts` (modifier) | Types locaux remplacés par `Machine`/`ServerMessage` du protocole ; plus de `as never` |
| `packages/fleet/src/machines.ts` (modifier) | `parseMachines` bâti sur `MachinesSchema` ; `MachineConfig` = `Machine & { url?: string }` |
| `apps/overlay/src/App.tsx` (modifier, ou le fichier qui appelle `createFleetClient`) | `{ machinesFromDaemon: true }` |
| `apps/overlay/test/fleet-app.test.tsx` (créer) | L'île active bien l'option : le premier `machines` du mock bascule la source |
| `packages/ledge/README.md` ou `docs/multi-machine.md` (modifier) | Une phrase : la liste vit dans `~/.ledge/machines.json`, partagée par les fronts |

---

### Task 1: Protocole : `MachineSchema`, `MachinesSchema`, messages

**Files:**
- Create: `packages/protocol/src/machines.ts`, `packages/protocol/test/machines.test.ts`
- Modify: `packages/protocol/src/messages.ts`, `packages/protocol/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MachineSchema: z.ZodObject<{ id: z.ZodString; label: z.ZodString; ssh: z.ZodOptional<typeof SshAliasSchema> }>;
  export const MachinesSchema: z.ZodArray<typeof MachineSchema>;   // .min(1).max(20) + superRefine (local d'abord, ssh requis ailleurs, unicité)
  export type Machine = z.infer<typeof MachineSchema>; export type Machines = Machine[];
  // ClientMessage += { type: 'machines.set'; machines: Machines }   ServerMessage += { type: 'machines'; machines: Machines }
  ```
- Consumes: `SshAliasSchema` de `./ssh.js`.

- [ ] **Step 1: Test**

`packages/protocol/test/machines.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { MachinesSchema, parseClientMessage, parseServerMessage } from '../src/index.js';

const local = { id: 'local', label: 'Local' };
const dev = { id: 'dev', label: 'Devbox', ssh: 'dev-server' };

describe('machines schema', () => {
  it('accepts the local machine first then ssh aliases', () => {
    expect(MachinesSchema.parse([local, dev])).toEqual([local, dev]);
    expect(MachinesSchema.parse([{ id: 'local', label: '  Local  ' }])[0]!.label).toBe('Local');
  });
  it('refuses an empty list, a non-local first entry, a remote without ssh, duplicates, and more than 20', () => {
    expect(() => MachinesSchema.parse([])).toThrow();
    expect(() => MachinesSchema.parse([dev, local])).toThrow();
    expect(() => MachinesSchema.parse([{ ...local, ssh: 'x' }])).toThrow();
    expect(() => MachinesSchema.parse([local, { id: 'dev', label: 'Devbox' }])).toThrow();
    expect(() => MachinesSchema.parse([local, dev, { ...dev, id: 'dev2' }])).toThrow();   // same alias
    expect(() => MachinesSchema.parse([local, dev, { ...dev, ssh: 'other' }])).toThrow(); // same id
    expect(() => MachinesSchema.parse([local, ...Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, label: `m${i}`, ssh: `h${i}` }))])).toThrow();
    expect(() => MachinesSchema.parse([local, { id: 'bad id', label: 'x', ssh: 'h' }])).toThrow();
    expect(() => MachinesSchema.parse([local, { id: 'd', label: 'x'.repeat(81), ssh: 'h' }])).toThrow();
  });
  it('rides in machines.set and machines messages', () => {
    expect(parseClientMessage({ type: 'machines.set', machines: [local, dev] })).toEqual({ type: 'machines.set', machines: [local, dev] });
    expect(parseServerMessage({ type: 'machines', machines: [local] })).toEqual({ type: 'machines', machines: [local] });
    expect(() => parseClientMessage({ type: 'machines.set', machines: [] })).toThrow();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** : `pnpm --filter @ledge/protocol test machines`

- [ ] **Step 3: Implémenter**

`packages/protocol/src/machines.ts` :

```ts
import { z } from 'zod';
import { SshAliasSchema } from './ssh.js';

/** A configured machine, as both fronts list it: the local daemon first, then SSH aliases (spec 2026-10-14 §5). */
export const MachineSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  label: z.string().trim().min(1).max(80),
  ssh: SshAliasSchema.optional()
});
export type Machine = z.infer<typeof MachineSchema>;

export const MachinesSchema = z.array(MachineSchema).min(1).max(20).superRefine((list, ctx) => {
  if (list[0]!.id !== 'local' || list[0]!.ssh !== undefined) ctx.addIssue({ code: 'custom', message: 'the first machine is local, without ssh', path: [0] });
  const ids = new Set<string>(), aliases = new Set<string>();
  list.forEach((m, i) => {
    if (i > 0 && !m.ssh) ctx.addIssue({ code: 'custom', message: 'a remote machine needs an ssh alias', path: [i, 'ssh'] });
    if (ids.has(m.id)) ctx.addIssue({ code: 'custom', message: `duplicate id ${m.id}`, path: [i, 'id'] }); ids.add(m.id);
    if (m.ssh) { if (aliases.has(m.ssh)) ctx.addIssue({ code: 'custom', message: `duplicate ssh alias ${m.ssh}`, path: [i, 'ssh'] }); aliases.add(m.ssh); }
  });
});
export type Machines = z.infer<typeof MachinesSchema>;
```

`messages.ts` : `import { MachinesSchema } from './machines.js';` ; dans `ClientMessageSchema` ajouter `z.object({ type: z.literal('machines.set'), machines: MachinesSchema })` ; dans `ServerMessageSchema` ajouter (avant l'entrée `error`) `z.object({ type: z.literal('machines'), machines: MachinesSchema })`. `index.ts` : `export * from './machines.js';`.

- [ ] **Step 4: Run, expect PASS** : `pnpm --filter @ledge/protocol test && pnpm -r typecheck`

Note : `pnpm -r typecheck` peut échouer dans `@ledge/fleet` si ses types locaux entrent en conflit avec le nouveau membre de `ServerMessage` (le garde `isMachinesMessage` devient redondant mais reste valide). Si un `switch` exhaustif sur `m.type` dans `fleet.ts` ou `store.ts` casse, ajouter `case 'machines': return;` provisoire ; la tâche 5 nettoie.

- [ ] **Step 5: Commit** : `git checkout -b desktop/lot2-daemon-machines && git add packages/protocol && git commit -m "feat(protocol): machines list schema and machines/machines.set messages"`

---

### Task 2: Daemon : fichier `machines.json`

**Files:**
- Modify: `packages/ledge/src/paths.ts`
- Create: `packages/ledge/src/daemon/machines.ts`, `packages/ledge/test/machines.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const DEFAULT_MACHINES: Machines;                       // [{ id: 'local', label: 'Local' }]
  export function readMachines(file = paths().machines): Machines; // never throws
  export function writeMachines(list: Machines, file = paths().machines): void;
  ```
  `paths().machines: string`.

- [ ] **Step 1: Test**

`packages/ledge/test/machines.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_MACHINES, readMachines, writeMachines } from '../src/daemon/machines.js';
import { paths } from '../src/paths.js';

const file = () => join(mkdtempSync(join(tmpdir(), 'ledge-machines-')), 'machines.json');
const list = [{ id: 'local', label: 'Local' }, { id: 'dev', label: 'Devbox', ssh: 'dev-server' }];

describe('machines file', () => {
  it('lives in the ledge dir', () => { expect(paths().machines).toBe(join(paths().dir, 'machines.json')); });
  it('defaults to the local machine when absent, truncated, empty or too long', () => {
    const f = file();
    expect(readMachines(f)).toEqual(DEFAULT_MACHINES);
    writeFileSync(f, '[{"id":"local"'); expect(readMachines(f)).toEqual(DEFAULT_MACHINES);
    writeFileSync(f, '[]'); expect(readMachines(f)).toEqual(DEFAULT_MACHINES);
    writeFileSync(f, JSON.stringify([list[0], ...Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, label: `m${i}`, ssh: `h${i}` }))])); expect(readMachines(f)).toEqual(DEFAULT_MACHINES);
    expect(existsSync(f)).toBe(true); // a bad file is left for the user to look at, not rewritten
  });
  it('round-trips a valid list', () => {
    const f = file(); writeMachines(list, f);
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual(list);
    expect(readMachines(f)).toEqual(list);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** : `pnpm --filter @paradow/ledge test machines`

- [ ] **Step 3: Implémenter**

`paths.ts` : ajouter `machines: join(dir, 'machines.json')` à l'objet retourné par `paths()`.

`packages/ledge/src/daemon/machines.ts` :

```ts
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { MachinesSchema, type Machines } from '@ledge/protocol';
import { paths } from '../paths.js';

/** What a fresh install lists: the daemon itself. */
export const DEFAULT_MACHINES: Machines = [{ id: 'local', label: 'Local' }];

/** The machines the fronts share; anything unreadable or invalid falls back to the default and is left untouched (spec §5.2). */
export function readMachines(file = paths().machines): Machines {
  try { return MachinesSchema.parse(JSON.parse(readFileSync(file, 'utf8'))); } catch { return DEFAULT_MACHINES; }
}

/** Written whole on each accepted `machines.set`; rename keeps a crash from leaving a half file. */
export function writeMachines(list: Machines, file = paths().machines): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n');
  renameSync(tmp, file);
}
```

- [ ] **Step 4: Run, expect PASS** : `pnpm --filter @paradow/ledge test machines && pnpm --filter @paradow/ledge typecheck`

- [ ] **Step 5: Commit** : `git add packages/ledge && git commit -m "feat(daemon): machines.json read and write"`

---

### Task 3: Daemon : servir `machines`, accepter `machines.set`, diffuser

**Files:**
- Modify: `packages/ledge/src/daemon/server.ts`, `packages/ledge/test/server.test.ts`

**Interfaces:**
- Produces: `startServer(opts)` accepte `machinesFile?: string` (défaut `paths().machines`) ; comportement : `sendSnapshot(ws)` est suivi de `send(ws, { type: 'machines', machines })` ; `handle(ws, { type: 'machines.set' })` → `writeMachines` puis `broadcast({ type: 'machines', machines })` aux `localClients` ; un message `machines.set` reçu d'un client `/ssh/` est ignoré (les clients ssh ne passent pas par `handle` pour ce type : voir Step 3).
- Consumes: tâche 2.

- [ ] **Step 1: Tests** (dans `server.test.ts`, en réutilisant `mk`, `fakeTmux`, `until`, `handshake` et le `beforeEach` qui pose `LEDGE_HOME`)

```ts
import { readFileSync } from 'node:fs';
import { paths } from '../src/paths.js';

const open = (port: number, path = '') => new Promise<WebSocket>(r => { const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { origin: 'tauri://localhost' } }); ws.on('open', () => r(ws)); });
const collect = (ws: WebSocket) => { const got: ServerMessage[] = []; ws.on('message', d => got.push(JSON.parse(String(d)))); return got; };
const dev = { id: 'dev', label: 'Devbox', ssh: 'dev-server' };

describe('machines list', () => {
  it('follows the snapshot, defaulting to local', async () => {
    const srv = await startServer({ store: new Store(), tmux: fakeTmux([]), port: 0 });
    const ws = await open(srv.port); const got = collect(ws);
    await until(() => got.some(m => m.type === 'machines'));
    expect(got.map(m => m.type).slice(0, 2)).toEqual(['snapshot', 'machines']);
    expect(got.find(m => m.type === 'machines')).toEqual({ type: 'machines', machines: [{ id: 'local', label: 'Local' }] });
    ws.close(); await srv.close();
  });
  it('machines.set is validated, written, and broadcast to every local client', async () => {
    const srv = await startServer({ store: new Store(), tmux: fakeTmux([]), port: 0 });
    const a = await open(srv.port), b = await open(srv.port); const gotA = collect(a), gotB = collect(b);
    await until(() => gotB.some(m => m.type === 'machines'));
    a.send(JSON.stringify({ type: 'machines.set', machines: [{ id: 'local', label: 'Local' }, dev] }));
    await until(() => gotB.filter(m => m.type === 'machines').length === 2);
    expect(gotB.at(-1)).toEqual({ type: 'machines', machines: [{ id: 'local', label: 'Local' }, dev] });
    expect(gotA.at(-1)).toEqual(gotB.at(-1));
    expect(JSON.parse(readFileSync(paths().machines, 'utf8'))).toEqual([{ id: 'local', label: 'Local' }, dev]);
    a.close(); b.close(); await srv.close();
  });
  it('an invalid list is refused with an error, nothing written nor broadcast', async () => {
    const srv = await startServer({ store: new Store(), tmux: fakeTmux([]), port: 0 });
    const a = await open(srv.port), b = await open(srv.port); const gotA = collect(a), gotB = collect(b);
    await until(() => gotB.some(m => m.type === 'machines'));
    a.send(JSON.stringify({ type: 'machines.set', machines: [dev, { id: 'local', label: 'Local' }] }));
    a.send(JSON.stringify({ type: 'machines.set', machines: [{ id: 'local', label: 'Local' }, dev, { ...dev, id: 'dev2' }] }));
    await until(() => gotA.filter(m => m.type === 'error').length === 2);
    expect(gotB.filter(m => m.type === 'machines')).toHaveLength(1);
    expect(existsSync(paths().machines)).toBe(false);
    a.close(); b.close(); await srv.close();
  });
  it('a second front connecting after a set sees the daemon list, not its own', async () => {
    const srv = await startServer({ store: new Store(), tmux: fakeTmux([]), port: 0 });
    const a = await open(srv.port); collect(a);
    a.send(JSON.stringify({ type: 'machines.set', machines: [{ id: 'local', label: 'Local' }, dev] }));
    await until(() => existsSync(paths().machines));
    const b = await open(srv.port); const gotB = collect(b);
    await until(() => gotB.some(m => m.type === 'machines'));
    expect(gotB.find(m => m.type === 'machines')).toEqual({ type: 'machines', machines: [{ id: 'local', label: 'Local' }, dev] });
    a.close(); b.close(); await srv.close();
  });
  it('is read back from the file at start', async () => {
    writeMachines([{ id: 'local', label: 'Local' }, dev]);
    const srv = await startServer({ store: new Store(), tmux: fakeTmux([]), port: 0 });
    const ws = await open(srv.port); const got = collect(ws);
    await until(() => got.some(m => m.type === 'machines'));
    expect(got.find(m => m.type === 'machines')).toEqual({ type: 'machines', machines: [{ id: 'local', label: 'Local' }, dev] });
    ws.close(); await srv.close();
  });
  it('ssh clients neither receive machines nor may set them', async () => {
    const remote: ServerMessage[] = [];
    const srv = await startServer({ store: new Store(), tmux: fakeTmux([]), port: 0, ssh: async (ws, _alias, _env) => { ws.on('message', d => { const m = JSON.parse(String(d)); if (m.type === 'machines.set') remote.push(m); }); } });
    const r = await open(srv.port, '/ssh/dev-server'); const gotR = collect(r);
    const a = await open(srv.port); const gotA = collect(a);
    await until(() => gotA.some(m => m.type === 'machines'));
    r.send(JSON.stringify({ type: 'machines.set', machines: [{ id: 'local', label: 'Local' }, dev] }));
    a.send(JSON.stringify({ type: 'snapshot.request' }));
    await until(() => gotA.filter(m => m.type === 'machines').length === 2);
    expect(gotR.some(m => m.type === 'machines')).toBe(false);
    expect(existsSync(paths().machines)).toBe(false);
    r.close(); a.close(); await srv.close();
  });
});
```

(`ServerMessage` importé de `@ledge/protocol` ; `existsSync` de `node:fs` ; `writeMachines` de `../src/daemon/machines.js`. `opts.ssh` a le type `typeof serveSsh`, appelé `(ws, alias, { env })` ; le faux ci-dessus respecte cette forme.)

- [ ] **Step 2: Run, expect FAIL** : `pnpm --filter @paradow/ledge test server -t "machines list"`

- [ ] **Step 3: Implémenter dans `server.ts`**

```ts
import { readMachines, writeMachines } from './machines.js';
import { paths } from '../paths.js';
// opts: ajouter `machinesFile?: string`
const machinesFile = opts.machinesFile ?? paths().machines;
let machines = readMachines(machinesFile);
const machinesMsg = (): ServerMessage => ({ type: 'machines', machines });

function sendSnapshot(ws: WebSocket) {
  // … envoi actuel du snapshot, previews, chat.history …
  send(ws, machinesMsg());   // spec §5.2: after each snapshot, the shared machines list
}
// dans handle(ws, msg):
case 'machines.set': {
  machines = msg.machines;             // already validated by parseClientMessage
  writeMachines(machines, machinesFile);
  broadcast(machinesMsg());            // every local client, the sender included
  return;
}
```

Les clients `/ssh/` ont leur propre gestion de messages (`(opts.ssh ?? serveSsh)(ws, alias, { env })`, `server.ts:375`), distincte de `handle` : rien à faire pour les exclure de `machines.set`, et `broadcast` (`server.ts:97`) ne parcourt que `localClients`.

Un `machines.set` invalide échoue dans `parseClientMessage` (`ClientMessageSchema.parse`, qui lance) → le `send(ws, { type: 'error', message: 'invalid message' })` existant couvre le cas (test « refusée »).

`startDaemon` (`src/daemon/index.ts`) : rien à passer, le défaut `paths().machines` suit `LEDGE_HOME`.

- [ ] **Step 4: Run, expect PASS** : `pnpm --filter @paradow/ledge test && pnpm --filter @paradow/ledge typecheck`

- [ ] **Step 5: Commit** : `git add packages/ledge && git commit -m "feat(daemon): serve and accept the shared machines list"`

---

### Task 4: Origine Desktop dans l'allowlist

**Files:**
- Modify: `packages/ledge/src/daemon/server.ts:40`, `packages/ledge/test/server.test.ts`

**Interfaces:**
- Produces: `ALLOWED_ORIGINS` contient en plus `'http://localhost:1421'`, `'http://127.0.0.1:1421'`.

- [ ] **Step 1: Test** (à côté du test d'allowlist existant qui utilise `handshake(port, origin)`)

```ts
it('accepts the Desktop dev origin on 1421 only', async () => {
  const srv = await startServer({ store: new Store(), tmux: fakeTmux([]), port: 0 });
  expect(await handshake(srv.port, 'http://localhost:1421')).toBe('open');
  expect(await handshake(srv.port, 'http://127.0.0.1:1421')).toBe('open');
  expect(await handshake(srv.port, 'http://localhost:1422')).not.toBe('open');
  expect(await handshake(srv.port, 'http://evil:1421')).not.toBe('open');
  expect(ALLOWED_ORIGINS).toContain('http://localhost:1421');
  await srv.close();
});
```

- [ ] **Step 2: Run, expect FAIL** : `pnpm --filter @paradow/ledge test server -t "1421"`

- [ ] **Step 3: Implémenter** : dans `ALLOWED_ORIGINS`, ajouter `'http://localhost:1421', 'http://127.0.0.1:1421'` après les entrées 1420, avec le commentaire `// Desktop's Vite dev server (spec 2026-10-14 §5.4)`.

- [ ] **Step 4: Run, expect PASS** : `pnpm --filter @paradow/ledge test`

- [ ] **Step 5: Commit** : `git add packages/ledge && git commit -m "feat(daemon): allow the Desktop dev origin"`

---

### Task 5: Fleet : types du protocole et `parseMachines` sur `MachinesSchema`

**Files:**
- Modify: `packages/fleet/src/fleet.ts`, `packages/fleet/src/machines.ts`, `packages/fleet/test/machines-source.test.ts`, `packages/fleet/test/fleet.test.ts`

**Interfaces:**
- Produces: `MachineConfig = Machine & { url?: string }` (l'URL n'existe que pour `local`, posée par le fleet, jamais persistée ni envoyée) ; `parseMachines(raw: unknown): MachineConfig[]` = `MachinesSchema.parse(strip(raw))` puis `url` de `LOCAL_MACHINE` sur la première ; `fleet.ts` lit `m.type === 'machines'` directement sur `ServerMessage` et envoie `{ type: 'machines.set', machines }` typé `ClientMessage`.
- Consumes: tâche 1.

- [ ] **Step 1: Tests**

Dans `machines-source.test.ts`, remplacer `machinesMsg` par un objet typé `ServerMessage` sans `as unknown` ; ajouter :

```ts
it('what goes to the daemon carries no url', () => {
  const { api, local } = setup();
  local.emit({ type: 'machines', machines: [{ id: 'local', label: 'Local' }] });
  api.fleet!.configure([LOCAL_MACHINE, remote]);   // api = createFleetClient(…) : un DaemonClient qui porte `fleet` (lot 1)
  expect(local.sent.at(-1)).toEqual({ type: 'machines.set', machines: [{ id: 'local', label: 'Local' }, { id: 'server', label: 'dev-server', ssh: 'dev-server' }] });
  expect(JSON.stringify(local.sent.at(-1))).not.toContain('url');
});
```

Dans `fleet.test.ts`, vérifier que le test existant de `parseMachines` (ou en ajouter un) couvre : `parseMachines([{ id: 'local', label: 'Local' }])[0]!.url === LOCAL_MACHINE.url` ; `parseMachines([{ ...LOCAL_MACHINE, ssh: 'x' }])` lance ; `parseMachines([LOCAL_MACHINE, { id: 'a', label: 'A' }])` lance ; un `url` fourni pour un distant est ignoré (`toBeUndefined()`).

- [ ] **Step 2: Run, expect FAIL** (typecheck ou assertions) : `pnpm --filter @ledge/fleet test && pnpm --filter @ledge/fleet typecheck`

- [ ] **Step 3: Implémenter**

`machines.ts` :

```ts
import { MachinesSchema, type Machine } from '@ledge/protocol';
export type MachineConfig = Machine & { url?: string };
export const LOCAL_MACHINE: MachineConfig = { id: 'local', label: 'Local', url: 'ws://127.0.0.1:47831' };
/** The shared list rules live in the protocol; the fleet only pins the local URL (spec §5.1). */
export function parseMachines(raw: unknown): MachineConfig[] {
  const list = MachinesSchema.parse(Array.isArray(raw) ? raw.map(m => { const { url: _url, ...rest } = (m ?? {}) as Record<string, unknown>; return rest; }) : raw);
  return list.map((m, i) => i === 0 ? { ...m, url: LOCAL_MACHINE.url } : m);
}
```

Supprimer `MachineConfigSchema` (le refine loopback n'a plus d'objet : l'URL n'est jamais lue). `machineUrl(machine, local)` reste.

`fleet.ts` : supprimer `type Machine` et `isMachinesMessage` ; `if (m.type === 'machines') { … }` ; `const toWire = (list: MachineConfig[]): Machine[] => list.map(({ id, label, ssh }) => ({ id, label, ...(ssh ? { ssh } : {}) }));` et `p.client.send({ type: 'machines.set', machines: toWire(next) })` sans `as never`.

- [ ] **Step 4: Run, expect PASS** : `pnpm --filter @ledge/fleet test && pnpm -r typecheck && pnpm --filter overlay test`

- [ ] **Step 5: Commit** : `git add packages/fleet && git commit -m "feat(fleet): machines list typed by the protocol"`

---

### Task 6: L'île active la source daemon

**Files:**
- Modify: le fichier de l'overlay qui appelle `createFleetClient` (`grep -rn "createFleetClient(" apps/overlay/src` — `App.tsx` ou `surface/useFleet.ts`)
- Create: `apps/overlay/test/fleet-app.test.tsx`
- Modify: `packages/fleet/test/mockDaemon.ts` (gagne `machines(list)` pour pousser un message `machines` ; les `machines.set` reçus sont déjà gardés dans `received`)
- Modify: `docs/multi-machine.md`

**Interfaces:**
- Produces: `createFleetClient(loadMachines(), makeClient, { machinesFromDaemon: true })` dans l'île ; `createMockDaemon().machines(list: Machines)` envoie `{ type: 'machines', machines: list }` à tous les clients.
- Consumes: tâche 5 ; lot 1 tâche 9.

- [ ] **Step 1: Test**

`apps/overlay/test/fleet-app.test.tsx` (`// @vitest-environment jsdom`, le mock daemon tourne en vrai sur un port libre comme dans `daemon.test.ts` — si `daemon.test.ts` est en `node`, ce test rend `App` et a besoin de jsdom **et** de `ws` : utiliser `WebSocketImpl` de `createDaemonClient` si l'app le permet, sinon rendre seulement le fleet, pas `App`) :

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMockDaemon } from './mockDaemon';
import { createFleetClient } from '../src/daemon/fleet';
import { loadMachines } from '../src/daemon/machines';
import { createDaemonClient } from '../src/daemon/client';
import { fleetOptions } from '../src/surface/fleetOptions';
import WebSocket from 'ws';

const until = (p: () => boolean, ms = 4000) => new Promise<void>((res, rej) => { const t0 = Date.now(); const i = setInterval(() => { if (p()) { clearInterval(i); res(); } else if (Date.now() - t0 > ms) { clearInterval(i); rej(new Error('timeout')); } }, 25); });

describe('the island and the daemon machines list', () => {
  let d: Awaited<ReturnType<typeof createMockDaemon>>;
  beforeEach(async () => { localStorage.clear(); d = await createMockDaemon(); });
  afterEach(() => d.close());
  it('migrates its local list once the daemon speaks, then follows the daemon', async () => {
    localStorage.setItem('ledge.machines', JSON.stringify([{ id: 'local', label: 'Local', url: 'ws://127.0.0.1:47831' }, { id: 'dev', label: 'Devbox', ssh: 'dev-server' }]));
    const api = createFleetClient(loadMachines(), () => createDaemonClient({ url: d.url, WebSocketImpl: WebSocket as never }), fleetOptions);   // a DaemonClient carrying `fleet`
    api.connect();
    await until(() => d.clientCount === 1);
    d.machines([{ id: 'local', label: 'Local' }]);
    await until(() => d.received.some(m => m.type === 'machines.set'));
    expect(d.received.find(m => m.type === 'machines.set')).toEqual({ type: 'machines.set', machines: [{ id: 'local', label: 'Local' }, { id: 'dev', label: 'Devbox', ssh: 'dev-server' }] });
    expect(localStorage.getItem('ledge.machines')).toBeNull();
    expect(api.fleet!.machinesSource()).toBe('daemon');
    api.close();
  });
});
```

`apps/overlay/src/surface/fleetOptions.ts` (créer, une ligne, pour que le test et l'app lisent la même valeur) : `export const fleetOptions = { machinesFromDaemon: true } as const; // spec 2026-10-14 §13 lot 2: the island trusts the daemon's list`.

- [ ] **Step 2: Run, expect FAIL** : `pnpm --filter overlay test fleet-app`

- [ ] **Step 3: Implémenter**

Dans `packages/fleet/test/mockDaemon.ts`, à côté de `upsert`/`remove` : `machines(list: Machines) { bc({ type: 'machines', machines: list }); }` (`bc` est le helper de diffusion existant ; `createMockDaemon` est `async`, écoute sur un port libre et expose `url`, `received`, `clientCount` en getter).

Dans l'overlay, à l'appel de `createFleetClient(…)`, ajouter le troisième argument `fleetOptions`. Les clés restent `ledge.*` (préfixe par défaut).

`docs/multi-machine.md` : remplacer la phrase qui dit que la liste est gardée dans le navigateur/overlay par : « La liste des machines vit dans `~/.ledge/machines.json`, tenue par le daemon local et partagée par toutes les fenêtres Ledge ; une liste gardée par une ancienne version de l'île est reprise une fois au premier démarrage. »

- [ ] **Step 4: Run, expect PASS** : `pnpm -r typecheck && pnpm -r test && pnpm --filter overlay build && pnpm --filter overlay test:e2e`
Expected: vert ; les specs Playwright `fleet.spec.ts` et `handle.spec.ts` passent sans changement (le fake daemon en page n'envoie jamais `machines` → source `local`, comportement actuel : à vérifier explicitement, c'est le cas « ancien daemon » de la spec §14).

- [ ] **Step 5: Essai manuel** : `pnpm --filter @paradow/ledge dev` (daemon) + île en dev ; dans Paramètres, ajouter une machine ; vérifier `~/.ledge/machines.json` ; ouvrir une seconde île (ou `test/devMock`) : la liste apparaît sans action.

- [ ] **Step 6: Commit et MR**

```bash
git add apps/overlay packages/fleet docs/multi-machine.md
git commit -m "feat(overlay): machines list from the local daemon"
git push -u origin desktop/lot2-daemon-machines
```

MR `desktop/lot2-daemon-machines → main` : « Lot 2: shared machines list served by the daemon ».
