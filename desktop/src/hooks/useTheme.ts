import { useState, useCallback, useEffect } from 'react';
import type { Palette } from '../lib/palettes';
import { LEGACY_PALETTE_MAP, PALETTES, getFamily, getPairedPalette, isDarkPalette } from '../lib/palettes';

export type Theme = 'light' | 'dark';

const VALID_PALETTES = new Set<string>(PALETTES.map(p => p.id));
const THEME_CHANGE_EVENT = 'dorabot:theme-change';

function emitThemeChange(palette: Palette, glass: boolean) {
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { palette, glass } }));
}

function normalizePalette(raw: string | null): Palette | null {
  if (!raw) return null;
  if (VALID_PALETTES.has(raw)) return raw as Palette;
  return LEGACY_PALETTE_MAP[raw] || null;
}

function applyToDOM(palette: Palette, glass: boolean) {
  const el = document.documentElement;
  const isDark = isDarkPalette(palette);

  el.setAttribute('data-palette', palette);

  if (isDark) {
    el.classList.add('dark');
  } else {
    el.classList.remove('dark');
  }

  if (glass) {
    el.setAttribute('data-glass', 'true');
  } else {
    el.removeAttribute('data-glass');
  }

  localStorage.setItem('palette', palette);
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  emitThemeChange(palette, glass);
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
  const [glass, setGlassState] = useState(() => localStorage.getItem('glass') === 'true');

  useEffect(() => {
    const onThemeChange = (event: Event) => {
      const detail = (event as CustomEvent<{ palette: Palette; glass: boolean }>).detail;
      if (!detail) return;
      setPaletteState(detail.palette);
      setGlassState(detail.glass);
    };
    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange as EventListener);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange as EventListener);
  }, []);

  const theme: Theme = isDarkPalette(palette) ? 'dark' : 'light';

  const setPalette = useCallback((p: Palette) => {
    setPaletteState(p);
    setGlassState(currentGlass => {
      applyToDOM(p, currentGlass);
      return currentGlass;
    });
  }, []);

  const setGlass = useCallback((g: boolean) => {
    setGlassState(g);
    localStorage.setItem('glass', String(g));
    if (g) {
      document.documentElement.setAttribute('data-glass', 'true');
    } else {
      document.documentElement.removeAttribute('data-glass');
    }
    emitThemeChange(palette, g);
  }, [palette]);

  const toggle = useCallback(() => {
    setPalette(getPairedPalette(palette));
  }, [palette, setPalette]);

  const setTheme = useCallback((t: Theme) => {
    const family = getFamily(palette);
    if (family === 'default') {
      setPalette(t === 'dark' ? 'default-dark' : 'default-light');
    } else if (family === 'mocha') {
      setPalette(t === 'dark' ? 'mocha-dark' : 'mocha-light');
    } else if (family === 'sage') {
      setPalette(t === 'dark' ? 'sage-dark' : 'sage-light');
    } else if (family === 'ocean') {
      setPalette(t === 'dark' ? 'ocean-dark' : 'ocean-light');
    } else {
      setPalette(t === 'dark' ? 'berry-dark' : 'berry-light');
    }
  }, [palette, setPalette]);

  return { theme, palette, glass, setTheme, setPalette, setGlass, toggle };
}
