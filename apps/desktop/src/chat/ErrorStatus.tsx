import { useI18n } from '../i18n/lang';
import { errorText } from './errors';

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A chat error as a status (never an alert, spec §7): said in the UI's language, inside `wrap` when given (« Échec du lancement : … »).
 *  The daemon's words stay secondary: always in the title, and in small text when the sentence does not carry them. */
export function ErrorStatus({ raw, className, wrap }: { raw: string; className: string; wrap?: (why: string) => string }) {
  const { t } = useI18n();
  const e = errorText(raw, t.chat.errors);
  return (
    <p className={className} role="status" title={raw}>
      {wrap ? wrap(e.text) : sentence(e.text)}
      {e.detail && <small className="ledge-error-detail">{e.detail}</small>}
    </p>
  );
}
