const APP_KEY = "baby-bet-board";
const APP_VERSION = "v2";
const BOARD_KEY_MEMORY_KEY = `${APP_KEY}:${APP_VERSION}:last-board-key`;
const REMOTE_POLL_MS = 15000;
const SAVE_DEBOUNCE_MS = 650;

const appConfig = normalizeConfig(
  typeof window.BABY_BET_CONFIG === "object" && window.BABY_BET_CONFIG
    ? window.BABY_BET_CONFIG
    : {}
);
const boardKey = readBoardKey(appConfig.boardKey);
const storageKey = `${APP_KEY}:${APP_VERSION}:${boardKey || "local"}`;
const remoteConfig =
  boardKey && appConfig.supabaseUrl && appConfig.supabasePublishableKey
    ? {
        supabaseUrl: appConfig.supabaseUrl,
        supabasePublishableKey: appConfig.supabasePublishableKey,
        boardTable: appConfig.boardTable,
        notesTable: appConfig.notesTable,
        boardKey,
      }
    : null;

const state = loadState(storageKey);

const runtime = {
  saveTimer: null,
  boardSyncInFlight: false,
  noteSyncInFlight: 0,
  lastRemoteBoardSignature: "",
  lastRemoteNotesSignature: "",
  pollTimer: null,
};

const els = {
  predictedDate: document.getElementById("predictedDate"),
  predictedName: document.getElementById("predictedName"),
  predictionNote: document.getElementById("predictionNote"),
  stake: document.getElementById("stake"),
  actualDate: document.getElementById("actualDate"),
  actualName: document.getElementById("actualName"),
  resultNote: document.getElementById("resultNote"),
  noteInput: document.getElementById("noteInput"),
  timeline: document.getElementById("timeline"),
  statusPill: document.getElementById("statusPill"),
  countdownValue: document.getElementById("countdownValue"),
  countdownLabel: document.getElementById("countdownLabel"),
  syncStatus: document.getElementById("syncStatus"),
  predictedDateStat: document.getElementById("predictedDateStat"),
  predictedNameStat: document.getElementById("predictedNameStat"),
  resultStat: document.getElementById("resultStat"),
  dateMatch: document.getElementById("dateMatch"),
  nameMatch: document.getElementById("nameMatch"),
  daysOff: document.getElementById("daysOff"),
  seedSample: document.getElementById("seedSample"),
  markArrived: document.getElementById("markArrived"),
  addNote: document.getElementById("addNote"),
  copySummary: document.getElementById("copySummary"),
};

bootstrap();

function bootstrap() {
  bindFormInputs();
  bindActions();
  syncInputs();
  render();

  if (remoteConfig) {
    setSyncStatus("Connecting to shared board...", "connecting");
    void hydrateFromBackend();
    runtime.pollTimer = window.setInterval(() => {
      void refreshFromBackend();
    }, REMOTE_POLL_MS);
  } else if (boardKey) {
    setSyncStatus("Local cache only until Supabase is configured.", "local");
  } else {
    setSyncStatus("Open an invite link to join the shared board.", "local");
  }
}

function createDefaultState() {
  return {
    predictedDate: "",
    predictedName: "",
    predictionNote: "",
    stake: "",
    actualDate: "",
    actualName: "",
    resultNote: "",
    notes: [],
  };
}

function loadState(key) {
  try {
    const stored = safeGetItem(key);
    if (!stored) return createDefaultState();
    return normalizeState(JSON.parse(stored));
  } catch {
    return createDefaultState();
  }
}

function saveState() {
  safeSetItem(storageKey, JSON.stringify(state));
}

function bindFormInputs() {
  const pairs = [
    ["predictedDate", "predictedDate"],
    ["predictedName", "predictedName"],
    ["predictionNote", "predictionNote"],
    ["stake", "stake"],
    ["actualDate", "actualDate"],
    ["actualName", "actualName"],
    ["resultNote", "resultNote"],
  ];

  for (const [field, key] of pairs) {
    els[field].value = state[key] ?? "";
    els[field].addEventListener("input", () => {
      state[key] = els[field].value;
      saveState();
      scheduleBoardSync();
      render();
    });
  }
}

