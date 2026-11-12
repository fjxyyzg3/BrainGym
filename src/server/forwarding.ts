import { createConnection, type Socket } from "node:net";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { JsonLines, encodeFrame } from "./json-lines.js";

export function registrationEndpoint(stateDir: string): string {
  if (process.platform !== "win32")
    return join(stateDir, ".tmp", "ipc", "app-registration.sock");
  const hash = createHash("sha256")
    .update(resolve(stateDir).toLowerCase())
    .digest("hex")
    .slice(0, 24);
  return `\\\\.\\pipe\\wheelmaker-app-registration-${hash}`;
}

export class ForwardingPublisher {
  private socket?: Socket;
  private retry?: NodeJS.Timeout;
  private deadline?: NodeJS.Timeout;
  private closed = false;
  private failures = 0;
  private version = 0;
  private state = "pending";
  private lastDiagnostic = "";

  constructor(
    private readonly options: {
      stateDir: string;
      id: string;
      target: string;
      publicUrl: string;
    },
  ) {
    const target = /^http:\/\/(?:127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})$/.exec(
      options.target,
    );
    const publicUrl = new URL(options.publicUrl);
    if (
      !/^[a-z][a-z0-9-]{0,62}$/.test(options.id) ||
      !target ||
      Number(target[1]) > 65535 ||
      !["http:", "https:"].includes(publicUrl.protocol) ||
      options.publicUrl !== `${publicUrl.origin}/${options.id}/`
    )
      throw new Error("Invalid Forwarding ID, target or public URL");
    this.connect();
  }

  private diagnostic(message: string): void {
    if (message !== this.lastDiagnostic) {
      console.error(message);
      this.lastDiagnostic = message;
    }
  }
  private connect(): void {
    if (this.closed) return;
    this.version = 0;
    this.state = "pending";
    let initialized = false,
      reason = "connection closed";
    const socket = createConnection(
      registrationEndpoint(this.options.stateDir),
    );
    this.socket = socket;
    const fail = (message: string) => {
      reason = message;
      socket.destroy();
    };
    this.deadline = setTimeout(() => fail("connection timeout"), 5000);
    const reader = new JsonLines((frame) => {
      if (!initialized) {
        if (frame.type !== "response" || frame.requestId !== 1)
          throw new Error("invalid open response");
        if (frame.code !== undefined && typeof frame.code !== "string")
          throw new Error("invalid response code");
        if (frame.code)
          throw new Error(
            frame.code === "conflict"
              ? "registration conflict"
              : "registration rejected",
          );
      } else if (frame.type !== "state") {
        throw new Error("unexpected response");
      }
      this.accept(frame.registration);
      if (!initialized) {
        initialized = true;
        this.failures = 0;
        if (this.deadline) clearTimeout(this.deadline);
        this.deadline = undefined;
      }
    });
    socket.once("connect", () => {
      if (this.closed) {
        socket.destroy();
        return;
      }
      if (this.deadline) clearTimeout(this.deadline);
      this.deadline = setTimeout(() => fail("open response timeout"), 5000);
      socket.write(
        encodeFrame({
          operation: "open",
          requestId: 1,
          id: this.options.id,
          target: this.options.target,
        }),
      );
    });
    socket.on("data", (chunk: Buffer) => {
      if (this.closed) return;
      try {
        reader.feed(chunk);
      } catch (error) {
        fail(
          error instanceof SyntaxError
            ? "invalid JSON response"
            : error instanceof Error
              ? error.message
              : "invalid response",
        );
      }
    });
    socket.once("error", () => {
      reason = "IPC unavailable";
    });
    socket.once("end", () => {
      socket.destroy();
    });
    socket.once("close", () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      if (this.deadline) clearTimeout(this.deadline);
      this.deadline = undefined;
      this.version = 0;
      this.state = "pending";
      if (this.closed) return;
      this.diagnostic(`Forwarding unavailable: ${reason}`);
      const delay = Math.min(1000 * 2 ** Math.min(this.failures++, 5), 30000);
      this.retry = setTimeout(() => {
        this.retry = undefined;
        this.connect();
      }, delay);
    });
  }

  private accept(value: unknown): void {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("invalid registration");
    const registration = value as Record<string, unknown>;
    if (
      registration.id !== this.options.id ||
      registration.target !== this.options.target ||
      !Number.isSafeInteger(registration.version) ||
      Number(registration.version) < 1 ||
      typeof registration.state !== "string" ||
      !/^[a-z][a-z-]{0,31}$/.test(registration.state)
    )
      throw new Error("invalid registration identity or state");
    const version = Number(registration.version);
    if (version <= this.version) return;
    if (
      registration.state === "ready" &&
      registration.publicUrl !== this.options.publicUrl
    )
      throw new Error("unexpected public URL");
    this.version = version;
    this.state = registration.state;
    if (this.state === "ready")
      this.diagnostic(`Forwarding ready: ${this.options.publicUrl}`);
    else
      this.diagnostic(
        `Forwarding state: ${this.state}${registration.error ? "; inspect Hub Forwarding for details" : ""}`,
      );
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.deadline) clearTimeout(this.deadline);
    this.retry = undefined;
    this.deadline = undefined;
    this.socket?.destroy();
    this.socket = undefined;
    this.version = 0;
    this.state = "unregistered";
  }
}
