const APP_KEY = "baby-bet-board";
const APP_VERSION = "v3";
const LEGACY_APP_VERSION = "v2";
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
const legacyStorageKey = `${APP_KEY}:${LEGACY_APP_VERSION}:${boardKey || "local"}`;
const remoteConfig =
  boardKey && appConfig.supabaseUrl && appConfig.supabasePublishableKey
    ? {
        supabaseUrl: appConfig.supabaseUrl,
        supabasePublishableKey: appConfig.supabasePublishableKey,
        boardTable: appConfig.boardTable,
        betsTable: appConfig.betsTable,
        boardKey,
      }
    : null;

const state = loadState();

const runtime = {
  saveTimer: null,
  remoteSyncInFlight: 0,
  lastRemoteSignature: "",
  pollTimer: null,
};

const els = {
  betsCount: document.getElementById("betsCount"),
  syncStatus: document.getElementById("syncStatus"),
  toggleCreate: document.getElementById("toggleCreate"),
  createPanel: document.getElementById("createPanel"),
  createForm: document.getElementById("createForm"),
  cancelCreate: document.getElementById("cancelCreate"),
  predictedName: document.getElementById("predictedName"),
  predictedDate: document.getElementById("predictedDate"),
  guessedBy: document.getElementById("guessedBy"),
  guessTime: document.getElementById("guessTime"),
  betsList: document.getElementById("betsList"),
};

const debugInfo = getSyncDiagnostics();
window.BABY_BET_DEBUG = debugInfo;
console.info("[Baby Bets] boot", debugInfo);

bootstrap();

function bootstrap() {
  bindActions();
  render();
  setInitialStatus();

  if (remoteConfig) {
    setSyncStatus("Connecting to shared list...", "connecting");
    console.info("[Baby Bets] remote sync enabled", {
      boardKeyPresent: Boolean(boardKey),
      supabaseUrlPresent: Boolean(appConfig.supabaseUrl),
      supabasePublishableKeyPresent: Boolean(appConfig.supabasePublishableKey),
      boardTable: remoteConfig.boardTable,
      betsTable: remoteConfig.betsTable,
    });
    void hydrateFromBackend();
    runtime.pollTimer = window.setInterval(() => {
      void refreshFromBackend();
    }, REMOTE_POLL_MS);
  } else {
    console.info("[Baby Bets] remote sync disabled", debugInfo.reason);
  }
}

function bindActions() {
  els.toggleCreate.addEventListener("click", () => {
    toggleCreatePanel();
  });

  els.cancelCreate.addEventListener("click", () => {
    toggleCreatePanel(false);
  });

  els.createForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleCreateSubmit();
  });

  els.betsList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action='open-create']");
    if (button) {
      toggleCreatePanel(true);
    }
  });
}

function handleCreateSubmit() {
  const predictedName = els.predictedName.value.trim();
  const predictedDate = els.predictedDate.value;
  const guessedByField = getCreateField("guessedBy", "stake");
  const guessTimeField = getCreateField("guessTime", "predictionNote");

  if (!guessedByField || !guessTimeField) {
    console.warn("Baby Bets form fields are missing. Please refresh the page and try again.");
    setSyncStatus("Form fields are missing. Please refresh the page and try again.", "error");
    return;
  }

  const guessedBy = guessedByField.value.trim();
  const guessTime = guessTimeField.value.trim();

  if (!predictedName) {
    els.predictedName.focus();
    return;
  }

  if (!guessedBy) {
    guessedByField.focus();
    return;
  }

  if (!guessTime) {
    guessTimeField.focus();
    return;
  }

  const bet = normalizeBetLike({
    id: generateBetId(),
    createdAt: new Date().toISOString(),
    predictedName,
    predictedDate,
    guessedBy,
    guessTime,
  });

  state.bets = [bet, ...state.bets.filter((entry) => entry.id !== bet.id)];
  saveState();
  render();

  els.createForm.reset();
  toggleCreatePanel(false);
  void syncBetNow(bet);
}

function getCreateField(...candidateIds) {
  for (const candidateId of candidateIds) {
    const field = document.getElementById(candidateId);
    if (field) return field;
  }

  return null;
}

function toggleCreatePanel(forceOpen) {
  const open = typeof forceOpen === "boolean" ? forceOpen : els.createPanel.hidden;
  els.createPanel.hidden = !open;
  els.toggleCreate.setAttribute("aria-expanded", String(open));
  els.toggleCreate.textContent = open ? "Close" : "Create";

  if (open) {
    window.requestAnimationFrame(() => {
      els.predictedName.focus();
    });
  }
}

