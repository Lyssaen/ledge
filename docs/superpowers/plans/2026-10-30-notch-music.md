# La musique dans l'encoche — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** montrer la pochette du morceau en cours (tout lecteur Windows) dans l'encoche fermée, avec précédent / lecture-pause / suivant au survol, réglable dans Réglages › Encoche.

**Architecture :** le processus Rust de Ledge Desktop lit la session média courante de Windows (GSMTC) toutes les secondes tant que l'encoche le demande, et diffuse un `NowPlaying` aux webviews (événement `ledge://media`). Le réglage `music` vit dans `IslandPrefs` (daemon → Desktop et encoche). L'encoche décide quand montrer la pochette (`musicShown`) et la dessine avec `MusicSlot`. La partie 1 (tâches 1 à 6) ne touche pas `Handle.tsx` ; la partie 2 (tâches 7 et 8) place `MusicSlot` dans l'encoche après la tâche 13 du lot 4 de Plume.

**Tech Stack :** Rust (Tauri 2, crate `windows` 0.58, `base64`), TypeScript, React 19, zod, vitest + Testing Library, playwright.

**Spec :** `docs/superpowers/specs/2026-10-30-notch-music-design.md` · maquette `docs/mockups/ledge-notch-music.html`

**Branche :** `feat/notch-music` (worktree `.worktrees/notch-music-impl` depuis `origin/main`, après fusion de `docs/notch-music`). **Ne pas fusionner sur main avant la fin de la partie 2.**

## Global Constraints

- Tous les lecteurs que Windows connaît ; aucun code ni réglage propre à YouTube Music.
- Pas de « J'aime ». Aucune connexion à un compte.
- Réglage désactivé par défaut : `music: { enabled: false, hover: 'controls', paused: '5min' }`.
- Un `island.json` ou un cache `ledge.island` sans `music` se lit avec ces défauts, jamais comme invalide.
- Rust n'interroge Windows que si l'encoche a appelé `media_watch { on: true }` ; hors Windows tout est un no-op (`media_now` → `null`).
- Le délai « 5 min » vaut `300_000` ms.
- Si la place manque, le message de Ledge se coupe ; la pochette et ses commandes ont une largeur fixe.
- Libellés FR mot pour mot (spec §4) : « Musique », « Le morceau en cours sur ton PC, à droite de l'encoche. », « Afficher la musique en cours », « Pochette, puis précédent, lecture/pause et suivant au survol. Aucune connexion à ton compte. », « En pause », « Toujours », « 5 min », « Masquer », « Combien de temps la pochette reste visible après une pause. », « Au survol », « Commandes », « Commandes et titre », « Ce qui s'ajoute à la pochette. », « Détecté : {titre} · {artiste}, lu par {source} », « Rien ne joue en ce moment ». Encoche : « Précédent », « Pause », « Lecture », « Suivant ».
- Rust : build et tests seulement sous Windows (`C:\Users\Desan\Workspace\ledge` via `powershell.exe`, cf. recette Windows du projet).
- Commits terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Le lecteur se ferme pendant que les commandes sont ouvertes** (onglet fermé) : la pochette et les commandes disparaissent, rien ne reste ouvert ni « survolé ». Test tâche 3 (`a vanished session hides the slot`) et tâche 7 (e2e).
2. **Pas de vignette, ou une vignette énorme** (vidéo 4K, podcast sans image) : carré neutre avec une note ; au-delà de 512 Kio, Rust n'envoie pas de vignette. Tests tâche 2 (`cover_too_big_is_dropped`) et tâche 4 (`no cover shows the note`).
3. **Titre très long ou artiste vide** (une vidéo YouTube n'a souvent qu'un titre) : coupé avec « … », jamais « titre · » avec un point qui pend. Tests tâche 4 (`tooltip without artist`) et tâche 5 (`detected line without artist`).
4. **Pause puis reprise avant 5 min, ou pause qui dure** : la reprise remet le compteur à zéro ; à 300 000 ms pile la pochette part. Tests tâche 3.
5. **Clics rapides sur « Suivant », ou lecteur qui refuse** : `canNext` faux → bouton désactivé ; un échec de `media_control` est avalé sans toast ni exception. Tests tâche 3 (`a refused control is swallowed`) et tâche 4 (`disabled when canNext is false`).

