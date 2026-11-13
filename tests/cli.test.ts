import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Store } from "../src/server/store.js";

test("real CLI creates, lists, revokes, issues and rotates without changing identity", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "braingym-cli-"));
  const path = join(dir, "cli.sqlite");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cli = (...args: string[]) => {
    const run = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/server/cli.ts", ...args],
      {
        encoding: "utf8",
        env: { ...process.env, BRAINGYM_ENV: "test", DATABASE_PATH: path },
      },
    );
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(run.stdout);
  };
  const original = cli("user:create", "CLI user");
  assert.equal(cli("user:list")[0].id, original.user.id);
  cli("token:revoke", original.user.id);
  const issued = cli("token:issue", original.user.id);
  const replacement = cli("token:rotate", original.user.id);
  const store = new Store(path);
  try {
    assert.throws(() => store.login(original.token, Date.now()));
    assert.throws(() => store.login(issued.token, Date.now()));
    assert.equal(
      store.login(replacement.token, Date.now()).user.id,
      original.user.id,
    );
  } finally {
    store.close();
  }
});
