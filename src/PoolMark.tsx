const CELLS = 7;
const UNIT = 10;

/** Pool pictograms in the same pixel language as the hash glyphs, on a 7×7 grid so the
 *  shapes read: a bolt for Tachyon, an eye for transparent, a seedling, a conifer, and two
 *  apples. `#` is lit, `@` is the bright head. */
const PATTERNS: Record<string, string[]> = {
  tachyon: [
    '....@@.',
    '...@@..',
    '..##...',
    '.#####.',
    '...##..',
    '..##...',
    '.#.....',
  ],
  transparent: [
    '.......',
    '..###..',
    '.#...#.',
    '#..#..#',
    '.#...#.',
    '..###..',
    '.......',
  ],
  sprout: [
    '.......',
    '.#...#.',
    '.##.##.',
    '..###..',
    '...#...',
    '...#...',
    '...#...',
  ],
  sapling: [
    '...#...',
    '..###..',
    '.#####.',
    '..###..',
    '.#####.',
    '#######',
    '...#...',
  ],
  orchard: [
    '...#...',
    '..#....',
    '.#####.',
    '#.....#',
    '#.....#',
    '.#...#.',
    '..#.#..',
  ],
  ironwood: [
    '...#...',
    '....#..',
    '.#####.',
    '#######',
    '#######',
    '.#####.',
    '..#.#..',
  ],
};

export function poolMarkCells(pool: string): string[] {
  return PATTERNS[pool] ?? PATTERNS.transparent;
}

export function PoolMark({ pool, size = 14 }: { pool: string; size?: number }) {
  const rows = poolMarkCells(pool);
  return (
    <svg
      class={`pool-mark ${pool}`}
      width={size}
      height={size}
      viewBox={`0 0 ${CELLS * UNIT} ${CELLS * UNIT}`}
      aria-hidden="true"
      shape-rendering="crispEdges"
    >
      {rows.flatMap((row, y) => [...row].map((cell, x) => cell !== '.' && (
        <rect key={`${x}-${y}`} class={cell === '@' ? 'head' : undefined} x={x * UNIT} y={y * UNIT} width={UNIT} height={UNIT} />
      )))}
    </svg>
  );
}
