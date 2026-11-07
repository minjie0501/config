// Issues panel: your open Jira issues across all projects (through acli, its
// own browser login: this mod never sees a token), and your open GitHub issues
// (through gh). Grouped In progress / To do (by priority, then last change),
// plus GitHub when you have any. It lives in the right panel's stack
// (`panel-body`, child `issues`) and opens from the Issues button in the tab
// bar (the `my-tabs` mod).
//
// Filters: Recent (changed in 30 days), In progress, All open (newest 100).
// acli's search can't return dates, so Jira rows have no age.
//
// Refreshes when the panel shows (at most once a minute), every 10 minutes in
// the background, on ↻ and when the filter changes. The last result is kept in
// localStorage. Keys (click the list first): ↑ ↓ move, ↵ opens, / searches,
// Esc clears the search.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, theme, layout, window } from "herdr";
import { FILTERS, filterOf, JIRA_FIELDS, JIRA_LIMIT, GITHUB_QUERY, fromAcli, fromGithub, grouped, searchWords, typeMark, priorityColor, jiraSearchUrl, ago } from "./data.js";

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
  return Boolean(panel && !panel.hidden && body?.active === "issues");
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

const firstLine = (text) => String(text ?? "").replace(/^✗\s*/, "").split("\n")[0];

export default class Issues extends View {
  init(_props, cx) {
    this.loading = false;
    this.jiraError = null;
    this.githubError = null;
    this.wasVisible = false;
    this.at = 0;
    this.words = [];
    this.filter = filterOf(load("filter", "recent")).id;
    this.data = load("cache", null); // { at, filter, jira: [], jiraCount, github: [], githubCount }
    if (this.data?.filter !== this.filter) this.data = null;
    this.site = load("site", null);
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Search issues, keys, status…" });
    this.input.on("change", (_e, cx) => { this.words = searchWords(this.input.value()); this.at = 0; cx.notify(); });
    this.inputFocused = false;
    this.input.on("focus", () => { this.inputFocused = true; });
    this.input.on("blur", () => { this.inputFocused = false; });
    cx.timer.every(15000, (cx) => this.tick(cx));
    this.tick(cx);
  }

  tick(cx) {
    const age = Date.now() - (this.data?.at ?? 0);
    if (age > (visible() ? VISIBLE_AGE : BACKGROUND_AGE)) this.refresh(cx);
  }

  setFilter(id, cx) {
    if (id === this.filter) return;
    this.filter = id;
    save("filter", id);
    this.at = 0;
    this.data = this.data ? { ...this.data, jira: [], jiraCount: 0, at: 0 } : null;
    this.refresh(cx, true);
  }

