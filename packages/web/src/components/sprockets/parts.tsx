// A Sprocket's eyes, drawn round the face's centre; the renderer places them, and motion.ts animates each one.

const INK = "#17171c";
/** Distance from the face centre to each eye. */
const EYE_X = 13;

export function Eyes({ tilt }: { tilt: number }) {
  return (
    <>
      {[-EYE_X, EYE_X].map((x) => (
        // Each eye in its own group, so expressions (motion.ts) can squash, move and size them apart.
        <g key={x} className="s-eye">
          <rect x={x - 4.5} y={-11} width={9} height={22} rx={4.5} fill={INK} transform={`rotate(${tilt} ${x} 0)`} />
        </g>
      ))}
    </>
  );
}
