// Eyes and accessories. Each part draws in its own coordinates around its anchor's origin; the renderer
// places it. Parts never animate themselves: they mark bits that wobble with s-wobble (stands on its
// bottom), and the CSS animates those.
import { useLayoutEffect, useRef } from "react";
import type { SprocketAccessory } from "@rails/shared";

const INK = "#17171c";
/** Distance from the face centre to each eye. */
const EYE_X = 13;

export function Eyes({ tilt }: { tilt: number }) {
  return (
    <>
      {[-EYE_X, EYE_X].map((x) => (
        <rect key={x} x={x - 4.5} y={-11} width={9} height={22} rx={4.5} fill={INK} transform={`rotate(${tilt} ${x} 0)`} />
      ))}
    </>
  );
}

/** A horizontal band of a cone, from `t0` to `t1` (0 = base, 1 = tip). */
function coneBand(t0: number, t1: number, half: number, height: number): string {
  const at = (t: number, side: number) => `${(side * half * (1 - t)).toFixed(1)} ${(-height * t).toFixed(1)}`;
  return `M ${at(t0, -1)} L ${at(t1, -1)} L ${at(t1, 1)} L ${at(t0, 1)} Z`;
}

/** Drawn at the hat anchor (bottom centre of the hat). */
export function Hat({ id }: { id: SprocketAccessory }) {
  switch (id) {
    case "party":
      return (
        <g transform="rotate(8)">
          <g className="s-wobble">
            <circle cx={0} cy={-58} r={8} fill="#FFD34D" />
          </g>
          <path d={coneBand(0, 0.34, 26, 56)} fill="#FF8FB4" />
          <path d={coneBand(0.34, 0.66, 26, 56)} fill="#FFD34D" />
          <path d={coneBand(0.66, 1, 26, 56)} fill="#6FC3FF" />
          <rect x={-28} y={-4} width={56} height={7} rx={3.5} fill="#F2709F" />
        </g>
      );
    case "beanie":
      return (
        <g>
          <g className="s-wobble">
            <circle cx={0} cy={-44} r={11} fill="#F0453A" />
          </g>
          <path d="M -38 2 C -38 -46 38 -46 38 2 Z" fill="#F0453A" />
          <path d="M -20 -10 V -28 M 0 -10 V -34 M 20 -10 V -28" stroke="#D63A30" strokeWidth={3} strokeLinecap="round" />
          <rect x={-41} y={-12} width={82} height={18} rx={9} fill="#D9392F" />
        </g>
      );
    case "cap":
      return (
        <g>
          <path d="M -34 2 C -34 -44 34 -44 34 2 Z" fill="#F3EFE6" />
          <path d="M 2 -40 C 18 -38 32 -24 34 2 L 14 2 C 14 -16 10 -30 2 -40 Z" fill="#2E6BEB" />
          <path d="M 16 -1 C 32 -13 62 -13 66 -4 C 64 4 40 7 16 4 Z" fill="#2559C9" />
          <circle cx={0} cy={-41} r={5} fill="#2E6BEB" />
        </g>
      );
    case "bow":
      // Sits to the right of the top of the head.
      return (
        <g transform="translate(24 -4) rotate(16)">
          <g className="s-wobble">
            <path d="M 0 -2 C -6 -20 -30 -22 -28 -4 C -30 14 -6 14 0 2 Z" fill="#FFB0CF" />
            <path d="M 0 -2 C 6 -20 30 -22 28 -4 C 30 14 6 14 0 2 Z" fill="#FFB0CF" />
            <rect x={-7} y={-9} width={14} height={16} rx={6} fill="#F585B3" />
          </g>
        </g>
      );
    case "flower":
      // A hair clip: the pink clip points back, the flower sits on the front.
      return (
        <g transform="translate(26 4) rotate(-12)">
          <rect x={-2} y={-5} width={34} height={10} rx={5} fill="#F79AC0" />
          <rect x={6} y={-1.5} width={20} height={3} rx={1.5} fill="#FFD5E5" />
          <g className="s-wobble">
            {[0, 72, 144, 216, 288].map((a) => (
              <circle key={a} cx={0} cy={-10} r={8.5} fill="#FFFBF2" transform={`rotate(${a})`} />
            ))}
            <circle cx={0} cy={0} r={7} fill="#FFC531" />
          </g>
        </g>
      );
    case "crown":
      return (
        <g>
          <path d="M -30 0 L -34 -30 L -15 -13 L 0 -36 L 15 -13 L 34 -30 L 30 0 Z" fill="#FFC83A" stroke="#FFC83A" strokeWidth={5} strokeLinejoin="round" />
          <rect x={-31} y={-9} width={62} height={9} rx={3} fill="#F2AE18" />
          <circle cx={-34} cy={-31} r={5.5} fill="#FFD95E" />
          <circle cx={0} cy={-38} r={5.5} fill="#FFD95E" />
          <circle cx={34} cy={-31} r={5.5} fill="#FFD95E" />
        </g>
      );
    case "bucket":
      // Lifted so the brim, not the crown, rests on the hat line (it sat too low on Block and Momo).
      return (
        <g transform="translate(0 -7)">
          <path d="M -30 -2 L -25 -34 Q 0 -42 25 -34 L 30 -2 Z" fill="#A574EE" />
          <path d="M -29 -9 Q 0 -13 29 -9" fill="none" stroke="#8E5DDB" strokeWidth={4} strokeLinecap="round" />
          <path d="M -46 6 Q -38 -6 -30 -6 L 30 -6 Q 38 -6 46 6 Q 0 14 -46 6 Z" fill="#8E5DDB" />
        </g>
      );
  }
}

/**
 * An accessory on its own (the creator's accessory row), scaled to fill a `size` square. Its viewBox
 * is fitted to the drawing after the first render, since each accessory has its own extent.
 */
export function AccessoryIcon({ id, size }: { id: SprocketAccessory; size: number }) {
  const svg = useRef<SVGSVGElement>(null);
  const g = useRef<SVGGElement>(null);
  useLayoutEffect(() => {
    const b = g.current!.getBBox();
    const side = Math.max(b.width, b.height) + 6;
    svg.current!.setAttribute("viewBox", `${b.x + b.width / 2 - side / 2} ${b.y + b.height / 2 - side / 2} ${side} ${side}`);
  }, [id]);
  return (
    <svg ref={svg} className="sp-accessory" width={size} height={size} viewBox="-60 -70 130 90" aria-hidden>
      <g ref={g}>
        <Hat id={id} />
      </g>
    </svg>
  );
}
