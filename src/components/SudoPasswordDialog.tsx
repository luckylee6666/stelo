import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { KeyRound, Loader2, AlertTriangle } from "lucide-react";
import { getCachedSudo, setCachedSudo, clearCachedSudo } from "../lib/sudoCache";

type SudoResult = { exit_code: number; stdout: string; stderr: string };

type Props = {
  backendId: string;
  /** 要在远端跑的命令（不含 sudo 前缀，本组件会加 sudo -S -p ''）。示例：`rm -- '/opt/foo'` */
  command: string;
  /** 顶部说明（显示给用户的动作描述）。示例：`删除 /opt/foo` */
  description: string;
  /** 成功（exit_code === 0）时调用，参数是 stdout。 */
  onSuccess: (stdout: string) => void;
  onCancel: () => void;
};

export function SudoPasswordDialog({
  backendId,
  command,
  description,
  onSuccess,
  onCancel,
}: Props) {
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  // 有缓存 → 尝试直接执行；失败（密码变了/sudoers 变了）再弹手动输入
  useEffect(() => {
    const cached = getCachedSudo(backendId);
    if (cached) {
      void run(cached, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (pw: string, saveOnSuccess: boolean) => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const res = await invoke<SudoResult>("ssh_exec_sudo", {
        sessionId: backendId,
        password: pw,
        command,
      });
      if (res.exit_code === 0) {
        if (saveOnSuccess && remember) setCachedSudo(backendId, pw);
        onSuccess(res.stdout);
        return;
      }
      // 密码错：清缓存（如果是走缓存进来的），让用户重新输入
      const lower = (res.stderr + res.stdout).toLowerCase();
      if (lower.includes("sorry, try again") || lower.includes("incorrect password")) {
        clearCachedSudo(backendId);
        setError("密码不对，请重试");
      } else if (lower.includes("not in the sudoers") || lower.includes("not allowed")) {
        setError(`当前用户没有 sudo 权限：${res.stderr.trim() || res.stdout.trim()}`);
      } else {
        setError(
          `命令退出码 ${res.exit_code}${res.stderr.trim() ? `：${res.stderr.trim()}` : ""}`,
        );
      }
    } catch (e) {
      setError(`执行失败：${e}`);
    } finally {
      setRunning(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || running) return;
    void run(password, true);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={() => !running && onCancel()}
    >
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-[420px] rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-center gap-2">
          <KeyRound size={16} className="text-amber-400" />
          <h2 className="text-sm font-semibold text-neutral-100">需要 sudo 密码</h2>
        </div>
        <p className="mb-1 text-xs text-neutral-400">即将执行：</p>
        <pre className="mb-3 max-h-20 overflow-auto rounded bg-neutral-950 px-2 py-1.5 font-mono text-xs text-amber-300">
          sudo {command}
        </pre>
        <p className="mb-3 text-xs text-neutral-500">
          {description}。密码只在内存里暂存，不落盘；App 关掉即清。
        </p>

        <label className="mb-2 block">
          <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
            密码
          </span>
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={running}
            className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500 disabled:opacity-60"
            placeholder="当前用户的登录/sudo 密码"
          />
        </label>

        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-400">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          记住 15 分钟（仅本次 Stelo 进程内）
        </label>

        {error && (
          <div className="mt-3 flex items-start gap-1.5 rounded border border-red-900/50 bg-red-950/40 px-2 py-1.5 text-xs text-red-300">
            <AlertTriangle size={11} className="mt-0.5 shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={running}
            onClick={onCancel}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={running || !password}
            className="flex items-center gap-1 rounded bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-40"
          >
            {running && <Loader2 size={12} className="animate-spin" />}
            {running ? "执行中…" : "确认执行"}
          </button>
        </div>
      </form>
    </div>
  );
}
