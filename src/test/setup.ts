import { vi } from "vitest";

// Tauri v2 的 invoke 最终调用 window.__TAURI_INTERNALS__.invoke
// 用一个通用 stub 避免没 mock 时 throw 打断测试；具体测试再通过 vi.mock 覆盖
type TauriInternals = {
  invoke: (...args: unknown[]) => Promise<unknown>;
  transformCallback: (...args: unknown[]) => unknown;
};

(window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__ = {
  invoke: vi.fn(async () => null),
  transformCallback: vi.fn(),
};
