// Pull requests panel: the GitHub PRs that wait for your review, and your own
// open PRs with their status (CI, review, conflicts, draft). It lives in the
// right panel's stack (`panel-body`, child `prs`) and opens from the PRs button
// in the tab bar (the `my-tabs` mod).
//
// One GraphQL query through `gh`, so it uses your gh login. It refreshes when
// the panel shows (at most once a minute), every 10 minutes in the background,
// and on the ↻ button. The last result is kept in localStorage, so the panel
// shows it at once after a restart. The number of review requests goes to the
// shared key "prs.review", which the PRs button shows as a badge.
//
// Click a PR to open it in the browser.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, layout, shared, setShared, spaces, window } from "herdr";

const QUERY = `query {
  review: search(query: "is:pr is:open archived:false review-requested:@me", type: ISSUE, first: 30) { issueCount nodes { ...pr } }
  mine: search(query: "is:pr is:open archived:false author:@me", type: ISSUE, first: 30) { issueCount nodes { ...pr } }
}
fragment pr on PullRequest {
  number title url isDraft updatedAt mergeable reviewDecision
  repository { nameWithOwner }
  author { login }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;

const SEARCH = {
  review: "https://github.com/pulls/review-requested",
  mine: "https://github.com/pulls",
};

const VISIBLE_AGE = 60 * 1000;
const BACKGROUND_AGE = 10 * 60 * 1000;

const find = (node, id) => {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
};

const visible = () => {
  const root = layout();
  const panel = find(root, "panel");
  const body = find(root, "panel-body");
  return Boolean(panel && !panel.hidden && body?.active === "prs");
};

const ago = (ms) => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

const toPr = (n) => ({
  number: n.number,
  title: n.title,
  url: n.url,
  draft: n.isDraft,
  updated: Date.parse(n.updatedAt),
  repo: n.repository?.nameWithOwner ?? "",
  author: n.author?.login ?? "",
  review: n.reviewDecision ?? null,
  conflicts: n.mergeable === "CONFLICTING",
  ci: n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null,
});

const ciFailed = (pr) => pr.ci === "FAILURE" || pr.ci === "ERROR";
const ciPending = (pr) => pr.ci === "PENDING" || pr.ci === "EXPECTED";

// One color for the dot before the title: what most needs a look.
const tone = (pr, t) => {
  if (pr.draft) return t.dim;
  if (ciFailed(pr) || pr.conflicts || pr.review === "CHANGES_REQUESTED") return t.ansi1;
  if (ciPending(pr)) return t.ansi3;
  if (pr.review === "APPROVED") return t.ansi2;
  return t.muted;
};

const openUrl = (url) => {
  const platform = window()?.platform;
  if (platform === "windows") return exec("cmd", ["/c", "start", "", url]);
  return exec(platform === "macos" ? "open" : "xdg-open", [url]);
};

export default class Prs extends View {
  init(_props, cx) {
    this.loading = false;
    this.error = null;
    this.wasVisible = false;
    try { this.data = JSON.parse(localStorage.getItem("cache") ?? "null"); } catch { this.data = null; }
    cx.timer.every(15000, (cx) => this.tick(cx));
    this.tick(cx);
  }

  tick(cx) {
    const age = Date.now() - (this.data?.at ?? 0);
    if (age > (visible() ? VISIBLE_AGE : BACKGROUND_AGE)) this.refresh(cx);
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("gh", ["api", "graphql", "-f", `query=${QUERY}`]);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `gh exited with ${r.code}`);
        const d = JSON.parse(r.stdout).data;
        this.data = {
          at: Date.now(),
          review: (d.review.nodes ?? []).filter(Boolean).map(toPr),
          mine: (d.mine.nodes ?? []).filter(Boolean).map(toPr),
          reviewCount: d.review.issueCount,
          mineCount: d.mine.issueCount,
        };
        localStorage.setItem("cache", JSON.stringify(this.data));
        // No spaces: `herdr-app check`, which saves shared state too. Write only in the real app.
        if (spaces().length && shared("prs.review") !== this.data.reviewCount) setShared("prs.review", this.data.reviewCount);
        this.error = null;
      } catch (e) {
        this.error = String(e?.message || e);
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  chips(pr, section, t) {
    const chip = (text, color) => div().flex_none().px(5).h(17).flex().items_center().rounded(4)
      .border_1().border_color(t.border).text_size(10.5).text_color(color).child(text);
    const out = [];
    if (pr.draft) out.push(chip("Draft", t.dim));
    if (pr.ci === "SUCCESS") out.push(chip("✓ CI", t.ansi2));
    else if (ciFailed(pr)) out.push(chip("✗ CI", t.ansi1));
    else if (ciPending(pr)) out.push(chip("● CI", t.ansi3));
    if (pr.conflicts) out.push(chip("Conflicts", t.ansi1));
    if (section === "mine") {
      if (pr.review === "APPROVED") out.push(chip("Approved", t.ansi2));
      else if (pr.review === "CHANGES_REQUESTED") out.push(chip("Changes requested", t.ansi1));
      else if (pr.review === "REVIEW_REQUIRED") out.push(chip("Needs review", t.muted));
    }
    return out;
  }

  row(pr, i, section, t) {
    const repo = pr.repo.split("/").pop();
    return v_flex().id(`pr-${section}-${i}`).px(10).py(7).gap(4).rounded(8).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => { openUrl(pr.url).catch(() => {}); })
      .child(h_flex().gap(8).items_center()
        .child(div().size(7).flex_none().rounded(4).bg(tone(pr, t)))
        .child(div().flex_1().min_w(0).truncate().text_size(12.8).text_color(t.foreground).child(pr.title)))
      .child(h_flex().pl(15).gap(6).items_center().text_size(11.5).text_color(t.dim)
        .child(div().min_w(0).truncate().child(`${repo} #${pr.number}`))
        .when(section === "review", (el) => el.child(div().flex_none().child(`· ${pr.author}`)))
        .child(div().flex_none().child(`· ${ago(pr.updated)}`))
        .child(div().flex_1())
        .children(this.chips(pr, section, t)));
  }

  section(id, title, list, count, empty, t) {
    const more = count - list.length;
    return v_flex().flex_none().gap(1)
      .child(h_flex().h(28).px(10).gap(6).items_center().text_size(11.5).text_color(t.dim)
        .child(div().font_semibold().child(title))
        .child(div().child(String(count))))
      .children(list.map((pr, i) => this.row(pr, i, id, t)))
      .when(!list.length, (el) => el.child(div().px(10).py(4).text_size(12).text_color(t.dim).child(empty)))
      .when(more > 0, (el) => el.child(div().id(`more-${id}`).px(10).py(4).text_size(12).text_color(t.accent).cursor_pointer()
        .on_click(() => { openUrl(SEARCH[id]).catch(() => {}); })
        .child(`${more} more on GitHub`)));
  }

  render(cx) {
    const shown = visible();
    if (shown && !this.wasVisible) this.tick(cx);
    this.wasVisible = shown;
    const t = theme();
    const d = this.data;
    const auth = /auth|login|token/i.test(this.error ?? "");
    return v_flex().id("prs").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background)
      .border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Pull requests"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim)
          .child(d ? `updated ${ago(d.at)}${ago(d.at) === "now" ? "" : " ago"}` : ""))
        .child(div().id("prs-refresh").size(24).flex_none().flex().items_center().justify_center().rounded(6)
          .text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.refresh(cx))
          .child(this.loading
            ? svg("mods/workspace-chrome/spinner.svg").size(13).spin(900)
            : div().text_size(14).child("↻"))))
      .when(Boolean(this.error), (el) => el.child(div().flex_none().mx(10).mt(10).p(10).rounded(8).bg(t.raised)
        .text_size(12).text_color(t.blocked)
        .child(auth ? `gh is not logged in. Run \`gh auth login\` in a terminal, then press ↻.\n\n${this.error}` : this.error)))
      .child(v_flex().id("prs-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(10)
        .when(!d && !this.error, (el) => el.child(div().p(8).text_size(12).text_color(t.dim).child("Loading pull requests…")))
        .when(Boolean(d), (el) => el
          .child(this.section("review", "Review requested", d.review, d.reviewCount, "Nothing waits for your review.", t))
          .child(this.section("mine", "Your pull requests", d.mine, d.mineCount, "You have no open pull requests.", t))));
  }
}
