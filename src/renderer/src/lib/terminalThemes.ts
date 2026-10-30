/**
 * Terminal color schemes. `system` (terminalTheme === '') follows the app's
 * light/dark theme; a named preset applies its own palette regardless.
 */

export interface TerminalPalette {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export interface TerminalPreset {
  id: string
  label: string
  palette: TerminalPalette
}

const systemDark: TerminalPalette = {
  background: '#0e0f12',
  foreground: '#e6e8ec',
  cursor: '#6ea8fe',
  cursorAccent: '#0e0f12',
  selectionBackground: 'rgba(110,168,254,0.28)',
  black: '#16181d',
  brightBlack: '#656b78',
  red: '#ff6b6b',
  green: '#51cf66',
  yellow: '#ffd43b',
  blue: '#6ea8fe',
  magenta: '#da77f2',
  cyan: '#3bc9db',
  white: '#e6e8ec',
  brightRed: '#ff6b6b',
  brightGreen: '#51cf66',
  brightYellow: '#ffd43b',
  brightBlue: '#6ea8fe',
  brightMagenta: '#da77f2',
  brightCyan: '#3bc9db',
  brightWhite: '#e6e8ec'
}

const systemLight: TerminalPalette = {
  background: '#f7f8fa',
  foreground: '#1a1d23',
  cursor: '#2f6fed',
  cursorAccent: '#f7f8fa',
  selectionBackground: 'rgba(47,111,237,0.20)',
  black: '#1a1d23',
  brightBlack: '#98a0ab',
  red: '#e03131',
  green: '#2f9e44',
  yellow: '#f08c00',
  blue: '#2f6fed',
  magenta: '#ae3ec9',
  cyan: '#1098ad',
  white: '#5c636e',
  brightRed: '#e03131',
  brightGreen: '#2f9e44',
  brightYellow: '#f08c00',
  brightBlue: '#2f6fed',
  brightMagenta: '#ae3ec9',
  brightCyan: '#1098ad',
  brightWhite: '#5c636e'
}

export const PRESETS: TerminalPreset[] = [
  {
    id: 'nord',
    label: 'Nord',
    palette: {
      background: '#2e3440',
      foreground: '#d8dee9',
      cursor: '#88c0d0',
      cursorAccent: '#2e3440',
      selectionBackground: 'rgba(136,192,208,0.30)',
      black: '#3b4252',
      brightBlack: '#616e88',
      red: '#bf616a',
      green: '#a3be8c',
      yellow: '#ebcb8b',
      blue: '#81a1c1',
      magenta: '#b48ead',
      cyan: '#88c0d0',
      white: '#e5e9f0',
      brightRed: '#bf616a',
      brightGreen: '#a3be8c',
      brightYellow: '#ebcb8b',
      brightBlue: '#81a1c1',
      brightMagenta: '#b48ead',
      brightCyan: '#88c0d0',
      brightWhite: '#e5e9f0'
    }
  },
  {
    id: 'dracula',
    label: 'Dracula',
    palette: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      cursorAccent: '#282a36',
      selectionBackground: 'rgba(255,121,198,0.30)',
      black: '#21222c',
      brightBlack: '#6272a4',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightRed: '#ff5555',
      brightGreen: '#50fa7b',
      brightYellow: '#f1fa8c',
      brightBlue: '#bd93f9',
      brightMagenta: '#ff79c6',
      brightCyan: '#8be9fd',
      brightWhite: '#f8f8f2'
    }
  },
  {
    id: 'solarized',
    label: 'Solarized Dark',
    palette: {
      background: '#002b36',
      foreground: '#839496',
      cursor: '#93a1a1',
      cursorAccent: '#002b36',
      selectionBackground: 'rgba(147,161,161,0.30)',
      black: '#073642',
      brightBlack: '#586e75',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightRed: '#dc322f',
      brightGreen: '#859900',
      brightYellow: '#b58900',
      brightBlue: '#268bd2',
      brightMagenta: '#d33682',
      brightCyan: '#2aa198',
      brightWhite: '#eee8d5'
    }
  },
  {
    id: 'one-dark',
    label: 'One Dark',
    palette: {
      background: '#282c34',
      foreground: '#abb2bf',
      cursor: '#528bff',
      cursorAccent: '#282c34',
      selectionBackground: 'rgba(82,139,255,0.30)',
      black: '#21252b',
      brightBlack: '#5c6370',
      red: '#e06c75',
      green: '#98c379',
      yellow: '#e5c07b',
      blue: '#61afef',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: '#d0d7e5',
      brightRed: '#e06c75',
      brightGreen: '#98c379',
      brightYellow: '#e5c07b',
      brightBlue: '#61afef',
      brightMagenta: '#c678dd',
      brightCyan: '#56b6c2',
      brightWhite: '#d0d7e5'
    }
  },
  {
    id: 'gruvbox',
    label: 'Gruvbox Dark',
    palette: {
      background: '#282828',
      foreground: '#ebdbb2',
      cursor: '#d79921',
      cursorAccent: '#282828',
      selectionBackground: 'rgba(215,153,33,0.30)',
      black: '#3c3836',
      brightBlack: '#928374',
      red: '#fb4934',
      green: '#b8bb26',
      yellow: '#fabd2f',
      blue: '#83a598',
      magenta: '#d3869b',
      cyan: '#8ec07c',
      white: '#ebdbb2',
      brightRed: '#fb4934',
      brightGreen: '#b8bb26',
      brightYellow: '#fabd2f',
      brightBlue: '#83a598',
      brightMagenta: '#d3869b',
      brightCyan: '#8ec07c',
      brightWhite: '#ebdbb2'
    }
  },
  {
    id: 'monokai',
    label: 'Monokai',
    palette: {
      background: '#272822',
      foreground: '#f8f8f2',
      cursor: '#f8f8f0',
      cursorAccent: '#272822',
      selectionBackground: 'rgba(248,248,242,0.28)',
      black: '#272822',
      brightBlack: '#75715e',
      red: '#f92672',
      green: '#a6e22e',
      yellow: '#f4bf75',
      blue: '#66d9ef',
      magenta: '#ae81ff',
      cyan: '#a1efe4',
      white: '#f9f8f5',
      brightRed: '#f92672',
      brightGreen: '#a6e22e',
      brightYellow: '#f4bf75',
      brightBlue: '#66d9ef',
      brightMagenta: '#ae81ff',
      brightCyan: '#a1efe4',
      brightWhite: '#f9f8f5'
    }
  }
]

export const PRESET_BY_ID: Record<string, TerminalPreset> = Object.fromEntries(
  PRESETS.map((p) => [p.id, p])
)

/** Returns the xterm theme for (app theme mode, saved terminalTheme id). */
export function themeFor(mode: 'light' | 'dark', custom?: string): TerminalPalette {
  if (custom) {
    const p = PRESET_BY_ID[custom]
    if (p) return p.palette
  }
  return mode === 'light' ? systemLight : systemDark
}
