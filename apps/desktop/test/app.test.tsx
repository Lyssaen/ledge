import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../src/App';

describe('Desktop shell', () => {
  it('renders the team and room toggles in English', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Team' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Meeting' })).toBeInTheDocument();
  });
});
