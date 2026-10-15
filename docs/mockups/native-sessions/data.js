/* Fictional scenarios shared by the thread and the agent peek. */
window.LedgeNativeScenarios = {
    codex: {
      name: 'Nova', provider: 'Codex', topic: 'Conserver l’historique des sessions', branch: 'feat/session-history',
      label: 'Outils, résultats et sous-agents', state: 'working', stateLabel: 'En cours', turn: '03', time: '14:32', elapsed: '2 min 18',
      input: '18 420', output: '1 320', source: 'Événements Codex + transcript JSONL',
      question: 'Ajoute un historique des sessions, qui reste accessible après leur fermeture. Vérifie aussi la reprise après un redémarrage.',
      message: 'Je conserve les événements dans un historique dédié. Deux sous-agents vérifient la persistance et la reprise pendant que je raccorde la lecture.',
      previous: 'D’accord pour une chronologie par tour, avec les actions regroupées et leurs détails à la demande.',
      final: 'L’historique est conservé après la fermeture. La reprise a été corrigée et toutes les vérifications passent.',
      finalCard: { title: 'Historique conservé après la fermeture, reprise corrigée', lead: 'L’historique d’une session reste lisible après sa fermeture. La reprise après un redémarrage perdait une ligne coupée ; c’est corrigé et vérifié.',
        did: [{ text: 'Persistance des événements dans un historique dédié', file: 'daemon/history.ts' }, { text: 'Conservation d’un événement avant la mise à jour de l’état', file: 'daemon/store.ts' }, { text: 'Requête de lecture de l’historique', file: 'protocol/messages.ts' }, { text: 'Dernière ligne incomplète gardée en attente jusqu’au prochain saut de ligne', file: 'daemon/history.ts' }],
        verified: [{ text: 'pnpm --filter @paradow/ledge test -- history', note: 'tout passe' }, { text: 'Iris · persistance après fermeture', note: 'confirmée' }, { text: 'Milo · reprise sur une ligne coupée', note: 'reproduite puis corrigée' }] },
      tools: [
        { id: 'read', label: 'Lire le stockage des sessions', name: 'CommandExecution', detail: 'Lecture · daemon/store.ts', command: 'sed -n \'1,120p\' packages/ledge/src/daemon/store.ts', result: 'export class Store {\n  private sessions = new Map<string, Session>();\n  // État courant des sessions\n}', status: 'success', duration: '0,12 s', exit: '0', nativeId: 'cmd_014', source: 'item_completed → CommandExecution' },
        { id: 'patch', label: 'Ajouter la persistance des événements', name: 'FileChange', detail: 'Modification · daemon et protocole', command: 'packages/ledge/src/daemon/history.ts\npackages/ledge/src/daemon/store.ts\npackages/protocol/src/messages.ts', result: '+ await history.append(sessionId, event);\n+ const events = await history.list(sessionId);', status: 'success', duration: null, exit: null, nativeId: 'patch_015', source: 'item_completed → FileChange' },
        { id: 'test', label: 'Vérifier la reprise des sessions', name: 'CommandExecution', detail: 'Commande · vérification en échec', command: 'pnpm --filter @paradow/ledge test -- history', result: 'FAIL  history › reprend après un redémarrage\n\nExpected: 12 événements\nReceived: 11 événements\n\n11 passed · 1 failed', status: 'failed', duration: '1,84 s', exit: '1', nativeId: 'cmd_016', source: 'item_completed → CommandExecution' },
        { id: 'repair', label: 'Corriger la reprise de la dernière ligne', name: 'FileChange', detail: 'Correction · daemon/history.ts', command: 'packages/ledge/src/daemon/history.ts', result: '+ if (!line.endsWith("\\n")) {\n+   pending = line;\n+   return;\n+ }\n\nModification appliquée.', status: 'success', duration: null, exit: null, nativeId: 'patch_017', source: 'item_completed → FileChange' },
        { id: 'retry', label: 'Reprendre la vérification après correction', name: 'CommandExecution', detail: 'Commande · reprise du dernier événement', command: 'pnpm --filter @paradow/ledge test -- history', result: 'Exécution en cours. Aucun résultat final reçu.', completedResult: 'PASS  history\n\n✓ conserve les événements après fermeture\n✓ reprend après un redémarrage\n✓ ignore un événement déjà importé\n\n12 passed · 0 failed', status: 'running', duration: null, exit: null, nativeId: 'cmd_018', source: 'Événement de début → CommandExecution' }
      ],
      files: [
        { path: 'daemon/history.ts', label: 'Ajout confirmé', description: 'Écriture et lecture paginée des événements.', diff: '+ export async function append(sessionId, event) {\n+   await database.insert({ sessionId, ...event });\n+ }', added: 42, removed: 0 },
        { path: 'daemon/store.ts', label: 'Modification confirmée', description: 'Conservation d’un événement avant la mise à jour de l’état.', diff: '  async apply(id, event) {\n+   await history.append(id, event);\n    const next = reduce(current, event);\n  }', added: 8, removed: 2 },
        { path: 'protocol/messages.ts', label: 'Modification confirmée', description: 'Requête de lecture de l’historique.', diff: '+ { type: "session.history", id, cursor }', added: 12, removed: 1 }
      ],
      helpers: [
        { name: 'Iris', after: 'patch', task: 'Vérifier la persistance', result: 'Les événements restent accessibles après la fermeture de la session. L’historique d’une session retirée du store se relit intégralement, dans l’ordre d’écriture.', time: '38 s', id: 'agent_iris', state: 'idle', input: '6 120', output: '410', tools: [
          { id: 'iris-cx-read', label: 'Lire la persistance', name: 'CommandExecution', detail: 'Iris · daemon/history.ts', command: 'sed -n \'1,80p\' packages/ledge/src/daemon/history.ts', result: 'export async function append(sessionId, event) {\n  await database.insert({ sessionId, ...event });\n}\n\nexport async function list(sessionId, cursor) {\n  return database.select().where({ sessionId }).after(cursor);\n}', status: 'success', duration: '0,08 s', exit: '0', nativeId: 'cmd_iris_01', source: 'SubAgentActivity → transcript de l’agent → CommandExecution' },
          { id: 'iris-cx-test', label: 'Fermer une session de test et relire son historique', name: 'CommandExecution', detail: 'Iris · vérification de la persistance', command: 'pnpm --filter @paradow/ledge test -- history.persist', result: 'PASS  history.persist\n\n✓ conserve les événements après la fermeture\n✓ relit l’historique d’une session retirée du store\n✓ garde l’ordre d’écriture', status: 'success', duration: '1,32 s', exit: '0', nativeId: 'cmd_iris_02', source: 'SubAgentActivity → transcript de l’agent → CommandExecution' }
        ] },
        { name: 'Milo', after: 'patch', task: 'Vérifier la reprise', result: 'Dernière ligne incomplète repérée : le lecteur analyse chaque ligne du bloc lu, y compris la dernière quand elle n’est pas terminée. Correction proposée : garder cette ligne en attente jusqu’au prochain saut de ligne. Transmise à Nova.', time: '51 s', id: 'agent_milo', state: 'idle', input: '7 480', output: '560', tools: [
          { id: 'milo-cx-read', label: 'Lire le lecteur JSONL', name: 'CommandExecution', detail: 'Milo · daemon/reader.ts', command: 'sed -n \'40,90p\' packages/ledge/src/daemon/reader.ts', result: 'const chunk = await read(fd, position);\nposition += chunk.length;\nfor (const line of chunk.split(\'\\n\')) {\n  if (line) events.push(JSON.parse(line));\n}', status: 'success', duration: '0,07 s', exit: '0', nativeId: 'cmd_milo_01', source: 'SubAgentActivity → transcript de l’agent → CommandExecution' },
          { id: 'milo-cx-repro', label: 'Reproduire un redémarrage sur une ligne coupée', name: 'CommandExecution', detail: 'Milo · reprise après redémarrage', command: 'node scripts/replay.mjs --truncate-last-line fixtures/session.jsonl', result: 'SyntaxError: Unexpected end of JSON input\n    at parse (packages/ledge/src/daemon/reader.ts:61)\n\n11 événements lus sur 12 attendus', status: 'failed', duration: '0,41 s', exit: '1', nativeId: 'cmd_milo_02', source: 'SubAgentActivity → transcript de l’agent → CommandExecution' }
        ] }
      ],
      coverage: [['Messages', 'Disponibles'], ['Actions et résultats', 'Disponibles'], ['Durées', 'Selon l’action'], ['Sous-agents', 'Disponibles'], ['Usage en tokens', 'Disponible']],
      coverageNote: 'Exemple fondé sur les types observés dans les transcripts locaux. Les appels et événements décrivant la même action doivent être dédupliqués.'
    },
    claude: {
      name: 'Otto', provider: 'Claude Code', topic: 'Préparer la migration de l’historique', branch: 'feat/history-migration',
      label: 'Sous-agents et autorisation', state: 'waiting_permission', stateLabel: 'Votre accord', turn: '02', time: '14:38', elapsed: '1 min 06',
      input: '12 860', output: '940', source: 'Hooks Claude + transcript JSONL',
      question: 'Prépare la migration SQLite pour les événements des sessions et vérifie qu’elle s’applique sur une base vide.',
      message: 'Iris a confirmé la structure existante. Milo vérifie encore la migration. Je souhaite l’appliquer sur la base de développement pour vérifier sa création.',
      previous: 'La base locale contiendra les sessions, les tours et les événements. Le fichier de migration est prêt à être ajouté.',
      tools: [
        { id: 'schema', label: 'Lire le schéma existant', name: 'Read', detail: 'Lecture · migrations/001-initial.sql', command: '{ "file_path": "migrations/001-initial.sql" }', result: 'CREATE TABLE sessions (\n  id TEXT PRIMARY KEY,\n  started_at TEXT NOT NULL\n);', status: 'success', duration: null, exit: null, nativeId: 'toolu_read_01', source: 'tool_use + tool_result' },
        { id: 'migration', label: 'Écrire la migration', name: 'Write', detail: 'Écriture · migrations/002-events.sql', command: '{ "file_path": "migrations/002-events.sql" }', result: 'Fichier créé : migrations/002-events.sql', status: 'success', duration: null, exit: null, nativeId: 'toolu_write_02', source: 'tool_use + tool_result' }
      ],
      permission: { id: 'permission_03', command: 'pnpm db:migrate --env development', reason: 'Cette commande créera les tables de l’historique dans la base de développement.' },
      files: [{ path: 'migrations/002-events.sql', label: 'Création confirmée', description: 'Fichier écrit. La migration n’a pas encore été exécutée.', diff: '+ CREATE TABLE events (\n+   id TEXT PRIMARY KEY,\n+   session_id TEXT NOT NULL,\n+   payload TEXT NOT NULL\n+ );', added: 5, removed: 0 }],
      helpers: [
        { name: 'Iris', kind: 'Explore', after: null, task: 'Repérer la structure de la base', result: 'La table sessions existe, avec une clé primaire id de type TEXT. Aucune table ni colonne ne stocke les événements. La migration peut référencer sessions.id, mais le poller supprime la ligne sessions dix minutes après la sortie : les événements doivent survivre à cette suppression, sans clé étrangère en cascade.', time: '24 s', id: 'agent_iris_claude', state: 'idle', input: '2 840', output: '320', actions: ['Read · migrations/001-initial.sql', 'Grep · accès à la table sessions'], tools: [
          { id: 'iris-read', label: 'Lire le schéma initial', name: 'Read', detail: 'Iris · migrations/001-initial.sql', command: '{ "file_path": "migrations/001-initial.sql" }', result: 'CREATE TABLE sessions (\n  id TEXT PRIMARY KEY,\n  tool TEXT NOT NULL,\n  cwd TEXT NOT NULL,\n  started_at TEXT NOT NULL\n);', status: 'success', duration: null, exit: null, nativeId: 'toolu_iris_read', source: 'Transcript du sous-agent → tool_use + tool_result' },
          { id: 'iris-events', label: 'Chercher un stockage d’événements existant', name: 'Grep', detail: 'Iris · migrations/', command: '{ "pattern": "events|payload", "path": "migrations" }', result: 'Aucune correspondance.', status: 'success', duration: null, exit: null, nativeId: 'toolu_iris_events', source: 'Transcript du sous-agent → tool_use + tool_result' },
          { id: 'iris-grep', label: 'Repérer les accès aux sessions', name: 'Grep', detail: 'Iris · daemon/', command: '{ "pattern": "sessions", "path": "packages/ledge/src/daemon" }', result: 'store.ts:42  database.select().from(sessions)\nstore.ts:68  database.insert(sessions)\npoller.ts:117  store.remove(s.id)  // la ligne sessions disparaît dix minutes après la sortie', status: 'success', duration: null, exit: null, nativeId: 'toolu_iris_grep', source: 'Transcript du sous-agent → tool_use + tool_result' }
        ] },
        { name: 'Milo', kind: 'general-purpose', after: 'migration', task: 'Vérifier la migration SQLite', result: null, time: null, id: 'agent_milo_claude', state: 'working', input: null, output: null, actions: ['Read · migrations/002-events.sql', 'Bash · vérification sur une base en mémoire'], tools: [
          { id: 'milo-read', label: 'Relire la migration', name: 'Read', detail: 'Milo · migrations/002-events.sql', command: '{ "file_path": "migrations/002-events.sql" }', result: 'CREATE TABLE events (\n  id TEXT PRIMARY KEY,\n  session_id TEXT NOT NULL,\n  payload TEXT NOT NULL\n);', status: 'success', duration: null, exit: null, nativeId: 'toolu_milo_read', source: 'Transcript du sous-agent → tool_use + tool_result' },
          { id: 'milo-check', label: 'Valider le schéma en mémoire', name: 'Bash', detail: 'Milo · vérification isolée', command: 'sqlite3 :memory: < migrations/002-events.sql', result: 'Exécution en cours. Aucun résultat final reçu.', status: 'running', duration: null, exit: null, nativeId: 'toolu_milo_bash', source: 'PreToolUse → agent_id + tool_use_id' }
        ] }
      ], coverage: [['Messages', 'Disponibles'], ['Actions et résultats', 'Disponibles'], ['Sous-agents et leurs outils', 'Disponibles'], ['Permissions', 'Événement disponible'], ['Durées', 'Selon les événements'], ['Usage en tokens', 'Selon le transcript']],
      coverageNote: 'SubagentStart / SubagentStop identifient les sous-agents. Leurs transcripts contiennent messages, appels et résultats. Les durées sont calculées si les deux bornes sont connues. La réponse native aux permissions reste à raccorder.'
    },
    cursor: {
      name: 'Pim', provider: 'Cursor', topic: 'Explorer le lecteur de conversations', branch: 'feat/conversation-reader',
      label: 'Une collecte partielle, explicite', state: 'idle', stateLabel: 'Tour terminé', turn: '01', time: null, elapsed: null,
      input: null, output: null, source: 'Transcript Cursor JSONL',
      question: 'Repère où afficher les messages et les outils dans la vue de session.',
      message: 'Je consulte la vue de session et les composants de réponse pour identifier les points de raccordement.',
      tools: [
        { id: 'cursor-read', label: 'Consulter la vue de session', name: 'Read', detail: 'Appel enregistré · résultat indisponible', command: '{ "path": "apps/overlay/src/surface/SessionView.tsx" }', result: null, status: 'unknown', duration: null, exit: null, nativeId: null, source: 'message.content → tool_use' },
        { id: 'cursor-grep', label: 'Chercher les composants de réponse', name: 'Grep', detail: 'Appel enregistré · résultat indisponible', command: '{ "pattern": "ReplyCard|lastReply", "path": "apps/overlay/src" }', result: null, status: 'unknown', duration: null, exit: null, nativeId: null, source: 'message.content → tool_use' },
        { id: 'cursor-write', label: 'Proposer un composant de conversation', name: 'Write', detail: 'Écriture demandée · résultat indisponible', command: '{ "path": "apps/overlay/src/surface/Conversation.tsx" }', result: null, status: 'unknown', duration: null, exit: null, nativeId: null, source: 'message.content → tool_use' }
      ],
      final: 'Je propose de raccorder la chronologie dans SessionView et d’isoler le rendu des actions dans un composant Conversation.',
      finalCard: { title: 'Raccorder la chronologie dans la vue de session', lead: 'La vue de session a un seul point d’entrée pour le contenu. J’y raccorderais la chronologie et j’isolerais le rendu des actions dans un composant dédié.',
        did: [{ text: 'Repéré le point d’entrée de la vue de session', file: 'surface/SessionView.tsx' }, { text: 'Proposé un composant de conversation', file: 'surface/Conversation.tsx', unconfirmed: true }],
        ask: 'La conversation doit-elle remplacer l’aperçu du terminal, ou s’afficher à côté ?',
        options: ['Remplacer l’aperçu du terminal', 'L’afficher à côté de l’aperçu'] },
      files: [{ path: 'surface/SessionView.tsx', label: 'Lecture demandée', description: 'Le chemin figure dans l’appel. Son résultat n’est pas fourni.', diff: null }, { path: 'surface/Conversation.tsx', label: 'Écriture non confirmée', description: 'Un appel Write est enregistré. Aucun résultat ne confirme que le fichier a été créé.', diff: null }],
      helpers: [], coverage: [['Messages', 'Disponibles'], ['Noms et paramètres', 'Disponibles'], ['Résultats et durées', 'Indisponibles'], ['Horodatages', 'Indisponibles'], ['Usage en tokens', 'Indisponible']],
      coverageNote: 'Ce scénario reproduit les limites du transcript local examiné. Des hooks peuvent compléter les prochaines actions. Une absence de résultat ne permet pas de conclure à une réussite.'
    }
  };

