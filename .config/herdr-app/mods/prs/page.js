// The PR page: opened by the list as a dialog over the window (the `prs` mod
// opens itself with props.page). Laid out like GitHub's PR page: a header with
// ↑ ↓ through the list, the title, state and branches; tabs Conversation,
// Checks and Files; a sidebar with reviewers, assignees, labels, Jira issues
// and the size of the change. Read only: merging is on GitHub.
//
// Keys: ↑ ↓ previous/next PR in the list, 1 2 3 tabs, O opens on GitHub,
// Esc closes (Herdr closes the top dialog).
//
// A dialog is its own copy of the mod: it can't read the list's cache, so the
// list hands over the PRs in its order, the Jira issues it knows and the Jira
// project keys.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { exec, theme, window, closeOverlay, nextCommand } from "herdr";
import { PAGE_FIELDS, FILES_LIMIT, pageChecks, mergeState, timeline, reviewers, reviewWord, jiraKeys, jiraFromAcli, ago } from "./data.js";
import { AgentForm } from "./agent.js";

const openUrl = (url) => {
  const platform = window()?.platform;
  if (platform === "windows") return exec("cmd", ["/c", "start", "", url]);
  return exec(platform === "macos" ? "open" : "xdg-open", [url]);
};

const TABS = [{ id: "conversation", label: "Conversation" }, { id: "checks", label: "Checks" }, { id: "files", label: "Files" }];
const STATE = { OPEN: ["Open", "ansi2"], MERGED: ["Merged", "ansi5"], CLOSED: ["Closed", "ansi1"] };
const VERDICT = { APPROVED: "ansi2", CHANGES_REQUESTED: "ansi1", REQUESTED: "ansi3", COMMENTED: "muted", DISMISSED: "dim", PENDING: "dim" };

export class PrPage {
  init(p, cx) {
    this.list = p.list ?? [];
    this.at = Math.min(Math.max(0, p.at ?? 0), Math.max(0, this.list.length - 1));
    this.tab = "conversation";
    this.cache = {}; // id -> { pr } | { error }
    this.jira = { ...(p.jira ?? {}) };
    this.projects = new Set(p.projects ?? []);
    this.overlay = p.overlay;
    this.form = null; // the Agent review form, when open
    // Agent review: only for an open PR whose page has loaded.
    this.onAgent = (it, cx) => {
      const pr = this.cache[this.id(it)]?.pr;
      if (!pr || pr.state !== "OPEN") return;
      if (this.form) { this.startAgent(cx); return; }
      this.form = new AgentForm();
      this.form.init(it, pr, cx);
      cx.notify();
    };
    // Key commands reach this dialog too: "prs.agent" (like ⌘↵), "prs.back".
    cx.spawn(async (cx) => {
      for (;;) {
        let c;
        try { c = await nextCommand(); } catch { return; } // a reload ends the loop
        if (c === "agent") this.onAgent(this.item(), cx);
        else if (c === "back") { this.form = null; cx.notify(); }
      }
    });
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(300, () => this.handle.focus());
    this.load(cx);
  }

  item() { return this.list[this.at]; }
  id(it = this.item()) { return it ? `${it.repo}#${it.number}` : ""; }

  load(cx) {
    const it = this.item();
    const id = this.id(it);
    if (!it || this.cache[id]) return;
    this.cache[id] = { loading: true };
    cx.spawn(async (cx) => {
      try {
        const r = await exec("gh", ["pr", "view", String(it.number), "--repo", it.repo, "--json", PAGE_FIELDS]);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        const pr = JSON.parse(r.stdout);
        pr.checks = pageChecks(pr.statusCheckRollup);
        pr.timeline = timeline(pr);
        pr.reviewers = reviewers(pr);
        pr.merge = mergeState(pr);
        pr.keys = jiraKeys([pr.title, pr.headRefName, pr.body], this.projects);
        this.cache[id] = { pr };
        cx.notify();
        await this.loadJira(pr.keys);
      } catch (e) {
        this.cache[id] = { error: String(e?.message || e).split("\n")[0] };
      }
      cx.notify();
    });
  }

  async loadJira(keys) {
    const wanted = keys.filter((k) => !this.jira[k]);
    if (!wanted.length) return;
    try {
      const r = await exec("acli", ["jira", "workitem", "search", "--jql", `key in (${wanted.join(",")})`, "--fields", "key,summary,status", "--limit", "50", "--json"]);
      if (r.code !== 0) return;
      const found = jiraFromAcli(JSON.parse(r.stdout));
      for (const k of wanted) this.jira[k] = found[k] ?? { missing: true };
    } catch {}
  }

