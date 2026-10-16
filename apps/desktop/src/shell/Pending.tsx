import { useI18n } from '../i18n/lang';

/** A place whose screen a later lot builds: its name and a short notice. Each lot replaces its own uses. */
export function Pending({ title }: { title: string }) {
  const { t } = useI18n();
  return (
    <section className="pending" aria-label={title}>
      <h2>{title}</h2>
      <p>{t.pending}</p>
    </section>
  );
}
