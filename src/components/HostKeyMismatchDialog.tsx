import { useEffect, useState } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import type { ChallengeResolver, HostKeyChallenge } from "../lib/sshConnect";

type Pending = {
  challenge: HostKeyChallenge;
  resolve: ChallengeResolver;
};

/** 顶层挂载一次，全局监听 hyper:hostkey-challenge 事件并弹对话框（首次确认 / 指纹变更）。 */
export function HostKeyMismatchDialog() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    const onEv = (e: Event) => {
      const ce = e as CustomEvent<Pending>;
      if (ce.detail?.challenge && typeof ce.detail.resolve === "function") {
        setPending(ce.detail);
      }
    };
    window.addEventListener("hyper:hostkey-challenge", onEv);
    return () => window.removeEventListener("hyper:hostkey-challenge", onEv);
  }, []);

  if (!pending) return null;
  const { challenge } = pending;

  const settle = (trust: boolean) => {
    pending.resolve(trust);
    setPending(null);
  };

  if (challenge.kind === "unverified") {
    const { info } = challenge;
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 backdrop-blur-sm">
        <div className="w-[540px] rounded-lg border border-amber-600/70 bg-neutral-900 p-5 shadow-2xl shadow-amber-900/30">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck size={20} className="text-amber-400" />
            <h2 className="text-base font-semibold text-amber-100">
              首次连接此主机 — 请确认指纹
            </h2>
          </div>

          <div className="mb-4 rounded border border-amber-900/60 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-100/90">
            这是 Stelo 第一次连接 <span className="font-mono">{info.host}:{info.port}</span>。
            建议你**通过其它可信渠道**（云控制台、运维同事确认、或在控制台直接登录后看 <span className="font-mono">ssh-keygen -lf /etc/ssh/ssh_host_*_key.pub</span>）核对下面的指纹再确认。
            盲点同意 = 接受可能的中间人攻击。
          </div>

          <div className="mb-4 space-y-2 rounded bg-neutral-950 px-3 py-2 font-mono text-xs">
            <div>
              <span className="text-neutral-500">主机：</span>
              <span className="text-neutral-200">
                {info.host}:{info.port}
              </span>
            </div>
            <div>
              <span className="text-neutral-500">类型：</span>
              <span className="text-emerald-300">{info.key_type}</span>
            </div>
            <div>
              <span className="text-neutral-500">指纹：</span>
              <span className="ml-1 break-all text-neutral-200">
                {info.fingerprint}
              </span>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => settle(false)}
              className="rounded border border-neutral-700 px-4 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => settle(true)}
              className="rounded bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-500"
            >
              指纹一致，信任并连接
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { info } = challenge;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div className="w-[540px] rounded-lg border-2 border-red-600/80 bg-neutral-900 p-5 shadow-2xl shadow-red-900/40">
        <div className="mb-3 flex items-center gap-2">
          <ShieldAlert size={20} className="text-red-400" />
          <h2 className="text-base font-semibold text-red-200">
            ⚠️ 远端主机密钥已变更
          </h2>
        </div>

        <div className="mb-4 rounded border border-red-900/60 bg-red-950/30 p-3 text-xs leading-relaxed text-red-200">
          <div className="mb-1.5 font-semibold">可能原因：</div>
          <ul className="ml-4 list-disc space-y-0.5 text-red-200/90">
            <li>服务器重装 / 系统重做 / 换了 SSH 服务端 —— 正常</li>
            <li>有人中间人（MITM）劫持你的连接 —— 危险</li>
            <li>你在连另一台同 IP 的机器（地址回收） —— 需人工确认</li>
          </ul>
          <div className="mt-2 text-red-300">
            如果你没有重装 / 换机器，请**不要**信任，立即联系管理员。
          </div>
        </div>

        <div className="mb-4 space-y-2 rounded bg-neutral-950 px-3 py-2 font-mono text-xs">
          <div>
            <span className="text-neutral-500">主机：</span>
            <span className="text-neutral-200">
              {info.host}:{info.port}
            </span>
          </div>
          <div>
            <span className="text-neutral-500">历史记录：</span>
            <span className="text-emerald-300">{info.expected_key_type}</span>
            <span className="ml-1 break-all text-neutral-400">
              {info.expected_fingerprint}
            </span>
          </div>
          <div>
            <span className="text-neutral-500">本次收到：</span>
            <span className="text-amber-300">{info.got_key_type}</span>
            <span className="ml-1 break-all text-neutral-400">
              {info.got_fingerprint}
            </span>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => settle(false)}
            className="rounded border border-neutral-700 px-4 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
          >
            取消连接（推荐）
          </button>
          <button
            type="button"
            onClick={() => settle(true)}
            className="rounded bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-500"
          >
            信任新密钥并连接
          </button>
        </div>
      </div>
    </div>
  );
}