---

## Partie 1 — maintenant, sans toucher `Handle.tsx`

### Task 1 : le réglage `music` et le type `NowPlaying`

**Files :**
- Modify : `packages/protocol/src/island.ts`
- Test : `packages/protocol/test/island.test.ts` (nouveau), `packages/ledge/test/island-file.test.ts` (nouveau)

**Interfaces :**
- Produces :
  - `MusicPrefsSchema` = `z.object({ enabled: z.boolean(), hover: z.enum(['controls', 'controls-title']), paused: z.enum(['always', '5min', 'hide']) })`, type `MusicPrefs`
  - `DEFAULT_MUSIC_PREFS: MusicPrefs = { enabled: false, hover: 'controls', paused: '5min' }`
  - `IslandPrefsSchema` gagne `music: MusicPrefsSchema.default(DEFAULT_MUSIC_PREFS)` ; `DEFAULT_ISLAND_PREFS.music = DEFAULT_MUSIC_PREFS`
  - `NowPlayingSchema` = `z.object({ title: z.string(), artist: z.string(), playing: z.boolean(), cover: z.string().nullable(), canPrev: z.boolean(), canNext: z.boolean(), source: z.string() })`, type `NowPlaying`
  - `MEDIA_EVENT = 'ledge://media'`, `type MediaAction = 'prev' | 'toggle' | 'next'`
  - `MUSIC_PAUSED_MS = 300_000`

- [ ] **Step 1 : tests en échec**

```ts
// packages/protocol/test/island.test.ts
test('an island file written before music reads with music off', () => {
  const { music: _, ...old } = DEFAULT_ISLAND_PREFS;
  expect(IslandPrefsSchema.parse(old).music).toEqual({ enabled: false, hover: 'controls', paused: '5min' });
});
test('music keeps what was set', () => {
  const music = { enabled: true, hover: 'controls-title', paused: 'always' } as const;
  expect(IslandPrefsSchema.parse({ ...DEFAULT_ISLAND_PREFS, music }).music).toEqual(music);
});
test('an unknown paused value is refused', () => {
  expect(IslandPrefsSchema.safeParse({ ...DEFAULT_ISLAND_PREFS, music: { ...DEFAULT_MUSIC_PREFS, paused: '10min' } }).success).toBe(false);
});
test('a NowPlaying without cover parses', () => {
  expect(NowPlayingSchema.parse({ title: 'Quai 9', artist: '', playing: false, cover: null, canPrev: true, canNext: false, source: 'Chrome' }).cover).toBeNull();
});

// packages/ledge/test/island-file.test.ts : readIsland sur un fichier temporaire sans `music` → music === DEFAULT_MUSIC_PREFS (pas null)
```

- [ ] **Step 2 :** `pnpm --filter @ledge/protocol test -- island` et `pnpm --filter @paradow/ledge test -- island-file` → FAIL.
- [ ] **Step 3 :** implémenter dans `packages/protocol/src/island.ts`, exporter depuis l'index du paquet comme les autres schémas.
- [ ] **Step 4 :** relancer → PASS ; `pnpm -r typecheck` passe : les objets `IslandPrefs` écrits à la main dans les tests et fixtures (`apps/desktop/e2e/daemon.ts`, `apps/overlay/e2e/fixtures.ts`…) partent de `DEFAULT_ISLAND_PREFS` ou reçoivent `music`.
- [ ] **Step 5 : commit** `feat(protocol): the notch's music setting and the now-playing payload`

### Task 2 : le lecteur Windows côté Rust

**Files :**
- Create : `apps/desktop/src-tauri/src/media.rs`
- Modify : `apps/desktop/src-tauri/src/main.rs` (mod, `.manage(media::MediaState::default())`, trois commandes dans `generate_handler!`), `apps/desktop/src-tauri/Cargo.toml`
- Test : `#[cfg(test)] mod tests` dans `media.rs`

