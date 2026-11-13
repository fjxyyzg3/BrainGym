import {
  GAME,
  COLOR_GAME,
  type Counts,
  type DualCounts,
  type GameId,
} from "../shared/contracts.js";
import {
  assertLevel,
  TRIALS,
  STEP_MS,
  LIT_MS,
  type ColorStimulus,
} from "../shared/rules.js";
export type Dimension = "position" | "color";
type GameResult<G extends GameId> = G extends typeof GAME ? Counts : DualCounts;
export interface GameSnapshot {
  phase: "warmup" | "playing" | "finished" | "aborted";
  cell: number | null;
  color: number | null;
  lit: boolean;
  trial: number;
  answered: boolean;
  colorAnswered: boolean;
}
export class NBackGame<G extends GameId = typeof GAME> {
  private answers = { position: new Set<number>(), color: new Set<number>() };
  private sequence: { cell: number; color: number | null }[];
  private ended = false;
  private aborted = false;
  private counts: GameResult<G> | null = null;
  constructor(
    private n: number,
    sequence: G extends typeof GAME ? number[] : ColorStimulus[],
    private startedAt: number,
    private game: G = GAME as G,
  ) {
    assertLevel(n);
    if (
      sequence.length !== n + TRIALS ||
      ![GAME, COLOR_GAME].includes(game) ||
      sequence.some((x) => {
        const cell = typeof x === "number" ? x : x?.cell;
        const color = typeof x === "number" ? null : x?.color;
        return (
          !Number.isInteger(cell) ||
          cell < 0 ||
          cell > 8 ||
          (game === GAME
            ? typeof x !== "number"
            : !Number.isInteger(color) || color! < 0 || color! > 5)
        );
      })
    )
      throw new Error("无效的题目序列");
    this.sequence = sequence.map((x) =>
      typeof x === "number" ? { cell: x, color: null } : { ...x },
    );
  }
  tick(now: number): GameSnapshot {
    const elapsed = Math.max(0, now - this.startedAt);
    const index = Math.floor(elapsed / STEP_MS);
    if (!this.aborted && !this.ended && index >= this.sequence.length) {
      this.ended = true;
      const position = this.count("position");
      this.counts = (
        this.game === GAME ? position : { position, color: this.count("color") }
      ) as GameResult<G>;
    }
    if (this.aborted || this.ended)
      return {
        phase: this.aborted ? "aborted" : "finished",
        cell: null,
        color: null,
        lit: false,
        trial: TRIALS,
        answered: false,
        colorAnswered: false,
      };
    return {
      phase: index < this.n ? "warmup" : "playing",
      cell: this.sequence[index].cell,
      color: this.sequence[index].color,
      lit: elapsed % STEP_MS < LIT_MS,
      trial: index < this.n ? index + 1 : index - this.n + 1,
      answered: this.answers.position.has(index),
      colorAnswered: this.answers.color.has(index),
    };
  }
  answer(now: number, dimension: Dimension = "position"): boolean {
    const state = this.tick(now);
    if (
      state.phase !== "playing" ||
      (dimension !== "position" && dimension !== "color") ||
      (dimension === "color" && this.game !== COLOR_GAME)
    )
      return false;
    const index = Math.floor(Math.max(0, now - this.startedAt) / STEP_MS);
    if (this.answers[dimension].has(index)) return false;
    this.answers[dimension].add(index);
    return true;
  }
  abort(): void {
    if (!this.ended) this.aborted = true;
  }
  private count(dimension: Dimension): Counts {
    const counts: Counts = { tp: 0, fn: 0, fp: 0, tn: 0 };
    const key = dimension === "position" ? "cell" : "color";
    for (let i = this.n; i < this.sequence.length; i++) {
      const match = this.sequence[i][key] === this.sequence[i - this.n][key];
      const answered = this.answers[dimension].has(i);
      counts[match ? (answered ? "tp" : "fn") : answered ? "fp" : "tn"]++;
    }
    return counts;
  }
  get result(): GameResult<G> | null {
    return this.counts ? structuredClone(this.counts) : null;
  }
}
