// Agent review: a form inside the PR page that starts a coding agent on the
// pull request, in a git worktree and a new Herdr space of its own.
//
// 1. Find a local clone of the PR's repository: the folders of Herdr's spaces
//    and terminals first, then the git repositories under ~/projects. None:
//    ask before cloning it (gh repo clone), to a path you can change.
// 2. Make a worktree under ~/.herdr/worktrees/<repo>/ (where Herdr's own
//    worktree feature puts them). Review: the PR head, detached. Fix modes:
//    a branch agent/fix-<n> or agent/checks-<n> from the PR branch.
// 3. space.new with the agent and the prompt as its first message.
// Nothing is pushed; the fix prompts tell the agent to ask before it pushes.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, theme, spaces, panes, home, knownAgents, readTextFile, run, notify } from "herdr";
import { modesFor, repoOfRemote, originOfConfig, branchFor, worktreeName, spaceName, promptFor } from "./data.js";

const load = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; }
};
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

// Main checkouts (folders) whose origin is `repo` ("owner/name").
const findClone = async (repo) => {
  const want = repo.toLowerCase();
  const gitDirs = new Set();
  // Herdr's spaces and terminals first: a worktree resolves to its main checkout.
  const folders = new Set([...spaces().filter((s) => !s.machine && s.folder).map((s) => s.folder), ...panes().map((p) => p.cwd).filter(Boolean)]);
  await Promise.all([...folders].map(async (cwd) => {
    try {
      const r = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd });
      if (r.code === 0) gitDirs.add(r.stdout.trim());
    } catch {}
  }));
  try {
    const r = await exec("find", [`${home()}/projects`, "-maxdepth", "6", "-name", "node_modules", "-prune", "-o", "-type", "d", "-name", ".git", "-print", "-prune"]);
    for (const line of r.stdout.split("\n")) if (line.trim()) gitDirs.add(line.trim());
  } catch {}
  for (const dir of gitDirs) {
    if (!dir.endsWith("/.git")) continue; // bare repositories have no checkout
    try {
      if (repoOfRemote(originOfConfig(await readTextFile(`${dir}/config`))) === want) return dir.slice(0, -5);
    } catch {}
  }
  return null;
};

export class AgentForm {
  // it: the list item ({repo, number, title, url, mine}); pr: gh pr view's answer.
  init(it, pr, cx) {
    this.it = it;
    this.pr = pr;
    this.modes = modesFor(pr, it.mine);
    const failing = pr.checks.some((c) => c.state === "failed");
    this.mode = !it.mine || this.modes.length === 1 ? "review" : failing && pr.reviewDecision !== "CHANGES_REQUESTED" ? "checks" : "address";
    this.agents = [];
    this.agent = load("agent", null);
    this.clone = undefined; // undefined: looking; null: not on this machine; else its folder
    this.status = null;
    this.error = null;
    this.busy = false;
    this.cloneInput = InputState.new({ value: `${home()}/projects/${it.repo.split("/").pop()}` });
    cx.spawn(async (cx) => {
      try {
        this.agents = (await knownAgents()).filter((a) => a.installed);
        if (!this.agents.some((a) => a.key === this.agent)) this.agent = (this.agents.find((a) => /claude/i.test(a.key)) ?? this.agents[0])?.key ?? null;
      } catch (e) { this.error = `Couldn't list the agents: ${e?.message || e}`; }
      cx.notify();
      this.clone = await findClone(it.repo);
      cx.notify();
    });
  }

  details() {
    const branch = branchFor(this.mode, this.it.number);
    return {
      number: this.it.number, repo: this.it.repo, title: this.pr.title, url: this.pr.url,
      base: this.pr.baseRefName, head: this.pr.headRefName, branch,
    };
  }

  prompt() { return promptFor(this.mode, this.details()); }

