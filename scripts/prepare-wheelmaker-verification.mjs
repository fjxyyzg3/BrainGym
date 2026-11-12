import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const directory = resolve("data/wheelmaker-verification");
mkdirSync(directory, { recursive: true });
const privatePath = resolve(directory, "private.json");
const formalRestart = process.argv.includes("--formal-restart");
if (existsSync(privatePath)) {
  if (
    formalRestart &&
    JSON.parse(readFileSync(privatePath, "utf8")).stage !== "formal-restart"
  )
    throw new Error("A different verification fixture exists; refusing reuse");
  console.log("Existing verification identity retained.");
} else {
  const databasePath = resolve(
    process.env.DATABASE_PATH ?? "data/braingym.sqlite",
  );
  const database = new DatabaseSync(databasePath, { readOnly: true });
  const fingerprint = (row) =>
    createHash("sha256").update(JSON.stringify(row)).digest("hex");
  const baseline = {
    schema: database.prepare("PRAGMA user_version").get().user_version,
    users: database
      .prepare("SELECT * FROM users ORDER BY id")
      .all()
      .map((row) => ({ id: row.id, hash: fingerprint(row) })),
    credentials: database
      .prepare("SELECT * FROM credentials ORDER BY user_id")
      .all()
      .map((row) => ({ user_id: row.user_id, hash: fingerprint(row) })),
    results: database
      .prepare("SELECT * FROM results ORDER BY user_id,result_id")
      .all()
      .map((row) => ({
        user_id: row.user_id,
        result_id: row.result_id,
        hash: fingerprint(row),
      })),
  };
  database.close();
  if (!formalRestart)
    cpSync(resolve("dist/server"), resolve(directory, "legacy-server"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  const { Store } = await import(
    pathToFileURL(
      formalRestart
        ? resolve("dist/server/server/store.js")
        : resolve(directory, "legacy-server/server/store.js"),
    ).href
  );
  const store = new Store(databasePath);
  try {
    const identity = store.createUser(
      `WheelMaker verification ${randomUUID()}`,
    );
    const payload = {
      resultId: randomUUID(),
      startedByUserId: identity.user.id,
      game: "spatial-n-back",
      version: 1,
      n: 2,
      tp: 9,
      fn: 0,
      fp: 0,
      tn: 21,
      completedAt: new Date().toISOString(),
    };
    const legacyResult = store.save(identity.user, payload, Date.now());
    writeFileSync(
      privatePath,
      JSON.stringify(
        {
          databasePath,
          baseline,
          identity,
          legacyResult,
          stage: formalRestart ? "formal-restart" : "pre-upgrade",
        },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    );
    console.log(
      JSON.stringify({
        prepared: true,
        preservedUsers: baseline.users.length,
        preservedResults: baseline.results.length,
        legacyResult: !formalRestart,
        preRestartResult: formalRestart,
      }),
    );
  } finally {
    store.close();
  }
}
