import type { Layout, Rect } from "@agentcast/shared";
import type { Page } from "playwright-core";

// The element map (PRD §9.7.1): what's on top of the page when a step settles, for the edit to animate
// in parts. Boxes only, never text. A string, not a function: the page gets exactly this source, with
// none of the helpers the worker's compiler adds to functions.

const SCRIPT = `(function (point) {
  var vw = innerWidth, vh = innerHeight, screen = vw * vh;
  var clip = function (e) {
    var r = e.getBoundingClientRect();
    var x = Math.max(r.left, 0), y = Math.max(r.top, 0), w = Math.min(r.right, vw) - x, h = Math.min(r.bottom, vh) - y;
    return w > 1 && h > 1 ? [Math.round(x), Math.round(y), Math.round(w), Math.round(h)] : null;
  };
  var shown = function (e) {
    var s = getComputedStyle(e);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };
  // Near the top of what's at its middle: pages lay transparent gradients and glows over their content.
  var onTop = function (e, b) {
    var hits = document.elementsFromPoint(b[0] + b[2] / 2, b[1] + b[3] / 2).slice(0, 8);
    return hits.some(function (hit) { return e === hit || e.contains(hit) || hit.contains(e); });
  };
  var area = function (b) { return b[2] * b[3]; };

  var panel = null, scope = document.body;
  var modal = Array.prototype.slice.call(document.querySelectorAll('[role="dialog"],dialog[open],[aria-modal="true"]'));
  Array.prototype.forEach.call(document.querySelectorAll("body *"), function (e) {
    if (modal.length > 8 || e.children.length === 0) return;
    var s = getComputedStyle(e);
    if (s.position !== "fixed") return;
    var b = clip(e);
    if (b && area(b) > screen * 0.12 && area(b) < screen * 0.92) modal.push(e);
  });
  modal.forEach(function (e) {
    if (!shown(e)) return;
    var b = clip(e);
    if (!b || area(b) < screen * 0.08 || !onTop(e, b)) return;
    if (!panel || area(b) > area(panel)) { panel = b; scope = e; }
  });

  var groups = [], seen = 0;
  var skip = /^(NAV|HEADER|FOOTER|SVG|SCRIPT|STYLE|SELECT)$/i;
  var walk = function (e) {
    if (++seen > 6000 || skip.test(e.tagName)) return;
    var kids = [];
    for (var i = 0; i < e.children.length; i++) {
      var c = e.children[i];
      if (!shown(c)) continue;
      var b = clip(c);
      if (b && area(b) > screen * 0.004 && onTop(c, b)) kids.push(b);
    }
    if (kids.length >= 3) {
      var ws = kids.map(function (b) { return b[2]; }).sort(function (a, b) { return a - b; });
      var hs = kids.map(function (b) { return b[3]; }).sort(function (a, b) { return a - b; });
      var mw = ws[ws.length >> 1], mh = hs[hs.length >> 1];
      var same = kids.filter(function (b) { return Math.abs(b[2] - mw) <= mw * 0.25 && Math.abs(b[3] - mh) <= mh * 0.35; });
      if (same.length >= 3) {
        var lefts = same.map(function (b) { return b[0]; }), tops = same.map(function (b) { return b[1]; });
        var stacked = Math.max.apply(null, lefts) - Math.min.apply(null, lefts) < mw * 0.5;
        var inline = Math.max.apply(null, tops) - Math.min.apply(null, tops) < mh * 0.5;
        var x0 = Math.min.apply(null, lefts), y0 = Math.min.apply(null, tops);
        var x1 = Math.max.apply(null, same.map(function (b) { return b[0] + b[2]; }));
        var y1 = Math.max.apply(null, same.map(function (b) { return b[1] + b[3]; }));
        groups.push({
          kind: stacked && mw > mh * 2 ? "rows" : inline && mh > mw ? "columns" : "cards",
          box: [x0, y0, x1 - x0, y1 - y0],
          items: same.slice(0, 24),
        });
      }
    }
    for (var j = 0; j < e.children.length; j++) walk(e.children[j]);
  };
  walk(scope);
  groups.sort(function (a, b) { return area(b.box) - area(a.box); });

  var component = null;
  if (point) {
    var at = document.elementFromPoint(point[0], point[1]);
    for (var e = at; e && e !== document.body; e = e.parentElement) {
      var b = clip(e);
      if (!b || area(b) < screen * 0.015) continue;
      if (area(b) > screen * 0.55) break;
      var s = getComputedStyle(e);
      if (s.borderRadius !== "0px" || s.boxShadow !== "none" || s.borderTopWidth !== "0px" || s.backgroundColor !== "rgba(0, 0, 0, 0)") { component = b; break; }
    }
  }
  return { panel: panel, component: component, groups: groups.slice(0, 6) };
})`;

/** The page's structure now, with the component at the middle of `near`. Never fails a take: undefined if it can't tell. */
export const LAYOUT_SCRIPT = SCRIPT;

export async function pageLayout(page: Page, near?: Rect): Promise<Layout | undefined> {
  const point = near ? [near[0] + near[2] / 2, near[1] + near[3] / 2] : null;
  const found = await page
    .evaluate(`${SCRIPT}(${JSON.stringify(point)})`)
    .catch(() => undefined);
  const raw = found as { panel: Rect | null; component: Rect | null; groups: Layout["groups"] } | undefined;
  if (!raw) return undefined;
  return {
    ...(raw.panel ? { panel: raw.panel } : {}),
    ...(raw.component ? { component: raw.component } : {}),
    groups: raw.groups,
  };
}