  cloneRepo(cx) {
    const path = this.cloneInput.value().trim().replace(/^~(?=\/)/, home());
    if (!path.startsWith("/")) { this.error = "Give a full path, for example ~/projects/name."; cx.notify(); return; }
    this.busy = true; this.error = null; this.status = `Cloning ${this.it.repo}…`; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("gh", ["repo", "clone", this.it.repo, path]);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        this.clone = path; this.status = null;
      } catch (e) { this.error = `Clone failed: ${String(e?.message || e).split("\n")[0]}`; this.status = null; }
      this.busy = false; cx.notify();
    });
  }

  // Resolves with the new space's name, or throws.
  start(cx, onDone) {
    if (this.busy || !this.clone || !this.agent) return;
    const agent = this.agents.find((a) => a.key === this.agent);
    if (!agent) return;
    save("agent", this.agent);
    this.busy = true; this.error = null; cx.notify();
    cx.spawn(async (cx) => {
      const git = async (args, label) => {
        this.status = label; cx.notify();
        const r = await exec("git", args, { cwd: this.clone });
        if (r.code !== 0) throw new Error(`${label}: ${(r.stderr || r.stdout).trim().split("\n").pop()}`);
        return r.stdout;
      };
      try {
        const d = this.details();
        const dir = `${home()}/.herdr/worktrees/${d.repo.split("/").pop()}`;
        await exec("mkdir", ["-p", dir]);
        // A free folder (and branch): a second start on the same PR gets -2, -3...
        let path = null, branch = d.branch;
        for (let i = 1; i <= 9 && !path; i++) {
          const suffix = i === 1 ? "" : `-${i}`;
          const candidate = `${dir}/${worktreeName(this.mode, d.number)}${suffix}`;
          const taken = (await exec("test", ["-e", candidate])).code === 0;
          if (!taken) { path = candidate; branch = d.branch ? `${d.branch}${suffix}` : null; }
        }
        if (!path) throw new Error(`No free worktree folder in ${dir}`);
        if (this.mode === "review") {
          await git(["fetch", "origin", `pull/${d.number}/head`], "Fetching the pull request");
          await git(["worktree", "add", "--detach", path, "FETCH_HEAD"], "Making the worktree");
        } else {
          await git(["fetch", "origin", d.head], `Fetching ${d.head}`);
          await git(["worktree", "add", "-B", branch, path, "FETCH_HEAD"], "Making the worktree");
        }
        this.status = "Starting the agent…"; cx.notify();
        const name = spaceName(this.mode, d.number, d.repo);
        run("space.new", { name, folder: path, argv: agent.run, task: promptFor(this.mode, { ...d, branch }) });
        notify({ title: `Started ${agent.name}`, body: `${name} · ${path.replace(home(), "~")}`, level: "success" });
        this.status = null; this.busy = false;
        onDone?.();
      } catch (e) {
        this.error = String(e?.message || e);
        this.status = null; this.busy = false;
      }
      cx.notify();
    });
  }

  render(t, onBack, onStart) {
    const segment = (id, label, on, action) => div().id(id).h(28).px(11).flex().items_center().rounded(7).text_size(12.5).cursor_pointer()
      .border_1().border_color(on ? t.accent : t.border).bg(on ? t.selected : t.background)
      .text_color(on ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { action(); cx.notify(); }).child(label);
    const section = (n, title, child) => v_flex().gap(8)
      .child(h_flex().gap(8).items_center().text_size(12).font_semibold().text_color(t.muted)
        .child(div().size(18).rounded(9).bg(t.raised).flex().items_center().justify_center().text_size(10.5).child(String(n)))
        .child(title))
      .child(div().pl(26).child(child));
    const mode = this.modes.find((m) => m.id === this.mode);
    const d = this.details();
    const repoName = d.repo.split("/").pop();
    const where = `~/.herdr/worktrees/${repoName}/${worktreeName(this.mode, d.number)}`;
    const ready = Boolean(this.clone) && Boolean(this.agent) && !this.busy;
    const button = (id, label, primary, enabled, action) => h_flex().id(id).h(32).px(14).gap(8).items_center().rounded(8).text_size(12.5)
      .border_1().border_color(primary ? t.ansi2 : t.input).bg(primary ? t.ansi2 : t.raised)
      .text_color(primary ? "#ffffff" : t.foreground)
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => action(cx)))
      .when(!enabled, (el) => el.opacity(0.45))
      .child(label);

    const repoBlock = this.clone === undefined
      ? div().text_size(12.5).text_color(t.dim).child(`Looking for ${d.repo} on this machine…`)
      : this.clone
        ? div().text_size(12.5).text_color(t.foreground).child(this.clone.replace(home(), "~"))
        : v_flex().gap(8)
          .child(div().text_size(12.5).text_color(t.ansi3).child(`${d.repo} is not on this machine. Clone it?`))
          .child(h_flex().gap(8).items_center()
            .child(div().flex_1().child(Input.new(this.cloneInput).h(30).px(9).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(12.5).text_color(t.foreground)))
            .child(button("agent-clone", "Clone", false, !this.busy, (cx) => this.cloneRepo(cx))));

    return v_flex().id("agent-form").flex_1().min_h(0).overflow_y_scrollbar().px(24).py(18).gap(20)
      .child(h_flex().gap(10).items_center()
        .child(div().text_size(16).font_semibold().child("Agent review"))
        .child(div().text_size(12.5).text_color(t.dim).child(`#${d.number} ${repoName}`))
        .child(div().flex_1())
        .child(button("agent-back", "← Back", false, !this.busy, (cx) => onBack(cx))))
      .child(section(1, "Mode", v_flex().gap(8)
        .child(h_flex().gap(6).children(this.modes.map((m) => segment(`mode-${m.id}`, m.label, m.id === this.mode, () => { this.mode = m.id; }))))
        .child(div().text_size(12).text_color(t.dim).child(mode?.about ?? ""))
        .when(this.modes.length === 1, (el) => el.child(div().text_size(11.5).text_color(t.dim)
          .child(this.pr.isCrossRepository ? "This PR comes from a fork: the agent runs its code on this machine. Fix modes are off for forks." : "Fix modes are for your own pull requests.")))))
      .child(section(2, "Agent", this.agents.length
        ? h_flex().gap(6).flex_wrap().children(this.agents.map((a) => segment(`agent-${a.key}`, a.name, a.key === this.agent, () => { this.agent = a.key; })))
        : div().text_size(12.5).text_color(t.dim).child("No installed agent found.")))
      .child(section(3, "Repository", repoBlock))
      .child(section(4, "What happens", v_flex().gap(4).text_size(12.5).text_color(t.muted)
        .child(div().child(`① A worktree at ${where}${d.branch ? ` on a new branch ${d.branch}, from ${d.head}` : ", the PR head, detached"}. Nothing is pushed.`))
        .child(div().child(`② A new space "${spaceName(this.mode, d.number, d.repo)}" with the agent and this prompt as its first message:`))
        .child(v_flex().mt(4).p(10).gap(8).rounded(8).bg(t.raised).text_size(11.5).text_color(t.foreground)
          .children(this.prompt().split("\n\n").map((para) => div().child(para))))))
      .when(Boolean(this.status), (el) => el.child(h_flex().gap(8).items_center().text_size(12.5).text_color(t.muted)
        .child(svg("mods/workspace-chrome/spinner.svg").size(13).spin(900)).child(this.status)))
      .when(Boolean(this.error), (el) => el.child(div().p(10).rounded(8).bg(t.raised).text_size(12.5).text_color(t.blocked).child(this.error)))
      .child(h_flex().gap(8).justify_end()
        .child(button("agent-cancel", "Cancel", false, !this.busy, (cx) => onBack(cx)))
        .child(button("agent-start", this.mode === "review" ? "Start review  ⌘↵" : "Start agent  ⌘↵", true, ready, (cx) => onStart(cx))));
  }
}
