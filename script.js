// BountyDesk page script. Owns the desk's data and operations; the assistant's
// site-actions.js wraps these same functions, so the page and the agent share one
// set of rules. No keys, no personal data, no network calls except loading the
// site's own data/*.json files.
export const DATA = { programs: [], checklists: [], findings: [] };

const NOTES_KEY = "bountydesk-notes";
let memoryNotes = [];

function storage() {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch (error) {
    // localStorage may throw (private mode, Node). Fall through to memory.
  }
  return null;
}

function readNotes() {
  const store = storage();
  if (store) {
    try {
      const raw = store.getItem(NOTES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (error) {
      return [];
    }
  }
  return memoryNotes.slice();
}

function writeNotes(notes) {
  const store = storage();
  if (store) {
    try {
      store.setItem(NOTES_KEY, JSON.stringify(notes));
      return;
    } catch (error) {
      // Fall through to memory.
    }
  }
  memoryNotes = notes.slice();
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `note-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/** Load the site's own data files (browser). Tests use setData instead. */
export async function loadData(fetchFn = fetch) {
  const [programs, checklists, findings] = await Promise.all([
    fetchFn("data/programs.json").then((r) => r.json()),
    fetchFn("data/checklists.json").then((r) => r.json()),
    fetchFn("data/findings.json").then((r) => r.json()),
  ]);
  DATA.programs = programs;
  DATA.checklists = checklists;
  DATA.findings = findings;
  return DATA;
}

/** Test hook: put data in directly without fetching. */
export function setData(data) {
  DATA.programs = data.programs || [];
  DATA.checklists = data.checklists || [];
  DATA.findings = data.findings || [];
  return DATA;
}

function getState() {
  const now = new Date();
  return {
    today: now.toISOString().slice(0, 10),
    programs: clone(DATA.programs),
    checklists: DATA.checklists.map((c) => ({ id: c.id, title: c.title, items: c.items.slice() })),
    findings: clone(DATA.findings),
    notes: readNotes(),
    pageFacts: {
      siteName: "BountyDesk",
      agentAtlasUrl: "https://agent-atlas-phi.vercel.app/",
      agentAtlasNetworkUrl: "https://agent-atlas-phi.vercel.app/agent_atlas",
      manifestUrl: "agent-manifest.json",
      awwwUrl: ".well-known/awww.json",
      networkUrl: "bounty_desk.network.json",
    },
  };
}

function programIds() {
  return DATA.programs.map((p) => p.id);
}

function saveNote({ programId, note }) {
  if (typeof programId !== "string" || !DATA.programs.some((p) => p.id === programId)) {
    return { ok: false, reason: "Choose a program from the desk's program table.", field: "programId" };
  }
  if (typeof note !== "string" || !note.trim()) {
    return { ok: false, reason: "Write a note first (up to 500 characters).", field: "note" };
  }
  if (note.length > 500) {
    return { ok: false, reason: "Keep the note to 500 characters or fewer.", field: "note" };
  }
  const notes = readNotes();
  const entry = { id: newId(), programId, note: note.trim(), created: new Date().toISOString().slice(0, 10) };
  notes.push(entry);
  writeNotes(notes);
  renderNotes();
  return { ok: true, note: entry, notes: readNotes() };
}

function deleteNote({ id }) {
  const notes = readNotes();
  const index = notes.findIndex((n) => n.id === id);
  if (index === -1) {
    return { ok: false, reason: "That note is not on your shortlist.", field: "id" };
  }
  notes.splice(index, 1);
  writeNotes(notes);
  renderNotes();
  return { ok: true, notes: readNotes() };
}

// --- Rendering (browser only; no-ops when the elements are absent) ---

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function renderPrograms() {
  const body = document.querySelector("#program-table-body");
  if (!body) return;
  body.replaceChildren();
  for (const p of DATA.programs) {
    const row = document.createElement("tr");
    const name = el("td");
    if (p.url) {
      const link = document.createElement("a");
      link.href = p.url;
      link.textContent = p.name;
      link.target = "_blank";
      link.rel = "noopener";
      name.append(link);
    } else {
      name.textContent = p.name;
    }
    row.append(
      name,
      el("td", p.platform),
      el("td", p.status),
      el("td", p.verdict, `verdict verdict-${p.verdict.toLowerCase()}`),
      el("td", p.rewards),
      el("td", p.gates.join("; ")),
      el("td", p.filing),
    );
    body.append(row);
  }
  const count = document.querySelector("#program-count");
  if (count) count.textContent = `${DATA.programs.length} programs`;
}

function renderChecklists() {
  const list = document.querySelector("#checklist-list");
  if (!list) return;
  list.replaceChildren();
  for (const c of DATA.checklists) {
    const card = el("article", undefined, "checklist-card");
    card.append(el("h3", c.title));
    const items = el("ol");
    for (const item of c.items) items.append(el("li", item));
    card.append(items);
    list.append(card);
  }
}

function renderFindings() {
  const list = document.querySelector("#finding-list");
  if (!list) return;
  list.replaceChildren();
  for (const f of DATA.findings) {
    const card = el("article", undefined, "finding-card");
    card.append(el("h3", f.title));
    card.append(el("p", `${f.program} · ${f.status} · ${f.date}`, "finding-meta"));
    card.append(el("p", f.summary));
    card.append(el("p", `Lesson: ${f.lesson}`, "finding-lesson"));
    list.append(card);
  }
}

function renderNotes() {
  const list = document.querySelector("#shortlist");
  if (!list) return;
  list.replaceChildren();
  const notes = readNotes();
  const empty = document.querySelector("#shortlist-empty");
  if (empty) empty.hidden = notes.length > 0;
  for (const n of notes) {
    const program = DATA.programs.find((p) => p.id === n.programId);
    const item = el("li");
    item.append(el("strong", program ? program.name : n.programId));
    item.append(el("span", ` — ${n.note} `));
    const del = el("button", "Delete", "note-delete");
    del.type = "button";
    del.setAttribute("aria-label", `Delete note for ${program ? program.name : n.programId}`);
    del.addEventListener("click", () => deleteNote({ id: n.id }));
    item.append(del);
    list.append(item);
  }
}

function renderAll() {
  renderPrograms();
  renderChecklists();
  renderFindings();
  renderNotes();
}

export const App = {
  page: {
    getState,
    programIds,
    saveNote,
    deleteNote,
    renderAll,
  },
};

// Browser boot: load data, then render. Module scripts run before
// DOMContentLoaded, so the listener always fires. Node tests import this
// module without a window, so this block never runs there.
if (typeof document !== "undefined" && typeof window !== "undefined") {
  document.addEventListener("DOMContentLoaded", async () => {
    try {
      await loadData();
    } catch (error) {
      console.error("BountyDesk data failed to load", error);
    }
    renderAll();
  });
}
