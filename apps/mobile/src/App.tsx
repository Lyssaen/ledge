import { copy } from './copy';

export function App() {
  return (
    <main className="app">
      <header className="px-side pt-4 pb-[18px]">
        <h1 className="text-[29px] leading-[1.15] font-semibold tracking-[-1px]">{copy.shellTitle}</h1>
        <p className="mt-2 text-[13px] text-muted">{copy.shellSubtitle}</p>
      </header>
    </main>
  );
}
