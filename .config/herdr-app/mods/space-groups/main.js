// Space groups: a clone of Herdr's `spaces` sidebar with one more level on top.
// Each space belongs to one group ("Work", "Personal", ...). The sidebar shows
// only the spaces of the active group. Click a group chip to switch to it,
// right-click a chip to rename or delete it, drag a space onto a chip to move
// it to that group. Right-click on a space opens Herdr's own space menu.
// New spaces go into the active group. When a space of another group gets
// shown (a key, a toast, the agents list), the sidebar follows it.
//
// This is a copy, so Herdr's updates to the original don't reach it.
// upstream.json holds the originals' fingerprints at copy time; at start, a
// toast says when installed.json shows that Herdr changed one of them.
//
// Shared state (persisted):
//   groups.list   string[]                 the groups, in order
//   groups.active string                   the shown group
//   groups.of     { [spaceId]: group }     where each space belongs
//   groups.last   { [group]: spaceId }     the space last shown in each group
//
// Key commands (keys.json: "space-groups.<command>"): next-group, prev-group,
// next-space, prev-space, select-1 .. select-9 (positions in the active group).
//
// Below the group code: Herdr's spaces list. Stable colored avatars, worktrees
// under their checkout, grouped by machine when more than one is known.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, machines, panes, run, openOverlay, closeOverlay, props, nextCommand, notify, readTextFile, appHome, exec, hc, theme, shared, setShared, watchFolder, window, layout } from "herdr";

const SELF = "space-groups";
const DEFAULT_GROUPS = ["Work", "Personal"];
const URGENCY = ["blocked", "done", "working", "idle"];

const groupList = () => {
  const list = shared("groups.list");
  return Array.isArray(list) && list.length ? list : DEFAULT_GROUPS;
};
const activeGroup = () => {
  const list = groupList();
  const g = shared("groups.active");
  return list.includes(g) ? g : list[0];
};
const groupOf = () => shared("groups.of") ?? {};
const lastOf = () => shared("groups.last") ?? {};
const membersOf = (g, of = groupOf()) => spaces().filter((s) => (of[s.id] ?? groupList()[0]) === g);
const urgent = (members) => URGENCY.find((st) => members.some((s) => s.status === st)) ?? null;

// Show group `g`: its last shown space, else its first. An empty group shows
// nothing new: the main area keeps the space it had.
const switchGroup = (g) => {
  if (!groupList().includes(g)) return;
  setShared("groups.active", g);
  const members = membersOf(g);
  const target = members.find((s) => s.id === lastOf()[g]) ?? members[0];
  if (target && !target.active) run("space.select", { id: target.id });
};

const moveSpace = (id, g) => {
  setShared("groups.of", { ...groupOf(), [id]: g });
  // The shown space left the sidebar: show another one of this group.
  const moved = spaces().find((s) => s.id === id);
  if (moved?.active && g !== activeGroup()) {
    const rest = membersOf(activeGroup()).filter((s) => s.id !== id);
    if (rest[0]) run("space.select", { id: rest[0].id });
  }
};

const saveGroupName = (old, name) => {
  const list = groupList();
  if (!name || (name !== old && list.includes(name))) return false;
  if (!old) {
    setShared("groups.list", [...list, name]);
    switchGroup(name);
    return true;
  }
  const rename = (g) => (g === old ? name : g);
  setShared("groups.list", list.map(rename));
  setShared("groups.of", Object.fromEntries(Object.entries(groupOf()).map(([id, g]) => [id, rename(g)])));
  setShared("groups.last", Object.fromEntries(Object.entries(lastOf()).map(([g, id]) => [rename(g), id])));
  if (shared("groups.active") === old) setShared("groups.active", name);
  return true;
};

// Its spaces go to the first other group.
const deleteGroup = (g) => {
  const list = groupList();
  if (list.length < 2) return;
  const rest = list.filter((x) => x !== g);
  const wasActive = activeGroup() === g;
  setShared("groups.of", Object.fromEntries(Object.entries(groupOf()).map(([id, x]) => [id, x === g ? rest[0] : x])));
  setShared("groups.list", rest);
  const { [g]: _gone, ...last } = lastOf();
  setShared("groups.last", last);
  if (wasActive) switchGroup(rest[0]);
};

const openPopup = (popupProps) =>
  openOverlay({ mod: SELF, kind: "popup", width: 210, height: 300, props: popupProps });

const openNameDialog = (group) =>
  openOverlay({ mod: SELF, kind: "dialog", width: 360, props: { mode: "group-name", group: group ?? null } });

