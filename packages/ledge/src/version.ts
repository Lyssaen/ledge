declare const __LEDGE_VERSION__: string | undefined;
/** The package version, written in by tsup at build time; tests and `tsx` runs see the dev fallback. */
export const LEDGE_VERSION: string = typeof __LEDGE_VERSION__ === 'string' ? __LEDGE_VERSION__ : '0.0.0-dev';
