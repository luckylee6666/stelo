type Props = {
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  title,
  message,
  confirmText = "确认",
  danger,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[380px] rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-2xl"
      >
        <h2 className="mb-2 text-sm font-semibold text-neutral-100">{title}</h2>
        <p className="text-xs leading-relaxed text-neutral-400">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className={
              danger
                ? "rounded bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-500"
                : "rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
            }
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
