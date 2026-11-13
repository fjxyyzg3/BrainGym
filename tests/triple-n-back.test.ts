import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/store.js";
import { buildApp } from "../src/server/app.js";
import { GAME, COLOR_GAME, type Counts } from "../src/shared/contracts.js";
import {
  generateTripleSequence,
  generateSequence,
  generateColorSequence,
  score,
  scoreResult,
  type TripleStimulus,
} from "../src/shared/rules.js";
import { NBackGame } from "../src/client/game.js";

const mode = "spatial-color-number-n-back" as const;
const perfect = { tp: 9, fn: 0, fp: 0, tn: 21 };
const idle = { tp: 0, fn: 9, fp: 0, tn: 21 };

async function fixture(t: { after: (fn: () => unknown) => void }) {
  const store = new Store(":memory:");
  const origin = "http://127.0.0.1:3100";
  let now = Date.parse("2026-11-13T12:00:00.000Z");
  const app = await buildApp({ store, origin, now: () => now });
  t.after(async () => {
    await app.close();
    store.close();
  });
  const a = store.createUser("Triple A"),
    b = store.createUser("Triple B");
  const login = async (token: string) => {
    const res = await app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { token },
    });
    return String(res.headers["set-cookie"]).split(";")[0];
  };
  const cookie = await login(a.token);
  const payload = () => ({
    resultId: randomUUID(),
    startedByUserId: a.user.id,
    game: mode,
    version: 1,
    n: 2,
    completedAt: "2026-11-13T08:00:00.000Z",
    position: { ...perfect },
    color: { ...idle },
    number: { ...perfect },
  });
  const save = (data: unknown, c = cookie) =>
    app.inject({
      method: "POST",
      url: "/api/results",
      headers: { origin, cookie: c },
      payload: data as Record<string, unknown>,
    });
  const get = (url: string, c = cookie) =>
    app.inject({ url, headers: { cookie: c } });
  return {
    store,
    app,
    a,
    b,
    cookie,
    login,
    payload,
    save,
    get,
    setNow: (value: number) => {
      now = value;
    },
  };
}

test("triple results save all channels and the server computes their unrounded mean", async (t) => {
  const f = await fixture(t),
    data = f.payload();
  const saved = await f.save({ ...data, score: -999 });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().score, 250 / 3);
  for (const dimension of ["position", "color", "number"] as const)
    assert.deepEqual(saved.json()[dimension], data[dimension]);
  assert.equal((await f.get(`/api/history?game=${mode}`)).json().total, 1);
  assert.equal((await f.get("/api/history")).json().total, 0);
});

function rng(seed: number) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
const dimensions = ["position", "color", "number"] as const;
const keys = ["cell", "color", "number"] as const;
function knownSequence(n: number): TripleStimulus[] {
  const sequence = Array.from({ length: n }, (_, i) => ({
    cell: i,
    color: i % 6,
    number: i + 1,
  }));
  for (let i = 0; i < 30; i++) {
    const previous = sequence[i];
    sequence.push({
      cell: i & 1 ? previous.cell : (previous.cell + 1) % 9,
      color: i & 2 ? previous.color : (previous.color + 1) % 6,
      number: i & 4 ? previous.number : (previous.number % 9) + 1,
    });
  }
  return sequence;
}

test("triple generation has independent bounded channels, variable targets and each 30 percent threshold", () => {
  const combinations = new Set<string>(),
    totals = new Set<string>();
  for (let n = 1; n <= 5; n++)
    for (let seed = 1; seed <= 20; seed++) {
      const sequence = generateTripleSequence(n, rng(seed));
      assert.equal(sequence.length, n + 30);
      for (const x of sequence) {
        assert.ok(Number.isInteger(x.cell) && x.cell >= 0 && x.cell <= 8);
        assert.ok(Number.isInteger(x.color) && x.color >= 0 && x.color <= 5);
        assert.ok(Number.isInteger(x.number) && x.number >= 1 && x.number <= 9);
      }
      const matches = [0, 0, 0];
      for (let i = n; i < sequence.length; i++) {
        const flags = keys.map((key, j) => {
          const flag = sequence[i][key] === sequence[i - n][key];
          matches[j] += Number(flag);
          return flag;
        });
        combinations.add(flags.join(":"));
      }
      assert.ok(matches.every((count) => count > 0 && count < 30));
      totals.add(matches.join(":"));
    }
  assert.equal(combinations.size, 8);
  assert.ok(totals.size > 20);
  const valid = [
    0,
    0.1,
    ...Array.from({ length: 29 }, () => [0.9, 0.2]).flat(),
  ];
  for (const [channel, key] of keys.entries())
    for (const threshold of [0.299, 0.301]) {
      const prefix = Array.from({ length: channel }, () => valid).flat();
      let calls = 0;
      const fallback = rng(42);
      const sequence = generateTripleSequence(1, () => {
        const index = calls++;
        return index < prefix.length
          ? prefix[index]
          : index === prefix.length + 1
            ? threshold
            : fallback();
      });
      assert.equal(sequence[1][key] === sequence[0][key], threshold < 0.3);
    }
  for (const [channel, key] of keys.entries()) {
    const prefix = Array.from({ length: channel }, () => valid).flat();
    let calls = 0;
    const fallback = rng(87);
    const sequence = generateTripleSequence(1, () => {
      const index = calls++;
      return index < prefix.length
        ? prefix[index]
        : index < prefix.length + 31
          ? 0
          : fallback();
    });
    assert.ok(calls > prefix.length + 31);
    assert.ok(sequence.slice(1).some((x, i) => x[key] !== sequence[i][key]));
    for (let earlier = 0; earlier < channel; earlier++) {
      assert.equal(sequence[1][keys[earlier]], sequence[0][keys[earlier]]);
      assert.notEqual(sequence[2][keys[earlier]], sequence[1][keys[earlier]]);
    }
  }
  assert.throws(() => generateTripleSequence(0));
});

