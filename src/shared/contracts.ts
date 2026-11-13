export interface Counts {
  tp: number;
  fn: number;
  fp: number;
  tn: number;
}
export interface User {
  id: string;
  name: string;
}
interface ResultBase {
  resultId: string;
  startedByUserId: string;
  version: 1;
  n: number;
  completedAt: string;
}
export interface SpatialResultInput extends ResultBase, Counts {
  game: typeof GAME;
}
export interface DualCounts {
  position: Counts;
  color: Counts;
}
export interface ColorResultInput extends ResultBase, DualCounts {
  game: typeof COLOR_GAME;
}
export interface TripleCounts extends DualCounts {
  number: Counts;
}
export interface TripleResultInput extends ResultBase, TripleCounts {
  game: typeof TRIPLE_GAME;
}
export type GameCounts =
  | ({ game: typeof GAME } & Counts)
  | ({ game: typeof COLOR_GAME } & DualCounts)
  | ({ game: typeof TRIPLE_GAME } & TripleCounts);
export type ResultInput =
  SpatialResultInput | ColorResultInput | TripleResultInput;
export type SavedResult = ResultInput & {
  score: number;
  receivedAt: string;
};
export interface History {
  items: SavedResult[];
  page: number;
  total: number;
  pageSize: number;
}
export const GAME = "spatial-n-back" as const;
export const COLOR_GAME = "spatial-color-n-back" as const;
export const TRIPLE_GAME = "spatial-color-number-n-back" as const;
export const GAME_IDS = [GAME, COLOR_GAME, TRIPLE_GAME] as const;
export type GameId = (typeof GAME_IDS)[number];
export type Dimension = "position" | "color" | "number";
export const DIMENSION_NAMES: Record<Dimension, string> = {
  position: "位置",
  color: "颜色",
  number: "数字",
};
export const GAME_DIMENSIONS = {
  [GAME]: ["position"],
  [COLOR_GAME]: ["position", "color"],
  [TRIPLE_GAME]: ["position", "color", "number"],
} as const satisfies Record<GameId, readonly Dimension[]>;
export const GAME_NAMES: Record<GameId, string> = {
  [GAME]: "空间 N-back",
  [COLOR_GAME]: "位置＋颜色 N-back",
  [TRIPLE_GAME]: "位置＋颜色＋数字 N-back",
};
export const isGameId = (value: unknown): value is GameId =>
  value === GAME || value === COLOR_GAME || value === TRIPLE_GAME;
export const VERSION = 1 as const;
