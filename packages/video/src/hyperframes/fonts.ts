import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { agentcastHome } from "./cli.ts";

// The brand's fonts as local files (PRD §9.7.3). A composition renders with the network blocked, so
// each Google Fonts family is fetched once per machine into ~/.agentcast/fonts/ and copied into the
// composition's assets/fonts/ with its @font-face rules.

/** A desktop Chrome user agent, so Google Fonts answers with woff2. */
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

type Face = { file: string; css: string };

const slug = (family: string) => family.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** The family's faces (weights 400–800 where it has them), cached; [] when Google doesn't serve it. */
async function facesOf(family: string, signal?: AbortSignal): Promise<Face[]> {
  const dir = join(agentcastHome(), "fonts", slug(family));
  const index = join(dir, "faces.json");
  const cached = await readFile(index, "utf8").then(
    (text) => JSON.parse(text) as Face[],
    () => undefined,
  );
  if (cached) return cached.map((f) => ({ ...f, file: join(dir, f.file) }));
  const name = encodeURIComponent(family).replace(/%20/g, "+");
  const css = async (query: string) => {
    const res = await fetch(`https://fonts.googleapis.com/css2?family=${name}${query}&display=block`, {
      headers: { "user-agent": UA },
      ...(signal ? { signal } : {}),
    });
    return res.ok ? res.text() : undefined;
  };
  const sheet = (await css(":wght@400;500;600;700;800").catch(() => undefined)) ?? (await css("").catch(() => undefined));
  if (!sheet) return [];
  await mkdir(dir, { recursive: true });
  const faces: Face[] = [];
  for (const block of sheet.match(/@font-face\s*{[^}]*}/g) ?? []) {
    const url = /url\((https:[^)]+\.woff2)\)/.exec(block)?.[1];
    if (!url) continue;
    const file = `${createHash("sha1").update(url).digest("hex").slice(0, 16)}.woff2`;
    const res = await fetch(url, { headers: { "user-agent": UA }, ...(signal ? { signal } : {}) });
    if (!res.ok) continue;
    await writeFile(join(dir, file), Buffer.from(await res.arrayBuffer()));
    faces.push({ file, css: block.replace(url, `assets/fonts/${slug(family)}/${file}`) });
  }
  await writeFile(index, JSON.stringify(faces));
  return faces.map((f) => ({ ...f, file: join(dir, f.file) }));
}

/**
 * Copies each family's faces into `<out>/assets/fonts/` and returns the @font-face CSS for them plus
 * the families that resolved. A family Google doesn't serve is left out (the stack falls back).
 */
export async function localFonts(
  families: string[],
  out: string,
  signal?: AbortSignal,
): Promise<{ css: string; families: string[] }> {
  let css = "";
  const found: string[] = [];
  // Tests and offline runs: no fetching; the stack falls back to the fonts Chrome has.
  if (process.env.AGENTCAST_FONTS === "off") return { css, families: found };
  for (const family of [...new Set(families)]) {
    const faces = await facesOf(family, signal).catch(() => [] as Face[]);
    if (!faces.length) continue;
    const dir = join(out, "assets", "fonts", slug(family));
    await mkdir(dir, { recursive: true });
    for (const face of faces) await copyFile(face.file, join(dir, face.file.split("/").pop()!));
    css += faces.map((f) => f.css).join("\n") + "\n";
    found.push(family);
  }
  return { css, families: found };
}
