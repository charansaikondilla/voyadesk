/**
 * Small, dependency-free helpers that run in the browser and on the server:
 * base64, SHA-256, ZIP (store), Excel .xlsx and Word .docx writers, CSV reader, EMI and transport costing.
 */
import { applyBps, type Minor } from "./money.js";

/* ───────────────────────── base64 + hashing ───────────────────────── */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, b = bytes[i + 1], c = bytes[i + 2];
    out += B64[a >> 2]! + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    out += b === undefined ? "=" : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    out += c === undefined ? "=" : B64[c & 63]!;
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = [0, 1, 2, 3].map((k) => (i + k < clean.length ? B64.indexOf(clean[i + k]!) : 0));
    const v = (n[0]! << 18) | (n[1]! << 12) | (n[2]! << 6) | n[3]!;
    if (o < out.length) out[o++] = (v >> 16) & 255;
    if (i + 2 < clean.length && o < out.length) out[o++] = (v >> 8) & 255;
    if (i + 3 < clean.length && o < out.length) out[o++] = v & 255;
  }
  return out.slice(0, o);
}

export const utf8 = (s: string) => new TextEncoder().encode(s);

/** Parse "data:<mime>;base64,<data>" into its parts. */
export function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const mime = m[1] ?? "application/octet-stream";
  const bytes = m[2] ? base64ToBytes(m[3]!) : utf8(decodeURIComponent(m[3]!));
  return { mime, bytes };
}

export async function sha256Hex(text: string): Promise<string> {
  const subtle = (globalThis as unknown as { crypto: { subtle: { digest(a: string, d: Uint8Array): Promise<ArrayBuffer> } } }).crypto.subtle;
  const buf = new Uint8Array(await subtle.digest("SHA-256", utf8(text)));
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ───────────────────────── ZIP (stored, no compression) ───────────────────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array | string;
}

