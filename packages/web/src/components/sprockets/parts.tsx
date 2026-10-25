// A Sprocket's eyes, drawn round the face's centre. The renderer places and slants them (`s-slant`, from the pose)
// and draws each one's shape every frame (engine.ts): moved and sized, its lid, and how happy it is, the open eye
// squashing away as the happy arc (^) grows in.

const INK = "#17171c";
/** Distance from the face centre to each eye. */
export const EYE_X = 14.5;

export function Eyes({ slant }: { slant: number }) {
  return (
    <>
      {[-EYE_X, EYE_X].map((x) => (
        // Each eye in its own group, so its shape can change apart from the other's.
        <g key={x} className="s-eye">
          <g className="s-slant" data-x={x} transform={`rotate(${slant} ${x} 0)`}>
            <rect className="s-open" x={x - 7} y={-15.5} width={14} height={31} rx={7} fill={INK} />
            <path className="s-happy" opacity={0} d={`M${x - 10} 6 Q${x} -16 ${x + 10} 6`} fill="none" stroke={INK} strokeWidth={8} strokeLinecap="round" />
          </g>
        </g>
      ))}
    </>
  );
}