// The originals in upstream.json whose fingerprint in installed.json is not
// the one we copied from. Once per change: localStorage keeps what was told.
const checkUpstream = async () => {
  const home = appHome();
  const upstream = JSON.parse((await readTextFile(`${home}/mods/${SELF}/upstream.json`)) ?? "{}").watch ?? {};
  const installed = JSON.parse((await readTextFile(`${home}/installed.json`)) ?? "{}");
  const changed = Object.entries(upstream)
    .filter(([name, files]) => Object.entries(files).some(([f, hash]) => installed[name]?.[f] !== hash))
    .map(([name]) => name);
  const key = JSON.stringify(changed.map((name) => [name, installed[name]]));
  if (!changed.length || localStorage.getItem("upstream.told") === key) return;
  localStorage.setItem("upstream.told", key);
  notify({
    // The toast shows one line of body: keep it short.
    title: "A copied Herdr mod is out of date",
    body: `Herdr updated: ${changed.join(", ")}`,
    level: "info",
  });
};

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 28 : 30);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class SpaceGroups extends View {
  init(_props, cx) {
    this.mode = props()?.mode ?? null;
    if (this.mode) return this.initOverlay(cx);
    // Spaces that exist before the first look go to the first group; spaces
    // made later go to the group that is active then.
    this.initial = new Set(spaces().map((s) => s.id));
    this.lastActive = null;
    this.lastGroup = null; // the group of lastActive, kept here: a closed space leaves groups.of
    this.seen = new Map(); // space id -> its machine, for spaces this copy has seen
    this.of = groupOf();
    this.overGroup = null; // the chip under a dragged space
    // Herdr writes installed.json when the app starts, the same moment this mod
    // starts. A second look a minute later covers the case where we read first.
    const upstream = (cx) => cx.spawn(async () => {
      try { await checkUpstream(); } catch (e) { console.log(`space-groups: upstream check failed: ${e}`); }
    });
    upstream(cx);
    cx.timer.after(60000, (cx) => upstream(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        this.command(c);
        cx.notify();
      }
    });
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  // ---- Groups --------------------------------------------------------------

  command(c) {
    const list = groupList();
    const at = list.indexOf(activeGroup());
    const rows = this.ordered();
    const here = rows.findIndex((r) => r.w.active);
    const pick = (r) => r && run("space.select", { id: r.w.id });
    if (c === "next-group") switchGroup(list[(at + 1) % list.length]);
    else if (c === "prev-group") switchGroup(list[(at - 1 + list.length) % list.length]);
    else if (c === "next-space") pick(rows[(here + 1) % rows.length]);
    else if (c === "prev-space") pick(rows[here <= 0 ? rows.length - 1 : here - 1]);
    else if (/^select-\d$/.test(c)) pick(rows[Number(c.slice(7)) - 1]);
  }

  // Give every space a group, drop closed spaces, follow the shown space, and
  // remember it as its group's last. Writes only what changed.
  //
  // Never writes from a list that may be partial: with no spaces (still
  // loading, or `herdr-app check`, which runs without any and still saves
  // shared state) it does nothing. A space leaves groups.of only when this
  // copy saw it, and it is gone while its machine's layout is ready, so a
  // machine that is away or loading keeps its spaces' groups.
  sync() {
    const sp = spaces();
    if (!sp.length) return;
    const list = groupList();
    const g = activeGroup();
    const of = groupOf();
    const next = { ...of };
    let changed = false;
    for (const s of sp) {
      this.seen.set(s.id, s.machine ?? null);
      if (!list.includes(of[s.id])) {
        next[s.id] = this.initial.has(s.id) ? list[0] : g;
        changed = true;
      }
    }
    const alive = new Set(sp.map((s) => s.id));
    const ready = new Set(machines().filter((m) => m.layout === "ready").map((m) => m.name ?? null));
    for (const id of Object.keys(next)) {
      if (alive.has(id) || !this.seen.has(id) || !ready.has(this.seen.get(id))) continue;
      delete next[id];
      changed = true;
    }
    if (changed) setShared("groups.of", next);
    this.of = next;
    const shown = sp.find((s) => s.active);
    if (!shown) return;
    const its = next[shown.id];
    if (shown.id !== this.lastActive) {
      this.redirect = null;
      // The shown space was closed and Herdr, which doesn't know groups, showed
      // one of another group: show this group's next space instead. Only when
      // the group has one left; else follow Herdr's pick as usual.
      const closed = this.lastActive && !sp.some((s) => s.id === this.lastActive);
      const target = closed && this.lastGroup === g && its !== g && this.neighbour(this.lastActive, next, g);
      if (target) {
        this.lastActive = shown.id;
        this.redirect = shown.id;
        run("space.select", { id: target });
        return;
      }
      this.lastActive = shown.id;
      this.lastGroup = its;
      if (its !== g) setShared("groups.active", its);
    }
    // Until the redirect shows, don't record Herdr's pick as its group's last.
    if (this.redirect === shown.id) return;
    if (lastOf()[its] !== shown.id) setShared("groups.last", { ...lastOf(), [its]: shown.id });
  }

  // The space to show after `gone` closed: the one below it in this group's
  // list as last drawn, else the one above, else any left in group `g`.
  neighbour(gone, of, g) {
    const rows = this.lastRows ?? [];
    const k = rows.indexOf(gone);
    const order = k < 0 ? rows : [...rows.slice(k + 1), ...rows.slice(0, k).reverse()];
    return order.find((id) => of[id] === g) ?? Object.keys(of).find((id) => of[id] === g) ?? null;
  }

  groupBar(t, collapsed) {
    const list = groupList();
    const g = activeGroup();
    if (collapsed) {
      return h_flex().id("group-rail").h(28).mx(4).flex_none().justify_center().items_center().rounded(6)
        .text_size(11).font_semibold().text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click(() => this.command("next-group"))
        .child([...g].slice(0, 2).join(""));
    }
    // A space dragged from the list (this.pressed) can drop on another group's chip.
    const dragged = this.pressed !== null ? spaces()[this.pressed] : null;
    const chip = (name, i) => {
      const members = membersOf(name, this.of);
      const status = urgent(members);
      const on = name === g;
      const target = dragged && this.of[dragged.id] !== name;
      const over = target && this.overGroup === name;
      return h_flex().id(`group-${i}`).h(24).px(8).gap(5).flex_none().items_center().rounded(6)
        .border_1().border_color(over ? t.accent : target ? t.input : "#00000000")
        .text_size(12).cursor_pointer()
        .when(on, (el) => el.bg(t.selected).text_color(t.foreground).font_semibold())
        .when(!on, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)))
        .when(over, (el) => el.bg(t.hover).text_color(t.foreground))
        .on_mouse_move((_e, cx) => {
          const next = target ? name : null;
          if (this.overGroup !== next || (next && this.over !== null)) {
            this.overGroup = next;
            if (next) this.over = null; // no reorder line in the list while over a chip
            cx.notify();
          }
        })
        .on_mouse_up("left", (_e, cx) => {
          if (target) moveSpace(dragged.id, name);
          this.pressed = null;
          this.over = null;
          this.overGroup = null;
          cx.notify();
        })
        .on_click(() => switchGroup(name))
        .on_mouse_down("right", () => openPopup({ mode: "group-menu", group: name }))
        .child(div().max_w(110).truncate().child(name))
        .child(div().text_size(10.5).text_color(t.dim).child(String(members.length)))
        .when(!on && (status === "blocked" || status === "done"), (el) =>
          el.child(div().size(6).rounded(3).flex_none().bg(tone(t, status))));
    };
    const add = div().id("group-new").h(24).px(7).flex_none().flex().items_center().rounded(6)
      .text_size(13).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(() => openNameDialog(null))
      .child("+");
    return h_flex().id("groups").px(10).pt(6).pb(2).gap(2).flex_none().flex_wrap().items_center()
      .children([...list.map(chip), add]);
  }

  // ---- Overlays (this mod opened as a popup or dialog) ------------------------

  initOverlay(cx) {
    if (this.mode !== "group-name") return;
    this.text = props()?.group ?? "";
    this.error = null;
    this.input = InputState.new({ value: this.text });
    if (this.text) this.input.set_selected_range({ start: 0, end: this.text.length });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.error = null; cx.notify(); });
    this.input.on("submit", (_e, cx) => { this.submitName(); cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  submitName() {
    const p = props();
    const name = this.text.trim();
    if (!name) { this.error = "Type a name."; return; }
    if (!saveGroupName(p.group, name)) { this.error = `"${name}" is already a group.`; return; }
    closeOverlay(p.overlay);
  }

  renderOverlay() {
    const t = theme();
    const p = props() ?? {};
    const close = () => closeOverlay(p.overlay);
    const item = (id, label, action, opts = {}) => h_flex().id(id).h(28).px(10).gap(8).items_center().rounded(6)
      .text_size(12.5).text_color(opts.disabled ? t.dim : t.foreground)
      .when(!opts.disabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click(() => { close(); action(); }))
      .child(div().flex_1().truncate().child(label));
    const heading = (text) => div().px(10).pt(6).pb(4).text_size(11).text_color(t.dim).child(text);
    const line = () => div().my(4).h(1).bg(t.border);
    const box = (children) => v_flex().w_full().p(4).bg(t.popover).children(children);

    if (this.mode === "group-menu") {
      const only = groupList().length < 2;
      return box([
        heading(p.group),
        item("group-show", "Show", () => switchGroup(p.group)),
        item("group-rename", "Rename…", () => openNameDialog(p.group)),
        item("group-delete", only ? "Delete (needs another group)" : "Delete (spaces move to the next group)", () => deleteGroup(p.group), { disabled: only }),
        line(),
        item("group-add", "New group…", () => openNameDialog(null)),
      ]);
    }

    // group-name: new or rename.
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("group-name").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { close(); cx.stop_propagation(); } })
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child(p.group ? `Rename "${p.group}"` : "New group"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child("Name"))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground))
      .when(Boolean(this.error), (el) => el.child(div().pt(6).text_size(11.5).text_color(t.blocked).child(this.error)))
      .child(h_flex().pt(20).gap(8).justify_end()
        .child(button("gn-cancel", "Cancel", false, close))
        .child(button("gn-save", "Save", true, (_e, cx) => { this.submitName(); cx.notify(); })));
  }

  // ---- Herdr's spaces list (filtered to the active group) --------------------

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id))) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
      const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      const repo = common.stdout.trim();
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = { name, branch: null, ahead: 0, behind: 0, repo: JSON.stringify([on, repo]), linked: repo !== `${top.stdout.trim()}/.git` };
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  // Spaces of the active group in order, each worktree space moved under its
  // main checkout's. `i` stays the space's place in the whole list (space.move).
  ordered() {
    const sp = spaces(), ps = panes();
    const g = activeGroup();
    const first = groupList()[0];
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }))
      .filter((r) => this.shown.has(r.w.id) && (this.of[r.w.id] ?? first) === g);
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    this.lastRows = out.map((r) => r.w.id);
    return out.map((r, n) => ({ ...r, n }));
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed) {
    const rows = this.ordered();
    const draw = (r) => (collapsed ? this.compact(r, t) : this.row(r, t));
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => div().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(8).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    if (!remote.length) {
      if (rows.length) return rows.map(draw);
      if (loading(null)) return [loadingRow(null)];
      return [h_flex().id("group-empty").h(28).flex_none().px(8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new"))
        .child(svg("mods/workspace-chrome/plus.svg").size(12))
        .when(!collapsed, el => el.child(`New space in ${activeGroup()}`))];
    }
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const machine = this.machines.find(k => k.name === m);
      const connected = !m || machine?.state === "connected";
      const folded = this.folded.has(m);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 2 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none())
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", m ? { machine: m } : {}); }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", m ? { machine: m } : {}))
        .child(svg("mods/workspace-chrome/plus.svg").size(12)).when(!collapsed, el => el.child("New space there"));
      return [head, ...(folded ? [] : mine.length ? mine.map(draw) : [loading(m) ? loadingRow(m) : empty])];
    });
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one.
  gitTail(g, tree, name, t) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  row({ w, i, g, tree }, t) {
    const on = w.active;
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(this.pressed === i && this.over !== i, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.over === i && this.pressed !== i, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(this.pressed < i, line => line.bottom(0))
          .when(this.pressed > i, line => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        this.pressed = i;
        this.over = i;
      })
      .on_mouse_move((_e, cx) => {
        const source = spaces()[this.pressed];
        const over = source && (source.machine ?? null) === (w.machine ?? null) ? i : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const over = this.over;
        this.pressed = null;
        this.over = null;
        if (from !== null && over === i && from !== i) run("space.move", { id: spaces()[from].id, index: i + 1 });
        else if (from === i) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), el => el.pl(22).child(svg("mods/workspace-chrome/branch.svg").size(13).text_color(t.dim)))
          .when(!tree, el => el.child(h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...w.name][0]?.toUpperCase() ?? "?")))
          .child(div().flex_shrink(0).max_w(150).truncate().text_color(t.foreground).child(w.name))
          .child(g ? this.gitTail(g, tree, w.name, t) : div().flex_1()),
      );
  }

  compact({ w, n }, t) {
    return h_flex()
      .id(`space-${w.id}`)
      .h(26)
      .flex_none()
      .justify_center()
      .gap(4)
      .when(w.active, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("space.select", { id: w.id }))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(n + 1)))
      .child(div().text_color(tone(t, w.status)).child(glyph(w.status)));
  }

  render() {
    if (this.mode) return this.renderOverlay();
    this.sync();
    const t = theme();
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    // Our change to Herdr's code: with no spaces (loading, `herdr-app check`) this would wipe every color.
    if (changed && sp.length) setShared("space.colors", kept);
    // A release anywhere ends a drag (after a chip or row handled it).
    return v_flex().id("space-groups-root").size_full().min_h(0).bg(t.chrome).text_size(13)
      .on_mouse_up("left", (_e, cx) => {
        if (this.pressed === null && this.overGroup === null) return;
        this.pressed = null;
        this.over = null;
        this.overGroup = null;
        cx.notify();
      })
      .child(this.groupBar(t, collapsed))
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(!collapsed, el => el.child("Spaces"))
        .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => run("space.new")).child(svg("mods/workspace-chrome/plus.svg").size(14))))
      .child(v_flex().flex_1().min_h(0).px(8).pb(14).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .children(this.grouped(t, collapsed)));
  }
}
