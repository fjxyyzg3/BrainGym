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
export type GameCounts =
  ({ game: typeof GAME } & Counts) | ({ game: typeof COLOR_GAME } & DualCounts);
export type ResultInput = SpatialResultInput | ColorResultInput;
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
export type GameId = typeof GAME | typeof COLOR_GAME;
export const GAME_NAMES: Record<GameId, string> = {
  [GAME]: "空间 N-back",
  [COLOR_GAME]: "位置＋颜色 N-back",
};
export const isGameId = (value: unknown): value is GameId =>
  value === GAME || value === COLOR_GAME;
export const VERSION = 1 as const;