function bindActions() {
  els.seedSample.addEventListener("click", () => {
    Object.assign(state, {
      predictedDate: nextFriday(),
      predictedName: "Mila",
      predictionNote: "Strong feeling about a weekend arrival and a short, soft name.",
      stake: "Dinner on the line",
      actualDate: "",
      actualName: "",
      resultNote: "",
    });

    syncInputs();
    saveState();
    render();
    void flushBoardSync();
  });

  els.markArrived.addEventListener("click", () => {
    if (!state.actualDate) {
      state.actualDate = todayIso();
      els.actualDate.value = state.actualDate;
    }
    if (!state.actualName && state.predictedName) {
      state.actualName = state.predictedName;
      els.actualName.value = state.actualName;
    }

    addTimelineNote("Arrival marked in the tracker.", { immediate: true });
    saveState();
    render();
    void flushBoardSync();
  });

  els.addNote.addEventListener("click", () => {
    const text = els.noteInput.value.trim();
    if (!text) return;
    addTimelineNote(text, { immediate: true });
    els.noteInput.value = "";
  });

  els.noteInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      els.addNote.click();
    }
  });

  els.copySummary.addEventListener("click", async () => {
    const text = buildSummary();
    try {
      await navigator.clipboard.writeText(text);
      els.copySummary.textContent = "Copied";
      window.setTimeout(() => {
        els.copySummary.textContent = "Copy summary";
      }, 1200);
    } catch {
      alert(text);
    }
  });
}

function syncInputs() {
  els.predictedDate.value = state.predictedDate ?? "";
  els.predictedName.value = state.predictedName ?? "";
  els.predictionNote.value = state.predictionNote ?? "";
  els.stake.value = state.stake ?? "";
  els.actualDate.value = state.actualDate ?? "";
  els.actualName.value = state.actualName ?? "";
  els.resultNote.value = state.resultNote ?? "";
}

function render() {
  renderStats();
  renderSummary();
  renderTimeline();
  saveState();
}

function renderStats() {
  const now = new Date();
  const predicted = parseDate(state.predictedDate);
  const actual = parseDate(state.actualDate);

  els.predictedDateStat.textContent = formatDate(state.predictedDate) || "Not set";
  els.predictedNameStat.textContent = state.predictedName || "Not set";

  const hasPredicted = Boolean(predicted);
  const hasActual = Boolean(actual);
  const nameMatch = compareNames(state.predictedName, state.actualName);
  const daysDiff = hasPredicted && hasActual ? differenceInDays(actual, predicted) : null;

  let status = "Waiting for your predictions";
  if (hasPredicted && !hasActual) {
    status = "Prediction locked in";
  } else if (hasPredicted && hasActual && nameMatch && daysDiff === 0) {
    status = "Perfect hit";
  } else if (hasPredicted && hasActual) {
    status = "Outcome recorded";
  }

  els.statusPill.textContent = status;
  els.resultStat.textContent = hasActual ? resultLabel(nameMatch, daysDiff) : "Waiting on arrival";
  els.dateMatch.textContent = hasActual
    ? daysDiff === 0
      ? "Exact match"
      : daysDiff > 0
        ? `${daysDiff} day${daysDiff === 1 ? "" : "s"} later`
        : `${Math.abs(daysDiff)} day${Math.abs(daysDiff) === 1 ? "" : "s"} early`
    : "No actual date yet";
  els.nameMatch.textContent = hasActual
    ? nameMatch
      ? "Exact match"
      : "Different name"
    : "No actual name yet";
  els.daysOff.textContent =
    hasActual && hasPredicted ? `${Math.abs(daysDiff)} day${Math.abs(daysDiff) === 1 ? "" : "s"}` : "--";

  if (hasPredicted && !hasActual) {
    const msRemaining = predicted.getTime() - now.getTime();
    const daysRemaining = Math.round(msRemaining / 86400000);
    els.countdownValue.textContent = `${Math.abs(daysRemaining)}`;
    els.countdownLabel.textContent =
      msRemaining >= 0
        ? `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} to the predicted date.`
        : `${Math.abs(daysRemaining)} day${Math.abs(daysRemaining) === 1 ? "" : "s"} past the predicted date.`;
  } else if (hasActual) {
    els.countdownValue.textContent = "Done";
    els.countdownLabel.textContent = "The result has been entered and saved.";
  } else {
    els.countdownValue.textContent = "--";
    els.countdownLabel.textContent = "Set a predicted date to start the countdown.";
  }
}

function renderSummary() {
  const details = [];
  if (state.predictionNote) details.push(state.predictionNote);
  if (state.stake) details.push(`Stake: ${state.stake}`);
  if (state.resultNote) details.push(state.resultNote);

  els.resultStat.title = details.join("\n");
}

