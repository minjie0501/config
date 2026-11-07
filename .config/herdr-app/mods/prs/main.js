// Pull requests panel: a cross-repo inbox. The GitHub PRs that wait for your
// review, and your own open PRs, grouped by what each one waits on:
// Review requested, Yours to fix, Ready to merge, Waiting. It lives in the
// right panel's stack (`panel-body`, child `prs`) and opens from the PRs button
// in the tab bar (the `my-tabs` mod).
//
// Each row: a dot for what most needs a look, the title and age; the repo,
// number, diff size, author (avatar) and the checks and review state; and the
// Jira issues named in the title or branch, with their summary and status.
//
// Data: one GraphQL query through `gh` (your gh login). Jira through `acli`
// (Atlassian's CLI, its own browser login): this mod never sees a token.
// Refreshes when the panel shows (at most once a minute), every 10 minutes in
// the background, and on ↻. The last result is kept in localStorage. The number
// of review requests goes to shared "prs.review" for the button's badge.
//
// Keys (click the panel first): ↑ ↓ move, ↵ opens in the browser, / searches,
// Esc clears the search. Click a row to open it; click a Jira line to open the
// issue. Avatars are downloaded with curl to data/prs/avatars (Herdr shows
// images only from its own folder).

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, theme, layout, shared, setShared, spaces, window, appHome, props, openOverlay, nextCommand } from "herdr";
import { QUERY, toPr, jiraKeys, grouped, searchWords, jiraFromAcli, ago, initials } from "./data.js";
import { PrPage } from "./page.js";

const SEARCH = { review: "https://github.com/pulls/review-requested", mine: "https://github.com/pulls" };
const VISIBLE_AGE = 60 * 1000;
const BACKGROUND_AGE = 10 * 60 * 1000;
const JIRA_AGE = 10 * 60 * 1000;
const PROJECTS_AGE = 24 * 60 * 60 * 1000;
const AVATARS = "data/prs/avatars";
const LOGIN = /^[A-Za-z0-9-]{1,39}$/;

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

const openUrl = (url) => {
  const platform = window()?.platform;
  if (platform === "windows") return exec("cmd", ["/c", "start", "", url]);
  return exec(platform === "macos" ? "open" : "xdg-open", [url]);
};

const load = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; }
};
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

const ciFailed = (pr) => pr.ci.failed > 0;

// One color for the dot before the title: what most needs a look.
const tone = (pr, t) => {
  if (ciFailed(pr) || pr.conflicts || pr.review === "CHANGES_REQUESTED") return t.ansi1;
  if (pr.draft) return t.dim;
  if (pr.ci.running) return t.ansi3;
  if (pr.review === "APPROVED") return t.ansi2;
  return t.muted;
};

