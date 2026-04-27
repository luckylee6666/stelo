import { useEffect, useRef, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
  useSessionStore,
  COLOR_LABELS,
  type Session,
  type PortForward,
} from "../stores/sessions";
import { useKeyStore } from "../stores/keys";
import { GroupSelect } from "./GroupSelect";
import { cn } from "../lib/utils";
import { newForwardId } from "../lib/forwards";

type Props = {
  session: Session;
  onClose: () => void;
};

type KeySource = "manual" | "saved";

export function EditSessionDialog({ session, onClose }: Props) {
  const updateMeta = useSessionStore((s) => s.updateMeta);
  const savedKeys = useKeyStore((s) => s.keys);

  const [name, setName] = useState(session.name);
  const [host, setHost] = useState(session.host ?? "");
  const [port, setPort] = useState(String(session.port ?? 22));
  const [user, setUser] = useState(session.user ?? "");
  const [keyPath, setKeyPath] = useState(session.keyPath ?? "");
  const [groupId, setGroupId] = useState<string | undefined>(session.groupId);
  const [colorLabel, setColorLabel] = useState<string>(session.colorLabel ?? "");
  const [forwards, setForwards] = useState<PortForward[]>(
    session.portForwards ?? [],
  );
  const [keySource, setKeySource] = useState<KeySource>(
    session.keyId ? "saved" : "manual",
  );
  const [selectedKeyId, setSelectedKeyId] = useState<string>(
    session.keyId ?? savedKeys[0]?.id ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => firstRef.current?.focus(), 40);
  }, []);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!host.trim() || !user.trim() || !name.trim()) {
      setError("名称、主机、用户名必填");
      return;
    }
    const p = Number(port);
    if (!Number.isInteger(p) || p <= 0 || p > 65535) {
      setError("端口号不合法");
      return;
    }
    if (session.authMode === "private_key") {
      if (keySource === "saved" && !selectedKeyId) {
        setError("请选择一个已保存的密钥");
        return;
      }
      if (keySource === "manual" && !keyPath.trim()) {
        setError("私钥路径必填");
        return;
      }
    }

    // 校验 forwards
    for (const pf of forwards) {
      if (!pf.localPort || pf.localPort <= 0 || pf.localPort > 65535) {
        setError(`端口转发规则本地端口不合法: ${pf.localPort}`);
        return;
      }
      if (!pf.remoteHost.trim()) {
        setError("端口转发规则远端主机必填");
        return;
      }
      if (!pf.remotePort || pf.remotePort <= 0 || pf.remotePort > 65535) {
        setError(`端口转发规则远端端口不合法: ${pf.remotePort}`);
        return;
      }
    }

    updateMeta(session.id, {
      name: name.trim(),
      host: host.trim(),
      port: p,
      user: user.trim(),
      keyPath:
        session.authMode === "private_key" && keySource === "manual"
          ? keyPath.trim()
          : undefined,
      keyId:
        session.authMode === "private_key" && keySource === "saved"
          ? selectedKeyId
          : undefined,
      groupId,
      portForwards: forwards,
      colorLabel: colorLabel || undefined,
    });
    onClose();
  };

  const addForward = () => {
    setForwards((prev) => [
      ...prev,
      {
        id: newForwardId(),
        kind: "local",
        localHost: "127.0.0.1",
        localPort: 3306,
        remoteHost: "127.0.0.1",
        remotePort: 3306,
        enabled: true,
      },
    ]);
  };

  const updateForward = (id: string, patch: Partial<PortForward>) => {
    setForwards((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    );
  };

  const removeForward = (id: string) => {
    setForwards((prev) => prev.filter((f) => f.id !== id));
  };

  const pickKey = async () => {
    try {
      const picked = await openFileDialog({
        multiple: false,
        directory: false,
        title: "选择私钥文件（不是 .pub）",
        defaultPath: "~/.ssh",
      });
      if (typeof picked === "string" && picked) {
        setKeyPath(picked.endsWith(".pub") ? picked.slice(0, -4) : picked);
      }
    } catch (e) {
      setError(`打开文件选择失败: ${e}`);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-[520px] overflow-auto rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-2xl"
      >
        <h2 className="mb-1 text-base font-semibold text-neutral-100">
          编辑会话
        </h2>
        <p className="mb-3 text-xs text-neutral-500">
          修改将在下次连接时生效。认证方式（
          {session.authMode === "password" ? "密码" : "私钥"}
          ）不可修改；如需切换请删除后重建。
        </p>

        <div className="space-y-3 text-sm">
          <Field label="名称">
            <input
              ref={firstRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
            />
          </Field>
          <div className="flex gap-2">
            <Field label="主机" className="flex-1">
              <input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="端口" className="w-24">
              <input
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="用户名">
            <input
              value={user}
              onChange={(e) => setUser(e.target.value)}
              className={inputCls}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </Field>

          {session.authMode === "private_key" && (
            <>
              {savedKeys.length > 0 && (
                <div className="flex rounded border border-neutral-700 p-0.5">
                  <TabBtn
                    active={keySource === "saved"}
                    onClick={() => setKeySource("saved")}
                  >
                    选择已保存
                  </TabBtn>
                  <TabBtn
                    active={keySource === "manual"}
                    onClick={() => setKeySource("manual")}
                  >
                    手动输入路径
                  </TabBtn>
                </div>
              )}
              {keySource === "saved" && savedKeys.length > 0 ? (
                <Field label="选择密钥">
                  <select
                    value={selectedKeyId}
                    onChange={(e) => setSelectedKeyId(e.target.value)}
                    className={inputCls}
                  >
                    {savedKeys.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name} — {k.path}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field label="私钥文件">
                  <div className="flex gap-2">
                    <input
                      value={keyPath}
                      onChange={(e) => setKeyPath(e.target.value)}
                      className={inputCls}
                    />
                    <button
                      type="button"
                      onClick={pickKey}
                      className="shrink-0 rounded border border-neutral-700 px-2.5 text-xs text-neutral-300 hover:bg-neutral-800"
                    >
                      浏览…
                    </button>
                  </div>
                </Field>
              )}
            </>
          )}

          <Field label="分组">
            <GroupSelect value={groupId} onChange={setGroupId} />
          </Field>

          <Field label="颜色标签">
            <div className="flex flex-wrap gap-1">
              {COLOR_LABELS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setColorLabel(c.id)}
                  className={cn(
                    "flex items-center gap-1 rounded border px-2 py-1 text-xs",
                    colorLabel === c.id
                      ? "border-blue-500 bg-neutral-800 text-neutral-100"
                      : "border-neutral-700 text-neutral-300 hover:bg-neutral-800",
                  )}
                >
                  <span
                    className="inline-block h-3 w-3 rounded-sm border border-neutral-700"
                    style={{ background: c.hex }}
                  />
                  {c.name}
                </button>
              ))}
            </div>
          </Field>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-neutral-500">
                端口转发（本地 -L）
              </span>
              <button
                type="button"
                onClick={addForward}
                className="rounded px-2 py-0.5 text-xs text-blue-400 hover:bg-neutral-800 hover:text-blue-300"
              >
                + 添加规则
              </button>
            </div>
            {forwards.length === 0 && (
              <div className="rounded border border-dashed border-neutral-800 px-3 py-3 text-center text-xs text-neutral-600">
                无规则。添加后，连接时会自动建立隧道。
              </div>
            )}
            {forwards.map((pf) => (
              <ForwardRow
                key={pf.id}
                pf={pf}
                onChange={(patch) => updateForward(pf.id, patch)}
                onRemove={() => removeForward(pf.id)}
              />
            ))}
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded border border-red-900/50 bg-red-950/40 px-2 py-1.5 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
          >
            取消
          </button>
          <button
            type="submit"
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
          >
            保存
          </button>
        </div>
      </form>
    </div>
  );
}

