import type { BeadPattern } from "../../../packages/core/src/types";
export interface PatternState {
  pattern: BeadPattern;
  digest: string;
  canUndo: boolean;
  canRedo: boolean;
  archives: {
    id: number;
    name: string;
    format: string;
    bytes: number;
    digest: string;
  }[];
}
export interface Project {
  id: string;
  title: string;
  revision: number;
  width: number;
  height: number;
  palette: string;
  beadCount: number;
  colorCount: number;
  updatedAt: string;
}
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public path = "",
    public status = 400,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: { message: "网络请求失败" } }));
    const e = data.error ?? {};
    throw new ApiError(
      e.code ?? "NETWORK_ERROR",
      e.message ?? "请求失败",
      e.path,
      res.status,
    );
  }
  return res.json();
}
export async function download(path: string, fallback: string) {
  const response = await fetch("/api/v1" + path, {
    credentials: "same-origin",
  });
  if (!response.ok) {
    const e = await response.json();
    throw new ApiError(
      e.error.code,
      e.error.message,
      e.error.path,
      response.status,
    );
  }
  const blob = await response.blob(),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = fallback;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
