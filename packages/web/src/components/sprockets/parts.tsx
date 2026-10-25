// A Sprocket's eyes, drawn round the face's centre. The renderer places and slants them (`s-slant`, from the pose)
// and draws each one's shape every frame (engine.ts): moved and sized, its lid, and how happy it is, the open eye
// squashing away as the happy arc (^) grows in.

const INK = "#17171c";
/** Distance from the face centre to each eye. */
export const EYE_X = 14.5;
/** How much further out the happy arcs sit than the open eyes, so ^ ^ isn't crowded. */
const HAPPY_OUT = 4;

export function Eyes({ slant }: { slant: number }) {
  return (
    <>
      {[-EYE_X, EYE_X].map((x) => (
        // Each eye in its own group, so its shape can change apart from the other's.
        <g key={x} className="s-eye">
          <g className="s-slant" data-x={x} transform={`rotate(${slant} ${x} 0)`}>
            <rect className="s-open" x={x - 7} y={-15.5} width={14} height={31} rx={7} fill={INK} />
            <path className="s-happy" opacity={0} d={`M${x + Math.sign(x) * HAPPY_OUT - 10} 6 Q${x + Math.sign(x) * HAPPY_OUT} -16 ${x + Math.sign(x) * HAPPY_OUT + 10} 6`} fill="none" stroke={INK} strokeWidth={8} strokeLinecap="round" />
          </g>
        </g>
      ))}
    </>
  );
}
