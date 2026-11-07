// Pure logic for the Issues panel: no `herdr` imports, so Node can test it.
// Ideas from herdr-ranch-issues (MIT, jslowack), written again as a
// cross-project inbox that reads Jira through acli (no tokens here).

// acli's search returns only these fields (it refuses updated, created,
// project, parent...), so rows have no age: JQL sorts them by last change.
export const JIRA_FIELDS = "key,summary,status,issuetype,priority";
export const JIRA_LIMIT = 100;

const BASE = "assignee = currentUser() AND statusCategory != Done";
export const FILTERS = [
  { id: "recent", label: "Recent", jql: `${BASE} AND updated >= -30d ORDER BY updated DESC`, hint: "Changed in the last 30 days" },
  { id: "progress", label: "In progress", jql: "assignee = currentUser() AND statusCategory = \"In Progress\" ORDER BY updated DESC", hint: "In progress" },
  { id: "all", label: "All open", jql: `${BASE} ORDER BY updated DESC`, hint: "All open" },
];
export const filterOf = (id) => FILTERS.find((f) => f.id === id) ?? FILTERS[0];

export const GITHUB_QUERY = `query {
  issues: search(query: "is:issue is:open archived:false assignee:@me sort:updated-desc", type: ISSUE, first: 50) {
    issueCount
    nodes { ... on Issue { number title url updatedAt repository { nameWithOwner } issueType { name } labels(first: 10) { nodes { name } } } }
  }
}`;

const PRIORITY = { Highest: 0, Blocker: 0, Critical: 1, High: 1, Major: 2, Medium: 2, Minor: 3, Low: 3, Lowest: 4, Trivial: 4 };
export const priorityRank = (name) => PRIORITY[name] ?? 5;

// acli's search JSON (a list of work items) to rows, in the order Jira sent.
export const fromAcli = (parsed) => (Array.isArray(parsed) ? parsed : parsed?.issues ?? []).filter((it) => it?.key).map((it, order) => {
  const f = it.fields ?? {};
  return {
    source: "jira",
    id: it.key,
    key: it.key,
    title: f.summary ?? "",
    status: f.status?.name ?? "",
    category: f.status?.statusCategory?.key ?? "new", // "new" | "indeterminate" | "done"
    type: f.issuetype?.name ?? "",
    priority: f.priority?.name ?? "",
    order,
  };
});

const BUG = /^(bug|type: ?bug|kind\/bug)$/i;
export const fromGithub = (nodes) => (nodes ?? []).filter(Boolean).map((n, order) => {
  const labels = (n.labels?.nodes ?? []).map((l) => l.name);
  return {
    source: "github",
    id: `${n.repository?.nameWithOwner}#${n.number}`,
    key: `${(n.repository?.nameWithOwner ?? "").split("/").pop()} #${n.number}`,
    title: n.title ?? "",
    url: n.url,
    status: "Open",
    category: "new",
    type: n.issueType?.name ?? (labels.some((l) => BUG.test(l)) ? "Bug" : "Issue"),
    priority: "",
    labels,
    updated: Date.parse(n.updatedAt),
    order,
  };
});

export const GROUPS = [
  { id: "progress", title: "In progress" },
  { id: "todo", title: "To do" },
  { id: "github", title: "GitHub" },
];
export const groupOf = (it) => (it.source === "github" ? "github" : it.category === "indeterminate" ? "progress" : "todo");

export const searchWords = (text) => text.toLowerCase().split(/\s+/).filter(Boolean);
export const matches = (it, words) => {
  if (!words.length) return true;
  const hay = [it.key, it.title, it.status, it.type, it.priority, ...(it.labels ?? [])].join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
};

// Jira groups: priority first, then the order Jira sent (last change first).
export const grouped = (items, words) => GROUPS.map((g) => ({
  ...g,
  rows: items.filter((it) => groupOf(it) === g.id && matches(it, words))
    .sort((a, b) => (g.id === "github" ? a.order - b.order : priorityRank(a.priority) - priorityRank(b.priority) || a.order - b.order)),
}));

// "Bug" -> a letter and a theme color name, like a Jira type icon.
export const typeMark = (type) => {
  const t = type.toLowerCase();
  if (t.includes("bug")) return { letter: "B", color: "ansi1" };
  if (t.includes("sub")) return { letter: "↳", color: "ansi4" };
  if (t.includes("story")) return { letter: "S", color: "ansi2" };
  if (t.includes("epic")) return { letter: "E", color: "ansi5" };
  if (t.includes("task")) return { letter: "T", color: "ansi4" };
  if (t.includes("feature")) return { letter: "F", color: "ansi3" };
  return { letter: "•", color: "muted" };
};

export const priorityColor = (name) => {
  const r = priorityRank(name);
  return r === 0 ? "ansi1" : r === 1 ? "ansi3" : "dim";
};

export const jiraSearchUrl = (site, jql) => `https://${site}/issues/?jql=${encodeURIComponent(jql)}`;

export const ago = (ms, now = Date.now()) => {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};