test("triple engine covers eight combinations, independent first inputs, blank windows and all score extremes", () => {
  for (let n = 1; n <= 5; n++)
    for (const strategy of ["correct", "wrong", "idle"] as const) {
      const sequence = knownSequence(n),
        game = new NBackGame(n, sequence, 0, mode);
      for (const dimension of dimensions)
        assert.equal(game.answer(100, dimension), false);
      const expected: Record<(typeof dimensions)[number], Counts> =
        Object.fromEntries(
          dimensions.map((d) => [d, { tp: 0, fn: 0, fp: 0, tn: 0 }]),
        ) as Record<(typeof dimensions)[number], Counts>;
      for (let i = n; i < n + 30; i++)
        for (const [j, dimension] of dimensions.entries()) {
          const match = sequence[i][keys[j]] === sequence[i - n][keys[j]];
          const input =
            strategy === "correct"
              ? match
              : strategy === "wrong"
                ? !match
                : false;
          expected[dimension][
            match ? (input ? "tp" : "fn") : input ? "fp" : "tn"
          ]++;
          const time = i * 2500 + 700 + j;
          assert.equal(game.tick(time).lit, false);
          if (input) {
            assert.equal(game.answer(time, dimension), true);
            assert.equal(game.answer(time + 1, dimension), false);
          }
        }
      assert.equal(game.tick((n + 30) * 2500).phase, "finished");
      assert.deepEqual(game.result, expected);
      assert.equal(
        scoreResult({ game: mode, ...game.result! }),
        strategy === "correct" ? 100 : strategy === "wrong" ? 0 : 50,
      );
      game.result!.number.tp = 1000;
      assert.deepEqual(game.result, expected);
      game.abort();
      assert.equal(game.tick(1e6).phase, "finished");
      assert.equal(game.answer(1e6, "number"), false);
    }
  const game = new NBackGame(2, knownSequence(2), 0, mode);
  assert.equal(game.tick(10000).trial, 3);
  game.abort();
  game.tick(1e6);
  assert.equal(game.result, null);
  assert.equal(game.answer(1e6, "number"), false);
});

test("triple stimuli reject invalid digits and old engines ignore number inputs", () => {
  for (const number of [0, 10, -1, 1.5, NaN, undefined, null, "1"]) {
    const sequence = knownSequence(1);
    sequence[0] = { ...sequence[0], number } as TripleStimulus;
    assert.throws(() => new NBackGame(1, sequence, 0, mode));
  }
  assert.equal(
    new NBackGame(1, generateSequence(1), 0).answer(3000, "number"),
    false,
  );
  assert.equal(
    new NBackGame(1, generateColorSequence(1), 0, COLOR_GAME).answer(
      3000,
      "number",
    ),
    false,
  );
});

test("triple validation rejects each missing or malformed channel and invalid common fields", async (t) => {
  const f = await fixture(t);
  for (const dimension of dimensions)
    for (const value of [
      undefined,
      null,
      {},
      [],
      { tp: -1, fn: 10, fp: 0, tn: 21 },
      { tp: 9.5, fn: 0, fp: 0, tn: 20.5 },
      { tp: 0, fn: 0, fp: 0, tn: 30 },
      { tp: 30, fn: 0, fp: 0, tn: 0 },
      { tp: 9, fn: 0, fp: 0, tn: 20 },
      { tp: "9", fn: 0, fp: 0, tn: 21 },
    ]) {
      assert.equal(
        (await f.save({ ...f.payload(), [dimension]: value })).statusCode,
        400,
      );
    }
  for (const patch of [
    { game: "unknown" },
    { version: 2 },
    { n: 0 },
    { n: 6 },
    { n: 1.5 },
    { completedAt: "bad" },
    { startedByUserId: undefined },
  ])
    assert.equal((await f.save({ ...f.payload(), ...patch })).statusCode, 400);
  assert.equal((await f.save(f.payload(), "")).statusCode, 401);
  for (const endpoint of ["history", "bests"])
    for (const selector of ["", "unknown", `${mode}&game=${COLOR_GAME}`])
      assert.equal(
        (await f.get(`/api/${endpoint}?game=${selector}`)).statusCode,
        400,
      );
});

