import { useEffect, useRef, useState } from "react";

type Props = {
  title: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
};

export function InputDialog({
  title,
  label,
  defaultValue = "",
  placeholder,
  confirmText = "确认",
  onConfirm,
  onCancel,
}: Props) {
  const [value, setValue] = useState(defaultValue);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => ref.current?.select(), 30);
  }, []);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    onConfirm(v);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-[400px] rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-2xl"
      >
        <h3 className="mb-3 text-sm font-semibold text-neutral-100">{title}</h3>
        {label && (
          <div className="mb-1 text-xs uppercase tracking-wider text-neutral-500">
            {label}
          </div>
        )}
        <input
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!value.trim()}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
          >
            {confirmText}
          </button>
        </div>
      </form>
    </div>
  );
}
