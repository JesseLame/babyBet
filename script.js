const APP_KEY = "baby-bet-board";
const REMOTE_POLL_MS = 15000;
const env = import.meta.env ?? {};
const SHARED_REMOTE_SCOPE = "";

const appConfig = normalizeConfig(
  {
    supabaseUrl: env.VITE_SUPABASE_URL,
    supabasePublishableKey: env.VITE_SUPABASE_PUBLISHABLE_KEY,
    boardTable: "baby_bet_board",
    betsTable: "baby_bet_bets",
  }
);
const remoteConfig =
  appConfig.supabaseUrl && appConfig.supabasePublishableKey
    ? {
        supabaseUrl: appConfig.supabaseUrl,
        supabasePublishableKey: appConfig.supabasePublishableKey,
        boardTable: appConfig.boardTable,
        betsTable: appConfig.betsTable,
      }
    : null;

const state = createDefaultState();

const runtime = {
  remoteSyncInFlight: 0,
  pollTimer: null,
  liveTimer: null,
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
  liveLeader: document.getElementById("liveLeader"),
  winnerName: document.getElementById("winnerName"),
  winnerMeta: document.getElementById("winnerMeta"),
  winnerTimer: document.getElementById("winnerTimer"),
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

  renderLiveWinner();
  runtime.liveTimer = window.setInterval(() => {
    renderLiveWinner();
  }, 1000);
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
    const deleteButton = event.target.closest("[data-action='delete-bet']");
    if (deleteButton) {
      void handleDeleteBet(deleteButton.dataset.betId);
      return;
    }

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
  if (remoteConfig) {
    return;
  }

  if (state.bets.length > 0) {
    setSyncStatus("Connect Supabase to load the shared list.", "offline");
    return;
  }

  setSyncStatus("Connect Supabase to load the shared list.", "offline");
}

function render() {
  renderHeader();
  renderLiveWinner();
  renderBets();
}

function renderHeader() {
  if (!els.betsCount) return;
  const count = state.bets.length;
  els.betsCount.textContent = `${count} bet${count === 1 ? "" : "s"}`;
}

function renderBets() {
  const bets = [...state.bets].sort(compareBetsByPredictedDate);
  const winnerId = findClosestBet(bets)?.id ?? null;
  els.betsList.innerHTML = "";

  if (bets.length === 0) {
    els.betsList.appendChild(renderEmptyState());
    return;
  }

  for (const bet of bets) {
    els.betsList.appendChild(renderBetRow(bet, bet.id === winnerId));
  }
}

function renderLiveWinner() {
  if (!els.liveLeader || !els.winnerName || !els.winnerMeta || !els.winnerTimer) {
    return;
  }

  const winner = findClosestBet(state.bets);

  if (!winner) {
    els.liveLeader.dataset.state = "empty";
    els.winnerName.textContent = "No bets yet";
    els.winnerMeta.textContent = "Add a bet to see who is closest to now.";
    els.winnerTimer.textContent = "--:--:--";
    return;
  }

  const targetTime = parseBetTargetDateTime(winner.predictedDate, winner.guessTime);
  const now = Date.now();
  const difference = targetTime ? targetTime.getTime() - now : 0;

  els.liveLeader.dataset.state = "active";
  els.winnerName.textContent = winner.predictedName || "Untitled bet";
  els.winnerMeta.textContent = buildWinnerMeta(winner, targetTime);
  els.winnerTimer.textContent = formatCountdown(difference);
}

function compareBetsByPredictedDate(a, b) {
  const aDate = parseDate(a.predictedDate);
  const bDate = parseDate(b.predictedDate);

  if (aDate && bDate) {
    const diff = aDate.getTime() - bDate.getTime();
    if (diff !== 0) return diff;
  } else if (aDate) {
    return -1;
  } else if (bDate) {
    return 1;
  }

  const createdDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  if (createdDiff !== 0) return createdDiff;

  return a.id.localeCompare(b.id);
}

function findClosestBet(bets, now = Date.now()) {
  let winner = null;
  let winnerDistance = Number.POSITIVE_INFINITY;
  let winnerTarget = Number.POSITIVE_INFINITY;

  for (const bet of Array.isArray(bets) ? bets : []) {
    const targetTime = parseBetTargetDateTime(bet.predictedDate, bet.guessTime);
    if (!targetTime) continue;

    const target = targetTime.getTime();
    const distance = Math.abs(target - now);

    if (
      distance < winnerDistance ||
      (distance === winnerDistance && target < winnerTarget) ||
      (distance === winnerDistance &&
        target === winnerTarget &&
        compareBetRecency(bet, winner) > 0)
    ) {
      winner = bet;
      winnerDistance = distance;
      winnerTarget = target;
    }
  }

  return winner;
}

