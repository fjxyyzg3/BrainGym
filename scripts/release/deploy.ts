import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { atomicJson, hash } from "./paths.js";
import { assertNoLinks, isWithin } from "../../src/server/environment.js";
import { ReleaseError } from "./process.js";

export interface ManagedState {
  id: string;
  phase: string;
  pid?: number;
  instanceId?: string;
  pendingRestart?: boolean;
  health?: { state: string };
}
export interface DeploymentControl {
  state(): Promise<ManagedState>;
  stop(): Promise<void>;
  start(): Promise<void>;
  waitStopped(previous: ManagedState): Promise<void>;
  waitReady(): Promise<void>;
}
export interface DeploymentOperations {
  preflight(): Promise<void>;
  backup(directory: string): Promise<void>;
  replace(): Promise<void>;
  loadDefinition(): Promise<void>;
  verify(): Promise<void>;
  restoreProgram(directory: string): Promise<void>;
  restoreDefinition(): Promise<void>;
}
export interface Journal {
  format: 1;
  operation: string;
  target: string;
  phase: string;
  initial: ManagedState;
  stopRequested: boolean;
  programTouched: boolean;
  definitionTouched: boolean;
  state: "active" | "published" | "restored" | "recovery-failed";
  backup: string;
  error?: string;
  errorDetail?: string;
  recoveryError?: string;
}

async function restore(
  journal: Journal,
  control: DeploymentControl,
  operations: DeploymentOperations,
) {
  const current = await control.state();
  if (
    (journal.programTouched || journal.definitionTouched) &&
    current.phase !== "stopped"
  ) {
    await control.stop();
    await control.waitStopped(current);
  }
  if (journal.programTouched) await operations.restoreProgram(journal.backup);
  if (journal.definitionTouched) await operations.restoreDefinition();
  if (journal.initial.phase === "running") {
    await control.start();
    await control.waitReady();
  } else {
    const recovered = await control.state();
    if (recovered.phase !== "stopped") {
      await control.stop();
      await control.waitStopped(recovered);
    }
  }
}

export async function deploy(
  target: string,
  home: string,
  control: DeploymentControl,
  operations: DeploymentOperations,
): Promise<Journal> {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const key = hash(resolve(target).toLowerCase()).slice(0, 24);
  const lockPath = join(home, `${key}.lock`),
    journalPath = join(home, `${key}.json`);
  let lock: number;
  try {
    lock = openSync(lockPath, "wx", 0o600);
  } catch {
    throw new ReleaseError(
      "DEPLOYMENT_LOCKED",
      "已有发布操作或未清理锁，拒绝并发发布",
    );
  }
  let journal: Journal | undefined;
  const record = (phase: string) => {
    journal!.phase = phase;
    atomicJson(journalPath, journal);
  };
  try {
    writeFileSync(
      lock,
      JSON.stringify({ pid: process.pid, target: resolve(target) }),
    );
    if (existsSync(journalPath)) {
      const previous: Journal = JSON.parse(readFileSync(journalPath, "utf8"));
      if (!["published", "restored"].includes(previous.state))
        throw new ReleaseError(
          "RECOVERY_REQUIRED",
          "存在未完成发布，请先恢复，不能覆盖现场",
        );
    }
    await operations.preflight();
    const initial = await control.state();
    if (
      !["running", "stopped"].includes(initial.phase) ||
      (initial.phase === "running" && initial.health?.state !== "healthy")
    )
      throw new ReleaseError("STATE_UNSTABLE", "原实例未处于稳定可核验状态");
    const operation = randomUUID();
    journal = {
      format: 1,
      operation,
      target: resolve(target),
      phase: "prepared",
      initial,
      stopRequested: false,
      programTouched: false,
      definitionTouched: false,
      state: "active",
      backup: join(home, "backups", operation),
    };
    record("prepared");
    if (initial.phase === "running") {
      journal.stopRequested = true;
      record("stop-requested");
      try {
        await control.stop();
      } catch {
        await control.waitStopped(initial);
      }
      await control.waitStopped(initial);
    }
    record("stopped");
    await operations.backup(journal.backup);
    record("backed-up");
    journal.programTouched = true;
    record("program-changing");
    await operations.replace();
    journal.definitionTouched = true;
    record("definition-changing");
    await operations.loadDefinition();
    record("definition-loaded");
    await control.start();
    record("started");
    await control.waitReady();
    await operations.verify();
    journal.state = "published";
    record("verified");
    return journal;
  } catch (error) {
    if (!journal) throw error;
    journal.error =
      error instanceof ReleaseError ? error.code : "DEPLOYMENT_FAILED";
    journal.errorDetail =
      error instanceof ReleaseError ? error.detail : undefined;
    try {
      record("recovering");
      await restore(journal, control, operations);
      journal.state = "restored";
      record("restored");
    } catch (recoveryError) {
      journal.recoveryError =
        recoveryError instanceof ReleaseError
          ? `${recoveryError.code}:${recoveryError.detail ?? ""}`
          : "RECOVERY_FAILED";
      journal.state = "recovery-failed";
      record("recovery-failed");
      throw new ReleaseError(
        "RECOVERY_FAILED",
        "发布与恢复未完成；保留私有阶段记录和备份，请先恢复现场",
      );
    }
    throw new ReleaseError(
      "DEPLOYMENT_RESTORED",
      "发布失败，已恢复原程序、定义及运行状态；新版未发布",
    );
  } finally {
    closeSync(lock);
    rmSync(lockPath);
  }
}

