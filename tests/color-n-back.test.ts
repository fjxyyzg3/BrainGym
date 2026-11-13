import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/store.js";
import { buildApp } from "../src/server/app.js";
import { COLOR_GAME, GAME, type Counts } from "../src/shared/contracts.js";
import {
  generateColorSequence,
  scoreResult,
  type ColorStimulus,
} from "../src/shared/rules.js";
import { NBackGame } from "../src/client/game.js";

async function fixture(t: { after: (fn: () => unknown) => void }) {
  const store = new Store(":memory:");
  const origin = "http://127.0.0.1:3100";
  let now = Date.parse("2026-11-13T12:00:00.000Z");
  const app = await buildApp({ store, origin, now: () => now });
  t.after(async () => {
    await app.close();
    store.close();
  });
  const a = store.createUser("Dual A");
  const b = store.createUser("Dual B");
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
    game: "spatial-color-n-back",
    version: 1,
    n: 2,
    completedAt: "2026-11-13T08:00:00.000Z",
    position: { tp: 9, fn: 0, fp: 0, tn: 21 },
    color: { tp: 0, fn: 9, fp: 0, tn: 21 },
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

test("dual mode saves separate channel counts and computes the mean on the server", async (t) => {
  const f = await fixture(t);
  const data = f.payload();
  const saved = await f.save({ ...data, score: -999 });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().score, 75);
  assert.deepEqual(saved.json().position, data.position);
  assert.deepEqual(saved.json().color, data.color);
  assert.equal((await f.get("/api/history")).json().total, 0);
  const history = (
    await f.get("/api/history?game=spatial-color-n-back")
  ).json();
  assert.equal(history.total, 1);
  assert.equal(history.items[0].resultId, data.resultId);
});

test("dual mode rejects unknown or repeated query game selectors", async (t) => {
  const f = await fixture(t);
  for (const endpoint of ["history", "bests"]) {
    for (const selector of [
      "unknown",
      "",
      "spatial-n-back&game=spatial-color-n-back",
    ]) {
      assert.equal(
        (await f.get(`/api/${endpoint}?game=${selector}`)).statusCode,
        400,
      );
    }
  }
});

function rng(seed: number) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
function knownSequence(n: number) {
  const sequence: ColorStimulus[] = Array.from({ length: n }, (_, i) => ({
    cell: i,
    color: i % 6,
  }));
  for (let i = 0; i < 30; i++) {
    const previous = sequence[i];
    sequence.push({
      cell: i % 4 < 2 ? previous.cell : (previous.cell + 1) % 9,
      color: i % 2 === 0 ? previous.color : (previous.color + 1) % 6,
    });
  }
  return sequence;
}

test("dual generation covers all levels, independent channels, variable targets and separate 30% thresholds", () => {
  const totals = new Set<string>(),
    combinations = new Set<string>();
  for (let n = 1; n <= 5; n++)
    for (let seed = 1; seed <= 10; seed++) {
      const seq = generateColorSequence(n, rng(seed));
      assert.equal(seq.length, n + 30);
      assert.ok(
        seq.every(
          (x) =>
            Number.isInteger(x.cell) &&
            x.cell >= 0 &&
            x.cell < 9 &&
            Number.isInteger(x.color) &&
            x.color >= 0 &&
            x.color < 6,
        ),
      );
      const matches = [0, 0];
      for (let i = n; i < seq.length; i++) {
        const p = seq[i].cell === seq[i - n].cell,
          c = seq[i].color === seq[i - n].color;
        matches[0] += Number(p);
        matches[1] += Number(c);
        combinations.add(`${p}:${c}`);
      }
      assert.ok(matches.every((x) => x > 0 && x < 30));
      totals.add(matches.join(":"));
    }
  assert.equal(combinations.size, 4);
  assert.ok(totals.size > 10);
  for (const threshold of [0.299, 0.301]) {
    for (const dimension of ["cell", "color"] as const) {
      const positionPrefix = [
        0,
        0.1,
        ...Array.from({ length: 29 }, () => [0.9, 0.2]).flat(),
      ];
      let calls = 0;
      const fallback = rng(42);
      const seq = generateColorSequence(1, () => {
        calls++;
        if (dimension === "cell") return calls === 2 ? threshold : fallback();
        return calls <= positionPrefix.length
          ? positionPrefix[calls - 1]
          : calls === positionPrefix.length + 2
            ? threshold
            : fallback();
      });
      assert.equal(seq[1][dimension] === seq[0][dimension], threshold < 0.3);
    }
  }
  let calls = 0;
  const fallback = rng(42);
  const regenerated = generateColorSequence(1, () =>
    ++calls <= 31 ? 0 : fallback(),
  );
  assert.ok(calls > 31);
  assert.ok(
    regenerated.slice(1).some((x, i) => x.cell !== regenerated[i].cell),
  );
  assert.throws(() => generateColorSequence(0));
});

