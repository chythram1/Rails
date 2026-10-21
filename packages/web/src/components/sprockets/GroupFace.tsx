import type { SprocketLook } from "@rails/shared";
import { Sprocket, VIEW } from "./Sprocket.tsx";

/**
 * Where each member stands in a group's picture (ADR 0022), as fractions of the box: how big each character is,
 * then the others' places (behind) and the lead's (in front, at the bottom). Two overlap corner to corner, three
 * stand in a triangle, four in a square.
 */
const LAYOUTS: Record<number, { scale: number; others: [number, number][]; lead: [number, number] }> = {
  1: { scale: 1, others: [], lead: [0, 0] },
  2: { scale: 0.7, others: [[1, 0]], lead: [0, 1] },
  3: { scale: 0.64, others: [[0, 0], [1, 0]], lead: [0.5, 1] },
  4: { scale: 0.58, others: [[0, 0], [1, 0], [1, 1]], lead: [0, 1] },
};

/**
 * A group chat's picture: its members' characters, standing still (lists and headers), in the box a single
 * Sprocket of `size` takes, so rows line up. The lead (the first look) stands in front.
 */
export function GroupFace({ looks, size }: { looks: { look: SprocketLook; id: string }[]; size: number }) {
  const shown = looks.slice(0, 4);
  const layout = LAYOUTS[Math.max(1, shown.length)];
  const width = size;
  const height = (size * VIEW.h) / VIEW.w;
  const w = width * layout.scale;
  const h = height * layout.scale;
  const place = ([x, y]: [number, number]) => ({ left: x * (width - w), top: y * (height - h) });
  const [lead, ...others] = shown;
  return (
    <span className="sp-face" style={{ width, height }} aria-hidden>
      {others.map((m, i) => (
        <span key={m.id} style={place(layout.others[i])}>
          <Sprocket look={m.look} size={w} seed={m.id} still />
        </span>
      ))}
      {lead && (
        <span style={place(layout.lead)}>
          <Sprocket look={lead.look} size={w} seed={lead.id} still />
        </span>
      )}
    </span>
  );
}
