import { useState } from 'react';
import { LangProvider, loadLang, useI18n } from './i18n/lang';

function Shell() {
  const { t } = useI18n();
  return (
    <main className="app">
      <header className="view-heading">
        <div className="view-toggle" role="group">
          <button type="button" aria-pressed="false">{t.views.team}</button>
          <button type="button" aria-pressed="true">{t.views.room}</button>
        </div>
      </header>
    </main>
  );
}

export function App() {
  const [lang] = useState(loadLang);
  return <LangProvider lang={lang}><Shell /></LangProvider>;
}
