import type { Session } from "../stores/sessions";

type Props = {
  session: Session;
  onCancel?: () => void;
};

export function ConnectingView({ session, onCancel }: Props) {
  const target = `${session.user}@${session.host}${
    session.port && session.port !== 22 ? `:${session.port}` : ""
  }`;
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div className="w-[360px] rounded-lg border border-neutral-800 bg-neutral-900 p-6">
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
        </div>
        <div className="mt-4 flex gap-1 text-xs text-neutral-500">
          <Step done label="读取本地凭据" />
          <Step done label="TCP 握手" />
          <Step running label="SSH 认证" />
          <Step label="打开 PTY" />
        </div>
        {onCancel && (
          <button
            onClick={onCancel}
            className="mt-5 w-full rounded border border-neutral-700 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
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
