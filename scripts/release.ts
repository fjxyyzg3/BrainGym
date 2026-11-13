import { prepareCandidate, assertPublishable } from "./release/artifact.js";
import {
  releaseHome,
  stableRoot,
  assertSeparated,
  hash,
  appId,
} from "./release/paths.js";
import { ReleaseError, run } from "./release/process.js";
import {
  connectHub,
  readHubConfig,
  configuredStateDir,
} from "./release/hub.js";
import { publish, deploymentOperations } from "./release/live.js";
import { deploymentStatus, recover } from "./release/deploy.js";
import { withoutControlCredentials } from "../src/server/environment.js";
import { join, resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";

const [command, ...args] = process.argv.slice(2);
async function main() {
  if (!command || command === "--help" || command === "help") {
    console.log(
      "BrainGym release: prepare | rehearse | deploy --candidate <path> | status | recover | cli -- <command>",
    );
    return;
  }
  if (command === "prepare" || command === "rehearse") {
    const directory = await prepareCandidate(
      process.cwd(),
      releaseHome(stableRoot()),
    );
    console.log(JSON.stringify({ passed: true, candidate: directory }));
    return;
  }
  if (command === "deploy" && (args.length !== 2 || args[0] !== "--candidate"))
    throw new ReleaseError(
      "CANDIDATE_REQUIRED",
      "正式发布必须显式提供 --candidate 已演练目录",
    );
  if (!["deploy", "status", "recover", "cli"].includes(command))
    throw new ReleaseError(
      "COMMAND_INVALID",
      "发布命令无效，使用 --help 查看入口",
    );
  const root = stableRoot();
  const target = resolve("D:/Apps/BrainGym"),
    home = join(releaseHome(root), "state");
  assertSeparated(target, root);
  const evidence =
    command === "deploy"
      ? assertPublishable(process.cwd(), resolve(args[1]))
      : undefined;
  if (command === "status") {
    const status = deploymentStatus(target, home);
    console.log(
      JSON.stringify({
        state: status?.state ?? "not-published",
        phase: status?.phase ?? "none",
      }),
    );
    return;
  }
  if (command === "cli") {
    const status = deploymentStatus(target, home);
    const lock = join(home, hash(target.toLowerCase()).slice(0, 24) + ".lock");
    if (
      existsSync(lock) ||
      (status && !["published", "restored"].includes(status.state))
    )
      throw new ReleaseError(
        "RECOVERY_REQUIRED",
        "发布或恢复尚未完成，暂时拒绝正式 CLI 写入",
      );
    const definition = readHubConfig(configuredStateDir(root)).apps.find(
      (app) => app.id === appId,
    )!;
    const cliArgs = args[0] === "--" ? args.slice(1) : args;
    if (
      !definition.env.DATABASE_PATH ||
      !/^(?:user:(?:create|list)|token:(?:issue|rotate|revoke))$/.test(
        cliArgs[0] ?? "",
      ) ||
      cliArgs.length > 2
    )
      throw new ReleaseError("CLI_ARGUMENT", "正式数据库、CLI 命令或参数无效");
    await run(
      definition.executable,
      ["dist/server/server/cli.js", ...cliArgs],
      definition.cwd,
      {
        ...withoutControlCredentials({ ...process.env, ...definition.env }),
        BRAINGYM_ENV: "production",
        WHEELMAKER_APP_MANAGED: "0",
        DATABASE_PATH: resolve(definition.cwd, definition.env.DATABASE_PATH),
      },
      true,
    );
    return;
  }
  const hub = await connectHub(root);
  try {
    if (command === "deploy") {
      const journal = await publish(
        hub,
        target,
        join(resolve(args[1]), "runtime"),
        home,
        evidence!.files,
        evidence!.release,
      );
      console.log(
        JSON.stringify({
          passed: true,
          state: journal.state,
          operation: journal.operation,
        }),
      );
      return;
    }
    if (command === "recover") {
      if (args.length)
        throw new ReleaseError(
          "ARGUMENT_INVALID",
          "recover 不接受任意路径参数",
        );
      const context = JSON.parse(
        readFileSync(
          join(home, hash(target.toLowerCase()).slice(0, 24) + ".context.json"),
          "utf8",
        ),
      );
      const connection = deploymentOperations(
        hub,
        target,
        context.runtime,
        home,
        { expectedFiles: {}, release: "", resume: true },
      );
      try {
        const restored = await recover(
          target,
          home,
          connection.control,
          connection.operations,
        );
        console.log(
          JSON.stringify({
            passed: true,
            state: restored.state,
            operation: restored.operation,
          }),
        );
      } finally {
        await connection.close();
      }
      return;
    }
  } finally {
    hub.close();
  }
  return;
}
main().catch((error) => {
  console.error(
    JSON.stringify({
      passed: false,
      code: error instanceof ReleaseError ? error.code : "RELEASE_FAILED",
      message:
        error instanceof ReleaseError
          ? error.message
          : "发布失败；私有诊断与凭据未输出",
    }),
  );
  process.exitCode = 1;
});