test("dual engine independently accepts both channels during the full window and preserves completion", () => {
  for (let n = 1; n <= 5; n++) {
    const seq = knownSequence(n),
      game = new NBackGame(n, seq, 100, COLOR_GAME);
    assert.equal(game.answer(200, "position"), false);
    assert.equal(game.answer(200, "color"), false);
    assert.equal(game.tick(100 + n * 2500).lit, true);
    for (let i = n; i < seq.length; i++) {
      const now = 100 + i * 2500 + 600;
      assert.equal(game.tick(now).lit, false);
      if (seq[i].cell === seq[i - n].cell) {
        assert.equal(game.answer(now, "position"), true);
        assert.equal(game.answer(now + 1, "position"), false);
      }
      if (seq[i].color === seq[i - n].color) {
        assert.equal(game.answer(now, "color"), true);
        assert.equal(game.answer(now + 1, "color"), false);
      }
    }
    assert.equal(game.tick(100 + seq.length * 2500).phase, "finished");
    assert.deepEqual(game.result, {
      position: { tp: 16, fn: 0, fp: 0, tn: 14 },
      color: { tp: 15, fn: 0, fp: 0, tn: 15 },
    });
    const copy = game.result!;
    copy.color.tp = 0;
    assert.equal(game.result!.color.tp, 15);
    assert.equal(game.answer(1e6, "color"), false);
    game.abort();
    assert.equal(game.tick(1e6).phase, "finished");
  }
});

test("dual engine aborts, catches time skips, ignores unsupported color in spatial mode and validates stimuli", () => {
  const game = new NBackGame(1, knownSequence(1), 0, COLOR_GAME);
  assert.equal(game.tick(10000).trial, 4);
  game.abort();
  assert.equal(game.tick(1e6).phase, "aborted");
  assert.equal(game.result, null);
  assert.equal(game.answer(10000, "color"), false);
  const spatial = new NBackGame(1, Array(31).fill(0), 0);
  assert.equal(spatial.answer(3000, "color"), false);
  assert.equal(spatial.answer(3000, "position"), true);
  for (const bad of [
    { cell: -1, color: 0 },
    { cell: 0, color: 6 },
    { cell: 9, color: 0 },
    { cell: 0, color: 1.1 },
  ]) {
    assert.throws(
      () =>
        new NBackGame(
          1,
          [...knownSequence(1).slice(0, -1), bad],
          0,
          COLOR_GAME,
        ),
    );
  }
});

test("dual scoring averages unrounded channel BA and handles perfect, wrong and no responses", () => {
  const perfect: Counts = { tp: 9, fn: 0, fp: 0, tn: 21 },
    wrong = { tp: 0, fn: 9, fp: 21, tn: 0 },
    idle = { tp: 0, fn: 9, fp: 0, tn: 21 };
  for (const [counts, expected] of [
    [perfect, 100],
    [wrong, 0],
    [idle, 50],
  ] as const)
    assert.equal(
      scoreResult({ game: COLOR_GAME, position: counts, color: counts }),
      expected,
    );
  const mixed = {
    position: { tp: 2, fn: 5, fp: 3, tn: 20 },
    color: { tp: 3, fn: 8, fp: 5, tn: 14 },
  };
  assert.ok(
    Math.abs(
      scoreResult({ game: COLOR_GAME, ...mixed }) -
        25 * (2 / 7 + 20 / 23 + 3 / 11 + 14 / 19),
    ) < 1e-10,
  );
});

test("dual server rejects either invalid channel, missing channels, versions, identity and times", async (t) => {
  const f = await fixture(t);
  const invalid = [
    null,
    {},
    [],
    { tp: -1, fn: 10, fp: 0, tn: 21 },
    { tp: 9.5, fn: 0, fp: 0, tn: 20.5 },
    { tp: 0, fn: 0, fp: 0, tn: 30 },
    { tp: 9, fn: 0, fp: 0, tn: 20 },
    { tp: "9", fn: 0, fp: 0, tn: 21 },
  ];
  for (const dimension of ["position", "color"])
    for (const value of invalid)
      assert.equal(
        (await f.save({ ...f.payload(), [dimension]: value })).statusCode,
        400,
      );
  for (const patch of [
    { color: undefined },
    { position: undefined },
    { version: 2 },
    { game: "unknown" },
    { n: 6 },
    { n: 1.5 },
    { completedAt: "bad" },
    { startedByUserId: undefined },
  ])
    assert.equal((await f.save({ ...f.payload(), ...patch })).statusCode, 400);
  assert.equal((await f.save(f.payload(), "")).statusCode, 401);
});