function compareBetRecency(a, b) {
  if (!b) return 1;

  const aCreated = new Date(a.createdAt).getTime();
  const bCreated = new Date(b.createdAt).getTime();

  if (aCreated !== bCreated) {
    return aCreated - bCreated;
  }

  return a.id.localeCompare(b.id);
}

function buildWinnerMeta(bet, targetTime) {
  const pieces = [];
  const dateText = formatDateTime(targetTime);

  if (dateText) {
    pieces.push(dateText);
  } else if (bet.predictedDate) {
    pieces.push(formatDate(bet.predictedDate));
  }

  if (bet.guessedBy) {
    pieces.push(`by ${bet.guessedBy}`);
  }

  return pieces.length > 0 ? pieces.join(" · ") : "Closest guess right now";
}

function parseBetTargetDateTime(predictedDate, guessTime) {
  const dateText = toText(predictedDate).trim();
  if (!dateText) return null;

  const timeText = normalizeTimeString(guessTime);
  const dateTime = new Date(`${dateText}T${timeText}`);
  return Number.isNaN(dateTime.getTime()) ? null : dateTime;
}

function normalizeTimeString(value) {
  const timeText = toText(value).trim();
  if (!timeText) return "12:00:00";

  if (/^\d{2}:\d{2}$/.test(timeText)) {
    return `${timeText}:00`;
  }

  if (/^\d{2}:\d{2}:\d{2}$/.test(timeText)) {
    return timeText;
  }

  return "12:00:00";
}

