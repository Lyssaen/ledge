import { useI18n } from '../i18n/lang';

const NPM = 'npm i -g @paradow/ledge && systemctl --user restart ledge-daemon';
const GIT = 'cd <your Ledge clone> && git pull && pnpm install && pnpm --filter @paradow/ledge build && systemctl --user restart ledge-daemon';

/** The daemon in WSL has no token file: it is older than this Desktop. Shows how to update it; the commands are not translated. */
export function DaemonOutdated() {
  const { t } = useI18n();
  const c = t.daemonOutdated;
  return (
    <div className="set-well warn" role="alert" style={{ margin: '12px 16px 0' }}>
      <strong>{c.title}</strong>
      <span>{c.body}</span>
      <span>{c.npm}</span>
      <code>{NPM}</code>
      <span>{c.git}</span>
      <code>{GIT}</code>
    </div>
  );
}
