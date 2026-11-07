// Pure logic for the PRs panel: no `herdr` imports, so Node can test it.
// Shapes a GitHub search result into rows, sorts them into groups, matches a
// search, and finds Jira keys. Ideas from herdr-ranch-prs (MIT, jslowack),
// written again for a cross-repo inbox.

export const QUERY = `query {
  review: search(query: "is:pr is:open archived:false review-requested:@me", type: ISSUE, first: 30) { issueCount nodes { ...pr } }
  mine: search(query: "is:pr is:open archived:false author:@me", type: ISSUE, first: 30) { issueCount nodes { ...pr } }
}
fragment pr on PullRequest {
  number title url isDraft updatedAt mergeable reviewDecision headRefName additions deletions
  repository { nameWithOwner }
  author { login }
  commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 0) {
    checkRunCountsByState { state count }
    statusContextCountsByState { state count }
  } } } } }
}`;

// Check states, as herdr-ranch counts them: SUCCESS, NEUTRAL and SKIPPED pass;
// anything unfinished is running.
const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "STARTUP_FAILURE", "ACTION_REQUIRED"]);
const PASSED = new Set(["SUCCESS", "NEUTRAL", "SKIPPED", "COMPLETED"]);
const RUNNING = new Set(["PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS", "WAITING"]);

export const checks = (rollup) => {
  const out = { failed: 0, running: 0, passed: 0 };
  const contexts = rollup?.contexts ?? {};
  for (const { state, count } of [...(contexts.checkRunCountsByState ?? []), ...(contexts.statusContextCountsByState ?? [])]) {
    if (FAILED.has(state)) out.failed += count;
    else if (RUNNING.has(state)) out.running += count;
    else if (PASSED.has(state)) out.passed += count;
  }
  return out;
};

// Jira keys: "FUMA0001-1308", "LUCY-12". Branches are often lower case, so they
// are matched in upper case; `projects` (the Jira project keys that exist)
// keeps out look-alikes such as UTF-8 or SHA-256. Without it, nothing matches.
const KEY = /\b([A-Z][A-Z0-9]{1,15})-(\d{1,7})\b/g;
export const jiraKeys = (texts, projects) => {
  if (!projects?.size) return [];
  const found = new Set();
  for (const text of texts) {
    for (const m of String(text ?? "").toUpperCase().matchAll(KEY)) {
      if (projects.has(m[1])) found.add(`${m[1]}-${Number(m[2])}`);
    }
  }
  return [...found];
};

export const toPr = (n, section) => ({
  id: `${n.repository?.nameWithOwner}#${n.number}`,
  section,
  number: n.number,
  title: n.title ?? "",
  url: n.url,
  draft: Boolean(n.isDraft),
  updated: Date.parse(n.updatedAt),
  repo: n.repository?.nameWithOwner ?? "",
  author: n.author?.login ?? "",
  branch: n.headRefName ?? "",
  add: n.additions ?? 0,
  del: n.deletions ?? 0,
  review: n.reviewDecision ?? null,
  conflicts: n.mergeable === "CONFLICTING",
  ci: checks(n.commits?.nodes?.[0]?.commit?.statusCheckRollup),
});

// What a PR of yours waits on.
export const groupOf = (pr) => {
  if (pr.section === "review") return "review";
  if (pr.review === "CHANGES_REQUESTED" || pr.ci.failed || pr.conflicts) return "fix";
  if (!pr.draft && pr.review === "APPROVED" && !pr.ci.running) return "ready";
  return "waiting";
};

export const GROUPS = [
  { id: "review", title: "Review requested", empty: "Nothing waits for your review." },
  { id: "fix", title: "Yours to fix" },
  { id: "ready", title: "Ready to merge" },
  { id: "waiting", title: "Waiting" },
];

// Every typed word must match somewhere: title, repo, number, author, branch,
// or a Jira key and its summary. Case is ignored.
export const matches = (pr, words, jira = {}) => {
  if (!words.length) return true;
  const hay = [pr.title, pr.repo, `#${pr.number}`, pr.author, pr.branch,
    ...(pr.keys ?? []).flatMap((k) => [k, jira[k]?.summary ?? ""])].join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
};

export const searchWords = (text) => text.toLowerCase().split(/\s+/).filter(Boolean);

