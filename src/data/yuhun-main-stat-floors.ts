import type { MainStat } from '../calculation-types';

/**
 * Empirical six-star level-0 main attributes. Two anonymized local yyx exports
 * contained 9,863 such pieces; all 11 observed attribute types had one value
 * each in both exports. This is not an official complete progression table.
 * Using these as bounds for higher levels assumes strengthening never lowers
 * a main attribute. No values are inferred for one- through five-star souls.
 */
export const SIX_STAR_ZERO_FIXED = { attack: 81, hp: 342, defense: 14 } as const;

export const SIX_STAR_ZERO_MAIN: Readonly<Record<MainStat, number>> = {
  attackPercent: .10,
  hpPercent: .10,
  defensePercent: .10,
  speed: 12,
  crit: .10,
  critDamage: .14,
  effectHit: .10,
  effectResist: .10,
};
