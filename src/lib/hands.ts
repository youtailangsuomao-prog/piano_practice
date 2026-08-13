export function medianPitch(midis: number[]): number {
  if (midis.length === 0) return 60;
  const sorted = [...midis].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