// The groups to draw, each with its rows in order (newest first).
export const grouped = (prs, words, jira) => GROUPS.map((g) => ({
  ...g,
  rows: prs.filter((pr) => groupOf(pr) === g.id && matches(pr, words, jira)).sort((a, b) => b.updated - a.updated),
}));

// acli's search JSON (a list of work items, or an object with them) to
// { KEY: { summary, status, category } }. category: "new" | "indeterminate" | "done".
export const jiraFromAcli = (parsed) => {
  const items = Array.isArray(parsed) ? parsed : parsed?.issues ?? parsed?.workItems ?? parsed?.values ?? [];
  const out = {};
  for (const it of items) {
    const f = it?.fields ?? it ?? {};
    if (!it?.key) continue;
    out[it.key] = {
      summary: f.summary ?? "",
      status: f.status?.name ?? (typeof f.status === "string" ? f.status : ""),
      category: f.status?.statusCategory?.key ?? null,
    };
  }
  return out;
};

export const ago = (ms, now = Date.now()) => {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

export const initials = (login) => (login.match(/[A-Za-z0-9]/g) ?? ["?"]).slice(0, 2).join("").toUpperCase();

// ---- The PR page (gh pr view) ---------------------------------------------

export const PAGE_FIELDS = "title,number,url,state,isDraft,isCrossRepository,author,body,baseRefName,headRefName,additions,deletions,commits,reviewDecision,mergeable,mergeStateStatus,reviews,comments,statusCheckRollup,files,labels,assignees,reviewRequests,latestReviews,createdAt";
export const MARKDOWN_LIMIT = 2000;
export const FILES_LIMIT = 300;

// One check of `gh pr view`'s statusCheckRollup: a CheckRun or a StatusContext.
export const checkOf = (c) => {
  const name = c.__typename === "StatusContext" ? c.context : [c.workflowName, c.name].filter(Boolean).join(" / ");
  const raw = c.__typename === "StatusContext" ? c.state : c.status === "COMPLETED" ? c.conclusion : c.status;
  const state = FAILED.has(raw) ? "failed" : PASSED.has(raw) ? "passed" : "running";
  return { name: name || "check", state, text: String(raw ?? "").toLowerCase().replace(/_/g, " "), url: c.detailsUrl || c.targetUrl || "" };
};
const CHECK_ORDER = { failed: 0, running: 1, passed: 2 };
export const pageChecks = (rollup) => (rollup ?? []).map(checkOf).sort((a, b) => CHECK_ORDER[a.state] - CHECK_ORDER[b.state] || a.name.localeCompare(b.name));

// What blocks or allows the merge, in words, with a tone: "ok" | "warn" | "bad".
export const mergeState = (p) => {
  if (p.state === "MERGED") return { text: "Merged", tone: "ok" };
  if (p.state === "CLOSED") return { text: "Closed without merge", tone: "bad" };
  if (p.mergeable === "CONFLICTING" || p.mergeStateStatus === "DIRTY") return { text: "This branch has conflicts that must be resolved", tone: "bad" };
  if (p.isDraft) return { text: "This pull request is still a draft", tone: "warn" };
  switch (p.mergeStateStatus) {
    case "CLEAN": case "HAS_HOOKS": return { text: "Ready to merge", tone: "ok" };
    case "BEHIND": return { text: "The branch is behind its base", tone: "warn" };
    case "BLOCKED": return { text: "Merging is blocked (reviews or required checks)", tone: "warn" };
    case "UNSTABLE": return { text: "Some checks are not passing", tone: "warn" };
    default: return { text: "Mergeability not known yet", tone: "warn" };
  }
};

export const reviewWord = (state) => ({ APPROVED: "approved", CHANGES_REQUESTED: "changes requested", COMMENTED: "commented", DISMISSED: "dismissed", PENDING: "pending" }[state] ?? String(state ?? "").toLowerCase());

const cap = (text) => {
  const t = String(text ?? "").trim();
  return t.length > MARKDOWN_LIMIT ? `${t.slice(0, MARKDOWN_LIMIT)}\n\n_… cut here: the rest is on GitHub._` : t;
};

// Description first, then comments and reviews by time. A review without text
// is a small line, not a card.
export const timeline = (p) => {
  const items = [
    ...(p.comments ?? []).map((c) => ({ kind: "comment", who: c.author?.login ?? "?", at: Date.parse(c.createdAt), body: cap(c.body) })),
    ...(p.reviews ?? []).map((r) => ({ kind: "review", who: r.author?.login ?? "?", at: Date.parse(r.submittedAt), body: cap(r.body), state: r.state })),
  ].sort((a, b) => a.at - b.at);
  return [{ kind: "description", who: p.author?.login ?? "?", at: Date.parse(p.createdAt), body: cap(p.body) || "_No description._" }, ...items];
};

// Reviewers: the latest verdict per person, then requested people and teams not heard from yet.
export const reviewers = (p) => {
  const out = (p.latestReviews ?? []).map((r) => ({ who: r.author?.login ?? "?", state: r.state }));
  for (const r of p.reviewRequests ?? []) {
    const who = r.login ?? r.name ?? r.slug;
    if (who && !out.some((o) => o.who === who)) out.push({ who, state: "REQUESTED" });
  }
  return out;
};

// ---- Agent review ---------------------------------------------------------

export const MODES = [
  { id: "review", label: "Review", about: "Read only: the agent reviews and reports. No pushes, no GitHub comments.", own: false },
  { id: "address", label: "Address review comments", about: "The agent makes the changes reviewers asked for on a branch of its own, and asks you before it pushes.", own: true },
  { id: "checks", label: "Fix failing checks", about: "The agent finds why checks fail and fixes it on a branch of its own, and asks you before it pushes.", own: true },
];

// Fix modes only for your own PR from this repository (not a fork).
export const modesFor = (pr, mine) => MODES.filter((m) => !m.own || (mine && !pr.isCrossRepository));

// "git@github.com:Owner/Repo.git", "https://github.com/owner/repo" -> "owner/repo".
export const repoOfRemote = (url) => {
  const m = String(url ?? "").trim().match(/github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
};

// The "origin" URL in a .git/config file's text.
export const originOfConfig = (text) => {
  const m = String(text ?? "").match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/);
  return m ? m[1] : null;
};

export const branchFor = (mode, number) => (mode === "review" ? null : `agent/${mode === "address" ? "fix" : "checks"}-${number}`);
export const worktreeName = (mode, number) => (mode === "review" ? `review-${number}` : `agent-${mode === "address" ? "fix" : "checks"}-${number}`);
export const spaceName = (mode, number, repo) => `${mode === "review" ? "review" : mode === "address" ? "fix" : "checks"} #${number} ${repo.split("/").pop()}`;

export const promptFor = (mode, p) => {
  const ref = `pull request #${p.number} in ${p.repo} ("${p.title}", ${p.url})`;
  const read = `Read it first: \`gh pr view ${p.number} --repo ${p.repo} --comments\` and \`gh pr diff ${p.number} --repo ${p.repo}\`.`;
  if (mode === "review") {
    return [
      `Review ${ref}.`,
      `This folder is a git worktree with the PR's head checked out (detached, base: ${p.base}). ${read}`,
      "Build the project and run its tests and linters if it has them, and try the change where you can.",
      "Then report: a short summary of the change, the problems you found ordered by severity with file:line, and your questions for the author.",
      "Do not push, do not comment on GitHub, and do not change the pull request. Report here only.",
    ].join("\n\n");
  }
  const goal = mode === "address"
    ? `Address the review comments on ${ref}. Also read the inline review comments: \`gh api repos/${p.repo}/pulls/${p.number}/comments\`. Make the changes the reviewers asked for; when you disagree with a comment, tell me instead of changing the code.`
    : `Fix the failing checks of ${ref}. See them with \`gh pr checks ${p.number} --repo ${p.repo}\` and the logs with \`gh run view <run-id> --repo ${p.repo} --log-failed\`. Find the cause and fix it; don't hide a failure by skipping or weakening a test.`;
  return [
    goal,
    `This folder is a git worktree on the branch \`${p.branch}\`, made from the PR branch \`${p.head}\`. ${read}`,
    "Run the tests and linters, then commit with clear messages.",
    `Before you push, show me what you changed and ask me. To update the pull request, push with \`git push origin HEAD:${p.head}\`.`,
  ].join("\n\n");
};
