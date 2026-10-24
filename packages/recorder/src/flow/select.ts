import type { Locator, Page } from "playwright-core";
import type { Step, Rect } from "@agentcast/shared";

export interface Match {
  locator: Locator;
  bbox: Rect;
}

/** Apply the same visibility, enabled and action compatibility checks to every strategy. */
export async function selectMatch(
  page: Page,
  locator: Locator,
  step: Step,
  maxCandidates: number,
): Promise<{ match?: Match; ambiguous: boolean }> {
  const count = await locator.count();
  if (count > maxCandidates) return { ambiguous: true };
  const eligible = (
    await Promise.all(
      Array.from({ length: count }, async (_, index) => {
        const candidate = locator.nth(index);
        try {
          const [visible, enabled, box, info] = await Promise.all([
            candidate.isVisible(),
            candidate.isEnabled({ timeout: 500 }),
            candidate.boundingBox({ timeout: 500 }),
            candidate.evaluate(
              (element) => ({
                tag: element.tagName.toLowerCase(),
                inputType:
                  element instanceof HTMLInputElement ? element.type : "",
                editable:
                  element instanceof HTMLElement && element.isContentEditable,
                href: element instanceof HTMLAnchorElement ? element.href : "",
                main: !!element.closest('main,[role="main"]'),
              }),
              undefined,
              { timeout: 500 },
            ),
          ]);
          if (!visible || !enabled || !box || box.width <= 0 || box.height <= 0)
            return undefined;
          if (step.action === "type") {
            if (!(
              info.tag === "textarea" ||
              info.editable ||
              (info.tag === "input" &&
                ![
                  "checkbox",
                  "radio",
                  "file",
                  "button",
                  "submit",
                  "reset",
                  "hidden",
                  "image",
                  "range",
                  "color",
                ].includes(info.inputType))
            ))
              return undefined;
            if (!(await candidate.isEditable({ timeout: 500 })))
              return undefined;
          }
          if (step.action === "select" && info.tag !== "select")
            return undefined;
          return { locator: count === 1 ? locator : candidate, box, ...info };
        } catch {
          if (page.isClosed())
            throw new Error("The page closed during locator resolution");
          return undefined;
        }
      }),
    )
  ).filter((item) => item !== undefined);
  if (!eligible.length) return { ambiguous: false };
  const found = (item: (typeof eligible)[number]) => ({
    match: {
      locator: item.locator,
      bbox: [item.box.x, item.box.y, item.box.width, item.box.height] as Rect,
    },
    ambiguous: false,
  });
  if (eligible.length === 1) return found(eligible[0]!);

  // Explicit context outranks incidental viewport position (e.g. invoice rows).
  if (step.target?.near) {
    const anchors = page.getByText(step.target.near, { exact: false });
    const n = Math.min(await anchors.count(), maxCandidates);
    const boxes = (
      await Promise.all(
        Array.from({ length: n }, (_, i) =>
          anchors
            .nth(i)
            .boundingBox({ timeout: 500 })
            .catch(() => null),
        ),
      )
    ).filter((box) => box !== null);
    if (boxes.length) {
      const scored = eligible
        .map((item) => ({
          item,
          distance: Math.min(
            ...boxes.map((box) =>
              Math.hypot(
                item.box.x + item.box.width / 2 - box.x - box.width / 2,
                item.box.y + item.box.height / 2 - box.y - box.height / 2,
              ),
            ),
          ),
        }))
        .sort((a, b) => a.distance - b.distance);
      if (scored[1]!.distance - scored[0]!.distance > 4)
        return found(scored[0]!.item);
      return { ambiguous: true };
    }
    // An absent hint is optional. Continue with the same safe viewport/link tie-breaks.
  }
  const viewport =
    page.viewportSize() ??
    (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
  const onScreen = eligible.filter(
    ({ box }) =>
      box.x < viewport.width &&
      box.y < viewport.height &&
      box.x + box.width > 0 &&
      box.y + box.height > 0,
  );
  if (step.action === "scroll") {
    const below = eligible
      .filter((item) => item.box.y >= viewport.height)
      .sort((a, b) => a.box.y - b.box.y);
    if (
      below.length === 1 ||
      (below.length > 1 && below[1]!.box.y - below[0]!.box.y > 4)
    )
      return found(below[0]!);
    if (below.length) return { ambiguous: true };
  }
  if (onScreen.length === 1) return found(onScreen[0]!);
  const pool = onScreen.length ? onScreen : eligible;
  if (
    pool.every(
      (item) => /^https?:/.test(item.href) && item.href === pool[0]!.href,
    )
  ) {
    const main = pool.filter((item) => item.main);
    if (main.length === 1) return found(main[0]!);
  }
  return { ambiguous: true };
}
