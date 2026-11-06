// Colour comes from the neutral hue gene (PLAN §6), and body energy shows as lightness so
// starvation is visible without a graph. Bucketed keys let the renderer batch many entities per
// fill instead of setting a style per organism.

export const HUE_BUCKETS = 24;
export const ENERGY_BANDS = 3;

export function hueBucket(hue: number): number {
  const h = ((hue % 360) + 360) % 360;
  return Math.min(HUE_BUCKETS - 1, Math.floor((h / 360) * HUE_BUCKETS));
}

/** key = hueBucket * ENERGY_BANDS + energyBand, so the colour table is indexable by key. */
export const paletteKey = (hue: number, energyFraction: number): number =>
  hueBucket(hue) * ENERGY_BANDS + Math.min(ENERGY_BANDS - 1, Math.max(0, Math.round(energyFraction * (ENERGY_BANDS - 1))));

const LIGHTNESS: readonly number[] = [22, 40, 60];

export const PALETTE: string[] = Array.from({ length: HUE_BUCKETS * ENERGY_BANDS }, (_, i) => {
  const hue = Math.round((Math.floor(i / ENERGY_BANDS) / HUE_BUCKETS) * 360);
  return `hsl(${hue} 70% ${LIGHTNESS[i % ENERGY_BANDS] ?? 50}%)`;
});