// Fictional transcript excerpts, shown in chronological order in each agent's own view.
const S = window.LedgeNativeScenarios;
const helper = (provider, name) => S[provider].helpers.find(h => h.name === name);

helper('claude', 'Iris').discussion = [
  { role: 'parent', text: 'Repère la structure de la base et les accès à la table sessions. Indique comment rattacher les événements à une session, sans modifier les fichiers.' },
  { role: 'assistant', text: 'Je commence par le schéma initial, puis je cherche où le daemon lit et écrit la table sessions.' },
  { tool: 'iris-read' },
  { role: 'assistant', text: 'La table sessions a une clé primaire id de type TEXT. Je vérifie qu’aucun stockage d’événements n’existe déjà.' },
  { tool: 'iris-events' },
  { role: 'assistant', text: 'Rien dans les migrations. Je regarde maintenant qui touche à cette table dans le daemon.' },
  { tool: 'iris-grep' },
  { role: 'report', text: helper('claude', 'Iris').result }
];
helper('claude', 'Milo').discussion = [
  { role: 'parent', text: 'Relis la migration des événements et vérifie sa syntaxe sur une base SQLite en mémoire. Ne touche pas à la base de développement.' },
  { role: 'assistant', text: 'Je relis la migration avant de la tester.' },
  { tool: 'milo-read' },
  { role: 'assistant', text: 'Le schéma référence sessions.id sans contrainte de clé étrangère. Je vérifie d’abord qu’il s’applique tel quel ; je signalerai ensuite cette absence dans mon rapport.' },
  { tool: 'milo-check' },
  { role: 'waiting', text: 'Milo travaille encore. Son rapport arrivera à la fin de sa tâche.' }
];
helper('codex', 'Iris').discussion = [
  { role: 'parent', text: 'Vérifie que les événements restent accessibles après la fermeture de la session. Lis la persistance et exécute sa vérification.' },
  { role: 'assistant', text: 'Je lis la persistance, puis je ferme une session de test et je relis son historique.' },
  { tool: 'iris-cx-read' },
  { role: 'assistant', text: 'L’écriture passe par append, la lecture par list avec un curseur. Je vérifie qu’une session fermée, puis retirée du store, reste lisible.' },
  { tool: 'iris-cx-test' },
  { role: 'report', text: helper('codex', 'Iris').result }
];
helper('codex', 'Milo').discussion = [
  { role: 'parent', text: 'Vérifie la reprise de la lecture après un redémarrage, y compris lorsque la dernière ligne du transcript est incomplète.' },
  { role: 'assistant', text: 'Je regarde comment le lecteur reprend après un redémarrage, et ce qu’il fait d’une dernière ligne coupée.' },
  { tool: 'milo-cx-read' },
  { role: 'assistant', text: 'Le lecteur analyse chaque ligne du bloc lu, y compris la dernière, même sans saut de ligne final. Je reproduis le cas avec un transcript tronqué.' },
  { tool: 'milo-cx-repro' },
  { role: 'assistant', text: 'Le cas est reproduit : la ligne coupée fait échouer l’analyse et un événement manque. Je ne modifie pas le lecteur moi-même, je transmets la correction à Nova.' },
  { role: 'report', text: helper('codex', 'Milo').result }
];

// Structured form of each final report, for the card variant of the last reply.
helper('claude', 'Iris').reportCard = { title: 'La table sessions existe, rien ne stocke les événements', points: ['Clé primaire id de type TEXT, référençable par la migration', 'Aucune table ni colonne d’événements dans les migrations', 'Le poller supprime la ligne sessions dix minutes après la sortie'], note: 'Les événements doivent survivre à cette suppression : pas de clé étrangère en cascade.' };
helper('codex', 'Iris').reportCard = { title: 'Les événements restent accessibles après la fermeture', points: ['L’historique d’une session retirée du store se relit intégralement', 'L’ordre d’écriture est conservé'], note: null };
helper('codex', 'Milo').reportCard = { title: 'Dernière ligne incomplète : correction transmise à Nova', points: ['Le lecteur analyse chaque ligne du bloc lu, même sans saut de ligne final', 'Reproduit avec un transcript tronqué : un événement manque'], note: 'Correction proposée : garder la ligne en attente jusqu’au prochain saut de ligne.' };
