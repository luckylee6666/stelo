import { create } from "zustand";

export type ConfirmOptions = {
  title: string;
  /** 简短描述，可包含 \n 换行 */
  message: string;
  /** 可选预览内容（用 monospace 框 + max-height 滚动展示，专门给"粘贴预览 / 命令片段"这种场景） */
  preview?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  /** 琥珀色警告级（不那么"红"，但比普通"蓝"严重）。默认 false。 */
  warn?: boolean;
};

type PendingConfirm = {
  id: number;
  opts: ConfirmOptions;
  resolve: (ok: boolean) => void;
};

type DialogState = {
  current: PendingConfirm | null;
  /** 入队一个 confirm；返回 Promise，true 表示用户点了确认。 */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  _settle: (ok: boolean) => void;
};

let nextId = 1;

export const useDialogStore = create<DialogState>((set, get) => ({
  current: null,
  confirm: (opts) =>
    new Promise<boolean>((resolve) => {
      const id = nextId++;
      // 同一时刻只允许一个 confirm；后来的覆盖前一个（前一个自动 reject 为 false）
      const prev = get().current;
      if (prev) prev.resolve(false);
      set({ current: { id, opts, resolve } });
    }),
  _settle: (ok) => {
    const cur = get().current;
    if (!cur) return;
    cur.resolve(ok);
    set({ current: null });
  },
}));

/** 业务侧导出的便捷函数。 */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return useDialogStore.getState().confirm(opts);
}
