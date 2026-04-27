import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 把后端抛出的 SFTP/SSH 错误串翻成中文 + 给出 actionable 提示。 */
export function friendlyFsError(raw: string): { message: string; canSudo: boolean } {
  const s = raw.toLowerCase();
  if (s.includes("permission denied")) {
    return {
      message: "权限不足——此路径需要管理员（root）权限才能操作",
      canSudo: true,
    };
  }
  if (s.includes("no such file") || s.includes("not found")) {
    return { message: "路径不存在或已被删除", canSudo: false };
  }
  if (s.includes("directory not empty") || s.includes("非空")) {
    return { message: "目录非空——请先清空内部文件", canSudo: false };
  }
  if (s.includes("disk full") || s.includes("no space")) {
    return { message: "远端磁盘空间不足", canSudo: false };
  }
  if (s.includes("connection") && (s.includes("refused") || s.includes("reset") || s.includes("closed"))) {
    return { message: "SSH 连接已断开，请先重连", canSudo: false };
  }
  return { message: raw, canSudo: false };
}
