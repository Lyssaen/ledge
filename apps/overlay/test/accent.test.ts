import { describe, it, expect, beforeEach } from 'vitest';
import { applyAccent, accentTokens, loadAccent, parseAccent, saveAccent } from '../src/accent';

const lum = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
};

describe('parseAccent', () => {
  it('accepts #rrggbb and normalises to lowercase', () => {
    expect(parseAccent('#3366FF')).toBe('#3366ff');
    expect(parseAccent('  #abcdef  ')).toBe('#abcdef');
  });
  it('rejects shorthand, missing hash, and garbage', () => {
    expect(parseAccent('#fff')).toBeNull();
    expect(parseAccent('3366ff')).toBeNull();
    expect(parseAccent('#gg0000')).toBeNull();
    expect(parseAccent('blue')).toBeNull();
    expect(parseAccent(null)).toBeNull();
  });
});

describe('accent persistence', () => {
  beforeEach(() => localStorage.clear());

  it('loads nothing until a valid hex is saved, then forgets it on reset', () => {
    expect(loadAccent()).toBeNull();
    saveAccent('#3366FF');
    expect(localStorage.getItem('ledge.accent')).toBe('#3366ff');
    expect(loadAccent()).toBe('#3366ff');
    saveAccent(null);
    expect(localStorage.getItem('ledge.accent')).toBeNull();
    expect(loadAccent()).toBeNull();
  });
  it('a stored garbage value is treated as unset', () => {
    localStorage.setItem('ledge.accent', 'blue');
    expect(loadAccent()).toBeNull();
  });
});

describe('accentTokens', () => {
  it('derives hover darker than primary, and eyes lighter than the glow', () => {
    const t = accentTokens('#3366ff', 'dark');
    expect(t.sidebarPrimary).toMatch(/^#[0-9a-f]{6}$/);
    expect(lum(t.primaryHover)).toBeLessThan(lum(t.primary));
    expect(lum(t.residentEye)).toBeGreaterThan(lum(t.residentGlow));
  });
  it('darkens the chrome on light theme so it stays readable on white', () => {
    const dark = accentTokens('#3366ff', 'dark');
    const light = accentTokens('#3366ff', 'light');
    expect(lum(light.sidebarPrimary)).toBeLessThan(lum(dark.sidebarPrimary));
  });
  it('uses dark text on a pale accent and light text on a deep one', () => {
    const pale = accentTokens('#fff3a0', 'dark');
    const deep = accentTokens('#1a2a6c', 'dark');
    expect(lum(pale.primaryForeground)).toBeLessThan(lum(pale.primary));
    expect(lum(deep.primaryForeground)).toBeGreaterThan(lum(deep.primary));
  });
});

describe('applyAccent', () => {
  it('writes the derived tokens and leaves danger-text alone; null restores the factory vars', () => {
    const el = document.createElement('div');
    el.style.setProperty('--danger-text', 'oklch(0.7 0.2 22)');
    applyAccent('#3366ff', 'dark', el);
    expect(el.style.getPropertyValue('--sidebar-primary')).toMatch(/^#[0-9a-f]{6}$/);
    expect(el.style.getPropertyValue('--primary')).toMatch(/^#[0-9a-f]{6}$/);
    expect(el.style.getPropertyValue('--ledge-glow')).toMatch(/^#[0-9a-f]{6}$/);
    expect(el.style.getPropertyValue('--ledge-eye')).toMatch(/^#[0-9a-f]{6}$/);
    expect(el.style.getPropertyValue('--danger-text')).toBe('oklch(0.7 0.2 22)');
    applyAccent(null, 'dark', el);
    expect(el.style.getPropertyValue('--sidebar-primary')).toBe('');
    expect(el.style.getPropertyValue('--ledge-glow')).toBe('');
    expect(el.style.getPropertyValue('--danger-text')).toBe('oklch(0.7 0.2 22)');
  });
  it('an invalid hex is the same as unset', () => {
    const el = document.createElement('div');
    applyAccent('blue', 'dark', el);
    expect(el.style.getPropertyValue('--sidebar-primary')).toBe('');
  });
});