function renderTimeline() {
  els.timeline.innerHTML = "";
  const entries = [...(state.notes ?? [])].sort((a, b) => new Date(b.time) - new Date(a.time));

  if (entries.length === 0) {
    const li = document.createElement("li");
    li.className = "timeline-empty";
    li.textContent = "No notes yet. Add the first update.";
    els.timeline.appendChild(li);
    return;
  }

  for (const entry of entries) {
    const li = document.createElement("li");
    const time = document.createElement("time");
    const text = document.createElement("p");
    time.dateTime = entry.time;
    time.textContent = formatTimestamp(entry.time);
    text.textContent = entry.text;
    li.append(time, text);
    els.timeline.appendChild(li);
  }
}

function addTimelineNote(text, { immediate = false } = {}) {
  const note = {
    time: new Date().toISOString(),
    text: text.trim(),
  };

  if (!note.text) return;

  state.notes = [note, ...(state.notes ?? [])];
  saveState();
  renderTimeline();
  setSyncStatus(remoteConfig ? "Saving note..." : "Local cache only", remoteConfig ? "saving" : "local");

  if (remoteConfig && immediate) {
    void syncNoteNow(note);
  }
}

function buildSummary() {
  const lines = [
    "Baby bet tracker summary",
    `Predicted date: ${formatDate(state.predictedDate) || "Not set"}`,
    `Predicted name: ${state.predictedName || "Not set"}`,
    `Actual date: ${formatDate(state.actualDate) || "Not set"}`,
    `Actual name: ${state.actualName || "Not set"}`,
    `Outcome: ${els.resultStat.textContent}`,
  ];

  if (state.stake) lines.push(`Stake: ${state.stake}`);
  if (state.predictionNote) lines.push(`Prediction note: ${state.predictionNote}`);
  if (state.resultNote) lines.push(`Result note: ${state.resultNote}`);

  return lines.join("\n");
}

async function hydrateFromBackend() {
  if (!remoteConfig) return;

  try {
    const snapshot = await loadRemoteSnapshot();
    const localSnapshot = normalizeState(state);
    if (snapshot.board) {
      applyRemoteSnapshot(snapshot.board, snapshot.notes);
      runtime.lastRemoteBoardSignature = boardSignature(snapshot.board);
      runtime.lastRemoteNotesSignature = notesSignature(snapshot.notes);
      setSyncStatus("Shared board synced", "synced");

      if (localSnapshot.notes.length > 0 && snapshot.notes.length === 0) {
        await seedRemoteNotesFromLocal(localSnapshot.notes);
        const refreshed = await loadRemoteSnapshot();
        if (refreshed.board) {
          applyRemoteSnapshot(refreshed.board, refreshed.notes);
          runtime.lastRemoteBoardSignature = boardSignature(refreshed.board);
          runtime.lastRemoteNotesSignature = notesSignature(refreshed.notes);
          setSyncStatus("Shared notes synced", "synced");
        }
      }
      return;
    }

    if (hasMeaningfulLocalState()) {
      await seedRemoteStateFromLocal();
      const seeded = await loadRemoteSnapshot();
      if (seeded.board) {
        applyRemoteSnapshot(seeded.board, seeded.notes);
        runtime.lastRemoteBoardSignature = boardSignature(seeded.board);
        runtime.lastRemoteNotesSignature = notesSignature(seeded.notes);
        setSyncStatus("Shared board created", "synced");
        return;
      }
    }

    setSyncStatus("Shared board ready", "synced");
  } catch (error) {
    console.warn("Shared sync unavailable", error);
    setSyncStatus("Local cache only", "offline");
  }
}

async function refreshFromBackend() {
  if (!remoteConfig) return;
  if (runtime.saveTimer || runtime.boardSyncInFlight || runtime.noteSyncInFlight > 0) return;

  try {
    const snapshot = await loadRemoteSnapshot();
    if (!snapshot.board) return;

    const boardSig = boardSignature(snapshot.board);
    const notesSig = notesSignature(snapshot.notes);
    if (
      boardSig !== runtime.lastRemoteBoardSignature ||
      notesSig !== runtime.lastRemoteNotesSignature
    ) {
      applyRemoteSnapshot(snapshot.board, snapshot.notes);
      runtime.lastRemoteBoardSignature = boardSig;
      runtime.lastRemoteNotesSignature = notesSig;
      setSyncStatus("Shared board updated", "synced");
    }
  } catch {
    setSyncStatus("Shared board unavailable right now", "offline");
  }
}

function applyRemoteSnapshot(boardRow, noteRows) {
  Object.assign(state, normalizeBoardLike(boardRow));
  state.notes = normalizeNotes(noteRows);
  syncInputs();
  render();
}