export function deploymentStatus(
  target: string,
  home: string,
): Journal | undefined {
  const path = join(
    home,
    hash(resolve(target).toLowerCase()).slice(0, 24) + ".json",
  );
  assertNoLinks(path);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
}

export async function recover(
  target: string,
  home: string,
  control: DeploymentControl,
  operations: DeploymentOperations,
): Promise<Journal> {
  assertNoLinks(home);
  assertNoLinks(target);
  const key = hash(resolve(target).toLowerCase()).slice(0, 24);
  const journalPath = join(home, key + ".json"),
    lockPath = join(home, key + ".lock");
  if (existsSync(lockPath)) {
    const owner = JSON.parse(readFileSync(lockPath, "utf8"));
    if (owner.target !== resolve(target) || !Number.isInteger(owner.pid))
      throw new ReleaseError("LOCK_INVALID", "锁所有权无法确认，不能强制清理");
    let alive = true;
    try {
      process.kill(owner.pid, 0);
    } catch (error) {
      alive = (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
    if (alive)
      throw new ReleaseError(
        "DEPLOYMENT_LOCKED",
        "原发布进程仍在运行，拒绝抢占",
      );
    rmSync(lockPath);
  }
  const lock = openSync(lockPath, "wx", 0o600);
  try {
    writeFileSync(
      lock,
      JSON.stringify({ pid: process.pid, target: resolve(target) }),
    );
    const journal = deploymentStatus(target, home);
    if (
      !journal ||
      journal.target !== resolve(target) ||
      !isWithin(join(home, "backups"), journal.backup) ||
      !["active", "recovery-failed"].includes(journal.state)
    )
      throw new ReleaseError("RECOVERY_INVALID", "没有匹配且未完成的恢复现场");
    try {
      journal.phase = "recovering";
      atomicJson(journalPath, journal);
      await restore(journal, control, operations);
      journal.state = "restored";
      journal.phase = "restored";
      atomicJson(journalPath, journal);
      return journal;
    } catch {
      journal.state = "recovery-failed";
      atomicJson(journalPath, journal);
      throw new ReleaseError(
        "RECOVERY_FAILED",
        "恢复未完成，保留现场以便再次受控恢复",
      );
    }
  } finally {
    closeSync(lock);
    rmSync(lockPath);
  }
}
