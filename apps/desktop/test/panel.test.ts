import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_PANEL, PANEL_KEY, clampPanel, loadPanel, panelBounds, savePanel, stepPanel } from '../src/state/panel';

describe('panel bounds (split-view.js)', () => {
  it('320 px of conversation and 288 px of sessions at most 70 %', () => {
    expect(panelBounds(1280)).toEqual({ min: 25, max: 70 });
    expect(panelBounds(1000).min).toBeCloseTo(32, 5);
    expect(panelBounds(1000).max).toBe(70);
    expect(panelBounds(900).max).toBeCloseTo(68, 5);
  });
  it('a body not measured yet falls back to 25–70', () => {
    expect(panelBounds(0)).toEqual({ min: 25, max: 70 });
    expect(panelBounds(Number.NaN)).toEqual({ min: 25, max: 70 });
  });
  it('a narrow body keeps min ≤ max and never NaN (Review Focus 5)', () => {
    for (const w of [700, 500, 300, 200, 1]) {
      const b = panelBounds(w);
      expect(Number.isNaN(b.min) || Number.isNaN(b.max)).toBe(false);
      expect(b.min).toBeLessThanOrEqual(b.max);
      expect(clampPanel(DEFAULT_PANEL.width, b)).toBeGreaterThanOrEqual(b.min);
      expect(clampPanel(99, b)).toBeLessThanOrEqual(b.max);
    }
    expect(panelBounds(500).min).toBe(panelBounds(500).max);
    expect(panelBounds(200)).toEqual({ min: 25, max: 25 });
  });
  it('clamps a stored width to the bounds, NaN to the default', () => {
    const b = panelBounds(1000);
    expect(clampPanel(10, b)).toBeCloseTo(32, 5);
    expect(clampPanel(90, b)).toBe(70);
    expect(clampPanel(Number.NaN, b)).toBe(38);
  });
});

describe('keyboard steps', () => {
  const b = { min: 25, max: 70 };
  it('← widens the conversation by 2 points, → narrows it, Home and End jump to the bounds', () => {
    expect(stepPanel(38, 'ArrowLeft', b)).toBe(40);
    expect(stepPanel(38, 'ArrowRight', b)).toBe(36);
    expect(stepPanel(69, 'ArrowLeft', b)).toBe(70);
    expect(stepPanel(26, 'ArrowRight', b)).toBe(25);
    expect(stepPanel(38, 'Home', b)).toBe(25);
    expect(stepPanel(38, 'End', b)).toBe(70);
    expect(stepPanel(38, 'Enter', b)).toBeNull();
  });
});

describe('desktop.panel', () => {
  beforeEach(() => localStorage.clear());
  it('defaults to 38 % not expanded and round-trips', () => {
    expect(loadPanel()).toEqual(DEFAULT_PANEL);
    savePanel({ width: 44, expanded: true });
    expect(loadPanel()).toEqual({ width: 44, expanded: true });
  });
  it('a corrupt value falls back field by field and leaves other keys alone (Review Focus 1)', () => {
    localStorage.setItem('desktop.view', '{"view":"team"}');
    for (const raw of ['"wide"', '[1,2]', '{"width":"38"}', '{"width":-5,"expanded":"yes"}', '{"width":95}', '{bad json']) {
      localStorage.setItem(PANEL_KEY, raw);
      expect(loadPanel()).toEqual(DEFAULT_PANEL);
    }
    localStorage.setItem(PANEL_KEY, '{"width":"wide","expanded":true}');
    expect(loadPanel()).toEqual({ width: 38, expanded: true });
    expect(localStorage.getItem('desktop.view')).toBe('{"view":"team"}');
  });
});