function setInitialStatus() {
  if (remoteConfig) return;
  if (state.bets.length > 0) {
    setSyncStatus("Saved locally on this device.", "synced");
    return;
  }

  setSyncStatus(
    boardKey ? "Create the first bet to start the shared list." : "Create the first bet to start the list.",
    "local"
  );
}

function render() {
  renderHeader();
  renderBets();
  saveState();
}

function renderHeader() {
  if (!els.betsCount) return;
  const count = state.bets.length;
  els.betsCount.textContent = `${count} bet${count === 1 ? "" : "s"}`;
}

function renderBets() {
  const bets = [...state.bets].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  els.betsList.innerHTML = "";

  if (bets.length === 0) {
    els.betsList.appendChild(renderEmptyState());
    return;
  }

  for (const bet of bets) {
    els.betsList.appendChild(renderBetRow(bet));
  }
}

function renderEmptyState() {
  const tr = document.createElement("tr");
  tr.className = "empty-state-row";

  const td = document.createElement("td");
  td.colSpan = 5;
  td.className = "empty-state-cell";

  const wrap = document.createElement("div");
  wrap.className = "empty-state";

  const title = document.createElement("p");
  title.className = "empty-title";
  title.textContent = "No bets yet";

  const copy = document.createElement("p");
  copy.className = "empty-copy";
  copy.textContent = "Hit Create to add the first one. The list stays compact and easy to scan.";

  const button = document.createElement("button");
  button.className = "empty-action";
  button.type = "button";
  button.textContent = "Create a bet";
  button.dataset.action = "open-create";

  wrap.append(title, copy, button);
  td.append(wrap);
  tr.append(td);
  return tr;
}

function renderBetRow(bet) {
  const tr = document.createElement("tr");
  tr.className = "bet-row";

  tr.append(
    createCell(bet.predictedName || "Untitled bet", "bet-name-cell"),
    createCell(formatDate(bet.predictedDate) || "—", "bet-muted-cell"),
    createCell(bet.guessedBy || "—", "bet-muted-cell"),
    createCell(bet.guessTime || "—", "bet-muted-cell"),
    createCell(formatTimestamp(bet.createdAt) || "—", "bet-muted-cell")
  );

  return tr;
}

function createCell(text, className) {
  const td = document.createElement("td");
  if (className) {
    td.className = className;
  }
  td.textContent = text;
  return td;
}

function createDefaultState() {
  return {
    bets: [],
  };
}

function loadState() {
  const current = readStateFromKey(storageKey);
  if (current && current.bets.length > 0) {
    return current;
  }

  const legacy = readStateFromKey(legacyStorageKey);
  if (legacy && legacy.bets.length > 0) {
    safeSetItem(storageKey, JSON.stringify(legacy));
    return legacy;
  }

  return current || legacy || createDefaultState();
}

