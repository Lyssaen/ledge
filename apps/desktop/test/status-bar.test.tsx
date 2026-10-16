import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LangProvider } from '../src/i18n/lang';
import { StatusBar } from '../src/shell/StatusBar';

const machines = [{ id: 'local', label: 'Local', status: 'ready' }, { id: 'devbox', label: 'Devbox', status: 'ready' }, { id: 'edge', label: 'Edge', status: 'unreachable' }, { id: 'local2', label: 'x', status: 'ready' }] as never;
const bar = (lang: 'fr' | 'en', ms = machines) => render(<LangProvider lang={lang}><StatusBar sessions={[]} machines={ms} /></LangProvider>);

describe('StatusBar copy', () => {
  it('fr: local is masculine, other machines feminine', () => {
    bar('fr');
    expect(screen.getByText('Local connecté')).toBeInTheDocument();
    expect(screen.getByText('Devbox connectée')).toBeInTheDocument();
    expect(screen.getByText('Edge déconnectée')).toBeInTheDocument();
  });
  it('fr: a disconnected local reads masculine', () => {
    bar('fr', [{ id: 'local', label: 'Local', status: 'unreachable' }] as never);
    expect(screen.getByText('Local déconnecté')).toBeInTheDocument();
  });
  it('en is unchanged', () => {
    bar('en');
    expect(screen.getByText('Local connected')).toBeInTheDocument();
    expect(screen.getByText('Edge disconnected')).toBeInTheDocument();
  });
});
