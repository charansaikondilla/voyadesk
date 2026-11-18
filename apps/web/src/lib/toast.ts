export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<(t: Toast[]) => void>();

function emit() {
  listeners.forEach((l) => l(toasts));
}

function push(kind: Toast["kind"], message: string) {
  const t = { id: nextId++, kind, message };
  toasts = [...toasts.slice(-3), t];
  emit();
  window.setTimeout(() => dismiss(t.id), kind === "error" ? 7000 : 3500);
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  success: (m: string) => push("success", m),
  error: (m: string) => push("error", m),
  info: (m: string) => push("info", m),
  subscribe(l: (t: Toast[]) => void) {
    listeners.add(l);
    l(toasts);
    return () => {
      listeners.delete(l);
    };
  },
};

/** Copy text from a click handler; never throws (sandboxed frames may refuse clipboard access). */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  } catch {
    toast.info("Couldn't copy automatically — select the text and copy it.");
  }
}