const inputCls =
  "w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500";

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function ForwardRow({
  pf,
  onChange,
  onRemove,
}: {
  pf: PortForward;
  onChange: (patch: Partial<PortForward>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="mb-2 rounded border border-neutral-800 bg-neutral-950/50 p-2">
      <div className="flex items-center gap-2 text-xs">
        <label className="flex cursor-pointer items-center gap-1 text-neutral-400">
          <input
            type="checkbox"
            checked={pf.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
            className="h-3.5 w-3.5"
          />
          启用
        </label>
        <span className="text-neutral-600">|</span>
        <input
          type="text"
          value={pf.localHost}
          onChange={(e) => onChange({ localHost: e.target.value })}
          className="w-24 rounded border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 font-mono text-xs text-neutral-200 outline-none"
          placeholder="127.0.0.1"
        />
        <span className="text-neutral-500">:</span>
        <input
          type="number"
          value={pf.localPort || ""}
          onChange={(e) => onChange({ localPort: Number(e.target.value) })}
          className="w-16 rounded border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 font-mono text-xs text-neutral-200 outline-none"
          placeholder="本地"
        />
        <span className="text-neutral-500">→</span>
        <input
          type="text"
          value={pf.remoteHost}
          onChange={(e) => onChange({ remoteHost: e.target.value })}
          className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 font-mono text-xs text-neutral-200 outline-none"
          placeholder="远端 host"
        />
        <span className="text-neutral-500">:</span>
        <input
          type="number"
          value={pf.remotePort || ""}
          onChange={(e) => onChange({ remotePort: Number(e.target.value) })}
          className="w-16 rounded border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 font-mono text-xs text-neutral-200 outline-none"
          placeholder="远端"
        />
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded px-1 text-neutral-500 hover:bg-red-900/40 hover:text-red-300"
          title="删除"
        >
          ×
        </button>
      </div>
      <div className="mt-1 text-[11px] text-neutral-600">
        本地 {pf.localHost}:{pf.localPort || "?"} 的连接会通过 SSH 转到远端{" "}
        {pf.remoteHost || "?"}:{pf.remotePort || "?"}
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded py-1 text-xs font-medium",
        active
          ? "bg-neutral-800 text-neutral-100"
          : "text-neutral-400 hover:text-neutral-200",
      )}
    >
      {children}
    </button>
  );
}