  refresh(cx, force = false) {
    if (this.loading && !force) return;
    const filter = filterOf(this.filter);
    const run = (this.run ?? 0) + 1;
    this.run = run;
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      const [jira, github] = await Promise.all([this.loadJira(filter), this.loadGithub()]);
      if (run !== this.run) return; // a newer load (another filter) took over
      this.data = {
        at: Date.now(),
        filter: filter.id,
        jira: jira?.items ?? this.data?.jira ?? [],
        jiraCount: jira?.count ?? this.data?.jiraCount ?? 0,
        github: github?.items ?? this.data?.github ?? [],
        githubCount: github?.count ?? this.data?.githubCount ?? 0,
      };
      save("cache", this.data);
      this.loading = false;
      cx.notify();
    });
  }

  async loadJira(filter) {
    try {
      const r = await exec("acli", ["jira", "workitem", "search", "--jql", filter.jql, "--fields", JIRA_FIELDS, "--limit", String(JIRA_LIMIT), "--json"]);
      if (r.code !== 0) throw new Error(r.stderr || r.stdout);
      const items = fromAcli(JSON.parse(r.stdout));
      let count = items.length;
      if (items.length >= JIRA_LIMIT) {
        const c = await exec("acli", ["jira", "workitem", "search", "--jql", filter.jql, "--count"]);
        count = Number((c.stdout.match(/(\d+)\s*$/) ?? [])[1]) || count;
      }
      if (!this.site) {
        const s = await exec("acli", ["jira", "auth", "status"]);
        this.site = (s.stdout.match(/Site:\s*(\S+)/) ?? [])[1] ?? null;
        if (this.site) save("site", this.site);
      }
      this.jiraError = null;
      return { items, count };
    } catch (e) {
      let signedIn = true;
      try { signedIn = (await exec("acli", ["jira", "auth", "status"])).code === 0; } catch { signedIn = null; }
      this.jiraError = signedIn === null ? "Install acli (brew install atlassian/acli/acli) to see Jira issues."
        : !signedIn ? "Sign in to Jira with `acli jira auth login --web`, then press ↻."
        : `Jira: ${firstLine(e?.message || e)}`;
      return null;
    }
  }

  async loadGithub() {
    try {
      const r = await exec("gh", ["api", "graphql", "-f", `query=${GITHUB_QUERY}`]);
      if (r.code !== 0) throw new Error(r.stderr || r.stdout);
      const d = JSON.parse(r.stdout).data.issues;
      this.githubError = null;
      return { items: fromGithub(d.nodes), count: d.issueCount };
    } catch (e) {
      this.githubError = /auth|login|token/i.test(String(e)) ? "GitHub: run `gh auth login`, then press ↻." : `GitHub: ${firstLine(e?.message || e)}`;
      return null;
    }
  }

  open(it) {
    if (it.source === "github") return openUrl(it.url).catch(() => {});
    return exec("acli", ["jira", "workitem", "view", it.key, "--web"]).catch(() => {});
  }

  key(e, cx, rows) {
    if (e.key === "down") this.at = Math.min(rows.length - 1, this.at + 1);
    else if (e.key === "up") this.at = Math.max(0, this.at - 1);
    else if (e.key === "enter" && rows[this.at]) this.open(rows[this.at]);
    else if (e.key === "/" && !this.inputFocused) this.input.focus();
    else if (e.key === "escape" && this.words.length) { this.input.set_value(""); this.words = []; }
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  row(it, i, t) {
    const on = i === this.at;
    const mark = typeMark(it.type);
    const pill = (text, color, bg) => div().flex_none().px(5).h(17).flex().items_center().rounded(4)
      .bg(bg ?? t.raised).text_size(10.5).text_color(color).child(text);
    return v_flex().id(`issue-${i}`).px(10).py(7).gap(4).rounded(8).cursor_pointer()
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => { this.at = i; this.handle.focus(); this.open(it); cx.notify(); })
      .child(h_flex().gap(8).items_center()
        .child(div().size(15).flex_none().rounded(4).bg(t[mark.color] ?? t.muted).flex().items_center().justify_center()
          .text_size(9.5).font_bold().text_color("#ffffff").child(mark.letter))
        .child(div().flex_1().min_w(0).truncate().text_size(12.8).text_color(t.foreground).child(it.title))
        .when(Boolean(it.updated), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(ago(it.updated)))))
      .child(h_flex().pl(23).gap(6).items_center().text_size(11.5).text_color(t.dim)
        .child(div().flex_none().text_color(it.source === "jira" ? t.accent : t.dim).child(it.key))
        .child(div().min_w(0).truncate().child(it.type))
        .child(div().flex_1())
        .when(Boolean(it.priority), (el) => el.child(div().flex_none().text_color(t[priorityColor(it.priority)]).child(it.priority)))
        .child(pill(it.status, it.category === "indeterminate" ? t.accent : t.muted))
        .children((it.labels ?? []).slice(0, 2).map((l) => pill(l, t.muted))));
  }

  render(cx) {
    const shown = visible();
    if (shown && !this.wasVisible) this.tick(cx);
    this.wasVisible = shown;
    const t = theme();
    const d = this.data;
    const filter = filterOf(this.filter);
    const items = d ? [...d.jira, ...d.github] : [];
    const groups = grouped(items, this.words).filter((g) => g.rows.length);
    const rows = groups.flatMap((g) => g.rows);
    if (this.at >= rows.length) this.at = Math.max(0, rows.length - 1);
    let n = 0;
    const moreJira = d ? d.jiraCount - d.jira.length : 0;
    const moreGithub = d ? d.githubCount - d.github.length : 0;
    const note = (text, color) => div().flex_none().mx(10).mt(8).px(10).py(8).rounded(8).bg(t.raised).text_size(12).text_color(color).child(text);
    const more = (id, text, action) => div().id(`more-${id}`).px(10).py(4).text_size(12).text_color(t.accent).cursor_pointer()
      .on_click(() => { action(); }).child(text);
    const segment = (f) => div().id(`filter-${f.id}`).h(24).px(9).flex().items_center().rounded(6).text_size(12).cursor_pointer()
      .when(f.id === this.filter, (el) => el.bg(t.selected).text_color(t.foreground).font_semibold())
      .when(f.id !== this.filter, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => this.setFilter(f.id, cx))
      .child(f.label);

    // Key events from the search field come here too: ↑ ↓ ↵ Esc work while typing.
    return v_flex().id("issues").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx, rows))
      .size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background)
      .border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Issues"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim)
          .child(d?.at ? `updated ${ago(d.at)}${ago(d.at) === "now" ? "" : " ago"}` : ""))
        .child(div().id("issues-refresh").size(24).flex_none().flex().items_center().justify_center().rounded(6)
          .text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.refresh(cx))
          .child(this.loading ? svg("mods/workspace-chrome/spinner.svg").size(13).spin(900) : div().text_size(14).child("↻"))))
      .child(v_flex().flex_none().px(10).pt(8).gap(6)
        .child(Input.new(this.input).h(30).px(9).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(12.5).text_color(t.foreground))
        .child(h_flex().gap(2).items_center().children(FILTERS.map(segment))
          .child(div().flex_1().min_w(0).truncate().text_right().text_size(11).text_color(t.dim).child(filter.hint))))
      .when(Boolean(this.jiraError), (el) => el.child(note(this.jiraError, t.blocked)))
      .when(Boolean(this.githubError), (el) => el.child(note(this.githubError, t.blocked)))
      .child(v_flex().id("issues-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(10)
        .on_mouse_down("left", () => this.handle.focus())
        .when(!d && !this.jiraError, (el) => el.child(div().p(8).text_size(12).text_color(t.dim).child("Loading issues…")))
        .when(Boolean(d) && !rows.length && !this.loading, (el) => el.child(div().p(8).text_size(12).text_color(t.dim)
          .child(this.words.length ? "No issue matches the search." : "No open issues here.")))
        .children(groups.map((g) => v_flex().flex_none().gap(1)
          .child(h_flex().h(26).px(10).gap(6).items_center().text_size(11.5).text_color(t.dim)
            .child(div().font_semibold().child(g.title))
            .child(div().child(String(g.rows.length))))
          .children(g.rows.map((it) => this.row(it, n++, t)))))
        .when(moreJira > 0 && Boolean(this.site), (el) => el.child(more("jira", `${moreJira} more in Jira`, () => openUrl(jiraSearchUrl(this.site, filter.jql)).catch(() => {}))))
        .when(moreGithub > 0, (el) => el.child(more("github", `${moreGithub} more on GitHub`, () => openUrl("https://github.com/issues/assigned").catch(() => {})))));
  }
}
