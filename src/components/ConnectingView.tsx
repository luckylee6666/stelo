import { useEffect, useState } from "react";
import type { Session } from "../stores/sessions";

type Props = {
  session: Session;
  onCancel?: () => void;
};

const TIMEOUT_MS = 15_000;

export function ConnectingView({ session, onCancel }: Props) {
  const target = `${session.user}@${session.host}${
    session.port && session.port !== 22 ? `:${session.port}` : ""
  }`;
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - start), 200);
    return () => clearInterval(id);
  }, []);

  const pct = Math.min(100, (elapsed / TIMEOUT_MS) * 100);
  const seconds = Math.floor(elapsed / 1000);
  const remaining = Math.max(0, Math.ceil((TIMEOUT_MS - elapsed) / 1000));
  // 阶段推断（前端只能猜——后端未发事件）：0~3s 解析+握手；3~10s 认证；10~15s 打开 PTY/超时风险
  const stage = seconds < 3 ? 0 : seconds < 10 ? 1 : 2;

  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div className="w-[400px] rounded-lg border border-neutral-800 bg-neutral-900 p-6">
        <div className="flex items-center gap-3">
          <Spinner />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-neutral-100">
              {session.name}
            </div>
            <div className="truncate text-xs text-neutral-500">
              正在连接 {target}
            </div>
          </div>
          <div className="shrink-0 font-mono text-xs text-neutral-500" title="剩余等待时间">
            {remaining}s
          </div>
        </div>

        {/* 倒计时进度条：到 100% 触发服务端 timeout */}
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-neutral-800">
          <div
            className={`h-full transition-[width] duration-200 ease-linear ${
              pct < 70
                ? "bg-blue-500"
                : pct < 90
                  ? "bg-amber-500"
                  : "bg-red-500"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="mt-4 flex gap-1 text-xs text-neutral-500">
          <Step done={stage > 0} running={stage === 0} label="TCP / SSH 握手" />
          <Step done={stage > 1} running={stage === 1} label="认证" />
          <Step done={false} running={stage === 2} label="打开 PTY" />
        </div>

        {pct >= 90 && (
          <div className="mt-3 rounded border border-amber-700/60 bg-amber-950/30 px-2 py-1.5 text-[11px] text-amber-200">
            ⚠ 即将超时（{TIMEOUT_MS / 1000}s 上限）。可能原因：
            网络阻塞 / 防火墙 / 端口错误。
          </div>
        )}

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="mt-5 w-full rounded border border-neutral-700 py-1.5 text-xs text-neutral-400 transition-colors duration-150 hover:bg-neutral-800 hover:text-neutral-200"
          >
            取消
          </button>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-neutral-700 border-t-blue-500"
      aria-hidden
    />
  );
}

function Step({
  label,
  done,
  running,
}: {
  label: string;
  done?: boolean;
  running?: boolean;
}) {
  return (
    <span
      className={
        done
          ? "flex-1 rounded bg-emerald-600/20 px-1.5 py-0.5 text-center text-emerald-400"
          : running
            ? "flex-1 rounded bg-blue-600/20 px-1.5 py-0.5 text-center text-blue-300"
            : "flex-1 rounded bg-neutral-800 px-1.5 py-0.5 text-center text-neutral-600"
      }
    >
      {done ? "✓ " : running ? "… " : ""}
      {label}
    </span>
  );
}
