import type { Stat } from './types';

export type CalculationMetricId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
export type ReproductionStat = Exclude<Stat, 'effectHit'>;
export interface HitMetricPools { shikigamiIds: string[]; yuhunIds: string[] }
export interface CalculationMetric {
  id: CalculationMetricId;
  name: string;
  stats: readonly Stat[];
}
export interface ConstraintDraft { enabled: boolean; min: string; max: string }
export interface CalculationLimitDraft { id: number; stat: Stat; min: string; max: string }
export type MainStatSlot = 2 | 4 | 6;
export type MainStat = 'attackPercent' | 'hpPercent' | 'defensePercent' | 'speed' | 'effectHit' | 'effectResist' | 'crit' | 'critDamage';
export type ExtraAttributeStat = 'attackPercent' | 'attack' | 'crit' | 'critDamage';
export interface CalculationShikigami { catalogId: string | null; name: string | null }
export interface SuitRequirement {
  catalogId: string | null;
  name: string;
  count: 2 | 4;
  kind: 'suit' | 'two-piece-effect';
}
export interface CalculationMemberDraft {
  slot: number;
  shikigami: CalculationShikigami | null;
  enabled: boolean;
  metricId: CalculationMetricId;
  targetScore: string;
  suitRequirements: SuitRequirement[];
  suitSelectionComplete: boolean;
  mainStats: Record<MainStatSlot, MainStat[]>;
  highestStat: Stat | null;
  extraAttributes: Record<ExtraAttributeStat, string>;
  scope: 'all' | 'unequipped';
  sixStarOnly: boolean;
  maxLevelOnly: boolean;
  excludeOccupied: boolean;
  limits: CalculationLimitDraft[];
}
export interface CalculationDraft {
  name: string;
  scene: string;
  calculationMode: 'difficulty' | 'force';
  difficulty: string;
  hitMetricPools: HitMetricPools;
  reproduction: { tolerancePercent: string; constraintStats: ReproductionStat[]; orderStats: ReproductionStat[] };
  members: CalculationMemberDraft[];
}
export interface CalculationIssue { slot: number | null; stat?: Stat; field?: string; message: string }
export interface CalculationRange {
  stat: Stat;
  min?: number;
  max?: number;
  percentage: boolean;
}
export interface CalculationPrecheckDiagnostic {
  slot: number;
  status: 'conflict' | 'relaxed' | 'manual-adjustment' | 'optimized' | 'compatible' | 'unchecked';
  reason: string;
  phase: 'base' | 'strict-order';
  checkedCombinations: number;
  survivingCombinations: number | null;
  removedMainStats: Record<MainStatSlot, MainStat[]>;
  /** Fixed main-attribute contribution to remove manually after calculation. */
  manualAdjustments?: {
    position: 1 | 3 | 5;
    stat: 'attack' | 'defense' | 'hp';
    amount: number;
    originalMax: number;
    calculationMax: number;
  }[];
}
export interface CalculationConfig {
  mode: 'screenshot-reproduction';
  percentageUnit: 'percentage-points';
  extraAttributesPercentageUnit: 'ratio';
  name: string;
  scene: string;
  calculationMode: 'difficulty' | 'force';
  difficulty: number | null;
  hitMetricPools: HitMetricPools;
  reproduction: { tolerancePercent: number; constraintStats: ReproductionStat[]; orderStats: ReproductionStat[] };
  targets: {
    slot: number;
    shikigami: CalculationShikigami | null;
    yuhunConfigEnabled: boolean;
    metricId: CalculationMetricId;
    metricName: string;
    targetScore: number | null;
    suitRequirements: SuitRequirement[];
    suitSelectionComplete: boolean;
    mainStats: Record<MainStatSlot, MainStat[]>;
    highestStat: Stat | null;
    extraAttributes: Partial<Record<ExtraAttributeStat, number>>;
    scope: 'all' | 'unequipped';
    sixStarOnly: boolean;
    maxLevelOnly: boolean;
    excludeOccupied: boolean;
    ranges: CalculationRange[];
  }[];
}
