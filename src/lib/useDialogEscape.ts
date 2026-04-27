import { useEffect } from "react";

/**
 * Modal 通用 ESC 关闭 hook。
 * 用法：useDialogEscape(onClose);
 * 或带条件：useDialogEscape(onClose, !busy);
 *
 * 注意：input/textarea 内按 ESC 不该关闭弹窗（用户在编辑时常用 ESC 取消 IME 候选）
 * 所以只在事件目标不是表单元素时才触发。
 */
export function useDialogEscape(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/i.test(t.tagName)) {
        // 表单内 ESC 让浏览器 / IME 处理（清空候选 / 失去焦点等）
        return;
      }
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, enabled]);
}
