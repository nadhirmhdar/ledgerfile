/**
 * The engagement's sections, in work order, and the paths they live at. Pure: the navigation component draws what this lists, pages name
 * their section with a key from it, and the tests check that every page path lands on the right key.
 */
export const NAV_GROUPS = [
  { id: "overview", title: "Overview", items: [{ key: "home", label: "Home", path: "" }] },
  {
    id: "setup",
    title: "Set up",
    items: [
      { key: "tb", label: "Trial balance and mapping", path: "/trial-balance" },
      { key: "leadsheets", label: "Lead sheets", path: "/lead-sheets" },
      { key: "journals", label: "Journal entries", path: "/journals" },
    ],
  },
  {
    id: "audit",
    title: "Audit",
    // Planning first, then the audit work in the order it is done: confirmations, journal testing, analytical review, client requests.
    items: [
      { key: "audit", label: "Planning", path: "/audit" },
      { key: "questionnaire", label: "Planning questionnaire", path: "/audit/questionnaire" },
      { key: "confirmations", label: "Confirmations", path: "/audit/confirmations" },
      { key: "journaltesting", label: "Journal testing", path: "/audit/journals" },
      { key: "analytics", label: "Analytical review", path: "/audit/analytics" },
      { key: "requests", label: "Client requests", path: "/requests" },
    ],
  },
  {
    id: "file",
    title: "File",
    items: [
      { key: "papers", label: "Working papers", path: "/papers" },
      { key: "index", label: "Index", path: "/index" },
      { key: "statements", label: "Financial statements", path: "/statements" },
    ],
  },
  {
    id: "finish",
    title: "Finish",
    // The letters are written at the end, with the review.
    items: [
      { key: "letters", label: "Letters", path: "/audit/letters" },
      { key: "report", label: "Auditor's report", path: "/audit/report" },
      { key: "review", label: "Review and sign-off", path: "/review" },
    ],
  },
] as const;

export type EngagementTab = (typeof NAV_GROUPS)[number]["items"][number]["key"];

/** The address of a section in an engagement. */
export const sectionHref = (engagementId: string, path: string): string => `/engagements/${engagementId}${path}`;

const ITEMS = NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ key: i.key as EngagementTab, path: i.path as string })));

/**
 * The section a path belongs to, for a path given relative to the engagement ("" is its home, "/audit/C5" an area). The longest matching
 * section wins, so the journal testing page is not Planning; areas and schedules fall under /audit and so stay in Planning.
 */
export function tabForPath(path: string): EngagementTab | null {
  const clean = path.replace(/\/+$/, "");
  if (clean === "") return "home";
  let best: { key: EngagementTab; length: number } | null = null;
  for (const item of ITEMS) {
    if (item.path === "") continue;
    if ((clean === item.path || clean.startsWith(`${item.path}/`)) && (!best || item.path.length > best.length)) best = { key: item.key, length: item.path.length };
  }
  return best?.key ?? null;
}

export interface Crumb {
  label: string;
  /** None for the page the reader is on: it is shown as text, not a link. */
  href?: string;
}

const START: Crumb = { label: "All engagements", href: "/" };

/** All engagements, Planning, then the area page itself. */
export function areaCrumbs(engagementId: string, area: { code: string; title: string }): Crumb[] {
  return [START, { label: "Planning", href: sectionHref(engagementId, "/audit") }, { label: `${area.code} ${area.title}` }];
}

/** All engagements, Planning, the area, then the schedule itself. */
export function scheduleCrumbs(engagementId: string, area: { code: string; title: string }, schedule: { reference: string; title: string }): Crumb[] {
  return [
    START,
    { label: "Planning", href: sectionHref(engagementId, "/audit") },
    { label: `${area.code} ${area.title}`, href: sectionHref(engagementId, `/audit/${area.code}`) },
    { label: `${schedule.reference} ${schedule.title}` },
  ];
}

/**
 * Where to scroll a strip so a child sits roughly in the middle: the child's left edge relative to the strip's visible left edge, less half
 * the spare width, kept within what can scroll. Pure so it can be tested without a browser.
 */
export function stripScrollLeft(m: { stripWidth: number; stripScrollWidth: number; stripScrollLeft: number; childLeft: number; childWidth: number }): number {
  const centred = m.stripScrollLeft + m.childLeft - (m.stripWidth - m.childWidth) / 2;
  const max = Math.max(0, m.stripScrollWidth - m.stripWidth);
  return Math.min(max, Math.max(0, Math.round(centred)));
}

// --- Which groups of sections are open in the sidebar ----------------------------------------------------------------------------------

/** The cookie that remembers the open groups across engagements in this browser. Written on toggle; read on the server so the first render matches. */
export const NAV_COOKIE = "lf_nav";
const NAV_COOKIE_SEPARATOR = ".";
const GROUP_IDS: string[] = NAV_GROUPS.map((g) => g.id);

/** The group a section is in. */
export const groupOfTab = (tab: EngagementTab): string => NAV_GROUPS.find((g) => g.items.some((i) => i.key === tab))!.id;

/** The group ids a cookie value holds. A missing, empty or garbled value, and any id that is not a group, give nothing. */
export function parseOpenGroups(value: string | null | undefined): string[] {
  if (typeof value !== "string" || value.length > 200) return [];
  const asked = new Set(value.split(NAV_COOKIE_SEPARATOR));
  return GROUP_IDS.filter((id) => asked.has(id));
}

/** The cookie value for a set of open groups, in the order of the sidebar. */
export const serializeOpenGroups = (ids: Iterable<string>): string => {
  const asked = new Set(ids);
  return GROUP_IDS.filter((id) => asked.has(id)).join(NAV_COOKIE_SEPARATOR);
};

/** The groups open when the page is drawn: the ones remembered, and always the one the current page is in. With nothing remembered, only that one. */
export function openGroups(current: EngagementTab, cookie: string | null | undefined): string[] {
  return GROUP_IDS.filter((id) => id === groupOfTab(current) || parseOpenGroups(cookie).includes(id));
}
