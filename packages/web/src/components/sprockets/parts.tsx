// Eyes and accessories. Each part draws in its own coordinates around its anchor's origin; the renderer
// places it. Parts never animate themselves: they mark swinging bits with s-dangle (hangs from its top)
// or s-wobble (stands on its bottom), and the CSS animates those.
import type { SprocketLook } from "@rails/shared";
import type { CharacterDef } from "./characters.ts";

const INK = "#17171c";
/** Distance from the face centre to each eye. */
export const EYE_X = 13;

export function Eyes({ tilt }: { tilt: number }) {
  return (
    <>
      {[-EYE_X, EYE_X].map((x) => (
        <rect key={x} x={x - 4.5} y={-11} width={9} height={22} rx={4.5} fill={INK} transform={`rotate(${tilt} ${x} 0)`} />
      ))}
    </>
  );
}

/** Drawn at the face centre. */
export function Eyewear({ id }: { id: SprocketLook["eyes"] }) {
  if (id === "sunglasses") {
    const lens = "M 3 -9 H 27 Q 29.5 -9 29 -6 L 27.5 4 Q 26.5 11 19 11 H 11 Q 4 11 3 4 Z";
    return (
      <g fill="#141416" transform="scale(1.12)">
        <path d={lens} />
        <path d={lens} transform="scale(-1 1)" />
        <rect x={-30} y={-10.5} width={60} height={4.5} rx={2.25} />
        <rect x={-37} y={-10} width={10} height={3.5} rx={1.75} />
        <rect x={27} y={-10} width={10} height={3.5} rx={1.75} />
        <path d="M 21 -4 L 17.5 4 M -9 -4 L -12.5 4" stroke="#fff" strokeOpacity={0.45} strokeWidth={2.6} strokeLinecap="round" />
      </g>
    );
  }
  if (id === "glasses") {
    return (
      <g fill="none" stroke="#141416" strokeWidth={3.5} strokeLinecap="round">
        <circle cx={-17} cy={0} r={15} fill="#fff" fillOpacity={0.14} />
        <circle cx={17} cy={0} r={15} fill="#fff" fillOpacity={0.14} />
        <path d="M -2 -3 Q 0 -5.5 2 -3 M -32 -3 L -40 -4 M 32 -3 L 40 -4" />
      </g>
    );
  }
  return null;
}

/** Drawn at the hat anchor (bottom centre of the hat). Headphones are drawn by `Headphones` instead. */
export function Hat({ id }: { id: SprocketLook["head"] }) {
  switch (id) {
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
      return (
        <g>
          <path d="M -40 8 C -38 -30 38 -30 40 8" fill="none" stroke="#F6A6C6" strokeWidth={9} strokeLinecap="round" />
          <g transform="translate(24 -21) rotate(14)">
            <g className="s-wobble">
              <path d="M 0 0 C -8 -16 -26 -14 -24 0 C -26 14 -8 16 0 0 Z" fill="#FFB8D3" />
              <path d="M 0 0 C 8 -16 26 -14 24 0 C 26 14 8 16 0 0 Z" fill="#FFB8D3" />
              <circle cx={0} cy={0} r={6} fill="#F27FAE" />
            </g>
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
    default:
      return null;
  }
}

/** Drawn at the ear line (`def.ears`), centred. Light, so the band shows against the dark page. */
export function Headphones({ ears }: { ears: CharacterDef["ears"] }) {
  const h = ears.half;
  const peak = ears.top - ears.y - 10;
  const c = (peak - 0.25 * -8) / 0.75; // control points that put the band's highest point at `peak`
  return (
    <g>
      <path d={`M ${-h + 1} -8 C ${-h + 1} ${c} ${h - 1} ${c} ${h - 1} -8`} fill="none" stroke="#ECE6D8" strokeWidth={8} strokeLinecap="round" />
      {[-1, 1].map((side) => (
        <g key={side} transform={`scale(${side} 1)`}>
          <rect x={h - 6} y={-21} width={15} height={42} rx={7.5} fill="#2A2A30" />
          <rect x={h + 5} y={-19} width={12} height={38} rx={6} fill="#ECE6D8" />
        </g>
      ))}
    </g>
  );
}

const SCARF = { main: "#9B6BEA", shade: "#8A5BDD" };

/** Drawn at the neck line (`def.neck`), centred. */
export function Scarf({ half, colors = SCARF }: { half: number; colors?: { main: string; shade: string } }) {
  return (
    <g>
      <g transform={`translate(${half - 22} 4)`}>
        <g className="s-dangle">
          <rect x={0} y={0} width={15} height={26} rx={6} fill={colors.shade} />
          <path d="M 4 22 V 29 M 7.5 22 V 30 M 11 22 V 29" stroke={colors.shade} strokeWidth={3} strokeLinecap="round" />
        </g>
      </g>
      <rect x={-half - 3} y={-9} width={2 * half + 6} height={18} rx={9} fill={colors.main} />
    </g>
  );
}