function formatCountdown(deltaMs) {
  const sign = deltaMs < 0 ? "ago" : "away";
  const totalSeconds = Math.max(0, Math.round(Math.abs(deltaMs) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
    seconds
  ).padStart(2, "0")}`;

  return days > 0 ? `${days}d ${clock} ${sign}` : `${clock} ${sign}`;
}

function formatDateTime(value) {
  if (!value) return "";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
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

function renderBetRow(bet, isLeader = false) {
  const tr = document.createElement("tr");
  tr.className = "bet-row";
  if (isLeader) {
    tr.classList.add("is-leader");
  }

  tr.append(
    createCell(bet.predictedName || "Untitled bet", "Baby name", "bet-name-cell"),
    createCell(formatDate(bet.predictedDate) || "—", "Predicted date", "bet-muted-cell"),
    createCell(bet.guessedBy || "—", "Guessed by", "bet-muted-cell"),
    createCell(bet.guessTime || "—", "Time", "bet-muted-cell"),
    createActionCell(bet)
  );

  return tr;
}

function createActionCell(bet) {
  const td = document.createElement("td");
  td.className = "bet-actions-cell";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary row-action-button";
  button.dataset.action = "delete-bet";
  button.dataset.betId = bet.id;
  button.setAttribute(
    "aria-label",
    `Delete bet for ${bet.predictedName || "untitled bet"}`
  );
  button.innerHTML = `
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <path
        d="M9 3h6a1 1 0 0 1 1 1v1h4v2H4V5h4V4a1 1 0 0 1 1-1Zm1 6h2v7h-2V9Zm4 0h2v7h-2V9ZM6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12H6Z"
      />
    </svg>
  `;

  td.append(button);
  return td;
}

function createCell(text, label, className) {
  const td = document.createElement("td");
  if (className) {
    td.className = className;
  }
  td.dataset.label = label;
  td.textContent = text;
  return td;
}

function createDefaultState() {
  return {
    bets: [],
  };
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
    state.bets = remoteBets;
    render();

    if (snapshot.board && remoteBets.length === 0) {
      const legacy = normalizeLegacyBet(snapshot.board);
      if (hasMeaningfulBetData(legacy)) {
        state.bets = [legacy];
        render();
        await upsertRemoteBet(legacy);
        setSyncStatus("Legacy board migrated into the list.", "synced");
        return;
      }
    }

    setSyncStatus(remoteBets.length > 0 ? "Shared list synced" : "Shared list ready", "synced");
  } catch (error) {
    console.warn("Shared sync unavailable", error, debugInfo);
    setSyncStatus("Shared list unavailable right now.", "offline");
  } finally {
    endRemoteSync();
  }
}

async function refreshFromBackend() {
  if (!remoteConfig) return;
  if (isRemoteBusy()) return;

  beginRemoteSync();
  try {
    const snapshot = await loadRemoteSnapshot();
    const remoteBets = normalizeBets(snapshot.bets);
    state.bets = remoteBets;
    render();
    setSyncStatus(remoteBets.length > 0 ? "Shared list synced" : "Shared list ready", "synced");
  } catch {
    setSyncStatus("Shared list unavailable right now.", "offline");
  } finally {
    endRemoteSync();
  }
}

async function syncBetNow(bet) {
  if (!remoteConfig) {
    console.info("[Baby Bets] remote sync disabled", debugInfo.reason);
    setSyncStatus("Connect Supabase to save bets.", "offline");
    return;
  }

  beginRemoteSync();
  try {
    setSyncStatus("Saving bet...", "saving");
    console.info("[Baby Bets] upserting bet", {
      betId: bet.id,
      supabaseUrl: remoteConfig.supabaseUrl,
      table: remoteConfig.betsTable,
    });
    await upsertRemoteBet(bet);
    state.bets = [bet, ...state.bets.filter((entry) => entry.id !== bet.id)];
    render();
    els.createForm.reset();
    toggleCreatePanel(false);
    setSyncStatus("Shared list synced", "synced");
  } catch (error) {
    console.warn("Bet sync failed", error);
    setSyncStatus("Could not save to the shared list.", "offline");
  } finally {
    endRemoteSync();
  }
}

async function handleDeleteBet(betId) {
  if (!betId) return;

  const bet = state.bets.find((entry) => entry.id === betId);
  if (!bet) return;

  const label = bet.predictedName || "this bet";
  const confirmed = window.confirm(`Delete ${label}? This cannot be undone.`);
  if (!confirmed) return;

  if (!remoteConfig) {
    state.bets = state.bets.filter((entry) => entry.id !== betId);
    render();
    setSyncStatus("Removed locally.", "offline");
    return;
  }

  beginRemoteSync();
  try {
    setSyncStatus("Deleting bet...", "saving");
    console.info("[Baby Bets] deleting bet", {
      betId,
      supabaseUrl: remoteConfig.supabaseUrl,
      table: remoteConfig.betsTable,
    });
    await deleteRemoteBet(betId);
    state.bets = state.bets.filter((entry) => entry.id !== betId);
    render();
    setSyncStatus("Shared list synced", "synced");
  } catch (error) {
    console.warn("Bet delete failed", error);
    setSyncStatus("Could not delete from the shared list.", "offline");
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
  url.searchParams.set("order", "created_at.desc");

  const rows = await requestSupabase(url);
  return Array.isArray(rows) ? rows : [];
}

async function fetchLegacyBoardRow() {
  const url = buildTableUrl(remoteConfig.boardTable);
  url.searchParams.set("select", "*");
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

async function deleteRemoteBet(betId) {
  const url = buildTableUrl(remoteConfig.betsTable);
  url.searchParams.set("id", `eq.${betId}`);

  return requestSupabase(url, {
    method: "DELETE",
    prefer: "return=representation",
  });
}

function betToRemotePayload(bet) {
  return {
    id: bet.id,
    board_key: SHARED_REMOTE_SCOPE,
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
  const supabaseKey = remoteConfig.supabasePublishableKey;
  const supabaseKeyKind = getSupabaseKeyKind(supabaseKey);

  if (supabaseKeyKind === "secret") {
    throw new Error(
      "Supabase secret keys cannot be used in the browser. Use a publishable key instead."
    );
  }

  const headers = {
    apikey: supabaseKey,
    Accept: "application/json",
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(prefer ? { Prefer: prefer } : {}),
  };

  if (supabaseKeyKind === "legacy_jwt" || supabaseKeyKind === "publishable") {
    headers.Authorization = `Bearer ${supabaseKey}`;
  }

  const response = await fetch(url, {
    method,
    headers,
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
  const supabaseKeyKind = getSupabaseKeyKind(appConfig.supabasePublishableKey);

  if (!appConfig.supabaseUrl) missing.push("SUPABASE_URL");
  if (!appConfig.supabasePublishableKey) missing.push("SUPABASE_PUBLISHABLE_KEY");

  return {
    supabaseUrlPresent: Boolean(appConfig.supabaseUrl),
    supabasePublishableKeyPresent: Boolean(appConfig.supabasePublishableKey),
    supabaseKeyKind,
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
  return `legacy-${APP_KEY}`;
}

function normalizeConfig(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    supabaseUrl: toText(source.supabaseUrl).trim().replace(/\/$/, ""),
    supabasePublishableKey: toText(source.supabasePublishableKey).trim(),
    boardTable: toText(source.boardTable).trim() || "baby_bet_board",
    betsTable: toText(source.betsTable).trim() || "baby_bet_bets",
  };
}

function toText(value) {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

function getSupabaseKeyKind(key) {
  if (!key) return "missing";
  if (key.startsWith("sb_publishable_")) return "publishable";
  if (key.startsWith("sb_secret_")) return "secret";
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return "legacy_jwt";
  return "unknown";
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