/** Build a valid .zip archive (method 0 = stored). Opens in Windows, macOS, Android and iOS. */
export function makeZip(entries: ZipEntry[], when = new Date()): Uint8Array {
  const dosTime = ((when.getHours() & 31) << 11) | ((when.getMinutes() & 63) << 5) | (Math.floor(when.getSeconds() / 2) & 31);
  const dosDate = (((when.getFullYear() - 1980) & 127) << 9) | (((when.getMonth() + 1) & 15) << 5) | (when.getDate() & 31);
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const used = new Set<string>();
  for (const e of entries) {
    let name = e.name.replace(/[\\:*?"<>|]/g, "_");
    for (let k = 2; used.has(name); k++) name = e.name.replace(/(\.[^.]*)?$/, (ext) => ` (${k})${ext}`);
    used.add(name);
    const nameBytes = utf8(name);
    const data = typeof e.data === "string" ? utf8(e.data) : e.data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    chunks.push(local, data);
    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cen.set(nameBytes, 46);
    central.push(cen);
    offset += local.length + data.length;
  }
  const cenSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, offset, true);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/** Read the file names and contents back out of a stored zip (used by tests and import). */
export function readZip(zip: Uint8Array): { name: string; data: Uint8Array }[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const out: { name: string; data: Uint8Array }[] = [];
  let p = 0;
  while (p + 30 <= zip.length && v.getUint32(p, true) === 0x04034b50) {
    const size = v.getUint32(p + 18, true);
    const nlen = v.getUint16(p + 26, true);
    const xlen = v.getUint16(p + 28, true);
    const name = new TextDecoder().decode(zip.slice(p + 30, p + 30 + nlen));
    const start = p + 30 + nlen + xlen;
    out.push({ name, data: zip.slice(start, start + size) });
    p = start + size;
  }
  return out;
}

/* ───────────────────────── XLSX ───────────────────────── */

const xmlEsc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export type Cell = string | number | null | undefined;

/** A real Excel workbook (one or more sheets). Numbers stay numbers; the first row is bold. */
export function makeXlsx(sheets: { name: string; rows: Cell[][] }[]): Uint8Array {
  const safe = sheets.map((s, i) => ({ ...s, name: (s.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || `Sheet${i + 1}`) }));
  const sheetXml = (rows: Cell[][]) => {
    const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => {
      const ref = `${colName(ci)}${ri + 1}`;
      const style = ri === 0 ? ' s="1"' : "";
      if (c === null || c === undefined || c === "") return "";
      if (typeof c === "number" && Number.isFinite(c)) return `<c r="${ref}"${style}><v>${c}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlEsc(String(c))}</t></is></c>`;
    }).join("")}</row>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  };
  const files: ZipEntry[] = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${safe.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${safe.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${safe.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${safe.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>` },
    ...safe.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows) })),
  ];
  return makeZip(files);
}

/* ───────────────────────── DOCX ───────────────────────── */

export type DocBlock = { kind: "title" | "heading" | "subheading" | "para" | "bullet" | "small"; text: string } | { kind: "table"; rows: string[][] };

/** A real Word document with title, headings, paragraphs, bullets and simple tables. */
export function makeDocx(blocks: DocBlock[]): Uint8Array {
  const run = (t: string, opts: { b?: boolean; sz?: number; color?: string } = {}) =>
    `<w:r><w:rPr>${opts.b ? "<w:b/>" : ""}${opts.color ? `<w:color w:val="${opts.color}"/>` : ""}${opts.sz ? `<w:sz w:val="${opts.sz}"/>` : ""}</w:rPr><w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r>`;
  const para = (t: string, opts: { b?: boolean; sz?: number; color?: string; space?: number; bullet?: boolean } = {}) =>
    `<w:p><w:pPr><w:spacing w:after="${opts.space ?? 120}"/>${opts.bullet ? '<w:ind w:left="360" w:hanging="240"/>' : ""}</w:pPr>${run(opts.bullet ? `• ${t}` : t, opts)}</w:p>`;
  const body = blocks.map((b) => {
    switch (b.kind) {
      case "title": return para(b.text, { b: true, sz: 40, color: "1D3E8A", space: 200 });
      case "heading": return para(b.text, { b: true, sz: 30, color: "1D3E8A", space: 120 });
      case "subheading": return para(b.text, { b: true, sz: 24, space: 80 });
      case "bullet": return para(b.text, { bullet: true, space: 60 });
      case "small": return para(b.text, { sz: 18, color: "555555" });
      case "table": return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>${b.rows.map((r, ri) => `<w:tr>${r.map((c) => `<w:tc><w:p>${run(c, { b: ri === 0 })}</w:p></w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>${para("")}`;
      default: return para(b.text);
    }
  }).join("");
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return makeZip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/document.xml", data: doc },
  ]);
}

/* ───────────────────────── CSV ───────────────────────── */

/** RFC 4180 CSV parser (quotes, escaped quotes, commas and newlines inside quotes). Also accepts tab-separated text. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const delim = !src.split("\n")[0]!.includes(",") && src.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows.map((r) => r.map((x) => x.trim()));
}

export function toCsv(rows: Cell[][]): string {
  return rows.map((r) => r.map((c) => {
    const s = c === null || c === undefined ? "" : String(c);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");
}

/* ───────────────────────── EMI ───────────────────────── */

export interface EmiPlan {
  months: number;
  rateBps: number;
  monthly: Minor;
  total: Minor;
  interest: Minor;
  noCost: boolean;
}

/** Reducing-balance EMI: P·r·(1+r)^n / ((1+r)^n − 1), r = annual rate / 12. Rate 0 = no-cost EMI. */
export function emiPlan(principal: Minor, months: number, rateBps: number): EmiPlan {
  if (principal <= 0 || months <= 0) return { months, rateBps, monthly: 0, total: 0, interest: 0, noCost: rateBps === 0 };
  if (rateBps === 0) {
    const monthly = Math.ceil(principal / months);
    return { months, rateBps, monthly, total: principal, interest: 0, noCost: true };
  }
  const r = rateBps / 10_000 / 12;
  const f = Math.pow(1 + r, months);
  const monthly = Math.ceil((principal * r * f) / (f - 1));
  const total = monthly * months;
  return { months, rateBps, monthly, total, interest: total - principal, noCost: false };
}

/* ───────────────────────── transport costing ───────────────────────── */

export interface VehicleRateLike {
  id: string;
  name: string;
  capacity: number;
  perDay: Minor;
  perKm: Minor;
  kmIncludedPerDay: number;
  allowancePerDay: Minor;
}

export interface TransportPlan {
  vehicles: { id: string; name: string; count: number; capacity: number; cost: Minor }[];
  seats: number;
  totalKm: number;
  extraKm: number;
  cost: Minor;
  perPerson: Minor;
  breakdown: string[];
}

/**
 * Cheapest vehicle mix for a group: tries every count of each vehicle type (bounded) and keeps the lowest cost
 * that seats everyone. Cost per vehicle = days × (day rate + driver allowance) + km beyond the daily allowance × km rate.
 */
export function planTransport(vehicles: VehicleRateLike[], pax: number, days: number, kmPerDay: number[]): TransportPlan | null {
  const usable = vehicles.filter((v) => v.capacity > 0);
  if (!usable.length || pax <= 0 || days <= 0) return null;
  const totalKm = kmPerDay.slice(0, days).reduce((s, k) => s + Math.max(0, k), 0) + Math.max(0, days - kmPerDay.length) * 0;
  const costOf = (v: VehicleRateLike) => {
    const included = v.kmIncludedPerDay * days;
    const extra = Math.max(0, totalKm - included);
    return days * (v.perDay + v.allowancePerDay) + extra * v.perKm;
  };
  let best: { counts: number[]; cost: number; seats: number } | null = null;
  const maxEach = usable.map((v) => Math.ceil(pax / v.capacity));
  const counts = new Array<number>(usable.length).fill(0);
  const search = (i: number) => {
    if (i === usable.length) {
      const seats = counts.reduce((s, c, k) => s + c * usable[k]!.capacity, 0);
      if (seats < pax) return;
      const cost = counts.reduce((s, c, k) => s + c * costOf(usable[k]!), 0);
      const n = counts.reduce((s, c) => s + c, 0);
      if (!best || cost < best.cost || (cost === best.cost && n < best.counts.reduce((s, c) => s + c, 0))) best = { counts: [...counts], cost, seats };
      return;
    }
    for (let c = 0; c <= Math.min(maxEach[i]!, 12); c++) {
      counts[i] = c;
      search(i + 1);
    }
    counts[i] = 0;
  };
  if (usable.length <= 5) search(0);
  else {
    // many vehicle types: greedy by cost per seat
    const sorted = [...usable].sort((a, b) => costOf(a) / a.capacity - costOf(b) / b.capacity);
    const c = new Array<number>(usable.length).fill(0);
    let left = pax;
    for (const v of sorted) {
      const k = Math.floor(left / v.capacity);
      const idx = usable.indexOf(v);
      c[idx] = (c[idx] ?? 0) + k;
      left -= k * v.capacity;
    }
    if (left > 0) {
      const idx = usable.indexOf([...usable].filter((v) => v.capacity >= left).sort((a, b) => costOf(a) - costOf(b))[0] ?? sorted[0]!);
      c[idx] = (c[idx] ?? 0) + 1;
    }
    best = { counts: c, cost: c.reduce((s, n, k) => s + n * costOf(usable[k]!), 0), seats: c.reduce((s, n, k) => s + n * usable[k]!.capacity, 0) };
  }
  const b = best as { counts: number[]; cost: number; seats: number } | null;
  if (!b) return null;
  const chosen = usable.map((v, k) => ({ id: v.id, name: v.name, count: b.counts[k]!, capacity: v.capacity, cost: b.counts[k]! * costOf(v) })).filter((x) => x.count > 0);
  const extraKm = Math.max(0, ...chosen.map((x) => totalKm - (usable.find((v) => v.id === x.id)!.kmIncludedPerDay * days)));
  return {
    vehicles: chosen, seats: b.seats, totalKm, extraKm, cost: b.cost, perPerson: Math.ceil(b.cost / pax),
    breakdown: chosen.map((x) => `${x.count} × ${x.name} (${x.capacity} seats) for ${days} day${days > 1 ? "s" : ""}`),
  };
}

/* ───────────────────────── small money helpers ───────────────────────── */

export function percentOf(amount: Minor, percent: number): Minor {
  return applyBps(amount, Math.round(percent * 100));
}
