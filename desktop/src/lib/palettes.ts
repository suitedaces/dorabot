export type Palette =
  | 'default-light'
  | 'default-dark'
  | 'mocha-light'
  | 'mocha-dark'
  | 'sage-light'
  | 'sage-dark'
  | 'ocean-light'
  | 'ocean-dark'
  | 'berry-light'
  | 'berry-dark'
  | 'terminal-light'
  | 'terminal-dark'
  | 'paper-light'
  | 'paper-dark'
  | 'neon-light'
  | 'neon-dark'
  | 'ink-light'
  | 'ink-dark'
  | 'sunset-light'
  | 'sunset-dark';

export type PaletteInfo = {
  id: Palette;
  label: string;
  family: string;
  isDark: boolean;
  preview: { bg: string; fg: string; accent: string; accent2: string };
  terminal: Record<string, string>;
};

const PAIRS: Record<string, [Palette, Palette]> = {
  default: ['default-light', 'default-dark'],
  mocha: ['mocha-light', 'mocha-dark'],
  sage: ['sage-light', 'sage-dark'],
  ocean: ['ocean-light', 'ocean-dark'],
  berry: ['berry-light', 'berry-dark'],
  terminal: ['terminal-light', 'terminal-dark'],
  paper: ['paper-light', 'paper-dark'],
  neon: ['neon-light', 'neon-dark'],
  ink: ['ink-light', 'ink-dark'],
  sunset: ['sunset-light', 'sunset-dark'],
};

const DARK_SET = new Set<Palette>([
  'default-dark', 'mocha-dark', 'sage-dark', 'ocean-dark', 'berry-dark',
  'terminal-dark', 'paper-dark', 'neon-dark', 'ink-dark', 'sunset-dark',
]);

export const LEGACY_PALETTE_MAP: Record<string, Palette> = {
  'catppuccin-latte': 'mocha-light',
  'catppuccin-mocha': 'mocha-dark',
  'rose-pine-dawn': 'ocean-light',
  'rose-pine': 'ocean-dark',
  'pastel-light': 'berry-light',
  'pastel-dark': 'berry-dark',
};

export function isDarkPalette(p: Palette): boolean {
  return DARK_SET.has(p);
}

export function getFamily(p: Palette): string {
  if (p.startsWith('default')) return 'default';
  if (p.startsWith('mocha')) return 'mocha';
  if (p.startsWith('sage')) return 'sage';
  if (p.startsWith('ocean')) return 'ocean';
  if (p.startsWith('terminal')) return 'terminal';
  if (p.startsWith('paper')) return 'paper';
  if (p.startsWith('neon')) return 'neon';
  if (p.startsWith('ink')) return 'ink';
  if (p.startsWith('sunset')) return 'sunset';
  if (p.startsWith('berry')) return 'berry';
  return 'default';
}

export function getPairedPalette(p: Palette): Palette {
  const pair = PAIRS[getFamily(p)];
  return pair[0] === p ? pair[1] : pair[0];
}