async function seedRemoteStateFromLocal() {
  if (!remoteConfig) return;
  await upsertBoardRow(state);
  if (state.notes.length > 0) {
    await insertNotes(state.notes);
  }
}

async function seedRemoteNotesFromLocal(notes) {
  if (!remoteConfig || !Array.isArray(notes) || notes.length === 0) return;
  await insertNotes(notes);
}

function scheduleBoardSync() {
  if (!remoteConfig) {
    setSyncStatus("Local cache only", "local");
    return;
  }

  window.clearTimeout(runtime.saveTimer);
  runtime.saveTimer = window.setTimeout(() => {
    runtime.saveTimer = null;
    void syncBoardNow();
  }, SAVE_DEBOUNCE_MS);
  setSyncStatus("Saving shared board...", "saving");
}

function flushBoardSync() {
  if (!remoteConfig) return Promise.resolve();
  window.clearTimeout(runtime.saveTimer);
  runtime.saveTimer = null;
  return syncBoardNow();
}

async function syncBoardNow() {
  if (!remoteConfig) return;

  runtime.boardSyncInFlight = true;
  setSyncStatus("Saving shared board...", "saving");

  try {
    await upsertBoardRow(state);
    runtime.lastRemoteBoardSignature = boardSignature(state);
    setSyncStatus("Shared board synced", "synced");
  } catch (error) {
    console.warn("Board sync failed", error);
    setSyncStatus("Shared board saved locally; retrying in the background.", "offline");
  } finally {
    runtime.boardSyncInFlight = false;
  }
}

async function syncNoteNow(note) {
  if (!remoteConfig) return;

  runtime.noteSyncInFlight += 1;
  try {
    await insertNote(note);
    runtime.lastRemoteNotesSignature = notesSignature(state.notes);
    setSyncStatus("Shared note synced", "synced");
  } catch (error) {
    console.warn("Note sync failed", error);
    setSyncStatus("Shared note saved locally; retrying in the background.", "offline");
  } finally {
    runtime.noteSyncInFlight = Math.max(0, runtime.noteSyncInFlight - 1);
  }
}

async function loadRemoteSnapshot() {
  const [boardRows, noteRows] = await Promise.all([fetchBoardRow(), fetchNotes()]);
  return {
    board: boardRows[0] ?? null,
    notes: Array.isArray(noteRows) ? noteRows : [],
  };
}

async function fetchBoardRow() {
  const url = buildTableUrl(remoteConfig.boardTable);
  url.searchParams.set(
    "select",
    "board_key,predicted_date,predicted_name,prediction_note,stake,actual_date,actual_name,result_note,updated_at"
  );
  url.searchParams.set("board_key", `eq.${remoteConfig.boardKey}`);
  url.searchParams.set("limit", "1");

  const rows = await requestSupabase(url);
  return Array.isArray(rows) ? rows : [];
}

async function fetchNotes() {
  const url = buildTableUrl(remoteConfig.notesTable);
  url.searchParams.set("select", "id,board_key,created_at,text");
  url.searchParams.set("board_key", `eq.${remoteConfig.boardKey}`);
  url.searchParams.set("order", "created_at.asc");

  const rows = await requestSupabase(url);
  return Array.isArray(rows) ? rows : [];
}

async function upsertBoardRow(boardState) {
  const payload = {
    board_key: remoteConfig.boardKey,
    predicted_date: boardState.predictedDate ?? "",
    predicted_name: boardState.predictedName ?? "",
    prediction_note: boardState.predictionNote ?? "",
    stake: boardState.stake ?? "",
    actual_date: boardState.actualDate ?? "",
    actual_name: boardState.actualName ?? "",
    result_note: boardState.resultNote ?? "",
    updated_at: new Date().toISOString(),
  };

  return requestSupabase(`${buildTableUrl(remoteConfig.boardTable).toString()}?on_conflict=board_key`, {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=representation",
    body: payload,
  });
}

async function insertNotes(notes) {
  for (const note of notes) {
    await insertNote(note);
  }
}

async function insertNote(note) {
  const payload = {
    board_key: remoteConfig.boardKey,
    created_at: note.time,
    text: note.text,
  };

  return requestSupabase(buildTableUrl(remoteConfig.notesTable), {
    method: "POST",
    prefer: "return=representation",
    body: payload,
  });
}

