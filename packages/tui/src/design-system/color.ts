// Adapted from dsh-TUI: src/components/Spinner/spinnerUtils.ts (interpolateColor),
// via apps/neant-tui/src/components/logo/bigfont.ts, at commit
// 646740f12c34546d6c195f5b7031be0dc67421a5.
// https://github.com/ccch1mneyyy/dsh-TUI
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function interpolateColor(color1: Rgb, color2: Rgb, t: number): Rgb {
  const blend = (from: number, to: number) => Math.round(from + (to - from) * t);
  return {
    r: blend(color1.r, color2.r),
    g: blend(color1.g, color2.g),
    b: blend(color1.b, color2.b),
  };
}

export function rgb(hex: `#${string}`): Rgb {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

export function hex({ r, g, b }: Rgb): `#${string}` {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}
