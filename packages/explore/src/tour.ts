import { Flow, type Step } from "@agentcast/shared";

/** What the worker reads from the product's front page in local Chrome, for a tour made without agents. */
export type PageFacts = {
  /** The page's address after redirects. */
  url: string;
  title: string;
  /** The main heading (h1), if any. */
  heading?: string;
  /** Page and viewport heights, in CSS pixels. */
  height: number;
  viewport: number;
  /** Visible links, in page order; `inNav` for those in the header or navigation. */
  links: Array<{ text: string; href: string; inNav: boolean }>;
  /** Visible tab names (role=tab), in page order. */
  tabs: string[];
  /** Visible button names, in page order (app-like pages: iosc.win's desktop has buttons, not links). */
  buttons?: string[];
};

/** Links a tour skips: accounts, legal, company, social and off-product pages. */
const SKIP =
  /\b(log ?in|sign ?(in|up)|register|account|cart|basket|wishlist|wish-list|checkout|privacy|terms|legal|cookies?|careers|jobs|contact|status|changelog|blog|press|github|twitter|discord|linkedin|youtube|download|pricing|faq|support|help)\b/i;

/** Buttons a tour never presses: accounts, money, changes, popups and menus. */
const UNSAFE =
  /\b(log ?(in|out)|sign ?(in|up|out)|register|account|buy|pay|checkout|purchase|subscribe|order|delete|remove|submit|send|save|upload|reset|clear|close|dismiss|accept|reject|decline|cookies?|cancel|skip|continue to|start|menu|toggle navigation)\b/i;
/** Names that open something to look at, tried first. */
const LOOK =
  /^(open|view|show|explore|see|browse|discover|try|watch|preview)\b/i;
/** Carousel dots and numbered pagers aren't views worth switching to. */
const PAGER = /^((go to )?slide \d+|\d+|next|previous|prev)$/i;
/** "Explore Image" is already a title; "Components" becomes "Exploring Components". */
const pageTitle = (text: string) =>
  LOOK.test(text) ? text : `Exploring ${text}`;

/**
 * The guided tour (PRD §9.2, the last rung): flows built from the front page alone, for when the
 * agents can't give us any (they stalled, timed out or were refused, or nothing they did replays).
 * Each is an ordinary flow, rehearsed and filmed like an agent's:
 * - the front page from top to bottom (if it scrolls),
 * - switching its tabs (if it has two or more),
 * - up to two of its main pages from the navigation, opened by clicking and scrolled,
 * - on app-like pages that gave fewer than two of those, a look around by its own buttons,
 * - and, if nothing else, a hover over its headline, so there is always a shot of the product.
 */
export function tourFlows(facts: PageFacts, product: string): Flow[] {
  const home = new URL(facts.url);
  const by = String(Math.round(facts.viewport * 0.8));
  const flows: Flow[] = [];
  const add = (
    id: string,
    title: string,
    whyItMatters: string,
    startUrl: string,
    steps: Array<Omit<Step, "id">>,
  ) =>
    flows.push(
      Flow.parse({
        id,
        title,
        whyItMatters,
        startUrl,
        requiresAuth: false,
        rank: 0,
        selected: false,
        source: "tour",
        steps: steps.map((s, i) => ({ ...s, id: `s${i + 1}` })),
      }),
    );

  const scrolls = Math.max(
    0,
    Math.min(
      4,
      Math.round((facts.height - facts.viewport) / (facts.viewport * 0.8)),
    ),
  );
  if (scrolls >= 1) {
    add(
      "t1",
      `${product} at a glance`,
      `The front page of ${product}, from its headline down.`,
      facts.url,
      Array.from({ length: scrolls }, (_, i) => ({
        action: "scroll" as const,
        value: by,
        ...(i === 0
          ? {
              narrationHint: facts.heading
                ? `${product}: ${facts.heading}`
                : `The ${product} front page`,
            }
          : {}),
      })),
    );
  }

  const tabs = [
    ...new Set(
      facts.tabs.filter(
        (t) =>
          t.length >= 2 &&
          t.length <= 30 &&
          !PAGER.test(t) &&
          !UNSAFE.test(t) &&
          !SKIP.test(t),
      ),
    ),
  ];
  if (tabs.length >= 2) {
    const pick = tabs.slice(1, 3).concat(tabs.length === 2 ? [tabs[0]!] : []);
    add(
      "t2",
      `Switching between ${pick.join(" and ")}`,
      `${product} shows each view at a click.`,
      facts.url,
      pick.map((t) => ({
        action: "click" as const,
        target: { text: t, role: "tab" },
        narrationHint: `Switching to ${t}`,
      })),
    );
  }

  const seen = new Set<string>([home.origin + home.pathname]);
  const pages = facts.links
    .filter((l) => {
      try {
        const u = new URL(l.href, facts.url);
        return (
          u.origin === home.origin &&
          !u.username &&
          !u.password &&
          l.text.length >= 3 &&
          l.text.length <= 30 &&
          !SKIP.test(l.text) &&
          !SKIP.test(u.pathname) &&
          !UNSAFE.test(l.text) &&
          !UNSAFE.test(u.pathname)
        );
      } catch {
        return false;
      }
    })
    .sort((a, b) => Number(b.inNav) - Number(a.inNav))
    .filter((l) => {
      const u = new URL(l.href, facts.url);
      const key = u.origin + u.pathname;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 2);
  for (const [i, l] of pages.entries()) {
    add(
      `t${3 + i}`,
      pageTitle(l.text),
      `The ${l.text.replace(LOOK, "").trim() || l.text} part of ${product}.`,
      facts.url,
      [
        {
          action: "click",
          target: { text: l.text, role: "link" },
          narrationHint: `Opening ${l.text}`,
        },
        { action: "scroll", value: by },
        { action: "scroll", value: by },
      ],
    );
  }

  if (flows.length < 2) {
    const seenNames = new Set<string>();
    const buttons = (facts.buttons ?? [])
      .filter(
        (b) =>
          b.length >= 3 &&
          b.length <= 40 &&
          !UNSAFE.test(b) &&
          !SKIP.test(b) &&
          !PAGER.test(b),
      )
      .filter(
        (b) =>
          !seenNames.has(b.toLowerCase()) &&
          Boolean(seenNames.add(b.toLowerCase())),
      )
      .sort((a, b) => Number(LOOK.test(b)) - Number(LOOK.test(a)))
      .slice(0, 3);
    if (buttons.length >= 2) {
      add(
        "t5",
        `A look around ${product}`,
        `What ${product} opens at a click.`,
        facts.url,
        buttons.map((b) => ({
          action: "click" as const,
          target: { text: b, role: "button" },
          narrationHint: b,
        })),
      );
    }
  }
  if (!flows.length && facts.heading) {
    add("t6", `${product}`, `The ${product} front page.`, facts.url, [
      {
        action: "hover",
        target: { text: facts.heading, role: "heading" },
        narrationHint: `${product}: ${facts.heading}`,
      },
    ]);
  }
  return flows;
}
