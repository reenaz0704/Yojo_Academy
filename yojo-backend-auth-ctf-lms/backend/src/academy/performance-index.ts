/** Performance index parts, each a percentage, or null when the student has no data for that part yet. */
export type PiParts = { attendance: number | null; quiz: number | null; labs: number | null };
export type PiWeights = { attendance: number; quiz: number; labs: number };

/**
 * Weighted performance index (OI-42, owner 24 Oct: attendance 20, quiz average 40, labs cleared 40, from
 * settings.policy.piWeights). Parts without data are left out and the remaining weights are scaled up to 100, so a
 * student with only attendance marks is not pulled down by empty quiz and lab parts. Null when no part has data.
 */
export function performanceIndex(parts: PiParts, w: PiWeights): number | null {
  let sum = 0;
  let weight = 0;
  for (const k of ['attendance', 'quiz', 'labs'] as const) {
    const v = parts[k];
    if (v === null || !w[k]) continue;
    sum += v * w[k];
    weight += w[k];
  }
  return weight ? Math.round(sum / weight) : null;
}
