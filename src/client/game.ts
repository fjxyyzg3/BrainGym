import {
  GAME,
  COLOR_GAME,
  TRIPLE_GAME,
  GAME_DIMENSIONS,
  isNBackGameId,
  type Counts,
  type DualCounts,
  type TripleCounts,
  type Dimension,
  type NBackGameId,
} from "../shared/contracts.js";
import {
  assertLevel,
  TRIALS,
  STEP_MS,
  LIT_MS,
  type ColorStimulus,
  type TripleStimulus,
} from "../shared/rules.js";
export type { Dimension } from "../shared/contracts.js";
type GameResult<G extends NBackGameId> = G extends typeof GAME
  ? Counts
  : G extends typeof COLOR_GAME
    ? DualCounts
    : TripleCounts;
export interface GameSnapshot {
  phase: "warmup" | "playing" | "finished" | "aborted";
  cell: number | null;
  color: number | null;
  number: number | null;
  lit: boolean;
  trial: number;
  answered: boolean;
  colorAnswered: boolean;
  numberAnswered: boolean;
}
export class NBackGame<G extends NBackGameId = typeof GAME> {
  private answers = {
    position: new Set<number>(),
    color: new Set<number>(),
    number: new Set<number>(),
  };
  private sequence: {
    cell: number;
    color: number | null;
    number: number | null;
  }[];
  private ended = false;
  private aborted = false;
  private counts: GameResult<G> | null = null;
  constructor(
    private n: number,
    sequence: G extends typeof GAME
      ? number[]
      : G extends typeof COLOR_GAME
        ? ColorStimulus[]
        : TripleStimulus[],
    private startedAt: number,
    private game: G = GAME as G,
  ) {
    assertLevel(n);
    if (
      sequence.length !== n + TRIALS ||
      !isNBackGameId(game) ||
      sequence.some((x) => {
        const cell = typeof x === "number" ? x : x?.cell;
        const color = typeof x === "number" ? null : x?.color;
        const number =
          typeof x === "object" && x && "number" in x ? x.number : null;
        return (
          !Number.isInteger(cell) ||
          cell < 0 ||
          cell > 8 ||
          (game === GAME
            ? typeof x !== "number"
            : !Number.isInteger(color) || color! < 0 || color! > 5) ||
          (game === TRIPLE_GAME &&
            (!Number.isInteger(number) || number! < 1 || number! > 9))
        );
      })
    )
      throw new Error("无效的题目序列");
    this.sequence = sequence.map((x) =>
      typeof x === "number"
        ? { cell: x, color: null, number: null }
        : {
            cell: x.cell,
            color: x.color,
            number: "number" in x ? x.number : null,
          },
    );
  }
  tick(now: number): GameSnapshot {
    const elapsed = Math.max(0, now - this.startedAt);
    const index = Math.floor(elapsed / STEP_MS);
    if (!this.aborted && !this.ended && index >= this.sequence.length) {
      this.ended = true;
      const position = this.count("position");
      this.counts = (
        this.game === GAME
          ? position
          : this.game === COLOR_GAME
            ? { position, color: this.count("color") }
            : {
                position,
                color: this.count("color"),
                number: this.count("number"),
              }
      ) as GameResult<G>;
    }
    if (this.aborted || this.ended)
      return {
        phase: this.aborted ? "aborted" : "finished",
        cell: null,
        color: null,
        number: null,
        lit: false,
        trial: TRIALS,
        answered: false,
        colorAnswered: false,
        numberAnswered: false,
      };
    return {
      phase: index < this.n ? "warmup" : "playing",
      cell: this.sequence[index].cell,
      color: this.sequence[index].color,
      number: this.sequence[index].number,
      lit: elapsed % STEP_MS < LIT_MS,
      trial: index < this.n ? index + 1 : index - this.n + 1,
      answered: this.answers.position.has(index),
      colorAnswered: this.answers.color.has(index),
      numberAnswered: this.answers.number.has(index),
    };
  }
  answer(now: number, dimension: Dimension = "position"): boolean {
    const state = this.tick(now);
    if (
      state.phase !== "playing" ||
      !(GAME_DIMENSIONS[this.game] as readonly Dimension[]).includes(dimension)
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
    const key = dimension === "position" ? "cell" : dimension;
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