test("dual retries normalize nested key order, reject either channel changes and cross-mode ID reuse", async (t) => {
  const f = await fixture(t),
    data = f.payload();
  const [one, two] = await Promise.all([f.save(data), f.save(data)]);
  assert.equal(one.statusCode, 200);
  assert.equal(two.statusCode, 200);
  assert.equal(one.json().receivedAt, two.json().receivedAt);
  assert.equal(
    (await f.save({ ...data, color: { tn: 21, fp: 0, fn: 9, tp: 0 } }))
      .statusCode,
    200,
  );
  for (const dimension of ["position", "color"])
    assert.equal(
      (await f.save({ ...data, [dimension]: { tp: 5, fn: 4, fp: 1, tn: 20 } }))
        .statusCode,
      409,
    );
  const spatial = {
    resultId: data.resultId,
    startedByUserId: data.startedByUserId,
    game: GAME,
    version: 1,
    n: 2,
    completedAt: data.completedAt,
    ...data.position,
  };
  assert.equal((await f.save(spatial)).statusCode, 409);
  assert.equal(
    (await f.get(`/api/history?game=${COLOR_GAME}`)).json().total,
    1,
  );
});

test("dual results stay isolated by user, mode and N with pagination and bests", async (t) => {
  const f = await fixture(t),
    low = f.payload();
  const old = {
    resultId: randomUUID(),
    startedByUserId: f.a.user.id,
    game: GAME,
    version: 1,
    n: 2,
    completedAt: low.completedAt,
    ...low.position,
  };
  assert.equal((await f.save(old)).statusCode, 200);
  assert.equal((await f.save(old)).statusCode, 200);
  for (let i = 0; i < 21; i++)
    assert.equal(
      (await f.save({ ...f.payload(), n: i === 0 ? 1 : 2 })).statusCode,
      200,
    );
  const first = (await f.get(`/api/history?game=${COLOR_GAME}`)).json(),
    second = (await f.get(`/api/history?page=2&game=${COLOR_GAME}`)).json();
  assert.equal(first.total, 21);
  assert.equal(first.items.length, 20);
  assert.equal(second.items.length, 1);
  assert.equal(
    new Set([...first.items, ...second.items].map((x) => x.resultId)).size,
    21,
  );
  assert.equal((await f.get("/api/history")).json().total, 1);
  assert.equal((await f.get("/api/bests")).json().items[0].score, 100);
  const bests = (await f.get(`/api/bests?game=${COLOR_GAME}`)).json().items;
  assert.deepEqual(
    bests.map((x: { n: number }) => x.n),
    [1, 2],
  );
  assert.ok(bests.every((x: { score: number }) => x.score === 75));
  const other = await f.login(f.b.token);
  assert.equal((await f.save(f.payload(), other)).statusCode, 409);
  for (const game of [GAME, COLOR_GAME])
    assert.equal(
      (await f.get(`/api/history?game=${game}`, other)).json().total,
      0,
    );
  f.store.rotateToken(f.a.user.id);
  assert.equal(
    (await f.get(`/api/history?game=${COLOR_GAME}`)).statusCode,
    401,
  );
  assert.equal((await f.save(f.payload())).statusCode, 401);
  const fresh = await f.login(f.b.token);
  f.setNow(Date.parse("2026-11-22T12:00:00Z"));
  assert.equal(
    (await f.get(`/api/bests?game=${COLOR_GAME}`, fresh)).statusCode,
    401,
  );
});

test("dual best compares unrounded means and preserves the first receipt on equal scores", async (t) => {
  const f = await fixture(t);
  const low = { ...f.payload(), position: { tp: 0, fn: 2, fp: 27, tn: 1 } };
  const high = { ...f.payload(), position: { tp: 0, fn: 3, fp: 26, tn: 1 } };
  const first = await f.save(low);
  f.setNow(Date.parse("2026-11-13T12:01:00Z"));
  const second = await f.save(high);
  assert.equal(first.json().score.toFixed(1), second.json().score.toFixed(1));
  const tie = { ...high, resultId: randomUUID() };
  f.setNow(Date.parse("2026-11-13T12:02:00Z"));
  await f.save(tie);
  const best = (await f.get(`/api/bests?game=${COLOR_GAME}`)).json().items;
  assert.equal(best[0].resultId, high.resultId);
});
