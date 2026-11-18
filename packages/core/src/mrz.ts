/**
 * Passport machine-readable zone (ICAO 9303 TD3: two lines of 44 characters).
 * Image OCR needs an external provider; once text is extracted (or typed), this
 * parser reads it and verifies every check digit so bad scans are caught.
 */
export interface MrzResult {
  valid: boolean;
  errors: string[];
  documentType: string;
  issuingCountry: string;
  surname: string;
  givenNames: string;
  passportNo: string;
  nationality: string;
  dob: string; // YYYY-MM-DD
  sex: "M" | "F" | "X";
  expiry: string; // YYYY-MM-DD
}

function charValue(c: string): number {
  if (c === "<") return 0;
  if (c >= "0" && c <= "9") return c.charCodeAt(0) - 48;
  if (c >= "A" && c <= "Z") return c.charCodeAt(0) - 55;
  return -1;
}

export function mrzCheckDigit(field: string): number {
  const weights = [7, 3, 1];
  let total = 0;
  for (let i = 0; i < field.length; i++) {
    const v = charValue(field[i] ?? "<");
    if (v < 0) return -1;
    total += v * (weights[i % 3] ?? 1);
  }
  return total % 10;
}

function mrzDate(yymmdd: string, kind: "dob" | "expiry", now: Date): string {
  const yy = Number(yymmdd.slice(0, 2));
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  const currentYY = now.getUTCFullYear() % 100;
  // Birth dates are in the past; expiry dates are at most ~20 years ahead.
  const century = kind === "dob" ? (yy > currentYY ? 1900 : 2000) : yy < currentYY - 30 ? 2100 : 2000;
  return `${century + yy}-${mm}-${dd}`;
}

export function parseMrz(text: string, now = new Date()): MrzResult {
  const lines = text
    .toUpperCase()
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, "").replace(/«/g, "<"))
    .filter((l) => l.length > 0);
  const errors: string[] = [];
  const l1 = (lines[0] ?? "").padEnd(44, "<").slice(0, 44);
  const l2 = (lines[1] ?? "").padEnd(44, "<").slice(0, 44);
  if (lines.length < 2) errors.push("Expected two MRZ lines of 44 characters each.");
  if ((lines[0]?.length ?? 0) !== 44 || (lines[1]?.length ?? 0) !== 44) {
    errors.push("Each MRZ line must be exactly 44 characters (passport format TD3).");
  }

  const documentType = l1.slice(0, 2).replace(/</g, "");
  const issuingCountry = l1.slice(2, 5).replace(/</g, "");
  const names = l1.slice(5).split("<<");
  const surname = (names[0] ?? "").replace(/</g, " ").trim();
  const givenNames = names.slice(1).join(" ").replace(/</g, " ").replace(/\s+/g, " ").trim();

  const passportField = l2.slice(0, 9);
  const nationality = l2.slice(10, 13).replace(/</g, "");
  const dobField = l2.slice(13, 19);
  const sexChar = l2.slice(20, 21);
  const expiryField = l2.slice(21, 27);
  const personalField = l2.slice(28, 42);

  const check = (label: string, field: string, digitChar: string) => {
    const expected = digitChar === "<" ? 0 : Number(digitChar);
    if (mrzCheckDigit(field) !== expected) errors.push(`${label} check digit does not match — rescan or retype.`);
  };
  check("Passport number", passportField, l2.slice(9, 10));
  check("Date of birth", dobField, l2.slice(19, 20));
  check("Expiry date", expiryField, l2.slice(27, 28));
  check("Personal number", personalField, l2.slice(42, 43));
  const composite = l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43);
  check("Composite", composite, l2.slice(43, 44));

  if (!documentType.startsWith("P")) errors.push("Document type is not a passport (should start with P).");
  if (!/^\d{6}$/.test(dobField)) errors.push("Date of birth is not numeric.");
  if (!/^\d{6}$/.test(expiryField)) errors.push("Expiry date is not numeric.");

  return {
    valid: errors.length === 0,
    errors,
    documentType,
    issuingCountry,
    surname,
    givenNames,
    passportNo: passportField.replace(/</g, ""),
    nationality,
    dob: /^\d{6}$/.test(dobField) ? mrzDate(dobField, "dob", now) : "",
    sex: sexChar === "M" || sexChar === "F" ? sexChar : "X",
    expiry: /^\d{6}$/.test(expiryField) ? mrzDate(expiryField, "expiry", now) : "",
  };
}
