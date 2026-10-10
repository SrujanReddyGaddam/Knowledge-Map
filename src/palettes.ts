export type Colors = { bg: string; panel: string; ink: string; mute: string; line: string; soft: string; near: string; far: string; accent: string };
type Pal = { name: string; swatch: string; light: Colors; dark: Colors };

// Each palette: tinted neutrals plus ONE accent (used for the selected node, its links and the active UI). Nothing louder than that.
export const PALETTES: Record<string, Pal> = {
  paper: {
    name: 'Paper', swatch: '#1d1d1b',
    light: { bg: '#efefed', panel: '#f6f6f4', ink: '#161614', mute: '#7b7a72', line: '#d9d9d4', soft: '#e7e7e3', near: '#1f1f1c', far: '#c8c7c0', accent: '#1d1d1b' },
    dark: { bg: '#141413', panel: '#191918', ink: '#ecece6', mute: '#8c8c84', line: '#2e2e2b', soft: '#232321', near: '#e6e6df', far: '#3a3a37', accent: '#ecece6' },
  },
  sage: {
    name: 'Sage', swatch: '#3f7a55',
    light: { bg: '#ecf0e8', panel: '#f3f6f0', ink: '#18201a', mute: '#74806d', line: '#d5dccf', soft: '#e3e9dd', near: '#2a3a2d', far: '#c0cab8', accent: '#3f7a55' },
    dark: { bg: '#121512', panel: '#171b17', ink: '#e7ece4', mute: '#87917f', line: '#2a312a', soft: '#202620', near: '#c9ddc9', far: '#2f3a30', accent: '#6fbf8a' },
  },
  clay: {
    name: 'Clay', swatch: '#c0562f',
    light: { bg: '#f3ede5', panel: '#f9f4ee', ink: '#231a15', mute: '#85766a', line: '#e1d6ca', soft: '#ede3d7', near: '#4a3328', far: '#d4c3b2', accent: '#c0562f' },
    dark: { bg: '#171210', panel: '#1d1714', ink: '#efe6dd', mute: '#948577', line: '#32282a', soft: '#261e19', near: '#ecd5c2', far: '#403126', accent: '#e07a52' },
  },
  ocean: {
    name: 'Ocean', swatch: '#2f6fb5',
    light: { bg: '#ebeff3', panel: '#f2f5f8', ink: '#121a24', mute: '#6f7c8b', line: '#d2dae3', soft: '#e0e7ee', near: '#22364d', far: '#bdcad8', accent: '#2f6fb5' },
    dark: { bg: '#10151b', panel: '#151b22', ink: '#e6ecf3', mute: '#7f8c9b', line: '#26303b', soft: '#1c242d', near: '#c6d8ee', far: '#2a3745', accent: '#5fa2ea' },
  },
  dusk: {
    name: 'Dusk', swatch: '#7a54c4',
    light: { bg: '#efecf3', panel: '#f5f3f9', ink: '#1b1822', mute: '#7a7487', line: '#dad5e3', soft: '#e6e2ee', near: '#38304f', far: '#c8c2d6', accent: '#7a54c4' },
    dark: { bg: '#15131a', panel: '#1a1820', ink: '#ece8f3', mute: '#8b8498', line: '#2d2938', soft: '#221f2b', near: '#d8cdf0', far: '#37314a', accent: '#a98af0' },
  },
};

export function applyColors(c: Colors) {
  const r = document.documentElement.style;
  r.setProperty('--bg', c.bg); r.setProperty('--panel', c.panel); r.setProperty('--ink', c.ink); r.setProperty('--mute', c.mute);
  r.setProperty('--line', c.line); r.setProperty('--soft', c.soft); r.setProperty('--accent', c.accent);
}