export const PALETTES: PaletteInfo[] = [
  {
    id: 'default-light',
    label: 'Default Light',
    family: 'default',
    isDark: false,
    preview: { bg: '#f8f8fa', fg: '#1a1a2e', accent: '#3b5bdb', accent2: '#51cf66' },
    terminal: {
      background: '#ffffff',
      foreground: '#383a42',
      cursor: '#383a42',
      cursorAccent: '#ffffff',
      selectionBackground: '#add6ff',
      selectionForeground: '#000000',
      black: '#383a42', red: '#e45649', green: '#50a14f', yellow: '#c18401',
      blue: '#4078f2', magenta: '#a626a4', cyan: '#0184bc', white: '#fafafa',
      brightBlack: '#a0a1a7', brightRed: '#e45649', brightGreen: '#50a14f', brightYellow: '#c18401',
      brightBlue: '#4078f2', brightMagenta: '#a626a4', brightCyan: '#0184bc', brightWhite: '#ffffff',
    },
  },
  {
    id: 'default-dark',
    label: 'Default Dark',
    family: 'default',
    isDark: true,
    preview: { bg: '#1a1a24', fg: '#e8e8e8', accent: '#7c9eff', accent2: '#69db7c' },
    terminal: {
      background: '#1a1a1a',
      foreground: '#d4d4d4',
      cursor: '#d4d4d4',
      cursorAccent: '#1a1a1a',
      selectionBackground: '#264f78',
      selectionForeground: '#ffffff',
      black: '#1a1a1a', red: '#f44747', green: '#6a9955', yellow: '#d7ba7d',
      blue: '#569cd6', magenta: '#c586c0', cyan: '#4ec9b0', white: '#d4d4d4',
      brightBlack: '#808080', brightRed: '#f44747', brightGreen: '#6a9955', brightYellow: '#d7ba7d',
      brightBlue: '#569cd6', brightMagenta: '#c586c0', brightCyan: '#4ec9b0', brightWhite: '#ffffff',
    },
  },
  {
    id: 'mocha-light',
    label: 'Mocha Light',
    family: 'mocha',
    isDark: false,
    preview: { bg: '#f5efe9', fg: '#4a3a2f', accent: '#9f6e43', accent2: '#7f9a6f' },
    terminal: {
      background: '#f5efe9',
      foreground: '#4a3a2f',
      cursor: '#8c6545',
      cursorAccent: '#f5efe9',
      selectionBackground: '#ddd1c5',
      selectionForeground: '#3b2d23',
      black: '#3f332b', red: '#b66a56', green: '#6f8f5c', yellow: '#b2874c',
      blue: '#6c8da6', magenta: '#8f7a6e', cyan: '#5d8f88', white: '#ece2d7',
      brightBlack: '#7a6a5f', brightRed: '#c8826f', brightGreen: '#87a473', brightYellow: '#c89c60',
      brightBlue: '#87a4bb', brightMagenta: '#a18e82', brightCyan: '#76a6a0', brightWhite: '#ffffff',
    },
  },
  {
    id: 'mocha-dark',
    label: 'Mocha Dark',
    family: 'mocha',
    isDark: true,
    preview: { bg: '#19120f', fg: '#efe3d4', accent: '#cda174', accent2: '#95ab8f' },
    terminal: {
      background: '#19120f',
      foreground: '#efe3d4',
      cursor: '#d7b38e',
      cursorAccent: '#19120f',
      selectionBackground: '#3b2f27',
      selectionForeground: '#f7efe5',
      black: '#1b1613', red: '#c9856a', green: '#9cb489', yellow: '#d7b372',
      blue: '#9eb9c6', magenta: '#b9a08f', cyan: '#8fb8ad', white: '#ddcbb8',
      brightBlack: '#5b4b3f', brightRed: '#d79a82', brightGreen: '#afc49e', brightYellow: '#e4c58c',
      brightBlue: '#b2c9d4', brightMagenta: '#c8b3a5', brightCyan: '#a3c8be', brightWhite: '#f7efe5',
    },
  },
  {
    id: 'sage-light',
    label: 'Sage Light',
    family: 'sage',
    isDark: false,
    preview: { bg: '#eef4ee', fg: '#2f4034', accent: '#5d8f6b', accent2: '#7ea59b' },
    terminal: {
      background: '#eef4ee',
      foreground: '#2f4034',
      cursor: '#5d8f6b',
      cursorAccent: '#eef4ee',
      selectionBackground: '#d4e1d4',
      selectionForeground: '#243229',
      black: '#2f4034', red: '#b4615d', green: '#5f8f6c', yellow: '#9d8f50',
      blue: '#5f7da1', magenta: '#7f768d', cyan: '#4d8b87', white: '#e3ebe3',
      brightBlack: '#60766a', brightRed: '#c57a75', brightGreen: '#78a183', brightYellow: '#b09f65',
      brightBlue: '#7893b3', brightMagenta: '#948ba0', brightCyan: '#68a09b', brightWhite: '#ffffff',
    },
  },
  {
    id: 'sage-dark',
    label: 'Sage Dark',
    family: 'sage',
    isDark: true,
    preview: { bg: '#121916', fg: '#dce8dd', accent: '#7ea58a', accent2: '#6d97a4' },
    terminal: {
      background: '#121916',
      foreground: '#dce8dd',
      cursor: '#8cb29a',
      cursorAccent: '#121916',
      selectionBackground: '#27352e',
      selectionForeground: '#e9f2ea',
      black: '#141d19', red: '#bb7a73', green: '#7ea58a', yellow: '#b9a06d',
      blue: '#7f98b0', magenta: '#9a8aa8', cyan: '#6fa6a2', white: '#cad8cb',
      brightBlack: '#495a51', brightRed: '#cc8f89', brightGreen: '#94b89f', brightYellow: '#cbb684',
      brightBlue: '#95abc1', brightMagenta: '#af9dba', brightCyan: '#83b9b5', brightWhite: '#e9f2ea',
    },
  },
  {
    id: 'ocean-light',
    label: 'Ocean Light',
    family: 'ocean',
    isDark: false,
    preview: { bg: '#eff3f8', fg: '#334458', accent: '#5c88b2', accent2: '#6fa0a2' },
    terminal: {
      background: '#eff3f8',
      foreground: '#334458',
      cursor: '#5c88b2',
      cursorAccent: '#eff3f8',
      selectionBackground: '#d3dee9',
      selectionForeground: '#243445',
      black: '#334458', red: '#c06b67', green: '#5c907f', yellow: '#b09256',
      blue: '#5c88b2', magenta: '#7d7ea8', cyan: '#5a97a0', white: '#e5ecf4',
      brightBlack: '#657a90', brightRed: '#d1817b', brightGreen: '#75a595', brightYellow: '#c2a96d',
      brightBlue: '#76a0c8', brightMagenta: '#9596bd', brightCyan: '#74acb3', brightWhite: '#ffffff',
    },
  },
  {
    id: 'ocean-dark',
    label: 'Ocean Dark',
    family: 'ocean',
    isDark: true,
    preview: { bg: '#101722', fg: '#d8e3f0', accent: '#6f9cc8', accent2: '#73a7a9' },
    terminal: {
      background: '#101722',
      foreground: '#d8e3f0',
      cursor: '#83add5',
      cursorAccent: '#101722',
      selectionBackground: '#27364a',
      selectionForeground: '#e7f0fb',
      black: '#121a26', red: '#c97d76', green: '#6fa092', yellow: '#bc9f67',
      blue: '#6f9cc8', magenta: '#8d8fc0', cyan: '#6faeb2', white: '#c4d3e6',
      brightBlack: '#495b72', brightRed: '#da928a', brightGreen: '#86b5a6', brightYellow: '#ceb67f',
      brightBlue: '#86b2dd', brightMagenta: '#a3a4d2', brightCyan: '#84c1c4', brightWhite: '#e7f0fb',
    },
  },
  {
    id: 'berry-light',
    label: 'Berry Light',
    family: 'berry',
    isDark: false,
    preview: { bg: '#f7f4fb', fg: '#433b5b', accent: '#8d7bc7', accent2: '#7fb3a8' },
    terminal: {
      background: '#f7f4fb',
      foreground: '#433b5b',
      cursor: '#8d7bc7',
      cursorAccent: '#f7f4fb',
      selectionBackground: '#e2daf3',
      selectionForeground: '#342d49',
      black: '#433b5b', red: '#be757d', green: '#6fa191', yellow: '#b59a5f',
      blue: '#7b89c4', magenta: '#8d7bc7', cyan: '#68a9a2', white: '#ebe5f6',
      brightBlack: '#6f668a', brightRed: '#cf8b93', brightGreen: '#88b2a4', brightYellow: '#c7b174',
      brightBlue: '#949fd3', brightMagenta: '#a594d8', brightCyan: '#82bab4', brightWhite: '#ffffff',
    },
  },
  {
    id: 'berry-dark',
    label: 'Berry Dark',
    family: 'berry',
    isDark: true,
    preview: { bg: '#171425', fg: '#e4def6', accent: '#a798dd', accent2: '#8bbeb3' },
    terminal: {
      background: '#171425',
      foreground: '#e4def6',
      cursor: '#b7a8eb',
      cursorAccent: '#171425',
      selectionBackground: '#332d52',
      selectionForeground: '#f1ecff',
      black: '#19162a', red: '#c9878e', green: '#8bbeb3', yellow: '#c2ab76',
      blue: '#94a4dc', magenta: '#a798dd', cyan: '#82c1bb', white: '#d2caea',
      brightBlack: '#595379', brightRed: '#da9aa1', brightGreen: '#9dcec4', brightYellow: '#d3bd8d',
      brightBlue: '#acb9e9', brightMagenta: '#beb1ea', brightCyan: '#98d0ca', brightWhite: '#f1ecff',
    },
  },
  // ─── Terminal ───
  {
    id: 'terminal-light',
    label: 'Terminal Light',
    family: 'terminal',
    isDark: false,
    preview: { bg: '#e2e6da', fg: '#0a2a10', accent: '#1a7a2a', accent2: '#aa7700' },
    terminal: {
      background: '#e2e6da',
      foreground: '#0a2a10',
      cursor: '#1a7a2a',
      cursorAccent: '#e2e6da',
      selectionBackground: '#b8ccb0',
      selectionForeground: '#0a1a08',
      black: '#0a2a10', red: '#aa4422', green: '#1a7a2a', yellow: '#aa7700',
      blue: '#2a7888', magenta: '#884488', cyan: '#2a8866', white: '#d8dcd2',
      brightBlack: '#5a7058', brightRed: '#cc5533', brightGreen: '#2a8a3a', brightYellow: '#bb8800',
      brightBlue: '#3a88aa', brightMagenta: '#aa55aa', brightCyan: '#3aaa77', brightWhite: '#eef0e8',
    },
  },
  {
    id: 'terminal-dark',
    label: 'Terminal Dark',
    family: 'terminal',
    isDark: true,
    preview: { bg: '#080c08', fg: '#33ff33', accent: '#00dd44', accent2: '#ccaa00' },
    terminal: {
      background: '#080c08',
      foreground: '#33dd44',
      cursor: '#33ff33',
      cursorAccent: '#080c08',
      selectionBackground: '#225522',
      selectionForeground: '#44ff44',
      black: '#080c08', red: '#cc4422', green: '#33dd44', yellow: '#ccaa00',
      blue: '#44aacc', magenta: '#cc44aa', cyan: '#22ccaa', white: '#88cc88',
      brightBlack: '#336633', brightRed: '#ee6644', brightGreen: '#44ff55', brightYellow: '#ffcc00',
      brightBlue: '#66ccee', brightMagenta: '#ee66cc', brightCyan: '#44eebb', brightWhite: '#aaeebb',
    },
  },
  // ─── Paper ───
  {
    id: 'paper-light',
    label: 'Paper Light',
    family: 'paper',
    isDark: false,
    preview: { bg: '#f8f0e2', fg: '#3a2818', accent: '#a04030', accent2: '#6b7f52' },
    terminal: {
      background: '#f8f0e2',
      foreground: '#3a2818',
      cursor: '#a04030',
      cursorAccent: '#f8f0e2',
      selectionBackground: '#ddd0ba',
      selectionForeground: '#2a2010',
      black: '#3a2818', red: '#a04030', green: '#6b7f52', yellow: '#a07830',
      blue: '#5a7a90', magenta: '#8a5a50', cyan: '#5a8878', white: '#eae2d4',
      brightBlack: '#7a6a52', brightRed: '#b85040', brightGreen: '#7a8f62', brightYellow: '#b08840',
      brightBlue: '#6a8aa0', brightMagenta: '#9a6a60', brightCyan: '#6a9888', brightWhite: '#f8f4ec',
    },
  },
  {
    id: 'paper-dark',
    label: 'Paper Dark',
    family: 'paper',
    isDark: true,
    preview: { bg: '#1c1610', fg: '#f0e6d0', accent: '#cc6852', accent2: '#8a9a70' },
    terminal: {
      background: '#1c1610',
      foreground: '#f0e6d0',
      cursor: '#cc6852',
      cursorAccent: '#1c1610',
      selectionBackground: '#3a2e20',
      selectionForeground: '#f0e8d4',
      black: '#1c1610', red: '#cc6852', green: '#8a9a70', yellow: '#c09040',
      blue: '#7a98aa', magenta: '#a07060', cyan: '#7aaa98', white: '#d4caae',
      brightBlack: '#5a4a34', brightRed: '#dd7060', brightGreen: '#9aaa80', brightYellow: '#d0a050',
      brightBlue: '#8aa8ba', brightMagenta: '#b08070', brightCyan: '#8abaa8', brightWhite: '#f0e8d4',
    },
  },
  // ─── Neon ───
  {
    id: 'neon-light',
    label: 'Neon Light',
    family: 'neon',
    isDark: false,
    preview: { bg: '#f2f0fa', fg: '#181828', accent: '#d41870', accent2: '#00aa88' },
    terminal: {
      background: '#f2f0fa',
      foreground: '#181828',
      cursor: '#d41870',
      cursorAccent: '#f2f0fa',
      selectionBackground: '#ddd0ee',
      selectionForeground: '#101020',
      black: '#181828', red: '#dd2222', green: '#00aa88', yellow: '#88bb00',
      blue: '#3366cc', magenta: '#d41870', cyan: '#00aa88', white: '#e8e6f4',
      brightBlack: '#606088', brightRed: '#ee3333', brightGreen: '#00bb99', brightYellow: '#99cc00',
      brightBlue: '#4477dd', brightMagenta: '#e62880', brightCyan: '#00bb99', brightWhite: '#f8f6ff',
    },
  },
  {
    id: 'neon-dark',
    label: 'Neon Dark',
    family: 'neon',
    isDark: true,
    preview: { bg: '#0a0c18', fg: '#d0d8e4', accent: '#ff2288', accent2: '#00eebb' },
    terminal: {
      background: '#0a0c18',
      foreground: '#d0d8e4',
      cursor: '#ff2288',
      cursorAccent: '#0a0c18',
      selectionBackground: '#2a1840',
      selectionForeground: '#f4f4ff',
      black: '#0a0c18', red: '#ff4444', green: '#00eebb', yellow: '#bbff00',
      blue: '#4488ff', magenta: '#ff2288', cyan: '#00ddcc', white: '#c0c0dd',
      brightBlack: '#444466', brightRed: '#ff6666', brightGreen: '#33ffcc', brightYellow: '#ccff33',
      brightBlue: '#66aaff', brightMagenta: '#ff44aa', brightCyan: '#33ffdd', brightWhite: '#eeeeff',
    },
  },
  // ─── Ink ───
  {
    id: 'ink-light',
    label: 'Ink Light',
    family: 'ink',
    isDark: false,
    preview: { bg: '#f8f8fa', fg: '#0c0c0e', accent: '#c41420', accent2: '#888888' },
    terminal: {
      background: '#f8f8fa',
      foreground: '#0c0c0e',
      cursor: '#c41420',
      cursorAccent: '#f8f8fa',
      selectionBackground: '#d8d8d8',
      selectionForeground: '#000000',
      black: '#0c0c0e', red: '#c41420', green: '#2a7a3a', yellow: '#8a6a22',
      blue: '#2255aa', magenta: '#882266', cyan: '#227788', white: '#e8e8e8',
      brightBlack: '#666666', brightRed: '#dd2530', brightGreen: '#3a8a4a', brightYellow: '#9a7a32',
      brightBlue: '#3366bb', brightMagenta: '#993377', brightCyan: '#338899', brightWhite: '#ffffff',
    },
  },
  {
    id: 'ink-dark',
    label: 'Ink Dark',
    family: 'ink',
    isDark: true,
    preview: { bg: '#0c0c0e', fg: '#f0f0f2', accent: '#dd3838', accent2: '#777777' },
    terminal: {
      background: '#0c0c0e',
      foreground: '#f0f0f2',
      cursor: '#dd3838',
      cursorAccent: '#0c0c0e',
      selectionBackground: '#333333',
      selectionForeground: '#ffffff',
      black: '#0c0c0e', red: '#dd3838', green: '#44aa55', yellow: '#aa8833',
      blue: '#4488cc', magenta: '#aa3388', cyan: '#44aaaa', white: '#cccccc',
      brightBlack: '#555555', brightRed: '#ee4848', brightGreen: '#55bb66', brightYellow: '#bb9944',
      brightBlue: '#5599dd', brightMagenta: '#bb4499', brightCyan: '#55bbbb', brightWhite: '#ffffff',
    },
  },
  // ─── Sunset ───
  {
    id: 'sunset-light',
    label: 'Sunset Light',
    family: 'sunset',
    isDark: false,
    preview: { bg: '#faf0e8', fg: '#382030', accent: '#d06030', accent2: '#8860a8' },
    terminal: {
      background: '#faf0e8',
      foreground: '#382030',
      cursor: '#d06030',
      cursorAccent: '#faf0e8',
      selectionBackground: '#e8ccb0',
      selectionForeground: '#281a20',
      black: '#382030', red: '#c04040', green: '#6a9a5a', yellow: '#cc7744',
      blue: '#5a78a0', magenta: '#8860a8', cyan: '#4a9090', white: '#f0e4da',
      brightBlack: '#7a5a5a', brightRed: '#d05050', brightGreen: '#7aaa6a', brightYellow: '#dd8855',
      brightBlue: '#6a88b0', brightMagenta: '#9970b8', brightCyan: '#5aa0a0', brightWhite: '#fef8f2',
    },
  },
  {
    id: 'sunset-dark',
    label: 'Sunset Dark',
    family: 'sunset',
    isDark: true,
    preview: { bg: '#1a1540', fg: '#f4e4d4', accent: '#ff7048', accent2: '#a060c0' },
    terminal: {
      background: '#1a1540',
      foreground: '#f4e4d4',
      cursor: '#ff7048',
      cursorAccent: '#1a1540',
      selectionBackground: '#3a2250',
      selectionForeground: '#f8eae0',
      black: '#1a1540', red: '#e05050', green: '#80aa68', yellow: '#dda060',
      blue: '#6080bb', magenta: '#a060c0', cyan: '#50aaa0', white: '#dcc8b8',
      brightBlack: '#5a4070', brightRed: '#f06060', brightGreen: '#90bb78', brightYellow: '#eeb070',
      brightBlue: '#7090cc', brightMagenta: '#b070d0', brightCyan: '#60bba8', brightWhite: '#f8eae0',
    },
  },
];

export function getPalette(id: Palette): PaletteInfo {
  return PALETTES.find(p => p.id === id) || PALETTES[0];
}
