// A Sprocket's eyes, drawn round the face's centre; the renderer places them, and motion.ts animates each one. Each
// eye is drawn open and happy (^, shown while the Sprocket has the class `joy`).

const INK = "#17171c";
/** Distance from the face centre to each eye. */
const EYE_X = 13;

export function Eyes({ tilt }: { tilt: number }) {
  return (
    <>
      {[-EYE_X, EYE_X].map((x) => (
        // Each eye in its own group, so expressions (motion.ts) can squash, move and size them apart.
        <g key={x} className="s-eye">
          <rect className="s-open" x={x - 4.5} y={-11} width={9} height={22} rx={4.5} fill={INK} transform={`rotate(${tilt} ${x} 0)`} />
          <path className="s-happy" d={`M${x - 8} 4 Q${x} -12 ${x + 8} 4`} fill="none" stroke={INK} strokeWidth={5.5} strokeLinecap="round" />
        </g>
      ))}
    </>
  );
}
