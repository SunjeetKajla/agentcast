/** Conservative block detection: normal navigation links labelled Sign in must not block a page. */
export function accessProblem(
  text: string,
): { kind: "blocked" | "sign-in-required"; message: string } | undefined {
  if (
    /sorry,? you (?:have been|are) blocked|you are unable to access|access denied|verify (?:that )?you are human|checking your browser|captcha (?:required|challenge)|cloudflare (?:security )?block/i.test(
      text,
    ) ||
    (/performing security verification/i.test(text) &&
      /verifies you are not a bot|protect against malicious bots/i.test(text))
  ) {
    return {
      kind: "blocked",
      message:
        "The site blocked browser automation. Use an authorized demo environment or ask the site owner to allow access.",
    };
  }
  if (
    /(?:requires?|must|need to).{0,70}(?:sign(?:ing)?[ -]?in|log(?:ging)?[ -]?in|authentication|account access)|(?:sign[ -]?in|log[ -]?in|authentication).{0,30}(?:required|to continue|to access)|no (?:public |live )?(?:interactive )?demos? (?:are )?(?:available|accessible|found)/i.test(
      text,
    )
  ) {
    return {
      kind: "sign-in-required",
      message:
        "The product requires sign-in. Start a new job using sign-in-once or a provided demo account.",
    };
  }
  return undefined;
}

/**
 * Hosts where every subdomain is a different owner's site, so a sibling subdomain is not "the same
 * site" (agent-cast-beta.vercel.app and someone-else.vercel.app). Not the full public suffix list,
 * the shared hosts products are commonly deployed on.
 */
const SHARED_HOSTS = [
  "vercel.app",
  "netlify.app",
  "netlify.com",
  "github.io",
  "gitlab.io",
  "pages.dev",
  "workers.dev",
  "herokuapp.com",
  "web.app",
  "firebaseapp.com",
  "onrender.com",
  "fly.dev",
  "railway.app",
  "azurewebsites.net",
  "azurestaticapps.net",
  "cloudfront.net",
  "amplifyapp.com",
  "appspot.com",
  "replit.app",
  "repl.co",
  "glitch.me",
  "surge.sh",
  "lovable.app",
  "framer.app",
  "framer.website",
  "webflow.io",
  "wixsite.com",
  "myshopify.com",
  "bubbleapps.io",
  "notion.site",
  "gitbook.io",
  "readthedocs.io",
  "substack.com",
  "blogspot.com",
  "wordpress.com",
  "carrd.co",
  "ngrok.io",
  "ngrok-free.app",
  "trycloudflare.com",
];

/**
 * The site a host belongs to: its registrable domain (tinyfish.ai for agent.tinyfish.ai; foo.co.uk
 * for app.foo.co.uk), or the tenant on a shared host (my-app.vercel.app). IPs and single labels are themselves.
 */
export function siteOf(hostname: string): string {
  const host = hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  if (/^[\d.]+$|^\[|^[^.]+$/.test(host)) return host;
  const labels = host.split(".");
  const shared = SHARED_HOSTS.find((h) => host === h || host.endsWith(`.${h}`));
  if (shared) return labels.slice(-(shared.split(".").length + 1)).join(".");
  const keep = /\.(co|com|org|net|gov|ac|edu|ltd|plc)\.[a-z]{2}$/.test(host)
    ? 3
    : 2;
  return labels.slice(-keep).join(".");
}

/**
 * A candidate may only send the recorder or agent to the authorized product site: the address the
 * job was given, or another part of the same site (TinyFish's app is agent.tinyfish.ai, its home tinyfish.ai).
 */
export function productEntry(value: string, base: string): string {
  const url = new URL(value || base, base);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    siteOf(url.hostname) !== siteOf(new URL(base).hostname)
  )
    throw new Error(
      "The app entrance must be an HTTP(S) URL on the product site.",
    );
  return url.toString();
}

/** Diagnostics must not retain credentials, query tokens or non-route fragments. */
export function diagnosticUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    if (!url.hash.startsWith("#/")) url.hash = "";
    else url.hash = url.hash.split("?")[0]!;
    return url.toString();
  } catch {
    return "";
  }
}

/** Detect repeated actions only across new provider step ids; polling the same step isn't progress. */
export class ExplorationWatchdog {
  private seen = new Set<string>();
  private recent: Array<{ action: string; digest?: string }> = [];
  lastProgressAt: number;
  constructor(
    now = Date.now(),
    private readonly maxSteps = 32,
    private readonly idleMs = 150_000,
  ) {
    this.lastProgressAt = now;
  }

  observe(
    step: { id: string; action: string | null },
    now: number,
    digest?: string,
  ): string | undefined {
    if (this.seen.has(step.id)) return undefined;
    this.seen.add(step.id);
    this.lastProgressAt = now;
    const action = (step.action ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    this.recent.push({ action, digest });
    this.recent = this.recent.slice(-8);
    const repeated =
      action && this.recent.filter((s) => s.action === action).length;
    const unchanged =
      digest && this.recent.filter((s) => s.digest === digest).length;
    const frames = new Set(this.recent.map((s) => s.digest).filter(Boolean));
    if (
      (repeated && repeated >= 5 && frames.size <= 1) ||
      (unchanged && unchanged >= 4 && repeated && repeated >= 3)
    )
      return "The explorer repeated the same action without a new result. Its last run and screenshot were saved.";
    if (this.seen.size > this.maxSteps)
      return `The explorer exceeded its ${this.maxSteps}-step budget without completing the task.`;
    return undefined;
  }

  idle(now = Date.now()): string | undefined {
    return now - this.lastProgressAt > this.idleMs
      ? `The explorer made no observable progress for ${Math.round(this.idleMs / 1000)} seconds.`
      : undefined;
  }
}

/** Common top-level domains, for spotting other sites named in an agent's outline (not "Next.js"). */
const OTHER_SITE =
  /(?<![@\w.-])((?:[a-z0-9-]+\.)+(?:com|dev|io|ai|app|net|org|co|so|sh|xyz|gg|me|tech|cloud|site|page|run))\b/gi;

/** Why a proposed flow leaves the product's site (its start, or another site in its outline), if it does. */
export function offSite(
  c: { start_url: string; outline: string[]; title: string },
  productUrl: string,
): string | undefined {
  const home = siteOf(new URL(productUrl).hostname);
  try {
    if (
      c.start_url &&
      siteOf(new URL(c.start_url, productUrl).hostname) !== home
    )
      return `starts on ${new URL(c.start_url, productUrl).hostname}`;
  } catch {
    return "its start is not a URL";
  }
  for (const m of [c.title, ...c.outline].join(" ").matchAll(OTHER_SITE))
    if (siteOf(m[1]!) !== home) return `goes to ${m[1]}`;
  return undefined;
}