async function requestSupabase(url, { method = "GET", body, prefer } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      apikey: remoteConfig.supabasePublishableKey,
      Authorization: `Bearer ${remoteConfig.supabasePublishableKey}`,
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Supabase request failed (${response.status}): ${text.slice(0, 200)}`);
  }

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Supabase response was not valid JSON: ${String(error)}`);
  }
}

function buildTableUrl(tableName) {
  return new URL(`${remoteConfig.supabaseUrl}/rest/v1/${encodeURIComponent(tableName)}`);
}

function setSyncStatus(message, tone = "local") {
  if (!els.syncStatus) return;
  els.syncStatus.textContent = message;
  els.syncStatus.dataset.tone = tone;
}

function boardSignature(boardRow) {
  const normalized = normalizeBoardLike(boardRow);
  return JSON.stringify(normalized);
}

function notesSignature(notes) {
  return JSON.stringify(normalizeNotes(notes));
}

function hasMeaningfulLocalState() {
  return [
    state.predictedDate,
    state.predictedName,
    state.predictionNote,
    state.stake,
    state.actualDate,
    state.actualName,
    state.resultNote,
    ...(state.notes ?? []).map((note) => note.text),
  ].some((value) => Boolean(value && String(value).trim()));
}

function normalizeState(raw) {
  const stateLike = raw && typeof raw === "object" ? raw : {};
  return {
    predictedDate: toText(stateLike.predictedDate),
    predictedName: toText(stateLike.predictedName),
    predictionNote: toText(stateLike.predictionNote),
    stake: toText(stateLike.stake),
    actualDate: toText(stateLike.actualDate),
    actualName: toText(stateLike.actualName),
    resultNote: toText(stateLike.resultNote),
    notes: normalizeNotes(stateLike.notes),
  };
}

function normalizeBoardLike(raw) {
  const row = raw && typeof raw === "object" ? raw : {};
  return {
    predictedDate: toText(row.predicted_date ?? row.predictedDate),
    predictedName: toText(row.predicted_name ?? row.predictedName),
    predictionNote: toText(row.prediction_note ?? row.predictionNote),
    stake: toText(row.stake ?? row.stake),
    actualDate: toText(row.actual_date ?? row.actualDate),
    actualName: toText(row.actual_name ?? row.actualName),
    resultNote: toText(row.result_note ?? row.resultNote),
  };
}

function normalizeNotes(rawNotes) {
  const notes = Array.isArray(rawNotes) ? rawNotes : [];
  return notes
    .map((note) => {
      const time = toText(note?.time || note?.created_at || note?.createdAt);
      return {
        time: time || new Date().toISOString(),
        text: toText(note?.text),
      };
    })
    .filter((note) => note.text.trim().length > 0)
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
}

function normalizeConfig(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    supabaseUrl: toText(source.supabaseUrl).trim().replace(/\/$/, ""),
    supabasePublishableKey: toText(source.supabasePublishableKey).trim(),
    boardTable: toText(source.boardTable).trim() || "baby_bet_board",
    notesTable: toText(source.notesTable).trim() || "baby_bet_notes",
    boardKey: toText(source.boardKey).trim(),
  };
}

function readBoardKey(defaultKey = "") {
  try {
    const fromUrl = readBoardKeyFromUrl();
    if (fromUrl) {
      safeSetItem(BOARD_KEY_MEMORY_KEY, fromUrl);
      return fromUrl;
    }

    const remembered = safeGetItem(BOARD_KEY_MEMORY_KEY);
    if (remembered) return remembered;

    if (defaultKey) {
      safeSetItem(BOARD_KEY_MEMORY_KEY, defaultKey);
      return defaultKey;
    }
  } catch {
    return defaultKey;
  }

  return defaultKey;
}

function readBoardKeyFromUrl() {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return hash.get("board") || query.get("board") || "";
}

function safeGetItem(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures and keep the app functional.
  }
}

function toText(value) {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

function resultLabel(nameMatch, daysDiff) {
  if (nameMatch && daysDiff === 0) return "Perfect hit";
  if (nameMatch && daysDiff !== 0) return "Name right, date off";
  if (!nameMatch && daysDiff === 0) return "Date right, name off";
  return "Both off";
}

function compareNames(a, b) {
  return normalizeName(a) !== "" && normalizeName(a) === normalizeName(b);
}

function normalizeName(value) {
  return (value ?? "").trim().toLowerCase();
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function differenceInDays(a, b) {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcA - utcB) / 86400000);
}

function formatDate(value) {
  if (!value) return "";
  const date = parseDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Now";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function nextFriday() {
  const date = new Date();
  const current = date.getDay();
  const offset = (5 - current + 7) % 7 || 7;
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}
