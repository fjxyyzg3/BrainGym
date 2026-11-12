import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Store } from "./store.js";

export function runCli(
  args: string[],
  path = process.env.DATABASE_PATH ?? "data/braingym.sqlite",
): unknown {
  const [command, value] = args;
  if (!command || command === "help")
    return {
      usage: [
        "user:create <name>",
        "user:list",
        "token:issue <user-id>",
        "token:rotate <user-id>",
        "token:revoke <user-id>",
      ],
    };
  const store = new Store(resolve(path));
  try {
    if (command === "user:list") return store.listUsers();
    if (!value) throw new Error("缺少用户名称或标识，使用 help 查看命令");
    if (command === "user:create") return store.createUser(value);
    if (command === "token:issue") return { token: store.issueToken(value) };
    if (command === "token:rotate") return { token: store.rotateToken(value) };
    if (command === "token:revoke") {
      store.revokeToken(value);
      return { revoked: true };
    }
    throw new Error("未知命令，使用 help 查看命令");
  } finally {
    store.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    console.log(JSON.stringify(runCli(process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "命令失败");
    process.exitCode = 1;
  }
}
