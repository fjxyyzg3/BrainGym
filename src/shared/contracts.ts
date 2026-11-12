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
export interface ResultInput extends Counts {
  resultId: string;
  startedByUserId: string;
  game: "spatial-n-back";
  version: 1;
  n: number;
  completedAt: string;
}
export interface SavedResult extends ResultInput {
  score: number;
  receivedAt: string;
}
export interface History {
  items: SavedResult[];
  page: number;
  total: number;
  pageSize: number;
}
export const GAME = "spatial-n-back" as const;
export const VERSION = 1 as const;
