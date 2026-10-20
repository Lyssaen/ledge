import { useId, useRef, type CSSProperties, type JSX } from 'react';
import type { Tool } from '@ledge/protocol';
import { MOTION, ms } from '../motion';
import { useDefaultMotionPreferences, useOsReducedMotion } from '../motionPreferences';
import { materialFor } from './material';
import { seedHash, type BotState } from './poseFor';
import { useBotMotion, useBotNod, BOT_MOTION, useBotVisibility } from './useBotMotion';
import { useUiCopy } from '../i18n/copy';

export interface BotProps {
  tool: Tool;
  state: BotState;
  pose: 1 | 2 | 3;
  size: number;
  /** The size the bot is drawn at on screen when a parent scales it; gates microgestures and sets hop height. Defaults to `size`. */
  shownSize?: number;
  theme: 'dark' | 'light';
  /** Stable session ID, or `parent.id + ':' + helper.id` for a helper; never the display name. */
  seed: string;
  readOnly?: boolean;
  /** Connection lost / stale: keep the known expression, freeze motion, lower opacity. */
  frozen?: boolean;
  /** Effective app preference; defaults to the app's registered store. The OS preference always wins. */
  reducedMotion?: boolean;
  /** Inactive layer / paused view: freeze every animation in place without the frozen styling. */
  paused?: boolean;
  /** Identity of the current approval request (e.g. its pending ID); a new value in approval plays the hand gesture once, even on mount. */
  askKey?: string;
  /** Increment to play one 650 ms nod acknowledging a received decision. */
  nodKey?: number;
  className?: string;
}

const TOOL_NAMES: Record<Tool, string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent', omp: 'omp' };

type Eyes = 'open' | 'wide' | 'happy' | 'error' | 'sleep';
interface Expression { eyes: Eyes; eye: string; tilt?: readonly [number, number, number]; lift?: number }

/** Approved expressions (spec section 6, mascot.css); tilt variants come from the reference controller. */
const EXPRESSIONS: Record<BotState, Expression> = {
  starting: { eyes: 'open', eye: 'starting' },
  working: { eyes: 'open', eye: 'working' },
  approval: { eyes: 'open', eye: 'approval', tilt: [-4, 3, -2], lift: -1 },
  question: { eyes: 'wide', eye: 'question', tilt: [4, -3, 6] },
  idle: { eyes: 'happy', eye: 'idle' },
  error: { eyes: 'error', eye: 'error', tilt: [-7, -6, -5], lift: 2 },
  done: { eyes: 'sleep', eye: 'done' },
  readonly: { eyes: 'open', eye: 'done' }
};

const FULL_VIEWBOX = '0 0 96 96';
/** Head crop at ≤ 20 px, per silhouette: each shell fills the box so the eyes stay as large as they can. */
const HEAD_VIEWBOX: Record<Tool, string> = {
  claude: '10 18 76 64',
  codex: '5 7 87 82',
  cursor: '11 8 74 82',
  omp: '10 18 76 68'
};

const HEAD_WIDTH = Object.fromEntries(Object.entries(HEAD_VIEWBOX).map(([tool, box]) => [tool, Number(box.split(' ')[2])])) as Record<Tool, number>;

/**
 * Approved logo-inspired silhouettes (issue #61): Clawd's pixel body with its legs and arms for Claude Code, the Codex
 * cloud, a softened cube for Cursor, an asymmetric pi for omp. They are drawings of Ledge, not the harnesses' official logos.
 */
