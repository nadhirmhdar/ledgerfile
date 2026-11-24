/**
 * A client's details: the trade licence, the licensing authority, the tax registration number (TRN), the financial year-end, the address and a contact.
 * Pure. Every one is optional. The shape of each is checked here and nothing is ever looked up anywhere: a TRN is only checked to have 15 digits, an email
 * only to look like one.
 */

export const MAX_LICENCE = 60;
export const MAX_AUTHORITY = 120;
export const MAX_ADDRESS = 300;
export const MAX_CONTACT = 120;
export const MAX_EMAIL = 200;

export interface ClientDetails {
  licenceNumber: string | null;
  licensingAuthority: string | null;
  taxRegistrationNumber: string | null;
  /** 'MM-DD'. */
  yearEnd: string | null;
  address: string | null;
  contactName: string | null;
  contactEmail: string | null;
}

export const EMPTY_DETAILS: ClientDetails = { licenceNumber: null, licensingAuthority: null, taxRegistrationNumber: null, yearEnd: null, address: null, contactName: null, contactEmail: null };

export const DETAIL_LABEL: Record<keyof ClientDetails, string> = {
  licenceNumber: "Trade licence number",
  licensingAuthority: "Licensing authority",
  taxRegistrationNumber: "Tax registration number (TRN)",
  yearEnd: "Financial year-end",
  address: "Address",
  contactName: "Contact name",
  contactEmail: "Contact email",
};

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** One line of text: trimmed, inner spaces collapsed. Empty becomes null. */
const line = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const nullIfEmpty = (s: string): string | null => (s === "" ? null : s);

/** Several lines: each trimmed and collapsed, blank lines dropped, line breaks kept. */
export function cleanAddress(v: unknown): string {
  return String(v ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** A TRN is 15 digits. Spaces and hyphens typed between them are allowed and dropped. */
export function checkTrn(value: unknown): { ok: true; value: string | null } | { ok: false; message: string } {
  const raw = line(value);
  if (raw === "") return { ok: true, value: null };
  const digits = raw.replace(/[\s-]/g, "");
  if (!/^\d{15}$/.test(digits)) return { ok: false, message: "A tax registration number has 15 digits." };
  return { ok: true, value: digits };
}

/** 'MM-DD' for a real day of a year that is not a leap year: 29 February is refused (use 28 February, or the last day of the month the year ends). */
export function checkYearEnd(value: unknown): { ok: true; value: string | null } | { ok: false; message: string } {
  const raw = line(value);
  if (raw === "") return { ok: true, value: null };
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (!m) return { ok: false, message: "The year-end is a month and a day." };
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1) return { ok: false, message: "The year-end is not a real day." };
  if (month === 2 && day === 29) return { ok: false, message: "29 February cannot be a year-end, because it is not a day every year. Use 28 February." };
  if (day > DAYS_IN_MONTH[month - 1]) return { ok: false, message: `${MONTHS[month - 1]} does not have ${day} days.` };
  return { ok: true, value: `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
}

export function checkEmail(value: unknown): { ok: true; value: string | null } | { ok: false; message: string } {
  const raw = line(value);
  if (raw === "") return { ok: true, value: null };
  if (raw.length > MAX_EMAIL) return { ok: false, message: `The email is too long (at most ${MAX_EMAIL} characters).` };
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(raw)) return { ok: false, message: "The email does not look like an address (name@example.com)." };
  return { ok: true, value: raw };
}

export type DetailsInput = Partial<Record<keyof ClientDetails, unknown>>;

/** The details as typed, checked and cleaned. Empty values become null; every problem is named, field by field. */
export function checkDetails(input: DetailsInput): { ok: true; value: ClientDetails } | { ok: false; errors: Partial<Record<keyof ClientDetails, string>> } {
  const errors: Partial<Record<keyof ClientDetails, string>> = {};
  const text = (key: keyof ClientDetails, max: number, clean: (v: unknown) => string = line): string | null => {
    const v = clean(input[key]);
    if (v.length > max) {
      errors[key] = `${DETAIL_LABEL[key]} is too long (at most ${max} characters).`;
      return null;
    }
    return nullIfEmpty(v);
  };
  const out: ClientDetails = {
    licenceNumber: text("licenceNumber", MAX_LICENCE),
    licensingAuthority: text("licensingAuthority", MAX_AUTHORITY),
    taxRegistrationNumber: null,
    yearEnd: null,
    address: text("address", MAX_ADDRESS, cleanAddress),
    contactName: text("contactName", MAX_CONTACT),
    contactEmail: null,
  };
  const trn = checkTrn(input.taxRegistrationNumber);
  if (trn.ok) out.taxRegistrationNumber = trn.value;
  else errors.taxRegistrationNumber = trn.message;
  const ye = checkYearEnd(input.yearEnd);
  if (ye.ok) out.yearEnd = ye.value;
  else errors.yearEnd = ye.message;
  const em = checkEmail(input.contactEmail);
  if (em.ok) out.contactEmail = em.value;
  else errors.contactEmail = em.message;
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: out };
}

/** "31 March" for a year-end of '03-31'. */
export const yearEndText = (yearEnd: string): string => {
  const [m, d] = yearEnd.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The period to suggest for a new engagement of a client with a year-end: it ends on the year-end just past (the latest one on or before today), and starts
 * the day after the year-end a year earlier. A suggestion only: the person can change both dates.
 */
export function periodForYearEnd(yearEnd: string, today: string): { start: string; end: string } | null {
  if (!checkYearEnd(yearEnd).ok || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const [month, day] = yearEnd.split("-").map(Number);
  const year = Number(today.slice(0, 4));
  const at = (y: number) => new Date(Date.UTC(y, month - 1, day));
  const endYear = iso(at(year)) <= today ? year : year - 1;
  const start = at(endYear - 1);
  start.setUTCDate(start.getUTCDate() + 1);
  return { start: iso(start), end: iso(at(endYear)) };
}

/**
 * A year-end typed in a spreadsheet cell as 'MM-DD', or null when it cannot be read: "31 March", "31-Mar", "31/03", "03-31", "March 31". A day-first
 * numeric date is read day first (the convention here); a first number above 12 is the day, so "31/03" and "03/31" are both 31 March.
 */
export function parseYearEndText(value: unknown): string | null {
  const raw = line(value).toLowerCase();
  if (raw === "") return null;
  const monthOf = (word: string): number => MONTHS.findIndex((m) => m.toLowerCase() === word || m.toLowerCase().slice(0, 3) === word.slice(0, 3)) + 1;
  let month = 0;
  let day = 0;
  let m = /^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]+([a-z]{3,9})\.?$/.exec(raw);
  if (m) {
    day = Number(m[1]);
    month = monthOf(m[2]);
  } else if ((m = /^([a-z]{3,9})\.?[\s\-/.]+(\d{1,2})(?:st|nd|rd|th)?$/.exec(raw))) {
    month = monthOf(m[1]);
    day = Number(m[2]);
  } else if ((m = /^(\d{1,2})[\s\-/.](\d{1,2})$/.exec(raw))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12) [day, month] = [a, b];
    else if (b > 12) [month, day] = [a, b];
    else [day, month] = [a, b];
  }
  if (!month || !day) return null;
  const checked = checkYearEnd(`${month}-${day}`);
  return checked.ok ? checked.value : null;
}
