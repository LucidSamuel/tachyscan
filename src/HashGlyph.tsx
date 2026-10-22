import { hashTint } from './lib';

const CELLS = 5;

/** Which cells of a 5×5 grid are lit for a hash. Columns mirror around the centre so each
 *  glyph reads as a shape rather than noise; 15 bits from the hash decide the left half. */
export function glyphCells(hash: string): boolean[] {
  const bytes = hash.replace(/[^0-9a-f]/gi, '');
  const bits: boolean[] = [];
  for (let i = 0; i < 15; i += 1) {
    const nibble = parseInt(bytes[(i * 2) % bytes.length] ?? '0', 16);
    bits.push((nibble & 1) === 1 || (nibble & 8) === 8);
  }
  const cells: boolean[] = [];
  for (let row = 0; row < CELLS; row += 1) {
    for (let col = 0; col < CELLS; col += 1) {
      const mirrored = col > 2 ? CELLS - 1 - col : col;
      cells.push(bits[row * 3 + mirrored]);
    }
  }
  return cells;
}

/** A small deterministic mark for a hash so the same value is recognisable across views. */
export function HashGlyph({ hash, size = 14, title }: { hash: string; size?: number; title?: string }) {
  if (!hash) return null;
  const cells = glyphCells(hash);
  const tint = hashTint(hash);
  const unit = 10;
  return (
    <svg
      class="hash-glyph"
      width={size}
      height={size}
      viewBox={`0 0 ${CELLS * unit} ${CELLS * unit}`}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      shape-rendering="crispEdges"
    >
      {title && <title>{title}</title>}
      {cells.map((lit, index) => lit && (
        <rect
          key={index}
          x={(index % CELLS) * unit}
          y={Math.floor(index / CELLS) * unit}
          width={unit}
          height={unit}
          fill={tint}
        />
      ))}
    </svg>
  );
}