**Interfaces :**
- Produces (Rust → TS) :
  - `#[derive(Serialize, Clone, PartialEq, Debug)] #[serde(rename_all = "camelCase")] pub struct NowPlaying { title, artist, playing, cover: Option<String>, can_prev, can_next, source }` — même forme que `NowPlayingSchema`.
  - `#[tauri::command] media_watch(app, state, on: bool)` : `on` démarre un fil qui relit la session courante toutes les **1 s** et émet `ledge://media` à **toutes** les fenêtres (`app.emit`) seulement quand la valeur change (`Option<NowPlaying>`, `null` = rien ne joue) ; `false` l'arrête et émet `null`. Idempotent.
  - `#[tauri::command] media_now(state) -> Option<NowPlaying>` : la dernière valeur connue.
  - `#[tauri::command] media_control(action: String) -> Result<(), String>` : `prev` | `toggle` | `next` sur la session courante (`TrySkipPreviousAsync`, `TryTogglePlayPauseAsync`, `TrySkipNextAsync`) ; action inconnue ou hors Windows → `Err`.
  - Fonctions pures testables partout : `source_name(aumid: &str) -> String`, `cover_data_url(mime: &str, bytes: &[u8]) -> Option<String>`.
- Cargo : `windows` gagne les features `Media_Control`, `Foundation`, `Storage_Streams` ; ajouter `base64 = "0.22"`.

- [ ] **Step 1 : tests en échec**

```rust
#[test] fn source_names_read_like_the_app() {
    assert_eq!(source_name("Chrome"), "Chrome");
    assert_eq!(source_name("MSEdge"), "Edge");
    assert_eq!(source_name("Spotify.exe"), "Spotify");
    assert_eq!(source_name("308046B0AF4A39CB"), "Firefox");
    assert_eq!(source_name("C:\\Program Files\\VideoLAN\\VLC\\vlc.exe"), "VLC");
    assert_eq!(source_name("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"), "Spotify");
    assert_eq!(source_name("foobar2000.exe"), "Foobar2000");
}
#[test] fn cover_becomes_a_data_url() {
    assert_eq!(cover_data_url("image/png", &[1, 2, 3]).as_deref(), Some("data:image/png;base64,AQID"));
    assert_eq!(cover_data_url("", &[1]).as_deref(), Some("data:image/jpeg;base64,AQ=="));
}
#[test] fn cover_too_big_is_dropped() { assert_eq!(cover_data_url("image/jpeg", &vec![0; 512 * 1024 + 1]), None); }
#[test] fn empty_cover_is_none() { assert_eq!(cover_data_url("image/png", &[]), None); }
```

