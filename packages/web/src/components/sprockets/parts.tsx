// A Sprocket's eyes, drawn round the face's centre; the renderer places and slants them (`s-slant`, from the pose),
// and motion.ts animates each one. Each eye is drawn open and happy (^, shown while the Sprocket has the class `joy`).

const INK = "#17171c";
/** Distance from the face centre to each eye. */
const EYE_X = 14.5;

export function Eyes({ slant }: { slant: number }) {
  return (
    <>
      {[-EYE_X, EYE_X].map((x) => (
        // Each eye in its own group, so expressions (motion.ts) can squash, move and size them apart.
        <g key={x} className="s-eye">
          <g className="s-slant" data-x={x} transform={`rotate(${slant} ${x} 0)`}>
            <rect className="s-open" x={x - 7} y={-15.5} width={14} height={31} rx={7} fill={INK} />
            <path className="s-happy" d={`M${x - 10} 6 Q${x} -16 ${x + 10} 6`} fill="none" stroke={INK} strokeWidth={8} strokeLinecap="round" />
          </g>
        </g>
      ))}
    </>
  );
}
