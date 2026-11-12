import { createRequire } from "node:module";
import { resolve } from "node:path";

// Verification uses Playwright's pinned WebSocket implementation for browser
// session headers; the application itself never reads Registry credentials.
const { ws: NodeWebSocket } = createRequire(import.meta.url)(
  resolve("node_modules/playwright-core/lib/utilsBundle.js"),
);

export async function registryClient({
  origin,
  token = "",
  hubId,
  protocolVersion = "2.11",
}) {
  if (!token)
    throw new Error(
      "Registry browser authentication is required; no verification credential was provided.",
    );
  const login = await fetch(new URL("/ws?auth=login", origin), {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      token,
      deviceName: "BrainGym integration verification",
    }),
  });
  if (!login.ok)
    throw new Error(`Registry verification login failed (${login.status})`);
  const authenticated = await login.json();
  if (!authenticated.authenticated)
    throw new Error("Registry verification login was not authenticated");
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const address = new URL("/ws", origin);
  address.protocol = address.protocol === "https:" ? "wss:" : "ws:";
  const socket = new NodeWebSocket(address, {
    headers: {
      Origin: origin,
      Cookie: cookie,
      "X-WheelMaker-CSRF": authenticated.csrfToken ?? "",
    },
  });
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    const message = JSON.parse(event.data);
    const task = pending.get(message.requestId);
    if (!task) {
      if (message.type === "error")
        for (const entry of pending.values())
          entry.reject(
            new Error(
              `${message.payload?.code ?? "RPC_ERROR"}: ${message.payload?.message ?? "connection rejected"}`,
            ),
          );
      return;
    }
    pending.delete(message.requestId);
    clearTimeout(task.timer);
    if (message.type === "error") {
      const error = new Error(
        `${message.payload?.code ?? "RPC_ERROR"}: ${message.payload?.message ?? "request failed"}`,
      );
      error.details = message.payload?.details;
      task.reject(error);
    } else task.resolve(message.payload);
  });
  socket.addEventListener("close", (event) => {
    for (const task of pending.values()) {
      clearTimeout(task.timer);
      task.reject(
        new Error(
          `Registry connection closed (${event.code}: ${event.reason.slice(0, 100)})`,
        ),
      );
    }
    pending.clear();
  });
  const call = (method, payload = {}, timeout = 10000) =>
    new Promise((resolve, reject) => {
      const requestId = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`${method} timed out`));
      }, timeout);
      pending.set(requestId, { resolve, reject, timer });
      socket.send(
        JSON.stringify({
          type: "request",
          requestId,
          method,
          ...(method === "connect.init" ? {} : { hubId }),
          payload,
        }),
      );
    });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("Registry connection timed out"));
      }, 10000);
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error("Registry connection unavailable"));
        },
        { once: true },
      );
    });
    const initialize = () =>
      call("connect.init", {
        clientName: "BrainGym integration verification",
        clientVersion: "1.0.0",
        protocolVersion,
        role: "client",
      });
    let initialized;
    try {
      initialized = await initialize();
    } catch (error) {
      if (typeof error.details?.supported !== "string") throw error;
      protocolVersion = error.details.supported;
      initialized = await initialize();
    }
    return {
      call,
      protocolVersion:
        initialized?.serverInfo?.protocolVersion ?? protocolVersion,
      close: () => socket.close(),
    };
  } catch (error) {
    socket.close();
    throw error;
  }
}
