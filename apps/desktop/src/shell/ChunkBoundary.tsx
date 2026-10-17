import { Component, type ErrorInfo, type JSX, type ReactNode } from 'react';
import { useI18n } from '../i18n/lang';

/** The note in place of a part whose chunk did not load, in the manner of Pending. */
function ChunkFailed(): JSX.Element {
  const { t } = useI18n();
  return <section className="pending" role="alert"><p>{t.chunkFailed}</p></section>;
}

/** Around a lazy part of the app (the session page, the New session form, the project editor, the chat): a chunk that fails to
 *  load (missing after an update, a disk error) leaves a note there instead of unmounting the whole app; the error is logged.
 *  `around` puts the note in the part's own frame (the chat's column). */
export class ChunkBoundary extends Component<{ children: ReactNode; around?: (note: JSX.Element) => JSX.Element }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  override componentDidCatch(error: unknown, _info: ErrorInfo): void { console.error('Ledge: a part of the app could not load', error); }
  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return this.props.around ? this.props.around(<ChunkFailed />) : <ChunkFailed />;
  }
}