export default class Prs extends View {
  init(_props, cx) {
    // Opened as the PR page (a dialog): only the page, no list, timers or writes.
    if (props()?.page) {
      this.page = new PrPage();
      this.page.init(props(), cx);
      return;
    }
    this.loading = false;
    this.error = null;
    this.wasVisible = false;
    this.at = 0;
    this.words = [];
    this.data = load("cache", null);
    if (this.data && !this.data.prs) this.data = null; // a cache from the first version
    this.jira = load("jira", {}); // KEY -> { summary, status, category, at }
    this.projects = load("projects", null); // { at, keys: [...] }
    this.jiraNote = null;
    this.avatars = new Set();
    this.avatarTried = new Set();
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Search PRs, repos, branches, Jira…" });
    this.input.on("change", (_e, cx) => { this.words = searchWords(this.input.value()); this.at = 0; cx.notify(); });
    this.inputFocused = false;
    this.input.on("focus", () => { this.inputFocused = true; });
    this.input.on("blur", () => { this.inputFocused = false; });
    // Key commands ("prs.<name>" in keys.json or herdr-app do): open, down, up, refresh.
    cx.spawn(async (cx) => {
      for (;;) {
        let c;
        try { c = await nextCommand(); } catch { return; } // a reload ends the loop
        const rows = this.groups().flatMap((g) => g.rows);
        if (c === "open") this.openPage(this.at);
        else if (c === "down") this.at = Math.min(rows.length - 1, this.at + 1);
        else if (c === "up") this.at = Math.max(0, this.at - 1);
        else if (c === "refresh") this.refresh(cx);
        cx.notify();
      }
    });
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
        const prs = [
          ...(d.review.nodes ?? []).filter(Boolean).map((n) => toPr(n, "review")),
          ...(d.mine.nodes ?? []).filter(Boolean).map((n) => toPr(n, "mine")),
        ];
        this.data = { at: Date.now(), prs, reviewCount: d.review.issueCount, mineCount: d.mine.issueCount };
        this.error = null;
        // No spaces: `herdr-app check`, which saves shared state too. Write only in the real app.
        if (spaces().length && shared("prs.review") !== this.data.reviewCount) setShared("prs.review", this.data.reviewCount);
      } catch (e) {
        this.error = String(e?.message || e);
      } finally {
        this.loading = false;
        cx.notify();
      }
      if (!this.data) return;
      await this.loadJira(cx);
      save("cache", this.data);
      cx.notify();
      await this.loadAvatars(cx);
    });
  }

  // Project keys first (once a day), so only real keys are looked up; then the
  // keys not looked up in the last 10 minutes, in one search.
  async loadJira(cx) {
    try {
      if (!this.projects || Date.now() - this.projects.at > PROJECTS_AGE) {
        const r = await exec("acli", ["jira", "project", "list", "--paginate", "--json"]);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        const list = JSON.parse(r.stdout);
        const keys = (Array.isArray(list) ? list : list?.values ?? list?.projects ?? []).map((p) => p?.key).filter(Boolean);
        this.projects = { at: Date.now(), keys };
        save("projects", this.projects);
      }
      const projects = new Set(this.projects.keys);
      for (const pr of this.data.prs) pr.keys = jiraKeys([pr.title, pr.branch], projects);
      const now = Date.now();
      const wanted = [...new Set(this.data.prs.flatMap((pr) => pr.keys))].filter((k) => !(now - (this.jira[k]?.at ?? 0) < JIRA_AGE));
      if (wanted.length) {
        const jql = `key in (${wanted.join(",")})`;
        const r = await exec("acli", ["jira", "workitem", "search", "--jql", jql, "--fields", "key,summary,status", "--limit", "100", "--json"]);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        const found = jiraFromAcli(JSON.parse(r.stdout));
        for (const k of wanted) this.jira[k] = { ...(found[k] ?? { missing: true }), at: now };
        save("jira", this.jira);
      }
      this.jiraNote = null;
    } catch (e) {
      // acli's errors don't always say why ("failed to list projects" when
      // signed out), so ask it whether it is signed in.
      const text = String(e?.message || e);
      let signedIn = true;
      try { signedIn = (await exec("acli", ["jira", "auth", "status"])).code === 0; } catch { signedIn = null; }
      this.jiraNote = signedIn === null ? "Jira: install acli (brew install atlassian/acli/acli) to see Jira issues."
        : !signedIn ? "Jira: sign in with `acli jira auth login --web`, then press ↻."
        : `Jira: ${text.replace(/^✗\s*/, "").split("\n")[0]}`;
    }
    cx.notify();
  }

  // Each new author's GitHub picture, once per session, 4 at a time.
  async loadAvatars(cx) {
    const logins = [...new Set(this.data.prs.map((pr) => pr.author))]
      .filter((l) => LOGIN.test(l) && !this.avatars.has(l) && !this.avatarTried.has(l));
    if (!logins.length) return;
    const dir = `${appHome()}/${AVATARS}`;
    try { await exec("mkdir", ["-p", dir]); } catch { return; }
    for (let i = 0; i < logins.length; i += 4) {
      await Promise.all(logins.slice(i, i + 4).map(async (login) => {
        this.avatarTried.add(login);
        try {
          const r = await exec("curl", ["-fsSL", "--max-time", "10", "-o", `${dir}/${login}.png`, `https://github.com/${login}.png?size=64`]);
          if (r.code === 0) this.avatars.add(login);
        } catch {}
      }));
      cx.notify();
    }
  }

  // The page is a dialog: a copy of this mod of its own, so it gets the list in
  // its order, the Jira issues known here and the Jira project keys.
  // The groups on screen: computed the same way for drawing, keys and commands.
  groups() {
    const d = this.data;
    return d ? grouped(d.prs, this.words, this.jira).filter((g) => g.rows.length || (g.id === "review" && !this.words.length)) : [];
  }

  openPage(i) {
    const rows = this.groups().flatMap((g) => g.rows);
    if (!rows[i]) return;
    const list = rows.map((pr) => ({ repo: pr.repo, number: pr.number, title: pr.title, url: pr.url, mine: pr.section === "mine" }));
    const keys = new Set(rows.flatMap((pr) => pr.keys ?? []));
    const jira = Object.fromEntries(Object.entries(this.jira).filter(([k]) => keys.has(k)));
    openOverlay({ mod: "prs", kind: "dialog", width: 0.72, height: 0.86,
      props: { page: true, list, at: i, jira, projects: this.projects?.keys ?? [] } });
  }

  key(e, cx, rows) {
    if (e.key === "down") this.at = Math.min(rows.length - 1, this.at + 1);
    else if (e.key === "up") this.at = Math.max(0, this.at - 1);
    else if (e.key === "enter" && rows[this.at]) this.openPage(this.at);
    else if (e.key === "/" && !this.inputFocused) this.input.focus();
    else if (e.key === "escape" && this.words.length) { this.input.set_value(""); this.words = []; }
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  avatar(login, t) {
    if (this.avatars.has(login)) return image(`${AVATARS}/${login}.png`).size(14).flex_none().rounded(7);
    return div().size(14).flex_none().rounded(7).bg(t.raised).flex().items_center().justify_center()
      .text_size(7.5).font_semibold().text_color(t.muted).child(initials(login));
  }

  chips(pr, t) {
    const chip = (text, color) => div().flex_none().px(5).h(17).flex().items_center().rounded(4)
      .border_1().border_color(t.border).text_size(10.5).text_color(color).child(text);
    const out = [];
    if (pr.draft) out.push(chip("Draft", t.dim));
    if (pr.ci.failed) out.push(chip(`✗ ${pr.ci.failed}`, t.ansi1));
    else if (pr.ci.running) out.push(chip(`◷ ${pr.ci.running}`, t.ansi3));
    else if (pr.ci.passed) out.push(chip(`✓ ${pr.ci.passed}`, t.ansi2));
    if (pr.conflicts) out.push(chip("Conflicts", t.ansi1));
    if (pr.section === "mine") {
      if (pr.review === "APPROVED") out.push(chip("Approved", t.ansi2));
      else if (pr.review === "CHANGES_REQUESTED") out.push(chip("Changes", t.ansi1));
      else if (pr.review === "REVIEW_REQUIRED") out.push(chip("Needs review", t.muted));
    }
    return out;
  }

  jiraLine(key, i, t) {
    const j = this.jira[key];
    const color = j?.category === "done" ? t.ansi2 : j?.category === "indeterminate" ? t.accent : t.muted;
    return h_flex().id(`jira-${i}-${key}`).pl(15).gap(6).items_center().text_size(11.5).rounded(4)
      .cursor_pointer().hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); exec("acli", ["jira", "workitem", "view", key, "--web"]).catch(() => {}); })
      .child(div().flex_none().text_color(t.accent).child(key))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(j?.missing ? "not found in Jira" : j?.summary ?? "…"))
      .when(Boolean(j?.status), (el) => el.child(div().flex_none().px(5).h(17).flex().items_center().rounded(4)
        .bg(t.raised).text_size(10.5).text_color(color).child(j.status)));
  }

  row(pr, i, t) {
    const repo = pr.repo.split("/").pop();
    const on = i === this.at;
    return v_flex().id(`pr-${i}`).px(10).py(7).gap(4).rounded(8).cursor_pointer()
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => { this.at = i; this.handle.focus(); this.openPage(i); cx.notify(); })
      .child(h_flex().gap(8).items_center()
        .child(div().size(7).flex_none().rounded(4).bg(tone(pr, t)))
        .child(div().flex_1().min_w(0).truncate().text_size(12.8).text_color(pr.draft ? t.muted : t.foreground).child(pr.title))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(pr.updated))))
      .child(h_flex().pl(15).gap(6).items_center().text_size(11.5).text_color(t.dim)
        .child(div().min_w(0).truncate().child(`${repo} #${pr.number}`))
        .child(div().flex_none().text_color(t.ansi2).child(`+${pr.add}`))
        .child(div().flex_none().text_color(t.ansi1).child(`−${pr.del}`))
        .when(pr.section === "review", (el) => el.child(this.avatar(pr.author, t)).child(div().flex_none().max_w(90).truncate().child(pr.author)))
        .child(div().flex_1())
        .children(this.chips(pr, t)))
      .children((pr.keys ?? []).map((k) => this.jiraLine(k, i, t)));
  }

  render(cx) {
    if (this.page) return this.page.render(cx);
    const shown = visible();
    if (shown && !this.wasVisible) this.tick(cx);
    this.wasVisible = shown;
    const t = theme();
    const d = this.data;
    const groups = this.groups();
    const rows = groups.flatMap((g) => g.rows);
    this.rows = rows;
    if (this.at >= rows.length) this.at = Math.max(0, rows.length - 1);
    const auth = /auth|login|token/i.test(this.error ?? "");
    let n = 0;
    const moreReview = d ? d.reviewCount - d.prs.filter((p) => p.section === "review").length : 0;
    const moreMine = d ? d.mineCount - d.prs.filter((p) => p.section === "mine").length : 0;
    const more = (id, count, url) => div().id(`more-${id}`).px(10).py(4).text_size(12).text_color(t.accent).cursor_pointer()
      .on_click(() => { openUrl(url).catch(() => {}); }).child(`${count} more on GitHub`);

    // Key events from the search field come here too: ↑ ↓ ↵ Esc work while typing.
    return v_flex().id("prs").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx, rows))
      .size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background)
      .border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Pull requests"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim)
          .child(d ? `updated ${ago(d.at)}${ago(d.at) === "now" ? "" : " ago"}` : ""))
        .child(div().id("prs-refresh").size(24).flex_none().flex().items_center().justify_center().rounded(6)
          .text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { this.projects = this.jiraNote ? null : this.projects; this.refresh(cx); })
          .child(this.loading ? svg("mods/workspace-chrome/spinner.svg").size(13).spin(900) : div().text_size(14).child("↻"))))
      .child(div().flex_none().px(10).pt(8)
        .child(Input.new(this.input).h(30).px(9).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(12.5).text_color(t.foreground)))
      .when(Boolean(this.error), (el) => el.child(div().flex_none().mx(10).mt(8).p(10).rounded(8).bg(t.raised)
        .text_size(12).text_color(t.blocked)
        .child(auth ? `gh is not logged in. Run \`gh auth login\` in a terminal, then press ↻.\n\n${this.error}` : this.error)))
      .child(v_flex().id("prs-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(10)
        .on_mouse_down("left", () => this.handle.focus())
        .when(!d && !this.error, (el) => el.child(div().p(8).text_size(12).text_color(t.dim).child("Loading pull requests…")))
        .when(Boolean(d) && !rows.length && this.words.length > 0, (el) => el.child(div().p(8).text_size(12).text_color(t.dim).child("No PR matches the search.")))
        .children(groups.map((g) => v_flex().flex_none().gap(1)
          .child(h_flex().h(26).px(10).gap(6).items_center().text_size(11.5).text_color(t.dim)
            .child(div().font_semibold().child(g.title))
            .child(div().child(String(g.rows.length))))
          .children(g.rows.map((pr) => this.row(pr, n++, t)))
          .when(!g.rows.length && Boolean(g.empty), (el) => el.child(div().px(10).py(4).text_size(12).text_color(t.dim).child(g.empty)))))
        .when(moreReview > 0, (el) => el.child(more("review", moreReview, SEARCH.review)))
        .when(moreMine > 0, (el) => el.child(more("mine", moreMine, SEARCH.mine))))
      .when(Boolean(this.jiraNote), (el) => el.child(div().flex_none().px(14).py(6).border_t(1).border_color(t.border)
        .text_size(11.5).text_color(t.dim).child(this.jiraNote)));
  }
}
