import { basePath } from "./base-path";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${basePath}api/${url}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "网络连接失败，请检查网络后重试");
  }
  const data = await response
    .json()
    .catch(() => ({ error: "服务响应异常，请稍后重试" }));
  if (!response.ok)
    throw new ApiError(
      response.status,
      data.code ?? "REQUEST_FAILED",
      data.error ?? "请求失败",
    );
  return data as T;
}
