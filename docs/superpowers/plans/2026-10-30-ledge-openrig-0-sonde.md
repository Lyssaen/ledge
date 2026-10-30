# Ledge × OpenRig, lot 0 : sonde sur un OpenRig jetable (plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** établir, sur un OpenRig 0.6.14 jetable, les faits qui fixent l'inscription de Ledge comme humain, le chemin de réponse à une escalade et les noms d'événements SSE, et les consigner dans une fiche de faits que les lots 2 et 4 lisent.

**Architecture :**
- Un script Node sans dépendance, `scripts/openrig-probe.mjs`, pilote un daemon OpenRig démarré dans un `OPENRIG_HOME` temporaire, sur un port libre autre que 7433, avec un serveur tmux isolé (`TMUX_TMPDIR`).
- Il n'utilise que le binaire `rig` et l'API HTTP/SSE de ce daemon jetable. Chaque étape écrit une observation brute dans un rapport JSON. Le script ne conclut rien : la fiche de faits est rédigée à la main à partir du rapport.
- Les sièges du rig de sonde sont des terminaux (`runtime: terminal`). Aucun agent Claude ou Codex n'est lancé, et le noyau est sauté (`--no-kernel`) : la sonde ne consomme aucun crédit LLM.

**Tech Stack :** Node 24 (ESM, `fetch`, `node:child_process`), vitest (config `vitest.scripts.config.ts`), OpenRig `@openrig/cli` 0.6.14 installé (`readlink -f $(which rig)`).

**Spec :** `docs/superpowers/specs/2026-10-30-ledge-openrig-orchestrator-design.md` (§2, §4.2, §4.3, §4.4, §11 lot 0). Plan maître : `docs/superpowers/plans/2026-10-30-ledge-openrig-orchestrator.md` ; son contrat et ses Global Constraints s'appliquent, on ne les répète pas.

## Global Constraints

Celles du plan maître, plus :

