/**
 * Passport photo → MRZ (the two machine-readable lines at the bottom of the photo page), entirely in the browser.
 * Uses Tesseract with files shipped in /ocr (no outside calls). The result is checked by the MRZ check digits on save.
 */
import { createWorker, PSM } from "tesseract.js";

const base = () => new URL("ocr/", document.baseURI).toString();

function cleanLine(s: string): string {
  return s.toUpperCase().replace(/\s+/g, "").replace(/[«‹<]/g, "<").replace(/[^A-Z0-9<]/g, "");
}

/** Find two consecutive 44-character TD3 lines (passport) in OCR text. */
export function pickMrz(text: string): string | null {
  const lines = text.split(/\n+/).map(cleanLine).filter((l) => l.length >= 30);
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i]!, b = lines[i + 1]!;
    if (a.startsWith("P") && a.includes("<<") && b.length >= 40) {
      const fix = (x: string) => (x + "<".repeat(44)).slice(0, 44);
      return `${fix(a)}\n${fix(b)}`;
    }
  }
  return null;
}

async function cropBottom(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("The photo could not be opened."));
      i.src = url;
    });
    // The MRZ sits in the bottom third of the photo page; scale it up and boost contrast
    const scale = Math.min(2, 2400 / img.width);
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * 0.4 * scale);
    const g = c.getContext("2d")!;
    g.filter = "grayscale(1) contrast(1.6)";
    g.drawImage(img, 0, img.height * 0.6, img.width, img.height * 0.4, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function readMrzFromImage(file: File): Promise<string | null> {
  const worker = await createWorker("eng", 1, { workerPath: `${base()}worker.min.js`, corePath: base(), langPath: base(), gzip: true, workerBlobURL: false });
  try {
    await worker.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<", tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    const crop = await cropBottom(file);
    const { data } = await worker.recognize(crop);
    return pickMrz(data.text) ?? pickMrz((await worker.recognize(file)).data.text);
  } finally {
    await worker.terminate();
  }
}
