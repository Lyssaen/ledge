import { Button } from '@ledge/ui/ui/Button';
import type { NavAction } from '../nav/state';
import { useI18n } from '../i18n/lang';

/** Native mode's overview, in place of the Atelier (hidden in its first round): the sessions are in the sidebar, and a
 *  new one starts here. */
export function NativeOverview({ dispatch }: { dispatch(a: NavAction): void }) {
  const { t } = useI18n();
  return (
    <section className="native-overview" aria-label={t.native.title}>
      <h1>{t.native.title}</h1>
      <p>{t.native.hint}</p>
      <Button variant="primary" onClick={() => dispatch({ type: 'modal', modal: { kind: 'launch' } })}>{t.native.launch}</Button>
    </section>
  );
}