test("triple retries normalize all channels, preserve receipt and reject changes to any channel or game", async (t) => {
  const f = await fixture(t),
    data = f.payload();
  const first = await f.save(data);
  f.setNow(Date.parse("2026-11-13T12:10:00.000Z"));
  const reordered: Record<string, unknown> = Object.fromEntries(
    Object.entries(data).reverse(),
  );
  for (const dimension of dimensions)
    reordered[dimension] = Object.fromEntries(
      Object.entries(data[dimension]).reverse(),
    );
  const retry = await f.save(reordered);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().receivedAt, first.json().receivedAt);
  for (const dimension of dimensions)
    assert.equal(
      (await f.save({ ...data, [dimension]: { tp: 5, fn: 4, fp: 1, tn: 20 } }))
        .statusCode,
      409,
    );
  for (const game of [GAME, COLOR_GAME])
    assert.equal((await f.save({ ...data, ...perfect, game })).statusCode, 409);
  assert.equal((await f.get(`/api/history?game=${mode}`)).json().total, 1);
});

test("triple histories, pagination, bests and sessions remain isolated with old contracts intact", async (t) => {
  const f = await fixture(t);
  for (const game of [GAME, COLOR_GAME]) {
    const old = { ...f.payload(), game, ...perfect };
    const first = await f.save(old);
    assert.equal(first.statusCode, 200);
    assert.equal((await f.save(old)).statusCode, 200);
    assert.equal(first.json().score, game === GAME ? 100 : 75);
    assert.equal(first.json().number, undefined);
  }
  for (let i = 0; i < 21; i++)
    assert.equal(
      (await f.save({ ...f.payload(), n: i === 0 ? 1 : 2 })).statusCode,
      200,
    );
  const first = (await f.get(`/api/history?game=${mode}`)).json(),
    second = (await f.get(`/api/history?game=${mode}&page=2`)).json();
  assert.equal(first.total, 21);
  assert.equal(first.items.length, 20);
  assert.equal(second.items.length, 1);
  assert.equal(
    new Set([...first.items, ...second.items].map((x) => x.resultId)).size,
    21,
  );
  assert.deepEqual(
    (await f.get(`/api/bests?game=${mode}`))
      .json()
      .items.map((x: { n: number }) => x.n),
    [1, 2],
  );
  assert.equal((await f.get("/api/history")).json().total, 1);
  const other = await f.login(f.b.token);
  assert.equal((await f.save(f.payload(), other)).statusCode, 409);
  for (const game of [GAME, COLOR_GAME, mode])
    assert.equal(
      (await f.get(`/api/history?game=${game}`, other)).json().total,
      0,
    );
  const freshToken = f.store.rotateToken(f.a.user.id);
  assert.equal((await f.save(f.payload())).statusCode, 401);
  assert.equal((await f.get(`/api/history?game=${mode}`)).statusCode, 401);
  const fresh = await f.login(freshToken);
  f.store.revokeToken(f.a.user.id);
  assert.equal((await f.get(`/api/bests?game=${mode}`, fresh)).statusCode, 401);
  const expires = await f.login(f.b.token);
  f.setNow(Date.parse("2026-11-22T12:00:00.000Z"));
  assert.equal(
    (await f.get(`/api/bests?game=${mode}`, expires)).statusCode,
    401,
  );
});

test("triple best compares unrounded number contribution and retains first receipt on ties", async (t) => {
  const f = await fixture(t);
  const low = { ...f.payload(), number: { tp: 0, fn: 2, fp: 27, tn: 1 } },
    high = { ...f.payload(), number: { tp: 0, fn: 3, fp: 26, tn: 1 } };
  const first = (await f.save(low)).json();
  f.setNow(Date.parse("2026-11-13T12:01:00.000Z"));
  const second = (await f.save(high)).json();
  assert.equal(first.score.toFixed(1), second.score.toFixed(1));
  assert.ok(second.score > first.score);
  assert.equal(
    second.score,
    (score(high.position) + score(high.color) + score(high.number)) / 3,
  );
  f.setNow(Date.parse("2026-11-13T12:02:00.000Z"));
  await f.save({ ...high, resultId: randomUUID() });
  assert.equal(
    (await f.get(`/api/bests?game=${mode}`)).json().items[0].resultId,
    high.resultId,
  );
});
