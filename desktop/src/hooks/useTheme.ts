import { useState, useCallback, useEffect } from 'react';
import type { Palette } from '../lib/palettes';
import { LEGACY_PALETTE_MAP, PALETTES, getFamily, getPairedPalette, isDarkPalette } from '../lib/palettes';

export type Theme = 'light' | 'dark';

const VALID_PALETTES = new Set<string>(PALETTES.map(p => p.id));
const THEME_CHANGE_EVENT = 'dorabot:theme-change';

function emitThemeChange(palette: Palette) {
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { palette } }));
}

function normalizePalette(raw: string | null): Palette | null {
  if (!raw) return null;
  if (VALID_PALETTES.has(raw)) return raw as Palette;
  return LEGACY_PALETTE_MAP[raw] || null;
}

function applyToDOM(palette: Palette) {
  const el = document.documentElement;
  const isDark = isDarkPalette(palette);

  el.setAttribute('data-palette', palette);

  if (isDark) {
    el.classList.add('dark');
  } else {
    el.classList.remove('dark');
  }

  localStorage.setItem('palette', palette);
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  emitThemeChange(palette);
}

function initPalette(): Palette {
  const normalized = normalizePalette(localStorage.getItem('palette'));
  if (normalized) {
    localStorage.setItem('palette', normalized);
    localStorage.setItem('theme', isDarkPalette(normalized) ? 'dark' : 'light');
    return normalized;
  }

  localStorage.removeItem('palette');
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = savedTheme === 'dark'
    || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const fallback: Palette = prefersDark ? 'default-dark' : 'default-light';
  localStorage.setItem('theme', prefersDark ? 'dark' : 'light');
  return fallback;
}

export function useTheme() {
  const [palette, setPaletteState] = useState<Palette>(initPalette);

  useEffect(() => {
    const onThemeChange = (event: Event) => {
      const detail = (event as CustomEvent<{ palette: Palette }>).detail;
      if (!detail) return;
      setPaletteState(detail.palette);
    };
    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange as EventListener);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange as EventListener);
  }, []);

  const theme: Theme = isDarkPalette(palette) ? 'dark' : 'light';

  const setPalette = useCallback((p: Palette) => {
    setPaletteState(p);
    applyToDOM(p);
  }, []);

  const toggle = useCallback(() => {
    setPalette(getPairedPalette(palette));
  }, [palette, setPalette]);

  const setTheme = useCallback((t: Theme) => {
    const isDark = t === 'dark';
    const paired = getPairedPalette(palette);
    // If current palette already matches the target mode, keep it; otherwise switch to the pair
    if (isDarkPalette(palette) === isDark) return;
    setPalette(paired);
  }, [palette, setPalette]);

  return { theme, palette, setTheme, setPalette, toggle };
}
