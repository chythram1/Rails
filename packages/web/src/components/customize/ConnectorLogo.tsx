import { IconBooks as Books, IconFolder as Folder, IconPlug as Plug, IconTerminal2 as Terminal, IconWorldSearch as WorldSearch } from "@tabler/icons-react";
import type { McpServer } from "@rails/shared";
import { LOGOS } from "./logos.ts";

/** Connectors without a brand mark in simple-icons, and custom servers, get one of these. */
const ICONS: Record<string, typeof Plug> = { context7: Books, deepwiki: WorldSearch, filesystem: Folder };

/** Relative luminance of a brand colour: near-black or near-white marks would vanish on one of the themes. */
function luminance(hex: string): number {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * A connector's mark on a square tile (`size` is the tile's side), filled in its brand colour with the mark in white or
 * black, whichever reads; a brand that's grey near black (GitHub, Notion, Vercel) gets the text colour instead, so it stands
 * out on either theme. One without a brand mark, and a custom server (a plug for a URL, a terminal for a command), gets
 * an icon on the tint.
 */
export function ConnectorLogo({ id, server, size = 40 }: { id?: string; server?: McpServer; size?: number }) {
  const key = id ?? server?.connector;
  const logo = key ? LOGOS[key] : undefined;
  const glyph = Math.round(size * 0.5);
  const style = { "--size": `${size}px` } as React.CSSProperties;
  if (!logo) {
    const Icon = (key && ICONS[key]) || (server?.transport === "stdio" ? Terminal : Plug);
    return (
      <span className="cz-logo cz-logo-soft" style={style} aria-hidden>
        <Icon size={glyph} stroke={1.8} />
      </span>
    );
  }
  const l = luminance(logo.hex);
  // Near black and without a hue (GitHub, Notion, Vercel); a dark colour (Atlassian's blue, Sentry's purple) keeps it.
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(logo.hex.slice(i, i + 2), 16));
  const ink = l < 0.12 && Math.max(r, g, b) - Math.min(r, g, b) < 40;
  return (
    <span className={ink ? "cz-logo cz-logo-ink" : "cz-logo cz-logo-brand"} style={ink ? style : { ...style, background: `#${logo.hex}`, color: l > 0.4 ? "#000" : "#fff" }} aria-hidden>
      <svg viewBox="0 0 24 24" width={glyph} height={glyph} fill="currentColor">
        <path d={logo.path} />
      </svg>
    </span>
  );
}

/** The mark alone, without its tile (`size` is the glyph's), for chips and small places. */
export function ConnectorGlyph({ id, server, size }: { id?: string; server?: McpServer; size: number }) {
  const key = id ?? server?.connector;
  const logo = key ? LOGOS[key] : undefined;
  const Icon = (key && ICONS[key]) || (server?.transport === "stdio" ? Terminal : Plug);
  const l = logo ? luminance(logo.hex) : 0;
  return logo ? (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={l < 0.12 || l > 0.85 ? "currentColor" : `#${logo.hex}`} aria-hidden>
      <path d={logo.path} />
    </svg>
  ) : (
    <Icon size={size} stroke={1.6} aria-hidden />
  );
}
