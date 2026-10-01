export type Point = [number, number];
export interface OcrLine { text: string; score: number; poly: Point[] }
export interface Rect { x: number; y: number; width: number; height: number }
export interface Asset { id: string; name: string; avatar: string; rarity?: string; type?: string }
export interface Catalog { version: string; shikigami: Asset[]; yuhun: Asset[] }
export const STATS = [
  ['attack', '攻击', false], ['hp', '生命', false], ['defense', '防御', false],
  ['speed', '速度', false], ['crit', '暴击', true], ['critDamage', '暴击伤害', true],
  ['effectHit', '效果命中', true], ['effectResist', '效果抵抗', true],
] as const;
export type Stat = typeof STATS[number][0];
export interface Candidate { catalogId: string; name: string; similarity: number }
export interface SoulMatch {
  catalogId: string | null;
  name: string | null;
  status: 'candidate' | 'unrecognized' | 'unavailable';
  candidates: Candidate[];
}
export interface Member {
  slot: number;
  shikigami: { id: string | null; name: string | null; rawText: string | null; candidates: Candidate[] };
  panel: Record<Stat, number | null>;
  yuhun: SoulMatch;
  needsReview: string[];
}
export interface TeamDraft {
  schemaVersion: 1;
  source: 'duel-quiz-screenshot';
  side: 'red' | 'blue' | null;
  catalogVersion: string | null;
  percentageUnit: 'percentage-points';
  members: Member[];
  warnings: string[];
  unresolved: string[];
}
export type SoulRegionSource = 'label' | 'estimated' | 'unavailable';
export interface SoulRegionAdjustment { offsetX: number; offsetY: number; scale: number }
export interface SoulScoreBreakdown {
  structure: number;
  color: number;
  pixel: number;
  total: number;
}
export interface SoulCandidatePreview extends Candidate {
  avatar: string;
  sourceScale: number;
  templateScale: number;
  sourceOffsetX: number;
  sourceOffsetY: number;
  sourceRegion: Rect;
  scores: SoulScoreBreakdown;
  rejectionReasons: string[];
  screenshotDataUrl: string;
  templateDataUrl: string;
}
export interface SoulRegionDiagnostic {
  slot: number;
  region: Rect;
  cropDataUrl: string | null;
  candidates: SoulCandidatePreview[];
  matchStatus: SoulMatch['status'] | 'pending';
  reason: string | null;
}
export interface ParsedTeam { draft: TeamDraft; soulRegions: Rect[]; soulRegionSource: SoulRegionSource }
export interface RecognitionResult {
  draft: TeamDraft;
  raw: {
    image: { width: number; height: number };
    originalImage: { width: number; height: number };
    items: OcrLine[];
    elapsedMs: number;
  };
  soulRegions: Rect[];
  soulRegionBaseline: Rect[];
  soulAdjustment: SoulRegionAdjustment;
  soulRegionSource: SoulRegionSource;
  soulDiagnostics: SoulRegionDiagnostic[];
}
