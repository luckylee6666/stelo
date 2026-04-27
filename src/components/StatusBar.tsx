import { useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { cn } from "../lib/utils";

type Metrics = {
  cpu: number;
  mem_used_kb: number;
  mem_total_kb: number;
  load1: number;
  load5: number;
  load15: number;
  net_rx_bps: number;
  net_tx_bps: number;
};

type Props = {
  backendId: string;
  cwd?: string;
  onCwdClick?: () => void;
  panelOpen?: boolean;
};

function formatMem(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)}G`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(0)}M`;
  return `${kb}K`;
}

function formatBps(bps: number): string {
  if (bps >= 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(1)}M/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(1)}K/s`;
  return `${bps}B/s`;
}

function barColor(pct: number): string {
  if (pct >= 85) return "bg-red-500";
  if (pct >= 65) return "bg-amber-500";
  return "bg-emerald-500";
}

export function StatusBar({ backendId, cwd, onCwdClick, panelOpen }: Props) {
  const [m, setM] = useState<Metrics | null>(null);

  useEffect(() => {
    let un: UnlistenFn | null = null;
    listen<Metrics>(`metrics:data:${backendId}`, (e) => {
      setM(e.payload);
    }).then((fn) => {
      un = fn;
    });
    return () => {
      un?.();
    };
  }, [backendId]);

  if (!m) {
    return (
      <div className="flex h-6 items-center gap-4 border-b border-neutral-800 bg-neutral-950/60 px-3 text-xs text-neutral-500">
        <span>采集中…</span>
      </div>
    );
  }

  const memPct = (m.mem_used_kb / m.mem_total_kb) * 100;

  return (
    <div className="flex h-6 items-center gap-4 border-b border-neutral-800 bg-neutral-950/60 px-3 text-xs text-neutral-300">
      <Stat
        label="CPU"
        value={`${m.cpu.toFixed(1)}%`}
        pct={m.cpu}
      />
      <Stat
        label="MEM"
        value={`${formatMem(m.mem_used_kb)} / ${formatMem(m.mem_total_kb)}`}
        pct={memPct}
      />
      <span className="text-neutral-600">·</span>
      <span>
        <span className="text-neutral-500">LOAD</span>{" "}
        <span className="font-mono">
          {m.load1.toFixed(2)} {m.load5.toFixed(2)} {m.load15.toFixed(2)}
        </span>
      </span>
      <span className="text-neutral-600">·</span>
      <span className="flex items-center gap-1">
        <span className="text-neutral-500">NET</span>
        <span className="font-mono text-sky-400" title="下行">
          ↓ {formatBps(m.net_rx_bps)}
        </span>
        <span className="font-mono text-amber-400" title="上行">
          ↑ {formatBps(m.net_tx_bps)}
        </span>
      </span>
      {cwd && (
        <>
          <span className="text-neutral-600">·</span>
          <button
            onClick={onCwdClick}
            className={cn(
              "flex min-w-0 items-center gap-1 rounded px-1 py-0.5 hover:bg-neutral-800",
              panelOpen && "bg-neutral-800 text-neutral-100",
            )}
            title="点击浏览当前目录"
          >
            <span className="text-neutral-500">CWD</span>
            <span className="truncate font-mono">{cwd}</span>
            <span className="shrink-0 text-[9px] text-neutral-600">
              {panelOpen ? "▲" : "▼"}
            </span>
          </button>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  pct,
}: {
  label: string;
  value: string;
  pct: number;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-neutral-500">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
      <span className="relative h-1.5 w-12 overflow-hidden rounded bg-neutral-800">
        <span
          className={cn("absolute left-0 top-0 h-full", barColor(clamped))}
          style={{ width: `${clamped}%` }}
        />
      </span>
    </span>
  );
}
