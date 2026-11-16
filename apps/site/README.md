# @ledge/site

The marketing site of Ledge: one static page, in French at `/` and in English at `/en/`, built with Astro. It has no
framework at run time: the page is plain HTML and CSS, and four small TypeScript scripts set it in motion.

## Run and build

Node 24 and pnpm, from the repository root:

```sh
pnpm install
pnpm --filter @ledge/site dev        # http://localhost:4321/ and /en/
pnpm --filter @ledge/site build      # writes apps/site/dist/
pnpm --filter @ledge/site preview    # serves the build
pnpm --filter @ledge/site typecheck  # astro check
```

Astro sends anonymous usage data unless `ASTRO_TELEMETRY_DISABLED=1` is set.

## Deploy

The site is hosted on AWS Amplify Hosting, built from `amplify.yml` at the repository root. The Amplify app is a
monorepo app whose root is `apps/site` (`AMPLIFY_MONOREPO_APP_ROOT=apps/site`); set `SITE_URL` there to the public
origin (for example `https://main.<app-id>.amplifyapp.com`), so the canonical and Open Graph URLs are right.

## Where things live

- `src/config.ts`: what the owner fills in by hand, in one place: the site's public URL, the download, GitHub, guide and
  release-notes links (each still a `TODO`, `null` until known) and the version the footer shows. `pnpm version:set`
  does not stamp it.
- `src/i18n/fr.ts` and `src/i18n/en.ts`: every visible string, `alt` and `aria-label`. The French is the mockup's text,
  word for word; `en.ts` is typed against it, so a missing or extra key fails `typecheck`. `src/i18n/index.ts` lists the
  languages and holds `rich()`, which fills the `{name}` holes of a string with markup.
- `src/data/media.ts`: the one place that resolves a media file. For a language other than French it serves
  `public/media/<language>/<file>` when that file exists at build time, and `public/media/<file>` otherwise.
- `src/data/tui.ts` and `src/data/scene.ts`: the timing of the `ledge tui` player and of the two-terminal scene.
- `src/components/`: one component per section of the page, `HomePage.astro` puts them in order; `src/layouts/Base.astro`
  is the document (head, fonts, language alternates, Open Graph).
- `src/styles/tokens.css` (palette, type, radii, spacing) and `src/styles/site.css` (the page, section by section, then
  the breakpoints).
- `src/scripts/`: the showcase tabs, the TUI player, the scene and the videos (played only while on screen, never with
  reduced motion). The page reads whole without JavaScript.
- `mockup/`: the mockup the owner approved (`Main.dc.html`, with `assets.json` mapping its `/_blob/<id>` to the files
  of `public/media/`). It is the reference for the design and the French copy; the site does not load it.

## The media

Everything in `public/media/` is a real capture of the application, recorded in French against the fake daemons of the
test suites. English captures are still to be wired: put each one in `public/media/en/` under the same file name (and
the same pixel size) and the English page picks it up at the next build. The captions of the English `ledge tui` frames
are in `src/i18n/en.ts`.

`capture/` holds what recorded them. The specs are temporary guests of the applications' own test folders: a script
copies them in, runs them and removes them. Recordings land in `$SITE_CAPTURE_OUT` (default `/tmp/ledge-site-capture`),
never in the repository; copy the ones you keep into `public/media/`. `ffmpeg` must be at `/usr/bin/ffmpeg`.

| Media | How |
|---|---|
| `atelier.mp4`, `session.mp4` (and an earlier `chat.mp4`) | `capture/run-desktop.sh`: copies `zz-rec.ts` and `zz-video.spec.ts` into `apps/desktop/e2e`, writes `zz-daemon.ts` (the e2e fake daemon with its chat answer paced) and runs Playwright there |
| `chat.mp4` | `capture/run-chat.sh`: the same with `zz-chat-video.spec.ts` |
| `rig.mp4` | `capture/run-rig.sh`: the same with `zz-rig-video.spec.ts`, the fake daemon answering the OpenRig messages |
| `notch.mp4`, `notch-poster.png`, `notch60-*.png` | `capture/run-overlay.sh`: copies `zz-rec.ts` and `zz-notch-video.spec.ts` into `apps/overlay/e2e` (`zz-notch-video-058.spec.ts` is the older 0.58.0 story, kept for reference) |
| `phone.mp4`, `phone-*.png` | `zz-video60.spec.ts`, copied by hand into `apps/mobile/e2e` and run with `pnpm --filter @ledge/mobile exec playwright test e2e/zz-video60.spec.ts`; it writes the frames and a `frames.txt` list that `ffmpeg -f concat` assembles, and the stills in `mobile60/` |
| `desktop-*.png` | 2880×1800 stills of Ledge Desktop used as posters and showcase images. The spec that took them is not in `capture/`: each recording also writes its first frame as `<name>-poster.png`, but at the video's size, so retake these as Playwright screenshots at a device scale factor of 2 from the same stories |
| `mascot-*.png` | `bots2.mjs <out> <playwright-core path>`: screenshots of the mascots of `packages/ui/mascots-logos.html`, served on `http://127.0.0.1:5891`, on a transparent background |
| `tui-tui-sprite.png` | `site-tui-video.test.tsx.txt`, copied to `packages/ledge/test/site-tui-video.test.tsx` and run with vitest (`SHOT_DIR=<out>`): it plays the story in the real TUI through ink-testing-library and dumps one ANSI frame per step; `ansi2png.mjs <out> <playwright-core path> f01 … f13` turns each into a PNG and `sprite.mjs <out> <playwright-core path>` stacks them into the sprite |

`zz-rec.ts` is shared by the desktop and notch specs: a fake pointer, smooth mouse moves, and a recording made of a CDP
screencast whose frames ffmpeg assembles into an H.264 file at 30 frames per second. On a machine where headless
Chromium hangs on screenshots, run the chat and notch scripts with `ZZ_GPU_OFF=1` (the two specs that read it).
