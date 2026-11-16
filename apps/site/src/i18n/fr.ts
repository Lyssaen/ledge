// The French copy, word for word the text of the approved mockup (`mockup/Main.dc.html`).
// A `{name}` hole is filled by the component with a piece of markup (a command in `<code>`, a coloured word) or a value.
export const fr = {
  meta: {
    title: 'Ledge, l\'atelier de vos agents de code',
    description: 'Un atelier pour tous vos agents de code, sur votre PC et vos serveurs. Vous voyez ce que fait chacun, et vous répondez à ses demandes sans ouvrir son terminal.',
    imageAlt: 'L\'atelier de Ledge Desktop : les agents à leur table, par projet'
  },
  nav: {
    label: 'Navigation principale',
    inLedge: 'Dans Ledge',
    openrig: 'OpenRig',
    everywhere: 'Partout',
    install: 'Installer',
    language: 'Langue'
  },
  hero: {
    titleLines: ['Vos agents travaillent.', 'Ledge vous dit quand', 'c\'est à vous.'],
    lead: 'Un atelier pour tous vos agents de code, sur votre PC et vos serveurs. Vous voyez ce que fait chacun, et vous répondez à ses demandes sans ouvrir son terminal.',
    seeMore: 'Voir ce qu\'il fait',
    agentsLabel: 'Agents pris en charge',
    notchLabel: 'L\'encoche de Ledge : au repos elle montre l\'activité des agents, puis s\'étire en bulle quand Otto attend votre accord, et quand Ledge fait le point',
    desktopVideoLabel: 'L\'atelier de Ledge Desktop en vidéo : les agents travaillent, Otto demande un accord et passe au rouge, on l\'approuve dans À toi, il repart, puis il écrit à Nova et Bix termine',
    phoneVideoLabel: 'Ledge sur le téléphone, en vidéo : une question reçoit sa réponse, une commande est autorisée, puis les sessions et le point de Ledge où l\'on règle une demande sur place'
  },
  states: {
    label: 'Les états d\'un agent',
    title: 'Un coup d\'œil suffit : la lumière d\'un agent dit ce qu\'il attend.',
    approval: { title: 'Votre accord', text: 'Il veut lancer une commande ou appliquer un plan.' },
    question: { title: 'Une question', text: 'Il a besoin que vous choisissiez pour continuer.' },
    working: { title: 'Au travail', text: 'Il avance. Rien à faire, sinon suivre son fil.' },
    idle: { title: 'Disponible', text: 'Il a fini son tour et attend votre consigne.' }
  },
  showcase: {
    title: 'Une journée dans Ledge',
    tabsLabel: 'Moments de la journée',
    scrollHint: 'Faites glisser pour voir tout l\'écran.',
    decide: {
      tab: 'Décider',
      text: 'Le fil d’un agent avance sous vos yeux. Quand il demande un accord, autorisez, refusez, ou refusez en expliquant quoi faire à la place.',
      media: 'Une session en vidéo : le fil d\'Otto avance, la demande d\'accord arrive, on clique Autoriser, la commande tourne et les tests passent'
    },
    yourTurn: {
      tab: 'Tout ce qui vous attend',
      text: 'Une seule page pour tout ce qui attend votre décision : les demandes des sessions, les questions de vos équipes, les PR prêtes à fusionner.',
      media: 'La page À toi : demandes des sessions, questions des rigs, MR et PR à corriger ou fusionner, travaux terminés'
    },
    point: {
      tab: 'Le point de Ledge',
      text: 'Ledge prend la parole le premier : ce qui vous attend, ce qui est terminé, ce qui est en cours, vos rigs. Chaque ligne se règle sur place. Posez-lui aussi vos questions : il cite ses sources et propose l’action en carte.',
      media: 'Le point de Ledge en vidéo : Ledge poste de lui-même ce qui attend, ce qui est terminé, ce qui est en cours et les rigs, une décision est réglée sur place, puis une question tapée reçoit sa réponse avec une carte pour passer le relais de Nova'
    },
    launch: {
      tab: 'Lancer',
      text: 'Un premier message, puis l’agent, son modèle, le projet et la machine. La session rejoint sa table.',
      media: 'Nouvelle session : le projet, l\'agent, le modèle et le premier message'
    },
    review: {
      tab: 'Relire',
      text: 'Le fil d’un agent d’un côté, ses modifications de l’autre, fichier par fichier. Divisez l’écran comme dans un éditeur de code.',
      media: 'Le fil d\'Otto à gauche, ses modifications à droite avec le diff d\'un fichier'
    }
  },
  openrig: {
    title: 'Une équipe entière, avec OpenRig.',
    lead: 'OpenRig fait travailler plusieurs agents comme une équipe : un pilote, des développeurs, une revue. Ledge en est le poste de pilotage. Vous lancez l\'équipe, vous la voyez s\'organiser, et ses questions vous arrivent comme celles de n\'importe quel agent.',
    videoLabel: 'OpenRig dans Ledge Desktop, en vidéo : clic sur Lancer, choix de la spec equipe-produit, un siège ajouté, l\'équipe s\'assemble siège par siège dans la topologie, puis une question du pilote arrive dans À toi et reçoit sa réponse',
    phoneAlt: 'Le même rig sur le téléphone : ses cinq sièges, ses permissions, sa topologie et sa file',
    launch: { term: 'Lancer', text: 'Depuis une spec enregistrée, un rig arrêté, ou en décrivant le besoin : l\'operator propose l\'équipe.' },
    tune: { term: 'Régler', text: 'Le nombre de sièges par rôle, leur agent, leur modèle et leurs permissions, même quand le rig tourne.' },
    answer: { term: 'Répondre', text: 'Les décisions et les questions de l\'équipe arrivent dans « À toi », sur le PC comme sur le téléphone.' },
    control: { term: 'Garder la main', text: 'Chaque action affiche la commande {rig} qu\'elle lance. Un instantané permet de revenir en arrière.' },
    note: 'OpenRig s\'installe à part. Ledge le pilote, il ne le remplace pas.',
    link: 'Découvrir OpenRig'
  },
  talk: {
    title: 'Vos agents se parlent.',
    lead: 'Un agent en trouve un autre avec {who} et lui écrit avec {send}. Ledge remet le message au prochain moment libre du destinataire, sans l\'interrompre.',
    left: {
      testsPass: '● Les tests de l’overlay passent.',
      tellNova: '● Je préviens Nova, qui attend ça pour rebaser.',
      send: '● Bash(ledge send nova "Les tests passent, tu peux rebaser")',
      waiting: '  ⎿ En attente : Nova travaille.',
      delivered: '  ⎿ Remis à Nova.'
    },
    right: {
      fixing: '• Je corrige la reconnexion ssh du fleet.',
      running: '  ◦ pnpm vitest run fleet/reconnect',
      passed: '  ✓ 12 tests passent',
      fixed: '• Reconnexion corrigée.',
      message: '✉ Otto\nLes tests passent, tu peux rebaser',
      ack: '• Bien reçu. Je rebase sur main.'
    },
    captions: {
      apart: 'Otto et Nova travaillent chacun de leur côté.',
      writes: 'Otto écrit à Nova.',
      waits: 'Nova est occupée : le message attend.',
      turnEnds: 'Nova termine son tour.',
      delivers: 'Ledge remet le message à Nova.',
      carriesOn: 'Nova enchaîne.'
    },
    pause: 'Pause',
    play: 'Lecture',
    replay: 'Rejouer',
    legend: '{amber}, les commandes de Ledge.',
    legendAmber: 'En ambre'
  },
  also: {
    title: 'Et pendant ce temps, Ledge s\'occupe du reste.',
    archive: { term: 'Archiver, reprendre', text: 'Une session archivée reprend plus tard sur la même conversation, avec un autre modèle si vous voulez.' },
    handoff: { term: 'Le relais de contexte', text: 'Contexte presque plein ? La session rédige un brief, une neuve reprend là où elle s\'arrête.' },
    forge: { term: 'MR et PR', text: 'GitHub et GitLab : le pipeline, le job qui échoue, « demander à l\'agent de corriger », fusionner.' },
    servers: { term: 'Vos serveurs aussi', text: 'Jusqu\'à 20 machines Linux par leur alias SSH, sans ouvrir un seul port.' },
    quotas: { term: 'Les quotas', text: 'Les limites de vos comptes Claude Code, Codex et Cursor, avec une alerte avant le mur.' },
    notes: { term: 'Vos notes', text: 'Des notes Markdown que les agents lisent, et qu\'ils peuvent proposer de corriger.' },
    browser: { term: 'Le navigateur de l\'agent', text: 'Son écran en direct quand il pilote un navigateur. Vous regardez, Ledge ne touche à rien.' },
    terminals: { term: 'Des terminaux lisibles', text: 'Chaque commande de vos shells est marquée : réussie, échouée, sa durée, et un clic pour la relancer.' }
  },
  everywhere: {
    title: 'La demande arrive là où vous êtes.',
    terminal: {
      title: 'Dans un terminal',
      text: '{tui} ouvre le même Ledge dans un onglet WSL, sur un serveur en SSH ou dans un volet tmux. Une touche suffit pour répondre.',
      spriteAlt: 'Ledge dans un terminal, en treize images : la vue d\'ensemble avec deux demandes, « y » autorise Otto, un chiffre répond à la question de Luna, le terminal d\'Iris avance, son fil s\'ouvre, puis Demander à Ledge et Nouvelle session',
      play: 'Lire la démonstration',
      pause: 'Mettre la démonstration en pause',
      frames: {
        overview: 'Deux sessions vous attendent.',
        approve: '« y » autorise Otto : il repart au travail.',
        next: 'Tab passe à la suivante : Luna pose une question.',
        answer: 'Un chiffre répond. Plus personne n’attend.',
        down: '« j » descend sur Iris : son terminal en direct.',
        progress: 'Iris avance : elle corrige l’image d’en-tête.',
        green: 'Lighthouse repasse au vert.',
        thread: 'Entrée ouvre le fil de la session.',
        back: 'Retour à la vue d’ensemble.',
        ask: 'Demander à Ledge : une question sur toutes les sessions.',
        summary: 'Ledge lit les sessions et résume où en est chacune.',
        newSession: 'Nouvelle session : une consigne, un agent, un projet.',
        allWorking: 'Tout le monde travaille.'
      }
    },
    notch: {
      title: 'En haut de l\'écran',
      text: 'L\'encoche, sur Windows. Une demande d\'accord y arrive tout de suite, avec ses deux réponses. Le reste, Ledge le regroupe et vous le dit en une fois, sans une bulle par agent. Vous continuez à taper là où vous étiez.',
      videoLabel: 'L\'encoche en vidéo : une demande d\'accord arrive tout de suite et on clique Autoriser, puis Ledge annonce en une fois que Bix et Pim ont fini et qu\'une décision attend, puis la question urgente d\'un rig reçoit sa réponse sur place'
    },
    phone: {
      title: 'Dans la poche',
      text: 'Une application à poser sur l\'écran d\'accueil, chiffrée de bout en bout. Décidez, suivez une session, lancez-en une, fusionnez une PR, menez vos rigs. Ce qui engage demande Face ID ou votre empreinte.',
      sessionsAlt: 'L\'onglet Sessions : la liste par projet, les filtres et le bouton Nouvelle',
      videoLabel: 'L\'application en vidéo : À toi, Sessions, le fil d\'une session, puis le chat avec Ledge',
      forgeAlt: 'L\'onglet MR et PR : trois demandes ouvertes avec l\'état de leur pipeline'
    }
  },
  security: {
    title: 'Rien sans votre clic.',
    lead: 'Ledge propose, vous décidez. Et personne d\'autre ne peut décider à votre place.',
    readOnly: { term: 'L\'assistant lit, il n\'agit pas', text: 'Il tourne en lecture seule. Chaque action passe par une carte que vous confirmez.' },
    local: { term: 'Tout reste chez vous', text: 'Le démon n\'écoute que sur {ip}. Vos serveurs sont joints par votre SSH.' },
    relay: { term: 'Le relais ne lit rien', text: 'Entre le PC et le téléphone ne passent que des messages chiffrés. Vous pouvez héberger le relais.' },
    pairing: { term: 'Un code à comparer', text: 'Un appareil n\'accède à rien avant que vous ayez vérifié le même code à six chiffres sur les deux écrans.' },
    hooks: { term: 'Vos agents restent libres', text: 'Ledge s\'ajoute à leurs hooks et rend toujours la main. Sans lui, vos sessions continuent comme avant.' }
  },
  install: {
    title: 'Installez-vous.',
    requirements: 'Il vous faut Windows 10 ou 11 avec WSL2, Node 22.13 ou plus récent, Git et tmux, et au moins un agent déjà installé.',
    daemon: { title: 'Le démon, dans WSL', text: 'Branche vos agents et démarre le service.' },
    desktop: { title: 'Ledge Desktop, sur Windows', download: 'Télécharger pour Windows', text: 'L\'encoche et la fenêtre, une seule application.' },
    session: { title: 'Votre première session', text: 'Ou « Nouvelle session » dans Ledge Desktop.' },
    notes: {
      platforms: 'Ledge Desktop et l\'encoche sont pour Windows. Le démon tourne sous Linux : WSL2 ou un serveur.',
      readOnly: 'Une session lancée sans Ledge reste visible, en lecture seule.',
      phone: 'Le téléphone agit sur le PC auquel il est lié, pas sur vos autres machines.',
      relay: 'Le relais hébergé est sur invitation. Vous pouvez héberger le vôtre.'
    }
  },
  footer: {
    tagline: 'Ledge {version}. Une nouvelle façon de travailler avec vos agents.',
    tour: 'Visite guidée',
    news: 'Nouveautés',
    github: 'GitHub'
  }
};

/** The shape every language follows: the same keys as the French copy, each a string (or a list of strings). */
export type Catalogue = typeof fr;