`source_name` : partie après le dernier `\` puis avant `!` s'il y a un `!` … sauf si la partie après `!` est plus parlante (cas Spotify Store : prendre ce qui suit `!`) ; retirer `.exe` sans casse ; table : `chrome`→Chrome, `msedge`→Edge, `spotify`→Spotify, `308046b0af4a39cb`→Firefox, `firefox`→Firefox, `vlc`→VLC, `brave`→Brave, `opera`→Opera ; sinon première lettre en majuscule.

- [ ] **Step 2 :** sous Windows, `cargo test -p ledge-desktop media` → FAIL.
- [ ] **Step 3 :** implémenter. Lecture sous `cfg(windows)` : `GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.get()` une fois par fil ; à chaque tick `GetCurrentSession()` → `TryGetMediaPropertiesAsync` (titre, artiste), `GetPlaybackInfo` (`PlaybackStatus == Playing`, `Controls().IsPreviousEnabled/IsNextEnabled`), `SourceAppUserModelId`. La vignette (`Thumbnail().OpenReadAsync()` → `DataReader`, `ContentType()`) n'est relue que si titre ou artiste changent. Toute erreur WinRT d'un tick = `None` pour ce tick, jamais de panique. Hors Windows : `media_watch` ne lance rien.
- [ ] **Step 4 :** `cargo test` et `cargo clippy` sous Windows → PASS, sans nouveau warning.
- [ ] **Step 5 : commit** `feat(desktop): read and drive the current Windows media session`

### Task 3 : l'encoche suit le morceau

**Files :**
- Create : `apps/overlay/src/music/nowPlaying.ts` (logique pure + hook)
- Modify : `apps/overlay/src/tauri/bridge.ts`, `apps/overlay/src/App.tsx`
- Test : `apps/overlay/test/music.test.tsx`

**Interfaces :**
- Consumes : `MusicPrefs`, `NowPlaying`, `NowPlayingSchema`, `MEDIA_EVENT`, `MediaAction`, `MUSIC_PAUSED_MS` (tâche 1) ; commandes `media_watch`, `media_now`, `media_control` (tâche 2).
- Produces :
  - bridge : `onNowPlaying(fn: (now: NowPlaying | null) => void): () => void` (hors Tauri : `CustomEvent<NowPlaying | null>` `ledge:media` sur `window`, comme `ledge:foreground`) ; `mediaWatch(on: boolean): void` ; `mediaNow(): Promise<NowPlaying | null>` (hors Tauri : `null`) ; `mediaControl(action: MediaAction): Promise<void>` (n'échoue jamais). Payloads validés par `NowPlayingSchema.safeParse`, invalide → `null`.
  - `musicShown(o: { prefs: MusicPrefs; now: NowPlaying | null; pausedSince: number | null; at: number }): boolean`
  - `useNowPlaying(prefs: MusicPrefs, active: boolean): { now: NowPlaying | null; shown: boolean; control(a: MediaAction): void }` — appelle `mediaWatch(active && prefs.enabled)` à chaque changement et `mediaWatch(false)` au démontage ; lit `mediaNow()` au montage ; retient `pausedSince` (passe à `Date.now()` quand `playing` devient faux ou au premier `now` en pause, `null` quand ça rejoue ou quand `now` devient `null` ou change de titre) ; programme un seul minuteur pour l'instant où `shown` bascule.
  - `App.tsx` : `const music = useNowPlaying(applied.music, applied.visible)`. En partie 1, seul l'effet `mediaWatch` sert ; `music` n'est passé à personne (la tâche 7 le passera à `Surface`).

- [ ] **Step 1 : tests en échec** (`musicShown` sur des valeurs ; hook avec `vi.useFakeTimers()` et `ledge:media`)

```ts
const NOW = { title: 'Quai 9', artist: 'Mira Volant', playing: true, cover: null, canPrev: true, canNext: true, source: 'Chrome' };
const on = { enabled: true, hover: 'controls', paused: '5min' } as const;
test('off shows nothing', () => expect(musicShown({ prefs: { ...on, enabled: false }, now: NOW, pausedSince: null, at: 0 })).toBe(false));
test('nothing playing shows nothing', () => expect(musicShown({ prefs: on, now: null, pausedSince: null, at: 0 })).toBe(false));
test('playing shows', () => expect(musicShown({ prefs: on, now: NOW, pausedSince: null, at: 0 })).toBe(true));
test('paused 5min: shown until 300 000 ms, gone at 300 000', () => {
  const p = { ...NOW, playing: false };
  expect(musicShown({ prefs: on, now: p, pausedSince: 0, at: 299_999 })).toBe(true);
  expect(musicShown({ prefs: on, now: p, pausedSince: 0, at: 300_000 })).toBe(false);
});
test('paused always stays', () => expect(musicShown({ prefs: { ...on, paused: 'always' }, now: { ...NOW, playing: false }, pausedSince: 0, at: 9e9 })).toBe(true));
test('paused hide goes at once', () => expect(musicShown({ prefs: { ...on, paused: 'hide' }, now: { ...NOW, playing: false }, pausedSince: 0, at: 0 })).toBe(false));
// hook :
// 'resuming before 5 min resets the countdown' : pause à t=0, reprise à 4 min, pause à 5 min → encore visible à 9 min 59 s, parti à 10 min
// 'a vanished session hides the slot' : dispatch NOW puis null → shown false, now null
// 'watch follows the setting' : mediaWatch espionné → true quand enabled && active, false quand enabled passe à false, false au démontage
// 'a refused control is swallowed' : invoke rejette → control('next') ne lève rien, aucune erreur console
// 'an invalid payload counts as nothing playing' : dispatch { title: 1 } → now null
```

- [ ] **Step 2 :** `pnpm --filter overlay test -- music` → FAIL.
- [ ] **Step 3 :** implémenter (`listenHere` existant pour l'écoute Tauri ; `invoke` existant pour les commandes).
- [ ] **Step 4 :** relancer → PASS ; toute la suite overlay passe.
- [ ] **Step 5 : commit** `feat(overlay): follow the now-playing track and the music setting`

### Task 4 : `MusicSlot`, la pochette et ses commandes (pas encore placée)

**Files :**
- Create : `apps/overlay/src/surface/MusicSlot.tsx`
- Modify : `apps/overlay/src/surface/geometry.ts` (constantes), `apps/overlay/src/i18n/messages.ts` (`music` en FR et EN)
- Test : `apps/overlay/test/music-slot.test.tsx`

**Interfaces :**
- Consumes : `NowPlaying`, `MediaAction`, `MusicPrefs['hover']`.
- Produces :
  - `geometry.ts` : `export const MUSIC = { sepGap: 12, cover: 24, coverRadius: 5, coverGap: 6, ctl: 28, title: 150 } as const` et `musicWidth(o: { open: boolean; withTitle: boolean }): number` = séparateur + `sepGap` + `cover`, plus si `open` : `coverGap + 3 * ctl`, plus si `withTitle` : `title + coverGap`. Fermé : la largeur que la tâche 7 réserve ; ouvert : celle qu'elle ajoute.
  - `MusicSlot(p: { now: NowPlaying; hover: 'controls' | 'controls-title'; open: boolean; onOpen(): void; onClose(): void; onControl(a: MediaAction): void; reducedMotion?: boolean }): JSX.Element` — un séparateur vertical (`--sidebar-border`, 1 × 16 px), la pochette (`<button>` 24 px, `background-image` = `cover`, sinon carré `--sidebar-accent` avec une note SVG), les trois barres d'activité quand `playing` et pas `open` (sans animation sous `reducedMotion`), grisée + signe pause quand `!playing`. `open` : boutons Précédent / Lecture-Pause (disque clair) / Suivant ; `controls-title` ajoute titre (gras) et artiste sur deux lignes, coupés « … ». Survol ou focus de la pochette → `onOpen` ; quitter la zone → `onClose` après **250 ms** (annulé si on revient, ou si le focus reste dedans). `open` est piloté par le parent.
  - i18n `t.music = { prev: 'Précédent', play: 'Lecture', pause: 'Pause', next: 'Suivant', cover: (title, artist) => artist ? \`${title} · ${artist}\` : title }` (EN : Previous, Play, Pause, Next).

- [ ] **Step 1 : tests en échec**

```tsx
test('closed: the cover only, with the track as its tooltip', ...)            // 1 bouton, title="Quai 9 · Mira Volant", aucun « Suivant »
test('tooltip without artist', ...)                                             // title === 'Quai 9'
test('no cover shows the note', ...)                                            // pas de background-image, svg [data-music-note]
test('paused: greyed with the pause sign, no activity bars', ...)               // [data-paused], pas de [data-eq]
test('hovering the cover asks to open; leaving closes after 250 ms', ...)       // fake timers : onClose pas appelé à 249, appelé à 250
test('open: Previous, Pause, Next in order, and they act', ...)                 // clics → onControl('prev'|'toggle'|'next'); libellé « Lecture » quand !playing
test('disabled when canNext is false', ...)                                     // bouton Suivant disabled, clic → onControl non appelé
test('controls-title shows title and artist', ...)                              // texte visible seulement si hover === 'controls-title' && open
test('musicWidth', () => { expect(musicWidth({ open: false, withTitle: false })).toBe(37); expect(musicWidth({ open: true, withTitle: false })).toBe(37 + 6 + 84); expect(musicWidth({ open: true, withTitle: true })).toBe(37 + 6 + 84 + 156); });
```

- [ ] **Step 2 :** `pnpm --filter overlay test -- music-slot` → FAIL.
- [ ] **Step 3 :** implémenter, transitions via `transition()` de `motion.ts` comme le reste de l'encoche.
- [ ] **Step 4 :** relancer → PASS ; `i18nNotch.test.ts` passe (clés FR/EN symétriques).
- [ ] **Step 5 : commit** `feat(overlay): the music slot, cover and controls`

### Task 5 : la carte « Musique » dans Réglages › Encoche

**Files :**
- Create : `apps/desktop/src/settings/MusicCard.tsx`
- Modify : `apps/desktop/src/settings/Island.tsx` (rendre `<MusicCard>` après la carte « Ce que fait l'encoche »), `apps/desktop/src/tauri/bridge.ts`, `apps/desktop/src/i18n/fr.ts`, `apps/desktop/src/i18n/en.ts`
- Test : `apps/desktop/test/settings-island.test.tsx` (liste des libellés à mettre à jour + nouveaux cas)

**Interfaces :**
- Consumes : `IslandPrefs['music']`, `NowPlaying`, `MEDIA_EVENT` ; le `set(key, patch, what)` d'`Island.tsx` (le passer en prop).
- Produces :
  - bridge Desktop : `onNowPlaying(fn): () => void` (Tauri : `listen(MEDIA_EVENT)` ; navigateur : `CustomEvent` `ledge:media` sur `window`) et `mediaNow(): Promise<NowPlaying | null>`.
  - `MusicCard(p: { music: MusicPrefs; off: boolean; errorOf(key: string): string | null; set(key: string, patch: Partial<IslandPrefs>, what: string): void }): JSX.Element`
  - i18n `settings.island.music` : `title`, `hint`, `show`, `showHint`, `shownOn`, `shownOff`, `paused`, `pausedHint`, `pausedOptions { always, '5min', hide }`, `pausedSaved(label)`, `hover`, `hoverHint`, `hoverOptions { controls, 'controls-title' }`, `hoverSaved(label)`, `detected(title, artist, source)`, `nothing`, `windowsOnly`. FR = Global Constraints ; `detected` sans artiste → « Détecté : {titre}, lu par {source} ». `windowsOnly` : « La musique dans l'encoche ne marche que sous Windows. » (EN à l'avenant).
  - Clés d'erreur / `set` : `musicEnabled`, `musicPaused`, `musicHover` ; chaque `set` envoie `{ music: { ...p.music, <champ> } }`.

- [ ] **Step 1 : tests en échec** (faux daemon de `helpers`, comme les tests voisins)
  - la liste des `.set-label` se termine par `'Show the music playing', 'When paused', 'On hover'` (libellés EN, l'app de test est en anglais) ;
  - l'interrupteur envoie `island.set` avec `music.enabled: true` et l'avis « Setting saved · … » arrive après la confirmation ;
  - interrupteur coupé → les deux segmentés sont `disabled` ;
  - « When paused » → `5 min` coché par défaut ; choisir « Always » envoie `paused: 'always'` ;
  - `detected line` : `window.dispatchEvent(new CustomEvent('ledge:media', { detail: NOW }))` → « Detected: Quai 9 · Mira Volant, played by Chrome » ; `detected line without artist` → « Detected: Quai 9, played by Chrome » ; `null` → « Nothing is playing right now » ;
  - un daemon sans `music` dans ses réglages → la carte s'affiche avec les défauts (interrupteur coupé).
- [ ] **Step 2 :** `pnpm --filter desktop test -- settings-island` → FAIL.
- [ ] **Step 3 :** implémenter avec `Card`, `SwitchRow`, `Row`, `Segmented` de `controls.tsx`. La ligne de statut n'apparaît que quand l'interrupteur est actif ; hors Tauri et hors e2e elle dit `windowsOnly` seulement si `navigator.userAgent` ne contient pas `Windows` (à défaut : `nothing`).
- [ ] **Step 4 :** relancer → PASS ; `pnpm --filter desktop test` entier passe ; `apps/desktop/e2e/island.spec.ts` passe (`pnpm --filter desktop test:e2e -- island`).
- [ ] **Step 5 : commit** `feat(desktop): the Music card in Settings › Notch`

### Task 6 : essai réel de la partie 1 sous Windows

- [ ] **Step 1 :** `pnpm build`, `pnpm test` → tout passe dans WSL.
- [ ] **Step 2 :** sous Windows (recette du projet), `cargo test`, `cargo clippy`, build de l'installateur de dev.
- [ ] **Step 3 (avec l'accord de l'utilisateur) :** lancer cette build ; activer « Afficher la musique en cours » ; lancer YouTube Music dans Chrome → la carte dit « Détecté : … lu par Chrome » ; mettre en pause → toujours détecté ; fermer l'onglet → « Rien ne joue en ce moment » ; essayer Spotify ou VLC si installé. Noter ce qui ne marche pas.
- [ ] **Step 4 :** rebase `feat/notch-music` sur `origin/main` si main a bougé ; push de la branche, **sans PR ni fusion**.

---

## Partie 2 — après la tâche 13 du lot 4 de Plume

**Préalable :** la tâche 13 (« l'encoche fermée, Ledge seul ») est sur main. Relire ce qu'elle a livré dans `Handle.tsx`, `geometry.ts`, `Surface.tsx` ; envoyer à Plume : « Otto va toucher Handle.tsx (place de la musique) ». Si la forme livrée contredit une décision ci-dessous, s'arrêter et demander à l'utilisateur.

### Task 7 : la musique dans l'encoche fermée

**Files :**
- Modify : `apps/overlay/src/surface/Handle.tsx`, `apps/overlay/src/surface/Surface.tsx`, `apps/overlay/src/surface/geometry.ts`, `apps/overlay/src/App.tsx` (passer `music` à `Surface`)
- Test : `apps/overlay/test/handle.test.tsx`, `apps/overlay/test/geometry.test.ts`, `apps/overlay/e2e/handle.spec.ts`

**Interfaces :**
- Consumes : `useNowPlaying` (tâche 3), `MusicSlot`, `MUSIC`, `musicWidth` (tâche 4).
- Produces : `HandleProps.music?: { now: NowPlaying; hover: MusicPrefs['hover']; open: boolean; onOpen(): void; onClose(): void; onControl(a: MediaAction): void }`, présent seulement quand `shown`. `Surface` tient l'état `musicOpen`.

Règles (spec §5) :
- `MusicSlot` se place à droite du message (ou de Ledge sans message), **au repos comme éveillée**. Si le repos de Plume est le filet de 10 px : avec de la musique visible, le repos devient la pastille de hauteur `ISLAND.h` avec Ledge et la pochette seulement ; sans musique, le filet ne change pas.
- La strip discrète (sous une fenêtre maximisée) ne montre pas la musique.
- Largeur : celle de Plume + `musicWidth({ open, withTitle: hover === 'controls-title' })` ; le message se coupe d'abord (`min-width: 0`, ellipsis), la musique jamais.
- Le cadre (`set_frame`), les épaules et la hot zone (`set_hot_zone`) prennent la largeur avec la musique, ouverte ou non.
- Survoler le reste de l'encoche garde son comportement ; survoler la pochette n'ouvre pas la liste des sessions.

- [ ] **Step 1 : tests en échec**
  - `handle.test.tsx` : avec `music` → séparateur et pochette après le message ; sans → rendu identique à aujourd'hui (snapshot des enfants) ; strip → pas de pochette ; au repos avec musique → pochette visible sans `awake` ;
  - `geometry.test.ts` : la largeur de l'encoche avec musique fermée = sans musique + `musicWidth({ open: false, withTitle: false })` ; ouverte « controls-title » = + `musicWidth({ open: true, withTitle: true })` ; la hot zone couvre cette largeur ;
  - `handle.spec.ts` (playwright, `ledge:media`) : la pochette apparaît ; survol → trois boutons, l'encoche s'élargit vers la droite ; `null` pendant que c'est ouvert → tout disparaît et la hot zone revient à la largeur d'avant ; message long → coupé, pochette entière.
- [ ] **Step 2 :** `pnpm --filter overlay test -- handle geometry` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** relancer → PASS ; suite overlay et `pnpm --filter overlay test:e2e` passent.
- [ ] **Step 5 : commit** `feat(overlay): the now-playing cover in the closed notch`

### Task 8 : essai réel complet, puis fusion

- [ ] **Step 1 :** `pnpm build && pnpm test` ; e2e Desktop et encoche.
- [ ] **Step 2 (avec l'accord de l'utilisateur) :** build Windows ; YouTube Music dans Chrome : pochette au repos, survol, Précédent / Pause / Suivant agissent sur l'onglet, pause → pochette grisée puis partie après 5 min, fermeture de l'onglet → disparition ; même chose avec un autre lecteur ; « Commandes et titre » ; réglage coupé → l'encoche d'avant.
- [ ] **Step 3 :** revue de toute la branche, puis PR vers main (`feat/notch-music`) ; fusion et version seulement sur demande de l'utilisateur.
