import { useEffect, useRef, useState } from "react";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  useAiStore,
  PRESETS,
  type AiKind,
  type AiProvider,
} from "../stores/aiProviders";
import { getApiKey, setApiKey, deleteApiKey } from "../lib/ai";
import { isStrictRedactEnabled, setStrictRedactEnabled } from "../lib/agent";
import { ConfirmDialog } from "./ConfirmDialog";
import { cn } from "../lib/utils";

type Props = {
  onClose: () => void;
};

export function AiManagerDialog({ onClose }: Props) {
  const providers = useAiStore((s) => s.providers);
  const activeId = useAiStore((s) => s.activeId);
  const setActive = useAiStore((s) => s.setActive);
  const addProvider = useAiStore((s) => s.addProvider);
  const updateProvider = useAiStore((s) => s.updateProvider);
  const removeProvider = useAiStore((s) => s.removeProvider);

  const [editing, setEditing] = useState<AiProvider | null | "new">(null);
  const [pendingDelete, setPendingDelete] = useState<AiProvider | null>(null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[540px] w-[620px] flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">
              AI 模型管理
            </h2>
            <p className="text-xs text-neutral-500">
              支持 Claude / OpenAI / DeepSeek / Kimi / 通义 / Ollama 本地 等任意
              OpenAI 兼容 API
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {providers.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-neutral-500">
              <span>还没有配置任何 AI 模型</span>
              <button
                onClick={() => setEditing("new")}
                className="mt-2 rounded bg-blue-600 px-4 py-1.5 text-xs text-white hover:bg-blue-500"
              >
                + 添加模型
              </button>
            </div>
          )}
          {providers.length > 0 && (
            <div className="divide-y divide-neutral-800">
              {providers.map((p) => (
                <div
                  key={p.id}
                  className="group flex items-center gap-3 px-5 py-2.5 hover:bg-neutral-800/30"
                >
                  <span className="text-lg">
                    {p.kind === "claude" ? "🟠" : "🟢"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 truncate text-sm text-neutral-100">
                      {p.name}
                      {p.id === activeId && (
                        <span className="rounded bg-emerald-600/30 px-1.5 py-0.5 text-[11px] text-emerald-400">
                          当前
                        </span>
                      )}
                    </div>
                    <div className="truncate font-mono text-xs text-neutral-500">
                      {p.model} · {p.apiBase}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {p.id !== activeId && (
                      <button
                        onClick={() => setActive(p.id)}
                        className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                        title="切换为当前模型"
                      >
                        设为当前
                      </button>
                    )}
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                      <button
                        onClick={() => setEditing(p)}
                        className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => setPendingDelete(p)}
                        className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-red-900/60 hover:text-red-200"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {providers.length > 0 && (
          <div className="shrink-0 border-t border-neutral-800 px-5 py-3">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setEditing("new")}
                className="rounded bg-blue-600 px-4 py-1.5 text-xs text-white hover:bg-blue-500"
              >
                + 添加模型
              </button>
              <StrictRedactToggle />
            </div>
          </div>
        )}
      </div>

      {editing !== null && (
        <ProviderForm
          initial={editing === "new" ? null : editing}
          onSubmit={async (draft, key, remember) => {
            let id = "";
            if (editing === "new") {
              id = addProvider({
                name: draft.name,
                kind: draft.kind,
                apiBase: draft.apiBase,
                model: draft.model,
                maxTokens: draft.maxTokens,
              });
            } else {
              id = editing.id;
              updateProvider(id, {
                name: draft.name,
                kind: draft.kind,
                apiBase: draft.apiBase,
                model: draft.model,
                maxTokens: draft.maxTokens,
              });
            }
            if (remember && key) await setApiKey(id, key);
            else if (!remember) await deleteApiKey(id);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="删除 AI 模型"
          message={`确认删除"${pendingDelete.name}"？API Key 也会被清除。`}
          confirmText="删除"
          danger
          onConfirm={async () => {
            await deleteApiKey(pendingDelete.id);
            removeProvider(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function StrictRedactToggle() {
  const [on, setOn] = useState<boolean>(() => isStrictRedactEnabled());
  return (
    <label
      className="flex cursor-pointer items-center gap-2 text-xs text-neutral-300"
      title="开启后：AI 工具命令的输出若命中脱敏规则（密码/token/API key），整段输出对 AI 屏蔽，不送进 prompt。关闭后只替换敏感字段为 ***。"
    >
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          setOn(e.target.checked);
          setStrictRedactEnabled(e.target.checked);
        }}
        className="h-3.5 w-3.5 cursor-pointer accent-emerald-500"
      />
      <span>AI 严格脱敏</span>
      {on && (
        <span className="rounded bg-emerald-600/20 px-1.5 py-0.5 text-[10px] text-emerald-300">
          推荐
        </span>
      )}
    </label>
  );
}

type ProviderDraft = {
  name: string;
  kind: AiKind;
  apiBase: string;
  model: string;
  maxTokens: number;
};

function ProviderForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: AiProvider | null;
  onSubmit: (draft: ProviderDraft, key: string, remember: boolean) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<AiKind>(initial?.kind ?? "openai");
  const [apiBase, setApiBase] = useState(initial?.apiBase ?? "https://api.openai.com/v1");
  const [model, setModel] = useState(initial?.model ?? "gpt-4o");
  const [maxTokens, setMaxTokens] = useState<string>(
    String(initial?.maxTokens ?? 1024),
  );
  const [apiKey, setApiKeyInput] = useState("");
  const [remember, setRemember] = useState(true);
  const [keyExists, setKeyExists] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => firstRef.current?.focus(), 40);
    if (initial) {
      getApiKey(initial.id).then((k) => {
        if (k) {
          setApiKeyInput(k);
          setKeyExists(true);
        }
      });
    }
  }, [initial]);

  const applyPreset = (idx: string) => {
    const i = Number(idx);
    if (Number.isNaN(i) || !PRESETS[i]) return;
    const p = PRESETS[i];
    setName(p.name);
    setKind(p.kind);
    setApiBase(p.apiBase);
    setModel(p.model);
  };

  /** 发一条最小请求验证 API key + apiBase + model 是否真的能工作 */
  const testConnection = async () => {
    if (testing) return;
    if (!apiBase.trim() || !model.trim() || !apiKey.trim()) {
      toast.warning("请先填 API Base / 模型 / API Key");
      return;
    }
    setTesting(true);
    try {
      const t0 = performance.now();
      const url =
        kind === "claude"
          ? `${apiBase.replace(/\/$/, "")}/v1/messages`
          : `${apiBase.replace(/\/$/, "")}/chat/completions`;
      const headers: Record<string, string> =
        kind === "claude"
          ? {
              Authorization: `Bearer ${apiKey}`,
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            }
          : {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            };
      const body =
        kind === "claude"
          ? {
              model: model.trim(),
              max_tokens: 8,
              messages: [{ role: "user", content: "hi" }],
            }
          : {
              model: model.trim(),
              messages: [{ role: "user", content: "hi" }],
              max_tokens: 8,
            };
      const res = await tauriFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const elapsed = Math.round(performance.now() - t0);
      if (res.ok) {
        toast.success(`连接成功（${elapsed}ms）`, {
          description: `${name || "Provider"} · ${model}`,
        });
      } else {
        const txt = await res.text();
        // 截短并避免回显 API key
        const safe = txt
          .replace(new RegExp(apiKey, "g"), "***")
          .slice(0, 240);
        toast.error(`API 返回 ${res.status}`, { description: safe });
      }
    } catch (e) {
      toast.error("连接失败", { description: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim() || !apiBase.trim() || !model.trim()) {
      setError("名称、API Base、模型名都必填");
      return;
    }
    const mt = Number(maxTokens);
    if (!Number.isInteger(mt) || mt <= 0 || mt > 32768) {
      setError("max_tokens 不合法");
      return;
    }
    onSubmit(
      {
        name: name.trim(),
        kind,
        apiBase: apiBase.trim(),
        model: model.trim(),
        maxTokens: mt,
      },
      apiKey,
      remember,
    );
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70"
      onClick={onCancel}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-[520px] max-h-[90vh] overflow-auto rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-2xl"
      >
        <h3 className="mb-3 text-sm font-semibold text-neutral-100">
          {initial ? "编辑模型" : "新建模型"}
        </h3>

        {!initial && (
          <label className="mb-3 block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
              从 Preset 快速填入
            </span>
            <select
              defaultValue=""
              onChange={(e) => applyPreset(e.target.value)}
              className={inputCls}
            >
              <option value="">（手动填写）</option>
              {PRESETS.map((p, i) => (
                <option key={i} value={i}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="space-y-3 text-sm">
          <Field label="名称（你自己起）">
            <input
              ref={firstRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
            />
          </Field>

          <Field label="类型">
            <div className="flex rounded border border-neutral-700 p-0.5">
              <TabBtn active={kind === "openai"} onClick={() => setKind("openai")}>
                OpenAI 兼容
              </TabBtn>
              <TabBtn active={kind === "claude"} onClick={() => setKind("claude")}>
                Claude Messages
              </TabBtn>
            </div>
          </Field>

          <Field label="API Base URL">
            <input
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
              className={inputCls}
              placeholder={
                kind === "claude"
                  ? "https://api.anthropic.com"
                  : "https://api.openai.com/v1"
              }
            />
          </Field>

          <Field label="模型名">
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={inputCls}
              placeholder={
                kind === "claude" ? "claude-sonnet-4-6" : "gpt-4o / deepseek-chat / ..."
              }
            />
          </Field>

          <Field label="max_tokens">
            <input
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              className={inputCls}
            />
          </Field>

          <Field label="API Key">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={keyExists ? "（已保存，留空保留）" : "sk-... / 你的 key"}
              className={inputCls}
            />
          </Field>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-400">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            记住 API Key（保存到本地应用目录）
            {keyExists && (
              <span className="text-emerald-500">· 已保存</span>
            )}
          </label>
        </div>

        {error && (
          <div className="mt-3 rounded border border-red-900/50 bg-red-950/40 px-2 py-1.5 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={testConnection}
            disabled={testing}
            className="flex items-center gap-1.5 rounded border border-emerald-700 bg-emerald-950/40 px-3 py-1.5 text-sm font-medium text-emerald-200 hover:bg-emerald-900/40"
            title="发一条最小请求验证 API Key 是否有效"
          >
            {testing ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <span>⚡</span>
            )}
            测试连接
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
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
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
        {label}
      </span>
      {children}
    </label>
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