function readStateFromKey(key) {
  try {
    const raw = safeGetItem(key);
    if (!raw) return null;
    return normalizeState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function saveState() {
  safeSetItem(storageKey, JSON.stringify(normalizeState(state)));
}

function normalizeState(raw) {
  const source = raw && typeof raw === "object" ? raw : {};

  if (Array.isArray(source.bets)) {
    return {
      bets: normalizeBets(source.bets),
    };
  }

  if (hasLegacyBetShape(source)) {
    return {
      bets: [normalizeLegacyBet(source)],
    };
  }

  return createDefaultState();
}

function hasLegacyBetShape(source) {
  return [
    source.predictedDate,
    source.predicted_date,
    source.predictedName,
    source.predicted_name,
    source.predictionNote,
    source.prediction_note,
    source.stake,
    source.guessedBy,
    source.guessed_by,
    source.guessTime,
    source.guess_time,
    source.actualDate,
    source.actual_date,
    source.actualName,
    source.actual_name,
    source.resultNote,
    source.result_note,
    source.updated_at,
    source.createdAt,
    source.created_at,
    source.board_key,
  ].some((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function normalizeBets(rawBets) {
  const bets = Array.isArray(rawBets) ? rawBets : [];
  const map = new Map();

  for (const rawBet of bets) {
    const bet = normalizeBetLike(rawBet);
    if (!hasMeaningfulBetData(bet)) continue;
    map.set(bet.id, bet);
  }

  return [...map.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function normalizeBetLike(raw, fallbackId = generateBetId()) {
  const row = raw && typeof raw === "object" ? raw : {};
  return {
    id: toText(row.id).trim() || fallbackId,
    createdAt:
      toText(row.createdAt ?? row.created_at ?? row.updated_at).trim() ||
      new Date().toISOString(),
    predictedDate: toText(row.predictedDate ?? row.predicted_date).trim(),
    predictedName: toText(row.predictedName ?? row.predicted_name).trim(),
    guessedBy: toText(row.guessedBy ?? row.guessed_by).trim(),
    guessTime: toText(row.guessTime ?? row.guess_time).trim(),
    actualDate: toText(row.actualDate ?? row.actual_date).trim(),
    actualName: toText(row.actualName ?? row.actual_name).trim(),
    resultNote: toText(row.resultNote ?? row.result_note).trim(),
  };
}

function normalizeLegacyBet(raw) {
  return normalizeBetLike(raw, legacyBetId());
}

function hasMeaningfulBetData(bet) {
  return [
    bet.predictedDate,
    bet.predictedName,
    bet.guessedBy,
    bet.guessTime,
    bet.actualDate,
    bet.actualName,
    bet.resultNote,
  ].some((value) => Boolean(value && String(value).trim()));
}

async function hydrateFromBackend() {
  if (!remoteConfig) return;

  beginRemoteSync();
  try {
    const snapshot = await loadRemoteSnapshot();
    const remoteBets = normalizeBets(snapshot.bets);
    const merged = mergeBets(state.bets, remoteBets);
    const mergedSignature = betsSignature(merged);
    const localSignature = betsSignature(state.bets);

    if (mergedSignature !== localSignature) {
      state.bets = merged;
      saveState();
      render();
    }

    runtime.lastRemoteSignature = betsSignature(remoteBets);

    if (snapshot.board && remoteBets.length === 0) {
      const legacy = normalizeLegacyBet(snapshot.board);
      if (hasMeaningfulBetData(legacy)) {
        const afterLegacy = mergeBets(state.bets, [legacy]);
        if (betsSignature(afterLegacy) !== betsSignature(state.bets)) {
          state.bets = afterLegacy;
          saveState();
          render();
        }
        await seedRemoteBetsFromLocal([legacy]);
        runtime.lastRemoteSignature = "";
        setSyncStatus("Legacy board migrated into the list.", "synced");
        return;
      }
    }

    const localOnly = findLocalOnlyBets(state.bets, remoteBets);
    if (localOnly.length > 0) {
      await seedRemoteBetsFromLocal(localOnly);
      setSyncStatus("Shared list synced", "synced");
      return;
    }

    setSyncStatus(remoteBets.length > 0 ? "Shared list synced" : "Shared list ready", "synced");
  } catch (error) {
    console.warn("Shared sync unavailable", error, debugInfo);
    setSyncStatus("Local list only for now.", "offline");
  } finally {
    endRemoteSync();
  }
}

async function refreshFromBackend() {
  if (!remoteConfig) return;
  if (runtime.saveTimer || isRemoteBusy()) return;

  beginRemoteSync();
  try {
    const snapshot = await loadRemoteSnapshot();
    const remoteBets = normalizeBets(snapshot.bets);
    const remoteSignature = betsSignature(remoteBets);
    const merged = mergeBets(state.bets, remoteBets);
    const mergedSignature = betsSignature(merged);
    const localSignature = betsSignature(state.bets);

    if (mergedSignature !== localSignature) {
      state.bets = merged;
      saveState();
      render();
      setSyncStatus("Shared list updated", "synced");
    }

    const localOnly = findLocalOnlyBets(state.bets, remoteBets);
    if (localOnly.length > 0) {
      await seedRemoteBetsFromLocal(localOnly);
      setSyncStatus("Shared list synced", "synced");
    }

    runtime.lastRemoteSignature = remoteSignature;
  } catch {
    setSyncStatus("Shared list unavailable right now.", "offline");
  } finally {
    endRemoteSync();
  }
}

function mergeBets(primary, secondary) {
  const combined = new Map();

  for (const bet of normalizeBets(primary)) {
    combined.set(bet.id, bet);
  }

  for (const bet of normalizeBets(secondary)) {
    combined.set(bet.id, bet);
  }

  return [...combined.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function findLocalOnlyBets(localBets, remoteBets) {
  const remoteIds = new Set(normalizeBets(remoteBets).map((bet) => bet.id));
  return normalizeBets(localBets).filter((bet) => !remoteIds.has(bet.id));
}

async function seedRemoteBetsFromLocal(bets) {
  if (!remoteConfig || !Array.isArray(bets) || bets.length === 0) return;

  beginRemoteSync();
  try {
    for (const bet of bets) {
      await upsertRemoteBet(bet);
    }
  } finally {
    endRemoteSync();
  }
}

async function syncBetNow(bet) {
  if (!remoteConfig) {
    console.info("[Baby Bets] local-only save", debugInfo.reason);
    setSyncStatus("Saved locally on this device.", "synced");
    return;
  }

  beginRemoteSync();
  try {
    setSyncStatus("Saving bet...", "saving");
    console.info("[Baby Bets] upserting bet", {
      betId: bet.id,
      boardKey: remoteConfig.boardKey,
      supabaseUrl: remoteConfig.supabaseUrl,
      table: remoteConfig.betsTable,
    });
    await upsertRemoteBet(bet);
    runtime.lastRemoteSignature = "";
    setSyncStatus("Shared list synced", "synced");
  } catch (error) {
    console.warn("Bet sync failed", error);
    setSyncStatus("Saved locally. Will retry when the connection is back.", "offline");
  } finally {
    endRemoteSync();
  }
}

async function loadRemoteSnapshot() {
  const [bets, boardRows] = await Promise.all([
    fetchRemoteBets().catch(() => []),
    fetchLegacyBoardRow().catch(() => []),
  ]);

  return {
    bets: Array.isArray(bets) ? bets : [],
    board: Array.isArray(boardRows) && boardRows.length > 0 ? boardRows[0] : null,
  };
}

async function fetchRemoteBets() {
  const url = buildTableUrl(remoteConfig.betsTable);
  url.searchParams.set("select", "*");
  url.searchParams.set("board_key", `eq.${remoteConfig.boardKey}`);
  url.searchParams.set("order", "created_at.desc");

  const rows = await requestSupabase(url);
  return Array.isArray(rows) ? rows : [];
}

async function fetchLegacyBoardRow() {
  const url = buildTableUrl(remoteConfig.boardTable);
  url.searchParams.set("select", "*");
  url.searchParams.set("board_key", `eq.${remoteConfig.boardKey}`);
  url.searchParams.set("limit", "1");

  const rows = await requestSupabase(url);
  return Array.isArray(rows) ? rows : [];
}

async function upsertRemoteBet(bet) {
  const payload = betToRemotePayload(bet);
  const url = `${buildTableUrl(remoteConfig.betsTable).toString()}?on_conflict=id`;

  return requestSupabase(url, {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=representation",
    body: payload,
  });
}

function betToRemotePayload(bet) {
  return {
    id: bet.id,
    board_key: remoteConfig.boardKey,
    created_at: bet.createdAt,
    predicted_date: bet.predictedDate ?? "",
    predicted_name: bet.predictedName ?? "",
    guessed_by: bet.guessedBy ?? "",
    guess_time: bet.guessTime ?? "",
    actual_date: bet.actualDate ?? "",
    actual_name: bet.actualName ?? "",
    result_note: bet.resultNote ?? "",
  };
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

function getSyncDiagnostics() {
  const missing = [];

  if (!boardKey) missing.push("BOARD_KEY");
  if (!appConfig.supabaseUrl) missing.push("SUPABASE_URL");
  if (!appConfig.supabasePublishableKey) missing.push("SUPABASE_PUBLISHABLE_KEY");

  return {
    boardKeyPresent: Boolean(boardKey),
    supabaseUrlPresent: Boolean(appConfig.supabaseUrl),
    supabasePublishableKeyPresent: Boolean(appConfig.supabasePublishableKey),
    remoteEnabled: Boolean(remoteConfig),
    missing,
    reason:
      missing.length > 0
        ? `Missing ${missing.join(", ")}`
        : "Remote sync is enabled",
  };
}

function beginRemoteSync() {
  runtime.remoteSyncInFlight += 1;
}

function endRemoteSync() {
  runtime.remoteSyncInFlight = Math.max(0, runtime.remoteSyncInFlight - 1);
}

function isRemoteBusy() {
  return runtime.remoteSyncInFlight > 0;
}

function betsSignature(bets) {
  return JSON.stringify(normalizeBets(bets));
}

function generateBetId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `bet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function legacyBetId() {
  return `legacy-${boardKey || "local"}`;
}

function normalizeConfig(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    supabaseUrl: toText(source.supabaseUrl).trim().replace(/\/$/, ""),
    supabasePublishableKey: toText(source.supabasePublishableKey).trim(),
    boardTable: toText(source.boardTable).trim() || "baby_bet_board",
    betsTable: toText(source.betsTable).trim() || "baby_bet_bets",
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
  if (Number.isNaN(date.getTime())) return "now";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}
