import { lazy, Suspense, type JSX } from 'react';
import { ChunkBoundary } from '../shell/ChunkBoundary';
import type { DockHostProps } from './DockHost';
import type { BottomPanelProps } from './BottomPanel';
import type { IdeFrameProps } from './IdeFrame';
import type { AtelierBarProps } from './AtelierBar';
import type { RigsViewProps } from './rigs/RigsView';
import type { RigViewProps } from './rig/RigView';
import type { OpenRigViewProps } from './openrig/OpenRigView';
import type { RigLaunchModalProps } from './launch-rig/RigLaunchModal';
import type { RigOutputEntry } from '../openrig/rigOutput';
import type { PrsViewProps } from '../forge/PrsView';
import type { PrPageProps } from '../forge/PrPage';

type IdeModule = typeof import('./IdeFrame');
let loaded: IdeModule | undefined;

/** Fetches the IDE shell's chunk (the frame, dockview and its CSS, ide.css): with the switch off it is never fetched. */
export function loadIde(): Promise<IdeModule> {
  return loaded ? Promise.resolve(loaded) : import('./IdeFrame').then(m => (loaded = m));
}

// A chunk already loaded is handed over synchronously: React.lazy then resolves within the same render, without suspending.
function fromChunk<K extends 'IdeFrame' | 'DockHost' | 'BottomPanel' | 'OutputView' | 'AtelierBar' | 'RigsView' | 'RigView' | 'RigLaunchModal' | 'OpenRigView' | 'PrsView' | 'PrPage' | 'PrsStatus' | 'PrTabLabel'>(key: K) {
  type Loaded = { default: IdeModule[K] };
  return lazy(() => (loaded
    ? { then: (ok: (m: Loaded) => void) => ok({ default: loaded![key] }) } as PromiseLike<Loaded> as Promise<Loaded>
    : loadIde().then(m => ({ default: m[key] }))));
}
const Frame = fromChunk('IdeFrame');
const Dock = fromChunk('DockHost');
const Bottom = fromChunk('BottomPanel');
const Output = fromChunk('OutputView');
const ABar = fromChunk('AtelierBar');
const Rigs = fromChunk('RigsView');
const RigTab = fromChunk('RigView');
const RigLaunch = fromChunk('RigLaunchModal');
const OpenRig = fromChunk('OpenRigView');
const Prs = fromChunk('PrsView');
const Pr = fromChunk('PrPage');
const PrsCount = fromChunk('PrsStatus');
const PrLabel = fromChunk('PrTabLabel');

/** The IDE shell, behind a sober wait (an empty window) the first time its chunk is fetched; a chunk that fails to load leaves a note (ChunkBoundary). */
export function IdePlace(props: IdeFrameProps): JSX.Element {
  return <ChunkBoundary><Suspense fallback={<div className="ide" aria-busy="true" />}><Frame {...props} /></Suspense></ChunkBoundary>;
}

/** The editing area, for IdePlace's `editor`: it renders inside the frame, so its chunk is already there. */
export function IdeDock(props: DockHostProps): JSX.Element {
  return <Dock {...props} />;
}

/** The bottom panel, for IdePlace's `bottom`: it renders inside the frame, so its chunk is already there. */
export function IdeBottom(props: BottomPanelProps): JSX.Element {
  return <Bottom {...props} />;
}

/** The bottom panel's Sortie, for IdeBottom's `output`. */
export function IdeOutput(props: { entries: readonly RigOutputEntry[] }): JSX.Element {
  return <Output {...props} />;
}

/** The Atelier tab's bar, above the atelier in its tab. */
export function IdeAtelierBar(props: AtelierBarProps): JSX.Element {
  return <ABar {...props} />;
}

/** The Rigs sidebar view, for IdePlace's `explorer`: it renders inside the frame, so its chunk (and ide-rigs.css) is already there. */
export function IdeRigs(props: RigsViewProps): JSX.Element {
  return <Rigs {...props} />;
}

/** The « Rig · name » tab's body: it renders inside the frame, so its chunk (and ide-rig.css) is already there. */
export function IdeRigView(props: RigViewProps): JSX.Element {
  return <RigTab {...props} />;
}

/** The « OpenRig · machine » tab's body: it renders inside the frame, so its chunk (and ide-openrig.css) is already there. */
export function IdeOpenRig(props: OpenRigViewProps): JSX.Element {
  return <OpenRig {...props} />;
}

/** The « Lancer un rig » modal's content (and ide-launch-rig.css): App.tsx draws it in a Modal, outside the frame, so its first
 *  render may still wait for the chunk (nothing shown meanwhile). */
export function IdeRigLaunch(props: RigLaunchModalProps): JSX.Element {
  return <ChunkBoundary><Suspense fallback={null}><RigLaunch {...props} /></Suspense></ChunkBoundary>;
}

/** Lot 8b: the « MR et PR » sidebar view, a request's tab, the status bar's count and a request tab's label. They render inside
 *  the frame, so its chunk (and forge.css) is already there. */
export function IdePrs(props: PrsViewProps): JSX.Element { return <Prs {...props} />; }
export function IdePr(props: PrPageProps): JSX.Element { return <Pr {...props} />; }
export function IdePrsStatus(props: { prs: PrsViewProps['prs']; onShow(): void }): JSX.Element { return <PrsCount {...props} />; }
export function IdePrTabLabel(props: { pr: PrPageProps['pr'] | undefined; title: string }): JSX.Element { return <PrLabel {...props} />; }
