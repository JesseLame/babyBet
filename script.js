const STORAGE_KEY = "baby-bet-board:v1";

const defaults = {
  predictedDate: "",
  predictedName: "",
  predictionNote: "",
  stake: "",
  actualDate: "",
  actualName: "",
  resultNote: "",
  notes: [
    {
      time: new Date().toISOString(),
      text: "Project created. Add your prediction and start tracking the bet.",
    },
  ],
};

const state = loadState();

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

bindFormInputs();
bindActions();
render();

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return structuredClone(defaults);
    const parsed = JSON.parse(stored);
    return {
      ...structuredClone(defaults),
      ...parsed,
      notes: Array.isArray(parsed.notes) && parsed.notes.length > 0 ? parsed.notes : defaults.notes,
    };
  } catch {
    return structuredClone(defaults);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
    addTimelineNote("Sample data loaded.");
    render();
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
    addTimelineNote("Arrival marked in the tracker.");
    saveState();
    render();
  });

  els.addNote.addEventListener("click", () => {
    const text = els.noteInput.value.trim();
    if (!text) return;
    addTimelineNote(text);
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
  els.daysOff.textContent = hasActual && hasPredicted ? `${Math.abs(daysDiff)} day${Math.abs(daysDiff) === 1 ? "" : "s"}` : "--";

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
    els.countdownLabel.textContent = "The result has been entered and stored locally.";
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

function addTimelineNote(text) {
  state.notes = state.notes ?? [];
  state.notes.unshift({ time: new Date().toISOString(), text });
  saveState();
  renderTimeline();
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