- **Accord de l'utilisateur :** le premier geste de la tâche 3 est de demander à l'utilisateur, dans la conversation, son « go » explicite pour démarrer l'OpenRig jetable. Sans ce go, on s'arrête. Le script exige en plus `--go` sur sa ligne de commande.
- **Jamais `~/.openrig` :** `OPENRIG_HOME` = `mkdtemp(join(os.tmpdir(), 'openrig-qa-ledge-'))`, avec le fichier marqueur `.openrig-fixture` dedans (convention de fixture d'OpenRig, `dist/openrig-compat.js`). `OPENRIG_SHARED_DOCS_ROOT` = `<home>/shared-docs`, parce que ce chemin hérité ignore `OPENRIG_HOME` (`dist/config-store.js:16`).
- **Jamais le port 7433 :** port libre choisi par le script (bind sur `127.0.0.1:0`, puis relâché), refus explicite de 7433 et de la valeur de `OPENRIG_PORT` de l'utilisateur. Tous les appels `rig` portent `OPENRIG_URL=http://127.0.0.1:<port>`.
- **Environnement nettoyé :** le script retire `OPENRIG_SESSION_NAME`, `OPENRIG_NODE_ID`, `OPENRIG_URL`, `OPENRIG_HOST`, `OPENRIG_PORT`, `RIGGED_*`, `LEDGE_SESSION`, `TMUX`, `TMUX_PANE`, puis pose les siens. Une étape « en tant que siège » ajoute `OPENRIG_SESSION_NAME=<siège>` pour cette seule commande.
- **tmux isolé :** `TMUX_TMPDIR=<home>/tmux` pour le daemon et pour chaque `rig`/`tmux` du script. Le daemon OpenRig en tient compte (`daemon/dist/adapters/tmux-server.js`) ; le serveur tmux de Ledge (`-L ledge`) et celui de l'utilisateur ne voient rien.
- **Démontage toujours :** `finally` → `rig down ledge-probe`, `rig daemon stop`, `tmux kill-server` sous `TMUX_TMPDIR`, `rm -rf <home>`. `node scripts/openrig-probe.mjs --teardown <home>` refait le démontage seul, si un essai a été interrompu.
- **Le dépôt ne reçoit que** le script, son test et la fiche de faits. Le rapport JSON brut reste hors dépôt, dans le dossier temporaire de session de l'exécutant (scratchpad). La fiche en cite les extraits utiles.
- Commits : `feat(scripts): …` et `docs(openrig): …`, avec la ligne `Co-Authored-By` du plan maître.

## Review Focus

1. **Une variable d'environnement oubliée fait parler la sonde au vrai OpenRig.** `rig` lit `$OPENRIG_HOME/daemon.json`, puis `OPENRIG_URL`, puis la config. Attendu : chaque appel `rig` et chaque `fetch` vise le port jetable, et le script s'arrête avant tout appel si l'URL résolue est `:7433` ou si le home résolu est `~/.openrig`. Test : `probeEnv`/`assertSafeTarget`, tâche 1.
2. **La sonde est lancée depuis une session Ledge ou un siège OpenRig** (son environnement porte `OPENRIG_SESSION_NAME`, `LEDGE_SESSION`). Attendu : ces variables ne passent jamais aux commandes, sauf l'identité de siège posée exprès par l'étape. Test : `probeEnv`, tâche 1.
3. **Un essai interrompu (Ctrl-C, exception) laisse un daemon et un serveur tmux vivants.** Attendu : SIGINT/SIGTERM déclenchent le démontage, et `--teardown <home>` le refait. Test : `teardownPlan`, tâche 1 ; vérification manuelle, tâche 3.
4. **`rig gateway human add` écrit ailleurs que dans le home jetable.** Il charge le registre directement (`daemon/dist/gateway-human-registry-surface.js`), sans passer par le daemon. Attendu : le chemin `path` qu'il imprime est sous `<home>`, sinon arrêt immédiat avec démontage. Test : `assertUnder`, tâche 1.
5. **Le vrai OpenRig de l'utilisateur tourne pendant la sonde.** Attendu : la sonde ne le touche pas. Elle note seulement, en lecture, si `~/.openrig/gateway/humans/` et `~/.openrig/daemon.json` ont changé pendant l'essai (mtime avant/après), et l'écrit dans le rapport. Étape « garde », tâche 2.

---

### Task 1 : briques pures de la sonde, testées

**Files :**
- Create : `scripts/openrig-probe.mjs` (exports purs seulement dans cette tâche, et le `main` gardé par `import.meta.url === pathToFileURL(process.argv[1]).href`, comme `scripts/pwa-notes.mjs`)
- Test : `test/openrig-probe.test.ts`

**Interfaces :**
- Consumes : rien.
- Produces (tâche 2) :
  - `probeEnv(base: NodeJS.ProcessEnv, o: { home: string; port: number; seat?: string }): NodeJS.ProcessEnv` ;
  - `assertSafeTarget(o: { home: string; port: number; realHome: string; userPort?: string }): void` (lance une `Error` dont le message commence par `openrig-probe: refused:`) ;
  - `assertUnder(path: string, home: string): void` ;
  - `probeRigSpec(): string`, le YAML du rig `ledge-probe` ;
  - `questionsJson(): string`, le fichier `--human-questions-file` ;
  - `parseSse(buffer: string): { events: Array<{ id: number; type: string; data: unknown }>; rest: string }` ;
  - `teardownPlan(o: { home: string; port: number }): Array<{ cmd: string; args: string[] }>` ;
  - `markers(run: string): { annotation: string; reason: string; decision: string; ping: string }`.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
// test/openrig-probe.test.ts
describe('probeEnv', () => {
  it('drops every inherited OpenRig, Ledge and tmux identity and sets the throwaway ones', () => {
    const env = probeEnv({ PATH: '/bin', OPENRIG_SESSION_NAME: 'x@y', OPENRIG_NODE_ID: 'n', OPENRIG_URL: 'http://127.0.0.1:7433',
      OPENRIG_PORT: '7433', RIGGED_HOME: '/h', LEDGE_SESSION: 's', TMUX: '/tmp/t,1,0', TMUX_PANE: '%1' }, { home: '/tmp/openrig-qa-ledge-a', port: 7512 });
    expect(env).toEqual({ PATH: '/bin', OPENRIG_HOME: '/tmp/openrig-qa-ledge-a', OPENRIG_URL: 'http://127.0.0.1:7512', OPENRIG_PORT: '7512',
      OPENRIG_SHARED_DOCS_ROOT: '/tmp/openrig-qa-ledge-a/shared-docs', TMUX_TMPDIR: '/tmp/openrig-qa-ledge-a/tmux' });
  });
  it('adds the seat identity only when asked', () => {
    expect(probeEnv({}, { home: '/tmp/openrig-qa-ledge-a', port: 7512, seat: 'probe-seat@ledge-probe' }).OPENRIG_SESSION_NAME).toBe('probe-seat@ledge-probe');
  });
});
describe('assertSafeTarget', () => {
  const ok = { home: join(tmpdir(), 'openrig-qa-ledge-a'), port: 7512, realHome: '/home/u' };
  it('accepts a temp openrig-qa home on another port', () => expect(() => assertSafeTarget(ok)).not.toThrow());
  it('refuses port 7433', () => expect(() => assertSafeTarget({ ...ok, port: 7433 })).toThrow(/^openrig-probe: refused: port 7433/));
  it("refuses the user's own OPENRIG_PORT", () => expect(() => assertSafeTarget({ ...ok, userPort: '7512' })).toThrow(/refused: port 7512/));
  it('refuses ~/.openrig and anything outside the temp dir', () => {
    expect(() => assertSafeTarget({ ...ok, home: '/home/u/.openrig' })).toThrow(/refused: home/);
    expect(() => assertSafeTarget({ ...ok, home: '/home/u/openrig-qa-x' })).toThrow(/refused: home/);
  });
});
describe('assertUnder', () => {
  it('refuses a path outside the home', () => expect(() => assertUnder('/home/u/.openrig/gateway/humans/ledge.yaml', '/tmp/openrig-qa-ledge-a')).toThrow(/refused: wrote outside/));
});
describe('probeRigSpec', () => {
  it('is a 0.2 spec with two terminal seats in pod probe', () => {
    const y = probeRigSpec();
    expect(y).toMatch(/^version: "0\.2"\nname: ledge-probe\n/);
    expect(y.match(/runtime: terminal/g)).toHaveLength(2);
    expect(y).toContain('agent_ref: "builtin:terminal"'); expect(y).toContain('profile: none');
    expect(y).toMatch(/- id: seat\b/); expect(y).toMatch(/- id: peer\b/);
  });
});
describe('questionsJson', () => {
  it('holds 2 questions of 2 to 4 options, one recommended each', () => {
    const q = JSON.parse(questionsJson());
    expect(q).toHaveLength(2);
    for (const x of q) { expect(x.options.length).toBeGreaterThanOrEqual(2); expect(x.options.filter((o: { recommended?: boolean }) => o.recommended)).toHaveLength(1); }
  });
});
describe('parseSse', () => {
  it('reads id and data frames, keeps the type from data, and returns the unfinished tail', () => {
    const r = parseSse('id: 4\ndata: {"seq":4,"type":"queue.created"}\n\nid: 5\ndata: {"seq":5,"ty');
    expect(r.events).toEqual([{ id: 4, type: 'queue.created', data: { seq: 4, type: 'queue.created' } }]);
    expect(r.rest).toBe('id: 5\ndata: {"seq":5,"ty');
  });
  it('ignores comment and keep-alive lines', () => expect(parseSse(':\n\n').events).toEqual([]));
});
describe('teardownPlan', () => {
  it('downs the rig, stops the daemon, kills the isolated tmux server, then removes the home, in that order', () => {
    expect(teardownPlan({ home: '/tmp/openrig-qa-ledge-a', port: 7512 }).map(s => [s.cmd, ...s.args].join(' '))).toEqual([
      'rig down ledge-probe', 'rig daemon stop', 'tmux kill-server', 'rm -rf /tmp/openrig-qa-ledge-a']);
  });
});
describe('markers', () => {
  it('are distinct and carry the run id', () => {
    const m = markers('r1'); expect(new Set(Object.values(m)).size).toBe(4); for (const v of Object.values(m)) expect(v).toContain('r1');
  });
});
```

- [ ] **Step 2 : lancer, constater l'échec**

Run : `pnpm exec vitest run --config vitest.scripts.config.ts test/openrig-probe.test.ts`
Expected : FAIL, `Failed to resolve import "../scripts/openrig-probe.mjs"`.

- [ ] **Step 3 : écrire les exports de la liste Interfaces dans `scripts/openrig-probe.mjs`**

- `assertSafeTarget` : le home doit être sous `os.tmpdir()` (ou `/tmp`), et son nom doit commencer par `openrig-qa-` (le prédicat `isFixtureScopedHome` d'OpenRig).
- `probeRigSpec` :
  - `version: "0.2"`, `name: ledge-probe` ;
  - un pod `probe` avec deux membres, `seat` et `peer`, en `agent_ref: "builtin:terminal"`, `runtime: terminal`, `profile: none` et `cwd: "."` ;
  - `edges: []` ;
  - les sessions tmux attendues sont donc `probe-seat@ledge-probe` et `probe-peer@ledge-probe` (`{pod}-{member}@{rig}`).
- `teardownPlan` : `rig down ledge-probe` et `rig daemon stop` sont exécutés avec `probeEnv` ; `tmux kill-server` l'est avec `TMUX_TMPDIR` posé.

- [ ] **Step 4 : lancer, constater le succès**

Run : `pnpm exec vitest run --config vitest.scripts.config.ts test/openrig-probe.test.ts`
Expected : PASS, 13 tests.

- [ ] **Step 5 : commit**

```bash
git add scripts/openrig-probe.mjs test/openrig-probe.test.ts
git commit -m "feat(scripts): openrig probe building blocks"
```

### Task 2 : le déroulé de la sonde et son rapport

**Files :**
- Modify : `scripts/openrig-probe.mjs` (ajout de `main(argv)`, des étapes et du rapport)
- Test : `test/openrig-probe.test.ts`

**Interfaces :**
- Consumes : la tâche 1 entière.
- Produces (tâche 3) :
  - la ligne de commande `node scripts/openrig-probe.mjs --go [--report <file.json>] [--keep]`, et `node scripts/openrig-probe.mjs --teardown <home>` ;
  - le rapport JSON `{ run, version, home, port, steps: Step[], events: SseEvent[], guard }`, avec `Step = { id: string; at: string; cmd?: string[]; env?: { seat?: string }; exit?: number; stdout?: string; stderr?: string; http?: { method: string; path: string; body?: unknown; status: number; json?: unknown } ; note?: string }`.
  - Chaque `id` d'étape est l'un de ceux de la table ci-dessous. La fiche de faits les cite.

- [ ] **Step 1 : écrire les tests qui échouent** (sans démarrer OpenRig)

```ts
describe('openrig-probe CLI', () => {
  const run = (...a: string[]) => spawnSync(process.execPath, ['scripts/openrig-probe.mjs', ...a], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  it('without --go, prints what it would do and exits 2, creating nothing', () => {
    const before = readdirSync(tmpdir()).filter(n => n.startsWith('openrig-qa-ledge-'));
    const r = run();
    expect(r.status).toBe(2); expect(r.stdout).toMatch(/--go/); expect(r.stdout).toMatch(/OPENRIG_HOME=.*openrig-qa-ledge-/);
    expect(readdirSync(tmpdir()).filter(n => n.startsWith('openrig-qa-ledge-'))).toEqual(before);
  });
  it('--teardown refuses a home that is not a probe home', () => {
    const r = run('--teardown', homedir() + '/.openrig');
    expect(r.status).toBe(1); expect(r.stderr).toMatch(/^openrig-probe: refused: home/);
  });
  it('refuses to start when the installed rig is not 0.6.14', () => {
    const fake = mkdtempSync(join(tmpdir(), 'probe-bin-')); dirs.push(fake);
    writeFileSync(join(fake, 'rig'), '#!/bin/sh\necho 0.7.0\n', { mode: 0o755 });
    const r = spawnSync(process.execPath, ['scripts/openrig-probe.mjs', '--go'], { encoding: 'utf8', env: { PATH: `${fake}:${process.env.PATH}` } });
    expect(r.status).toBe(1); expect(r.stderr).toMatch(/refused: rig 0\.7\.0, the probe is written for 0\.6\.14/);
  });
});
```

- [ ] **Step 2 : lancer, constater l'échec**

Run : `pnpm exec vitest run --config vitest.scripts.config.ts test/openrig-probe.test.ts -t "openrig-probe CLI"`
Expected : FAIL (pas de `main`, code de sortie 0).

- [ ] **Step 3 : écrire `main(argv: string[]): Promise<number>`, qui déroule les étapes dans cet ordre**

Chaque étape est enregistrée, même si elle échoue. Un échec n'arrête pas la sonde, sauf pour `preflight`, `start` et `guard.*`. Chemins HTTP relatifs à `http://127.0.0.1:<port>`.

| id | Ce que fait l'étape | Ce qu'on regarde |
|---|---|---|
| `preflight` | `rig --version` = 0.6.14, choix du port, `mkdtemp`, `.openrig-fixture`, `assertSafeTarget`, mtime de `~/.openrig/daemon.json` et de `~/.openrig/gateway/humans/` (lecture seule) | — |
| `start` | `rig daemon start --port <p> --no-kernel`, puis attente de `GET /healthz` (30 s) | corps de `/healthz` : y a-t-il `semver` / `version` ? |
| `sse.open` | `GET /api/events?replay=0` en flux, gardé ouvert jusqu'à la fin ; chaque événement est horodaté à la réception | `id`, `data.type`, présence d'une ligne `event:` |
| `rig.up` | `git init <home>/ws`, liste des fichiers (avec ignorés), puis `rig up <home>/spec/rig.yaml --cwd <home>/ws --yes --json`, puis nouvelle liste | sortie JSON ; fichiers ajoutés/modifiés dans `ws` |
| `rig.plan` | `git init <home>/ws2`, puis `rig up starter --plan --cwd <home>/ws2 --json` | ce que le plan annonce d'écrire pour des sièges Claude/Codex (sans lancer) ; liste de `ws2` inchangée |
| `read.mirror` | `GET /api/ps`, `/api/rigs`, `/api/rigs/summary`, `/api/rigs/<id>/graph`, `/api/kernel`, `/api/attention` | forme des sièges, noms de session, champs d'état |
| `esc.before-register` | en tant que `probe-seat@ledge-probe` : `rig queue create --destination ledge@external --human-intent decision --summary … --evidence-ref <ws>/PROOF.md --human-questions-file <q> --body-file <b> --json` | refus attendu, et son message |
| `human.add` | `rig gateway human add ledge --display-name "Ledge" --binding slack:ledge-decoy:file:<home>/decoy-slack.env:primary --delivery-class D --actor ledge-probe` (fichier absent) ; en cas de refus, `human.add.file` : même chose avec le fichier créé vide | sortie, `path` (→ `assertUnder`), `rig gateway human show ledge --json` |
| `human.second` | `rig gateway human add other --display-name Other --binding slack:x:file:<home>/x.env:primary --delivery-class D --actor ledge-probe` | refus « a human is already configured » : la frontière d'un seul humain |
| `esc.create` | la création de `esc.before-register`, cette fois après l'inscription | `qitemId`, sortie `--json` |
| `esc.create.source` | même création hors siège, avec `--source probe-peer@ledge-probe` | la provenance `claimed:v1` est-elle acceptée pour une ligne humaine ? |
| `esc.read` | à t+0 et à t+10 s : `GET /api/queue/list?destinationSession=ledge@external`, `/api/queue/<id>`, `/api/queue/<id>/transitions`, `/api/queue/human-updates`, `/api/queue/undelivered`, `/api/attention` | l'état, l'état de transport (`transport-failed`, `never-posted`…), le nom du champ qui porte les questions, `tier`, `intent` |
| `esc.block` | en tant que siège : `rig queue create --destination probe-seat@ledge-probe --summary work --json`, `rig queue claim <w>`, `rig queue block <w> --on <esc> --json` | état de `<w>` |
| `answer.approve` | `POST /api/mission-control/action { verb: 'approve', qitemId: <esc>, actorSession: 'ledge@external', annotation: <m.annotation>, reason: <m.reason> }` | réponse HTTP ; puis `/api/queue/<esc>`, `/api/queue/<w>`, `/api/queue/list?destinationSession=probe-seat@ledge-probe`, `/api/mission-control/audit?qitem_id=<esc>` ; puis `tmux capture-pane -p -t probe-seat@ledge-probe` (sous `TMUX_TMPDIR`) ; où apparaissent `m.annotation` et `m.reason`, et `<w>` s'est-il réveillé ? |
| `answer.twice` | le même `approve` une seconde fois | statut et `error` (`qitem_already_terminal` ?), à faire correspondre à `already_answered` |
| `answer.reply-row` | `rig queue create --source ledge@external --destination probe-seat@ledge-probe --summary "Réponse de Ledge : …" --body-file <r> --json`, hors siège | acceptée ? Visible dans le volet du siège ? |
| `answer.header` | une nouvelle escalade, puis `approve` avec l'en-tête `X-OpenRig-Session: ledge@external` au lieu de `actorSession` | provenance enregistrée (`transport:v1` / `claimed:v1`) |
| `deny` | une nouvelle escalade, puis `deny` avec `reason` | état final, réveil du travail bloqué dessus |
| `planb.park` | en tant que siège : un travail `<w2>`, puis `rig queue block <w2> --on human-ledge@host --summary … --evidence-ref <ws>/PROOF.md --json` ; puis `rig queue create --destination human-ledge@host --tier human-gate …` | les deux sont-ils acceptés ? Visibles dans `queue/list` et `/api/attention` ? |
| `planb.resolve` | `POST /api/mission-control/action { verb: 'resolve', qitemId: <w2>, decision: <m.decision>, actorSession: 'ledge@external' }` | état de `<w2>` (`in-progress` ?), `m.decision` dans les transitions et dans le volet du siège |
| `send.seat` | en tant que `probe-peer@ledge-probe` : `rig send probe-seat@ledge-probe "<m.ping>"`, puis `GET /api/queue/outbox/list?senderSession=probe-peer@ledge-probe` | événement SSE émis ? Ligne d'outbox ? Enveloppe vue dans le volet |
| `send.ledge` | hors siège : `rig send probe-seat@ledge-probe "<m.ping>-ledge"` | même chose : quel expéditeur apparaît ? Une outbox existe-t-elle sans identité ? |
| `sse.resume` | fermeture du flux, puis `GET /api/events` avec `Last-Event-ID: <dernier id reçu>`, pendant 3 s | aucun `id` déjà reçu ne revient |
| `events.catalog` | (calcul) les `data.type` distincts, avec pour chacun la première étape dans la fenêtre de laquelle il est arrivé et un exemple | — |
| `guard` | mtime de `~/.openrig/daemon.json` et de `~/.openrig/gateway/humans/` comparés à `preflight` | changés ou non (le vrai daemon peut écrire : on note, on ne conclut pas) |
| `teardown` | `teardownPlan`, puis vérification : le port ne répond plus, et `<home>` n'existe plus (sauf `--keep`) | — |

- Sans `--go` : on imprime le tableau ci-dessus et l'environnement qui serait posé, puis on sort avec le code 2.
- `SIGINT` et `SIGTERM` déclenchent le démontage.
- Le rapport est écrit dans le fichier `--report`, ou par défaut dans `<os.tmpdir()>/openrig-probe-report-<run>.json`, avant le démontage. Son chemin est imprimé.

- [ ] **Step 4 : lancer, constater le succès**

Run : `pnpm exec vitest run --config vitest.scripts.config.ts test/openrig-probe.test.ts`
Expected : PASS, 16 tests. Aucun dossier `openrig-qa-ledge-*` nouveau dans `os.tmpdir()`.

- [ ] **Step 5 : commit**

```bash
git add scripts/openrig-probe.mjs test/openrig-probe.test.ts
git commit -m "feat(scripts): openrig probe run and report"
```

### Task 3 : passer la sonde, rédiger la fiche de faits

**Files :**
- Create : `docs/superpowers/specs/2026-10-30-openrig-facts.md`

**Interfaces :**
- Consumes : le CLI de la tâche 2.
- Produces (lots 2 et 4) : la table « Décisions » de la fiche, ligne par ligne. Les identifiants de ligne (D1…D13) sont cités tels quels par les plans des lots 2 et 4.

- [ ] **Step 1 : demander le go**

Message à l'utilisateur, mot pour mot ou presque : « Je vais démarrer un OpenRig jetable : home `/tmp/openrig-qa-ledge-…`, port libre (pas 7433), tmux isolé, sans noyau ni agent LLM. Il est démonté à la fin. `~/.openrig` n'est pas touché. Go ? » On attend un « go » explicite. Sans ce go, la tâche s'arrête ici.

- [ ] **Step 2 : lancer la sonde**

Run : `node scripts/openrig-probe.mjs --go --report <scratchpad>/openrig-probe-report.json`
Expected :
- code 0 ;
- la dernière ligne vaut `teardown ok: port <p> closed, <home> removed` ;
- `ss -ltn | grep :<p>` ne renvoie rien ;
- `ls /tmp | grep openrig-qa-ledge-` ne renvoie rien.

En cas d'échec en cours de route, on relance `node scripts/openrig-probe.mjs --teardown <home>`, puis on vérifie les mêmes points.

- [ ] **Step 3 : écrire la fiche `docs/superpowers/specs/2026-10-30-openrig-facts.md`**

Structure imposée. Chaque cellule « Observé » cite l'`id` d'étape du rapport et l'extrait exact (sortie, champ JSON, code HTTP). Ce qui n'a pas été observé s'écrit « non observé », jamais une supposition.

```markdown
# OpenRig 0.6.14 : fiche de faits (lot 0)
Sonde du <date>, rapport <run>. Conditions : home jetable, `--no-kernel`, sièges terminal.

## Décisions
| # | Question | Observé (étape : extrait) | Décision pour Ledge | Lot |
|---|---|---|---|---|
| D1 | D'où lire la version d'OpenRig | start : … | `GET /healthz` champ … / sinon `rig --version` | 2 |
| D2 | L'inscription `ledge` avec leurre Slack passe-t-elle ? Faut-il le fichier ? | human.add / human.add.file : … | commande exacte retenue | 2 |
| D3 | Un second humain distinct est-il refusé ? | human.second : … | si un humain existe déjà : `human: 'failed'` + detail, ou repli B | 2 |
| D4 | Une ligne `ledge@external` sans Slack : état, lisible, par quelle route et quel filtre | esc.read : … | route + filtre + champs (questions, tier, intent, evidenceRef) | 2 |
| D5 | `approve` ferme-t-il la ligne, réveille-t-il le travail bloqué, et porte-t-il le texte jusqu'au siège ? Par quel champ (`annotation` ou `reason`) ? | answer.approve : … | réponse = approve seul / ligne de réponse + approve | 4 |
| D6 | Une ligne de réponse `--source ledge@external` vers le siège est-elle acceptée et vue ? | answer.reply-row : … | oui / non | 4 |
| D7 | Une deuxième réponse : quel code d'erreur ? | answer.twice : … | correspondance avec `already_answered` | 4 |
| D8 | Identité de l'acteur : `actorSession` dans le corps ou en-tête, et provenance enregistrée | answer.approve / answer.header : … | ce que le pont envoie | 4 |
| D9 | Plan B : park sur `human-ledge@host`, ligne `human-gate`, `resolve` avec `decision` | planb.* : … | retenu si D2, D4 ou D5 échouent | 2, 4 |
| D10 | Noms d'événements SSE utiles, forme du flux (`event:` absent ? type dans `data.type` ?) | events.catalog : … | liste exacte pour le miroir : queue, siège, rig | 2 |
| D11 | `rig send` : événement ou outbox (route, clé d'interrogation : par expéditeur ?) | send.seat / send.ledge : … | événement suivi, ou interrogation de 5 s de `/api/queue/outbox/list?senderSession=` pour chaque siège | 2 |
| D12 | Reprise SSE avec `Last-Event-ID` sans doublon | sse.resume : … | conserver `id` dans `openrig.json` | 2 |
| D13 | Ce que `rig up --cwd` écrit dans le dossier (terminal réel, Claude/Codex en plan) | rig.up / rig.plan : … | liste montrée à l'étape « Le plan » (spec §4.6) | 5 |

## Retenu
Une phrase par lot : le lot 2 s'inscrit par … ; le lot 4 répond par … ; le repli B est (ou n'est pas) nécessaire, parce que …

## Non sondé
L'escalade de l'operator vers `operator.human` (le noyau est sauté), et les sièges Claude/Codex réels. Ce qu'il faudrait pour les sonder (accord, coût).

## Demandes amont confirmées (spec §12)
…

## Extraits
Les extraits JSON cités ci-dessus, tronqués à l'utile.
```

- [ ] **Step 4 : relire la fiche contre le rapport**

Pour chaque ligne D1…D13, on retrouve l'extrait cité dans le rapport JSON (`jq '.steps[] | select(.id=="<id>")'`). Une cellule « Décision » qui ne découle pas de son « Observé » est corrigée.

- [ ] **Step 5 : commit**

```bash
git add docs/superpowers/specs/2026-10-30-openrig-facts.md
git commit -m "docs(openrig): facts sheet from the throwaway probe"
```

- [ ] **Step 6 : signaler au plan maître**

Si la fiche retient le plan B (D9), ou si D3, D5 ou D11 contredisent le contrat, on l'écrit dans le résumé de PR. Le plan maître n'est modifié que par la session qui le tient.
