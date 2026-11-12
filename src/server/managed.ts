import { JsonLines, encodeFrame } from "./json-lines.js";
export type Health = {
  state: "healthy" | "degraded" | "unhealthy" | "unknown";
  message?: string;
  components?: { id: string; state: string; message: string }[];
};
type Identity = { appId: string; instanceId: string };
export class ManagedControl {
  private identity?: Identity;
  private queue = Promise.resolve();
  private ready = false;
  private closed = false;
  private healthTimer?: NodeJS.Timeout;
  private lastHealth = "";
  private reader = new JsonLines((frame) => {
    this.queue = this.queue
      .then(async () => {
        if (!this.closed) await this.handle(frame);
      })
      .catch((error) => this.fail(error));
  });
  constructor(
    private readonly options: {
      version: string;
      initialize: () => Promise<void>;
      health: () => Health;
      stop: (code: number) => Promise<void>;
    },
  ) {}
  start(): void {
    process.stdin.on("data", this.onData);
    process.stdin.once("end", this.onEnd);
    process.stdin.once("error", this.onError);
    process.stdout.once("error", this.onError);
    process.stdin.resume();
  }
  private onData = (chunk: Buffer) => {
    if (!this.closed) {
      try {
        this.reader.feed(chunk);
      } catch (error) {
        void this.fail(error);
      }
    }
  };
  private onEnd = () => {
    try {
      this.reader.end();
    } catch (error) {
      void this.fail(error);
      return;
    }
    this.queue = this.queue
      .then(() => this.finish(0))
      .catch((error) => this.fail(error));
  };
  private onError = (error: Error) => {
    void this.fail(error);
  };
  private async send(frame: object): Promise<void> {
    if (!this.identity || this.closed) return;
    const data = encodeFrame({ ...frame, protocol: 1, ...this.identity });
    await new Promise<void>((done, reject) =>
      process.stdout.write(data, (error) => (error ? reject(error) : done())),
    );
  }
  private sample(): Health {
    try {
      return this.options.health();
    } catch {
      return {
        state: "unhealthy",
        message: "Health probe failed; inspect application logs.",
      };
    }
  }
  private async handle(frame: Record<string, unknown>): Promise<void> {
    const allowed = [
      "type",
      "requestId",
      "method",
      "protocol",
      "appId",
      "instanceId",
    ];
    if (
      Object.keys(frame).some((key) => !allowed.includes(key)) ||
      frame.type !== "request" ||
      !Number.isSafeInteger(frame.requestId) ||
      Number(frame.requestId) <= 0
    )
      throw new Error("Invalid managed request");
    if (!this.identity) {
      if (
        frame.method !== "initialize" ||
        frame.protocol !== 1 ||
        typeof frame.appId !== "string" ||
        !/^[a-z][a-z0-9-]{0,62}$/.test(frame.appId) ||
        typeof frame.instanceId !== "string" ||
        !frame.instanceId ||
        frame.instanceId.length > 256
      )
        throw new Error("Invalid managed initialization");
      this.identity = { appId: frame.appId, instanceId: frame.instanceId };
      await this.options.initialize();
      if (this.closed) return;
      const health = this.sample();
      await this.send({ type: "ready", version: this.options.version, health });
      this.ready = true;
      this.lastHealth = JSON.stringify(health);
      this.healthTimer = setInterval(() => {
        void this.publishHealth().catch((error) => this.fail(error));
      }, 1000);
      return;
    }
    if (
      frame.appId !== this.identity.appId ||
      frame.instanceId !== this.identity.instanceId ||
      (frame.protocol !== undefined && frame.protocol !== 1)
    )
      throw new Error("Managed instance identity mismatch");
    if (!this.ready) throw new Error("Managed request before readiness");
    if (frame.method === "health")
      await this.send({
        type: "response",
        requestId: frame.requestId,
        health: this.sample(),
      });
    else if (frame.method === "shutdown") {
      await this.send({ type: "response", requestId: frame.requestId });
      await this.finish(0);
    } else throw new Error("Unsupported managed command");
  }
  private async publishHealth(): Promise<void> {
    if (this.closed || !this.ready) return;
    const health = this.sample(),
      serialized = JSON.stringify(health);
    if (serialized !== this.lastHealth) {
      await this.send({ type: "event", method: "health", health });
      this.lastHealth = serialized;
    }
  }
  private async fail(error: unknown): Promise<void> {
    if (this.closed) return;
    console.error(
      "Managed control failed:",
      error instanceof Error ? error.message : "invalid control frame",
    );
    await this.finish(1);
  }
  private async finish(code: number): Promise<void> {
    if (!this.closed) {
      this.dispose();
      await this.options.stop(code);
    }
  }
  dispose(): void {
    this.closed = true;
    if (this.healthTimer) clearInterval(this.healthTimer);
    process.stdin.off("data", this.onData);
    process.stdin.off("end", this.onEnd);
    process.stdin.off("error", this.onError);
    process.stdout.off("error", this.onError);
    process.stdin.pause();
  }
}
