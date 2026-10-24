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
 * A connector's mark on a square ruled tile (`size` is the tile's side): its brand mark in its colour (as agent logos
 * keep theirs), in the text colour when the brand's is too dark or too light to read on either theme, or an icon.
 * A custom server shows a plug (a URL) or a terminal (a command).
 */
export function ConnectorLogo({ id, server, size = 40 }: { id?: string; server?: McpServer; size?: number }) {
  return (
    <span className="cz-logo" style={{ "--size": `${size}px` } as React.CSSProperties} aria-hidden>
      <ConnectorGlyph id={id} server={server} size={Math.round(size * 0.5)} />
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
