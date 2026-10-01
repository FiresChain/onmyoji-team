export interface PanelBase {
  attack: number;
  hp: number;
  defense: number;
  speed: number;
  crit: number;
  critDamage: number;
  effectHit: number;
  effectResist: number;
}

export interface InnateBonus {
  attackPercent: number;
  hpPercent: number;
  defensePercent: number;
  speed: number;
  crit: number;
  critDamage: number;
  effectHit: number;
  effectResist: number;
}

type ReferenceBase = Pick<PanelBase, 'attack' | 'hp' | 'defense' | 'speed' | 'crit' | 'critDamage'>;

export interface ReferenceComparison {
  referenceCount: number;
  matchedCount: number;
  mismatches: Array<{ heroId: number; fields: Array<keyof ReferenceBase> }>;
}

export interface GenerateOptions {
  catalog: string;
  awakeDir: string;
  nativeDir: string;
  skillDir: string;
  output: string;
  auditOutput: string;
  fetch: boolean;
  reference: string | null;
}

export function awakeForRarity(rarity: string): 0 | 1;
export function parseOfficialAttr(response: unknown, heroId: number): PanelBase;
export function parseAwakening(response: unknown, heroId: number): InnateBonus;
export function splitPanel(official: PanelBase, innate: InnateBonus, heroId: number): PanelBase;
export function compareReference(
  panels: Array<{ heroId: number; base: ReferenceBase }>,
  reference: { schemaVersion: number; panels: Array<{ heroId: number; base: ReferenceBase }> },
): ReferenceComparison;
export function generate(options: GenerateOptions): Promise<{
  schemaVersion: 1;
  catalogCount: number;
  supportedCount: number;
  unsupported: Array<{ heroId: number; reason: string }>;
  reference?: ReferenceComparison;
}>;
