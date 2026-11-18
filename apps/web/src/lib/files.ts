import { parseDataUrl } from "@voyadesk/core";
import { toast } from "./toast";

/** Read a picked file as a data URL. Photos are scaled to ≤1600 px JPEG so uploads stay small and fast on mobile data. */
export async function readFileForUpload(file: File, maxBytes = 8_000_000): Promise<{ name: string; mime: string; dataUrl: string }> {
  if (file.size > 25_000_000) throw new Error("That file is too large. Please pick one under 25 MB.");
  const raw = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("The file could not be read."));
    r.readAsDataURL(file);
  });
  if (/^image\/(png|jpeg|webp)$/.test(file.type)) {
    const scaled = await downscale(raw, 1600).catch(() => null);
    if (scaled && scaled.length < raw.length) return { name: file.name.replace(/\.(png|webp)$/i, ".jpg"), mime: "image/jpeg", dataUrl: scaled };
  }
  if (Math.ceil((raw.length * 3) / 4) > maxBytes) throw new Error(`Please pick a file under ${Math.round(maxBytes / 1_000_000)} MB.`);
  return { name: file.name, mime: file.type || "application/octet-stream", dataUrl: raw };
}

function downscale(dataUrl: string, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const g = c.getContext("2d");
      if (!g) return reject(new Error("no canvas"));
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => reject(new Error("bad image"));
    img.src = dataUrl;
  });
}

/** Save bytes as a file. Some embedded previews block downloads; then we say so instead of failing silently. */
export function downloadBytes(name: string, bytes: Uint8Array | string, mime: string): void {
  try {
    const blob = new Blob([typeof bytes === "string" ? bytes : bytes.slice().buffer as ArrayBuffer], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    toast.success(`Downloading ${name}`);
  } catch {
    toast.error("Downloads are blocked in this preview. Open the app in its own browser tab to download.");
  }
}

export function downloadDataUrl(name: string, dataUrl: string): void {
  const p = parseDataUrl(dataUrl);
  if (!p) return toast.error("This file can't be opened.");
  downloadBytes(name, p.bytes, p.mime);
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function humanSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1_048_576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`;
}