const SHELLS: Record<Tool, string> = {
  claude: 'M24 24H72Q75 24 75 27V43H82Q84 43 84 45V52Q84 54 82 54H75V62Q75 64 73 64H70V75Q70 77 68 77H66Q64 77 64 75V64H59V75Q59 77 57 77H55Q53 77 53 75V64H43V75Q43 77 41 77H39Q37 77 37 75V64H32V75Q32 77 30 77H28Q26 77 26 75V64H23Q21 64 21 62V54H14Q12 54 12 52V45Q12 43 14 43H21V27Q21 24 24 24Z',
  codex: 'M30 25C31 13 48 10 57 20C69 14 84 23 81 37C92 46 87 62 76 65C76 80 58 86 48 77C35 85 20 78 21 66C7 61 7 45 18 38C13 28 21 20 30 25Z',
  cursor: 'M43 13Q48 10 53 13L77 27Q82 30 82 36V64Q82 69 77 72L53 85Q48 88 43 85L19 72Q14 69 14 64V36Q14 30 19 27Z',
  omp: 'M17 22H79Q83 22 83 26V48Q83 52 79 52H71V79Q71 83 67 83H58Q54 83 54 79V52H41V67Q41 71 37 71H28Q24 71 24 67V52H17Q13 52 13 48V26Q13 22 17 22Z'
};

/**
 * No visor: each logo carries its eyes on the shell itself, where its body has room for a face.
 * Cursor's look follows the cube's front face.
 */
const FACES: Record<Tool, string | undefined> = {
  claude: 'translate(0 -8)',
  codex: undefined,
  cursor: 'translate(31.5 58) skewY(27) scale(.86) translate(-48.5 -49)',
  omp: 'translate(0 -12)'
};

/** The eyes follow the pointer up to this many screen pixels beyond the bot's edges. */
const GAZE_REACH = 240;

/**
 * Session mascot: one persistent SVG whose layers (shell, pose, gaze, eyes, accessories) stay mounted
 * across theme and state changes; only attributes and CSS variables change. A halo in the state colour
 * (data-halo, drawn by bots.css) distinguishes live sessions at a glance.
 */