  startAgent(cx) {
    this.form?.start(cx, () => closeOverlay(this.overlay));
  }

  go(delta, cx) {
    if (this.form) return;
    const next = this.at + delta;
    if (next < 0 || next >= this.list.length) return;
    this.at = next;
    this.load(cx);
    cx.notify();
  }

  key(e, cx) {
    const k = e.keystroke;
    if (k === "down") this.go(1, cx);
    else if (k === "up") this.go(-1, cx);
    else if (!this.form && (k === "1" || k === "2" || k === "3")) { this.tab = TABS[Number(k) - 1].id; cx.notify(); }
    else if (k === "o") { const it = this.item(); if (it) openUrl(it.url).catch(() => {}); }
    else if (k === "cmd-enter" && this.onAgent) this.onAgent(this.item(), cx);
    else return;
    cx.stop_propagation();
  }

  // ---- drawing ---------------------------------------------------------------

  button(id, label, hint, primary, action, t) {
    return h_flex().id(id).h(30).px(12).gap(8).items_center().rounded(7).cursor_pointer().text_size(12.5)
      .border_1().border_color(primary ? t.ansi2 : t.input).bg(primary ? t.ansi2 : t.raised)
      .text_color(primary ? "#ffffff" : t.foreground).hover((s) => s.opacity(0.88))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => action(cx))
      .child(label)
      .when(Boolean(hint), (el) => el.child(div().text_size(11).opacity(0.7).child(hint)));
  }

  pill(text, color, t) {
    return div().flex_none().px(6).h(18).flex().items_center().rounded(9).border_1().border_color(t.border)
      .text_size(10.5).text_color(color).child(text);
  }

  header(it, pr, t) {
    const [label, color] = pr?.isDraft ? ["Draft", "dim"] : STATE[pr?.state] ?? ["Open", "ansi2"];
    return v_flex().flex_none().px(20).pt(14).pb(0).gap(8).border_b(1).border_color(t.border)
      .child(h_flex().gap(10).items_center().text_size(12).text_color(t.dim)
        .child(div().child(`↑ ↓   ${this.at + 1} of ${this.list.length}`))
        .child(div().min_w(0).truncate().child(it.repo))
        .child(div().flex_1())
        .child(this.button("page-github", "Open on GitHub", "O", false, () => openUrl(it.url).catch(() => {}), t))
        .when(Boolean(this.onAgent) && (!pr || pr.state === "OPEN"), (el) => el.child(
          this.button("page-agent", "Agent review", "⌘↵", true, (cx) => this.onAgent(it, cx), t))))
      .child(h_flex().gap(8).items_baseline()
        .child(div().min_w(0).text_size(19).font_semibold().text_color(t.foreground).child(pr?.title ?? it.title))
        .child(div().flex_none().text_size(17).text_color(t.dim).child(`#${it.number}`)))
      .child(h_flex().gap(8).items_center().text_size(12.5).text_color(t.muted)
        .child(div().flex_none().px(9).h(22).flex().items_center().rounded(11).bg(t[color]).text_color("#ffffff").text_size(12).font_semibold().child(label))
        .when(Boolean(pr), (el) => el
          .child(div().flex_none().font_semibold().text_color(t.foreground).child(pr.author?.login ?? ""))
          .child(div().flex_none().child(`wants to merge ${pr.commits?.length ?? 0} commit${pr.commits?.length === 1 ? "" : "s"} into`))
          .child(div().flex_none().px(5).rounded(4).bg(t.raised).text_color(t.accent).child(pr.baseRefName))
          .child(div().flex_none().child("from"))
          .child(div().min_w(0).truncate().px(5).rounded(4).bg(t.raised).text_color(t.accent).child(pr.headRefName))))
      .child(h_flex().gap(2).items_end().children(TABS.map((tab) => {
        const on = tab.id === this.tab;
        const count = !pr ? "" : tab.id === "checks" ? pr.checks.length : tab.id === "files" ? pr.files?.length ?? 0 : pr.timeline.length - 1;
        return h_flex().id(`tab-${tab.id}`).h(34).px(12).gap(6).items_center().cursor_pointer().text_size(12.5)
          .border_b(2).border_color(on ? t.accent : "#00000000")
          .text_color(on ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { this.tab = tab.id; cx.notify(); })
          .child(tab.label)
          .child(div().px(5).rounded(8).bg(t.raised).text_size(10.5).text_color(t.dim).child(String(count)));
      })));
  }

  conversation(pr, t) {
    const card = (item, i) => {
      if (item.kind === "review" && !item.body) {
        return h_flex().pl(4).gap(6).items_center().text_size(12).text_color(t.dim)
          .child(div().text_color(t.foreground).child(item.who))
          .child(div().child(reviewWord(item.state)))
          .child(div().child(`· ${ago(item.at)} ago`));
      }
      return v_flex().rounded(8).border_1().border_color(t.border).overflow_hidden()
        .child(h_flex().px(12).h(34).gap(6).items_center().bg(t.raised).text_size(12).text_color(t.muted)
          .child(div().font_semibold().text_color(t.foreground).child(item.who))
          .child(div().child(item.kind === "description" ? "opened this" : item.kind === "review" ? "reviewed" : "commented"))
          .child(div().child(`· ${ago(item.at)} ago`))
          .child(div().flex_1())
          .when(item.kind === "review", (el) => el.child(this.pill(reviewWord(item.state), t[VERDICT[item.state]] ?? t.muted, t))))
        .child(div().px(14).py(10).text_size(13).child(TextView.markdown(`md-${this.id()}-${i}`, item.body).selectable(true)));
    };
    const merge = pr.merge;
    const failed = pr.checks.filter((c) => c.state === "failed").length;
    const running = pr.checks.filter((c) => c.state === "running").length;
    const checksLine = !pr.checks.length ? "No checks" : failed ? `${failed} failing check${failed === 1 ? "" : "s"}`
      : running ? `${running} check${running === 1 ? "" : "s"} running` : "All checks have passed";
    const tone = (x) => (x === "ok" ? t.ansi2 : x === "bad" ? t.ansi1 : t.ansi3);
    const mergeRow = (id, icon, color, text, action) => h_flex().id(id).px(14).h(36).gap(10).items_center().text_size(12.5)
      .border_t(1).border_color(t.border)
      .when(Boolean(action), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => action(cx)))
      .child(div().w(14).flex_none().text_color(color).child(icon)).child(div().child(text));
    return v_flex().gap(12)
      .children(pr.timeline.map(card))
      .child(v_flex().rounded(8).border_1().border_color(t.border).overflow_hidden()
        .child(h_flex().px(14).h(36).items_center().text_size(12.5).font_semibold().bg(t.raised).child("Merge"))
        .child(mergeRow("merge-checks", failed ? "✗" : running ? "◷" : "✓", failed ? t.ansi1 : running ? t.ansi3 : t.ansi2, checksLine,
          (cx) => { this.tab = "checks"; cx.notify(); }))
        .child(mergeRow("merge-review", "●", t[VERDICT[pr.reviewDecision]] ?? t.muted,
          pr.reviewDecision ? `Review: ${reviewWord(pr.reviewDecision)}` : "No review decision"))
        .child(mergeRow("merge-state", merge.tone === "ok" ? "✓" : "!", tone(merge.tone), merge.text))
        .child(div().px(14).py(8).border_t(1).border_color(t.border).text_size(11.5).text_color(t.dim)
          .child("Merge on GitHub: this panel never writes to GitHub.")));
  }

  checks(pr, t) {
    if (!pr.checks.length) return div().text_size(12.5).text_color(t.dim).child("No checks on this pull request.");
    const icon = { failed: ["✗", t.ansi1], running: ["◷", t.ansi3], passed: ["✓", t.ansi2] };
    return v_flex().rounded(8).border_1().border_color(t.border).overflow_hidden()
      .children(pr.checks.map((c, i) => h_flex().id(`check-${i}`).px(12).h(34).gap(10).items_center().text_size(12.5)
        .when(i > 0, (el) => el.border_t(1).border_color(t.border))
        .when(Boolean(c.url), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => { openUrl(c.url).catch(() => {}); }))
        .child(div().w(14).flex_none().text_color(icon[c.state][1]).child(icon[c.state][0]))
        .child(div().flex_1().min_w(0).truncate().child(c.name))
        .child(div().flex_none().text_size(11.5).text_color(t.dim).child(c.text))));
  }

  files(pr, t) {
    const files = (pr.files ?? []).slice(0, FILES_LIMIT);
    if (!files.length) return div().text_size(12.5).text_color(t.dim).child("No files.");
    const letter = { ADDED: ["A", t.ansi2], DELETED: ["D", t.ansi1], RENAMED: ["R", t.ansi4], COPIED: ["C", t.ansi4] };
    return v_flex().rounded(8).border_1().border_color(t.border).overflow_hidden()
      .children(files.map((f, i) => {
        const [l, c] = letter[f.changeType] ?? ["M", t.ansi3];
        return h_flex().id(`file-${i}`).px(12).h(30).gap(10).items_center().text_size(12.5).cursor_pointer()
          .when(i > 0, (el) => el.border_t(1).border_color(t.border))
          .hover((s) => s.bg(t.hover)).on_click(() => { openUrl(`${pr.url}/files`).catch(() => {}); })
          .child(div().w(12).flex_none().text_size(11).font_semibold().text_color(c).child(l))
          .child(div().flex_1().min_w(0).truncate().child(f.path))
          .child(div().flex_none().text_size(11.5).text_color(t.ansi2).child(`+${f.additions}`))
          .child(div().flex_none().text_size(11.5).text_color(t.ansi1).child(`−${f.deletions}`));
      }))
      .when((pr.files?.length ?? 0) > FILES_LIMIT, (el) => el.child(div().px(12).py(8).text_size(12).text_color(t.dim)
        .child(`${pr.files.length - FILES_LIMIT} more files on GitHub`)));
  }

  sidebar(pr, t) {
    const section = (title, children) => v_flex().gap(6)
      .child(div().text_size(11.5).font_semibold().text_color(t.dim).child(title))
      .children(children.length ? children : [div().text_size(12).text_color(t.dim).child("None")]);
    const line = (text, color) => div().min_w(0).truncate().text_size(12.5).text_color(color ?? t.foreground).child(text);
    return v_flex().w(240).flex_none().min_h(0).overflow_y_scrollbar().px(16).py(14).gap(18).border_l(1).border_color(t.border)
      .child(section("Reviewers", pr.reviewers.map((r) => h_flex().gap(6).items_center()
        .child(line(r.who)).child(div().flex_1())
        .child(this.pill(r.state === "REQUESTED" ? "requested" : reviewWord(r.state), t[VERDICT[r.state]] ?? t.muted, t)))))
      .child(section("Assignees", (pr.assignees ?? []).map((a) => line(a.login))))
      .child(section("Labels", (pr.labels ?? []).map((l) => this.pill(l.name, t.muted, t))))
      .child(section("Jira", pr.keys.map((k) => {
        const j = this.jira[k];
        const color = j?.category === "done" ? t.ansi2 : j?.category === "indeterminate" ? t.accent : t.muted;
        return v_flex().id(`side-jira-${k}`).gap(2).cursor_pointer().rounded(4).hover((s) => s.bg(t.hover))
          .on_click(() => { exec("acli", ["jira", "workitem", "view", k, "--web"]).catch(() => {}); })
          .child(h_flex().gap(6).items_center().child(line(k, t.accent)).child(div().flex_1())
            .when(Boolean(j?.status), (el) => el.child(this.pill(j.status, color, t))))
          .child(div().text_size(11.5).text_color(t.muted).child(j?.missing ? "not found in Jira" : j?.summary ?? "…"));
      })))
      .child(section("Changes", [
        h_flex().gap(6).text_size(12.5)
          .child(div().text_color(t.ansi2).child(`+${pr.additions}`))
          .child(div().text_color(t.ansi1).child(`−${pr.deletions}`))
          .child(div().text_color(t.dim).child(`in ${pr.files?.length ?? 0} files`)),
      ]));
  }

  render(_cx) {
    const t = theme();
    const it = this.item();
    if (!it) return div().p(20).child("No pull request.");
    const entry = this.cache[this.id(it)] ?? {};
    const pr = entry.pr;
    const body = !pr
      ? div().p(20).text_size(12.5).text_color(entry.error ? t.blocked : t.dim).child(entry.error ?? "Loading the pull request…")
      : this.form
        ? this.form.render(t, (cx) => { this.form = null; cx?.notify(); }, (cx) => this.startAgent(cx))
      : h_flex().flex_1().min_h(0).items_start()
        .child(v_flex().id(`page-main-${this.id(it)}`).flex_1().min_w(0).h_full().overflow_y_scrollbar().px(20).py(16)
          .child(this.tab === "checks" ? this.checks(pr, t) : this.tab === "files" ? this.files(pr, t) : this.conversation(pr, t)))
        .child(this.sidebar(pr, t));
    return v_flex().id("pr-page").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(this.header(it, pr, t))
      .child(body)
      .child(h_flex().flex_none().h(30).px(20).gap(16).items_center().border_t(1).border_color(t.border).text_size(11.5).text_color(t.dim)
        .child("↑ ↓ previous / next").child("1 2 3 tabs").child("O open on GitHub")
        .when(Boolean(this.onAgent), (el) => el.child("⌘↵ agent review"))
        .child("Esc close"));
  }
}