export function Bot({ tool, state, pose, size, shownSize, theme, seed, readOnly = false, frozen = false, paused = false, reducedMotion, askKey, nodKey, className }: BotProps): JSX.Element {
  const ref = useRef<SVGSVGElement>(null);
  const gradientId = `bot-shell-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const prefs = useDefaultMotionPreferences();
  const osReduced = useOsReducedMotion();
  const reduced = osReduced || (reducedMotion ?? prefs.reduced);
  const simplified = size <= 20;
  const expr = EXPRESSIONS[state];
  /** Halo in the state colour (bots.css): every live state; never a finished or read-only session. */
  const halo = !readOnly && state !== 'done' && state !== 'readonly';
  const t = useUiCopy();
  const h = seedHash(seed);
  // The working hop (spec §6): the only ambient motion kept at ≤ 20 px, so the handle shows progress. Height in screen px,
  // converted to SVG units so a 12 px bot lifts 2 px and a 48 px bot 5.8 px; period 3.6–4.4 s, offset per bot like breathing.
  const hop = state === 'working' && !reduced && !readOnly && !frozen && !paused;
  // A parent that scales the SVG (the handle's resting bots) passes the on-screen size, so the units match what is seen;
  // the units follow the viewBox width (the head crop's, or 96 for the full drawing).
  const shown = shownSize ?? size;
  const hopPx = Math.min(7, Math.max(2, shown * 0.12));
  const hopUnits = (hopPx / shown) * (simplified ? HEAD_WIDTH[tool] : 96);
  const hopCycle = 3600 + (h % 9) * 100;

  const detailed = !simplified && shown > 20;
  const motionEnabled = !reduced && !readOnly && state !== 'readonly' && !frozen && !paused;
  useBotVisibility(ref);
  useBotMotion(ref, { seed, state, askKey, nodKey, enabled: motionEnabled && detailed, gazeReach: GAZE_REACH });
  useBotNod(ref, nodKey, motionEnabled && detailed, state, askKey);

  const style = {
    '--bot-size': `${size}px`,
    '--bot-eye': `var(--bot-eye-${expr.eye})`,
    '--bot-tilt': `${expr.tilt?.[pose - 1] ?? 0}deg`,
    '--bot-lift': `${expr.lift ?? 0}px`,
    '--bot-breath': ms(4800 + (h % 17) * 100),
    '--bot-phase': `-${ms((h % 43) * 100)}`,
    '--bot-hop': `${hopUnits.toFixed(2)}px`,
    '--bot-hop-cycle': ms(hopCycle),
    '--bot-ease': MOTION.grow.ease,
    '--bot-material-ms': ms(240),
    '--bot-eye-ms': ms(260),
    '--bot-pose-ms': ms(300),
    '--bot-gaze-ms': ms(450),
    '--bot-blink-ms': ms(BOT_MOTION.blinkMs),
    '--bot-ask-ms': ms(BOT_MOTION.askMs),
    '--bot-nod-ms': ms(BOT_MOTION.nodMs),
    '--bot-question-ms': ms(650),
    '--bot-arrival-ms': ms(BOT_MOTION.transitionMs),
    '--bot-entry-hop-ms': ms(BOT_MOTION.hopMs),
    '--bot-touch-ms': ms(BOT_MOTION.touchMs),
    '--bot-idle-ms': ms(BOT_MOTION.idleMs)
  } as CSSProperties;

  const label = `${TOOL_NAMES[tool]} · ${t.botLabel[state]}${readOnly && state !== 'readonly' ? ` · ${t.botReadOnly}` : ''}${frozen ? ` · ${t.botNotLive}` : ''}`;

  return (
    <svg
      ref={ref}
      className={className ? `bot ${className}` : 'bot'}
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={simplified ? HEAD_VIEWBOX[tool] : FULL_VIEWBOX}
      data-tool={tool}
      data-state={state}
      data-eyes={expr.eyes}
      data-pose={pose}
      data-material={materialFor(theme)}
      data-simplified={String(simplified)}
      data-detailed={String(detailed)}
      data-readonly={String(readOnly || state === 'readonly')}
      data-halo={String(halo)}
      data-frozen={String(frozen)}
      data-paused={String(paused)}
      data-reduced={String(reduced)}
      data-hop={String(hop)}
      style={style}
    >
      <defs>
        <linearGradient id={gradientId} x1=".1" y1="0" x2=".8" y2="1" gradientUnits="objectBoundingBox">
          <stop className="shell-top" />
          <stop className="shell-bottom" offset="1" />
        </linearGradient>
      </defs>
      <ellipse className="ground" cx="48" cy="90" rx="25" ry="3" />
      <g className="hop">
        <g className="body">
          <g className="arrival">
            <g className="signature">
              <g className="touch">
                <g className="pose">
                  <path className="shell" d={SHELLS[tool]} fill={`url(#${gradientId})`} />
                  {tool === 'cursor' && (
                    <g className="facets">
                      <path className="cube-top" d="M43 13Q48 10 53 13L77 27Q80 29 81 32L48 49L15 32Q16 29 19 27Z" />
                      <path className="cube-side" d="M48 49L81 32Q82 34 82 36V64Q82 69 77 72L53 85Q50 87 48 87Z" />
                      <path className="cube-edge" d="M17 32L48 49L79 32M48 49V83" />
                    </g>
                  )}
                  {tool === 'claude' && <path className="shine" d="M27 28H69" />}
                  <g transform={FACES[tool]}>
                    <g className="gaze">
                      <g className="eye-blink">
                        <g className="eye-open">
                          <rect x="36" y="43" width="6" height="12" rx={tool === 'claude' ? 0.6 : 3} />
                          <rect x="55" y="43" width="6" height="12" rx={tool === 'claude' ? 0.6 : 3} />
                        </g>
                        {detailed && (
                          <g className="eye-glint">
                            <rect x="37.5" y="44.5" width="2.4" height="2.4" rx={tool === 'claude' ? 0 : 1.2} />
                            <rect x="56.5" y="44.5" width="2.4" height="2.4" rx={tool === 'claude' ? 0 : 1.2} />
                          </g>
                        )}
                        <path className="eye-happy" d="M35 51Q39 43 43 51M54 51Q58 43 62 51" />
                        <path className="eye-error" d="m35 45 8 3m11 0 8-3M38 54h2m16 0h2" />
                        <path className="eye-sleep" d="M35 50q4 3 8 0m11 0q4 3 8 0" />
                      </g>
                    </g>
                  </g>
                  {tool === 'claude' ? <rect className="arm" x="75" y="56" width="8" height="12" rx="2" /> : <ellipse className="arm" cx="79" cy="63" rx="5" ry="8" />}
                </g>
              </g>
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}
