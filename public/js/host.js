const socket = io();

let roomCode = "";
let selectedGame = null;
let customQuestions = [];
let currentPlayers = [];
let currentBatchMode = "mcq";
let currentQTab = "single";

const GAMES = [
  { id: "imposter", icon: "🕵️", name: "Who is the Imposter", desc: "One word. Find the spy.", color: "#7c3aed" },
  { id: "trivial", icon: "🎯", name: "Trivial Quiz", desc: "T/F + MCQ questions", color: "#06b6d4" },
  { id: "reaction", icon: "⚡", name: "Reaction Royale", desc: "Flash. Tap. Survive.", color: "#f59e0b" },
  { id: "wouldyourather", icon: "🤔", name: "Would You Rather", desc: "Majority rules", color: "#10b981" },
  { id: "mathquiz", icon: "➕", name: "Math Quiz", desc: "Solve it faster", color: "#ef4444" },
  { id: "fasttyper", icon: "⌨️", name: "Fastest Typer", desc: "Speed + accuracy", color: "#8b5cf6" },
  { id: "wordcrack", icon: "🟩", name: "Word Crack", desc: "Multiplayer Wordle", color: "#14b8a6" },
  { id: "codebreaker", icon: "🔐", name: "Code Breaker", desc: "Crack the 4-digit code", color: "#f97316" },
  { id: "roulette", icon: "🎰", name: "Russian Roulette", desc: "Spin. Shoot. Survive.", color: "#ec4899" },
  { id: "rapidfire", icon: "🔥", name: "Rapid Fire", desc: "60 seconds of chaos", color: "#6366f1" }
];

const SETTINGS = {
  imposter: [
    { key: "imposters", label: "Number of Imposters", type: "number", default: 1, min: 1, max: 4 },
    { key: "votingTime", label: "Voting Timer (seconds)", type: "number", default: 30, min: 10, max: 120 }
  ],
  trivial: [
    { key: "rounds", label: "Number of Questions", type: "number", default: 10, min: 3, max: 30 },
    { key: "questionTime", label: "Time per Question (seconds)", type: "number", default: 20, min: 5, max: 60 }
  ],
  reaction: [
    { key: "rounds", label: "Number of Rounds", type: "number", default: 5, min: 1, max: 10 },
    { key: "mode", label: "Win Mode", type: "select", default: "laststanding", options: [{ v: "laststanding", l: "Last Standing" }, { v: "mosttaps", l: "Most Taps" }] }
  ],
  wouldyourather: [
    { key: "rounds", label: "Number of Rounds", type: "number", default: 10, min: 3, max: 20 }
  ],
  mathquiz: [
    { key: "rounds", label: "Number of Rounds", type: "number", default: 10, min: 3, max: 20 },
    { key: "questionTime", label: "Time per Question (seconds)", type: "number", default: 15, min: 5, max: 60 },
    { key: "difficulty", label: "Difficulty", type: "select", default: "medium", options: [{ v: "easy", l: "Easy" }, { v: "medium", l: "Medium" }, { v: "hard", l: "Hard" }] }
  ],
  fasttyper: [
    { key: "rounds", label: "Number of Rounds", type: "number", default: 5, min: 2, max: 10 }
  ],
  wordcrack: [
    { key: "rounds", label: "Number of Rounds", type: "number", default: 5, min: 2, max: 10 }
  ],
  codebreaker: [
    { key: "rounds", label: "Number of Rounds", type: "number", default: 5, min: 2, max: 10 }
  ],
  roulette: [
    { key: "mode", label: "Win Mode", type: "select", default: "laststanding", options: [{ v: "laststanding", l: "Last Standing" }, { v: "mostrounds", l: "Most Rounds Survived" }] }
  ],
  rapidfire: [
    { key: "duration", label: "Duration (seconds)", type: "number", default: 60, min: 30, max: 180 }
  ]
};

function $(id) { return document.getElementById(id); }

function showSection(name) {
  document.querySelectorAll(".screen-section").forEach(s => s.classList.remove("active"));
  $("section-" + name)?.classList.add("active");
}

function makeAvatarEl(player) {
  if (player.avatar && player.avatar.startsWith("emoji:")) {
    return `<div class="avatar" style="background:${player.avatar.split("|")[1] || "#7c3aed"}; font-size:18px;">${player.avatar.split(":")[1].split("|")[0]}</div>`;
  } else if (player.avatar && player.avatar.startsWith("data:")) {
    return `<div class="avatar"><img src="${player.avatar}" alt="${player.name}"></div>`;
  }
  const colors = ["#7c3aed","#06b6d4","#f59e0b","#10b981","#ef4444","#ec4899","#8b5cf6"];
  const color = colors[player.name.charCodeAt(0) % colors.length];
  return `<div class="avatar" style="background:${color}">${player.name.charAt(0).toUpperCase()}</div>`;
}

// Init: create room
socket.emit("create_room", { hostId: "host_" + Date.now() });

socket.on("room_created", ({ code }) => {
  roomCode = code;
  $("roomCodeDisplay").textContent = code;
  loadQR();
  buildGameGrid();
});

async function loadQR() {
  const res = await fetch("/qr");
  const data = await res.json();
  $("url-display").textContent = data.url;
  $("qrImg").src = data.qr;
  $("qrImg").style.display = "block";
  $("qrPlaceholder").style.display = "none";
}

function buildGameGrid() {
  const grid = $("gameGrid");
  grid.innerHTML = GAMES.map(g => `
    <div class="game-card" id="gc-${g.id}" onclick="selectGame('${g.id}')">
      <div class="icon">${g.icon}</div>
      <div class="name">${g.name}</div>
      <div class="desc">${g.desc}</div>
    </div>
  `).join("");
}

function selectGame(id) {
  selectedGame = id;
  document.querySelectorAll(".game-card").forEach(c => c.classList.remove("selected"));
  $("gc-" + id)?.classList.add("selected");

  const game = GAMES.find(g => g.id === id);
  $("settingsTitle").textContent = `${game.icon} ${game.name} Settings`;
  $("settingsPanel").style.display = "block";

  const settings = SETTINGS[id] || [];
  $("settingsGrid").innerHTML = settings.map(s => `
    <div class="setting-item">
      <label class="setting-label">${s.label}</label>
      ${s.type === "select"
        ? `<select class="setting-input" id="setting-${s.key}">${s.options.map(o => `<option value="${o.v}" ${o.v === s.default ? "selected" : ""}>${o.l}</option>`).join("")}</select>`
        : `<input class="setting-input" type="number" id="setting-${s.key}" value="${s.default}" min="${s.min || 1}" max="${s.max || 100}">`
      }
    </div>
  `).join("");

  if (id === "trivial") {
    $("trivialQSection").style.display = "block";
    setBatchMode("mcq");
    renderQuestionList();
  } else {
    $("trivialQSection").style.display = "none";
  }
}

function cancelSelection() {
  selectedGame = null;
  $("settingsPanel").style.display = "none";
  document.querySelectorAll(".game-card").forEach(c => c.classList.remove("selected"));
}

function getSettings() {
  const settings = {};
  const defs = SETTINGS[selectedGame] || [];
  defs.forEach(s => {
    const el = $("setting-" + s.key);
    if (el) settings[s.key] = s.type === "number" ? parseInt(el.value) || s.default : el.value;
  });
  if (selectedGame === "trivial" && customQuestions.length > 0) settings.questions = customQuestions;
  return settings;
}

// ─── QUESTION TAB SWITCHING ───────────────────────────────────────────
function switchQTab(tab) {
  currentQTab = tab;
  $("tabSingle").classList.toggle("active", tab === "single");
  $("tabBatch").classList.toggle("active", tab === "batch");
  $("singleQForm").style.display = tab === "single" ? "flex" : "none";
  $("batchQForm").style.display = tab === "batch" ? "block" : "none";
}

function onQTypeChange() {
  $("mcqOptions").style.display = $("qType").value === "mcq" ? "block" : "none";
}

// ─── SINGLE QUESTION ADD ──────────────────────────────────────────────
function addQuestion() {
  const text = $("qText").value.trim();
  if (!text) return;
  const type = $("qType").value;
  let q;
  if (type === "tf") {
    q = { q: text, options: ["True", "False"], answer: 0, type: "tf" };
  } else {
    const opts = [$("qOpt0").value.trim(), $("qOpt1").value.trim(), $("qOpt2").value.trim(), $("qOpt3").value.trim()].filter(Boolean);
    if (opts.length < 2) { alert("Add at least 2 options. First option is correct."); return; }
    while (opts.length < 4) opts.push("—");
    q = { q: text, options: opts, answer: 0, type: "mcq" };
  }
  customQuestions.push(q);
  renderQuestionList();
  $("qText").value = "";
  [$("qOpt0"), $("qOpt1"), $("qOpt2"), $("qOpt3")].forEach(el => { if (el) el.value = ""; });
}

// ─── BATCH UPLOAD ─────────────────────────────────────────────────────
function setBatchMode(mode) {
  currentBatchMode = mode;
  $("batchMCQ").classList.toggle("active", mode === "mcq");
  $("batchTF").classList.toggle("active", mode === "tf");

  if (mode === "mcq") {
    $("batchFormatHint").textContent =
`Format (one block per question):
Question: Your question here
A. Option A (correct)
B. Option B
C. Option C
D. Option D
Correct answer: A

Question: Next question...`;
  } else {
    $("batchFormatHint").textContent =
`Format (one block per question):
Question: Your question here
True or false?
Correct answer: True

Question: Next question...`;
  }
}

function clearBatchInput() {
  $("batchInput").value = "";
  $("batchResult").textContent = "";
}

function parseBatch() {
  const raw = $("batchInput").value.trim();
  if (!raw) return;

  const blocks = raw.split(/\n\s*\n/).filter(b => b.trim());
  const added = [];
  const errors = [];

  blocks.forEach((block, idx) => {
    const lines = block.trim().split("\n").map(l => l.trim()).filter(Boolean);
    try {
      if (currentBatchMode === "mcq") {
        // Find question line
        const qLine = lines.find(l => /^question:/i.test(l));
        if (!qLine) throw new Error("No 'Question:' line");
        const qText = qLine.replace(/^question:/i, "").trim();

        // Find options A-D
        const opts = [];
        ["A","B","C","D"].forEach(letter => {
          const l = lines.find(ln => new RegExp(`^${letter}[.):]`, "i").test(ln));
          if (l) opts.push(l.replace(/^[A-D][.):\s]+/i, "").trim());
        });
        if (opts.length < 2) throw new Error("Need at least 2 options (A, B...)");
        while (opts.length < 4) opts.push("—");

        // Find correct answer
        const ansLine = lines.find(l => /^correct answer:/i.test(l));
        if (!ansLine) throw new Error("No 'Correct answer:' line");
        const ansLetter = ansLine.replace(/^correct answer:/i, "").trim().toUpperCase();
        const ansIdx = ["A","B","C","D"].indexOf(ansLetter);
        if (ansIdx === -1) throw new Error(`Invalid answer '${ansLetter}', use A/B/C/D`);

        // Reorder so correct is first
        const correctOpt = opts[ansIdx];
        const otherOpts = opts.filter((_, i) => i !== ansIdx);
        added.push({ q: qText, options: [correctOpt, ...otherOpts], answer: 0, type: "mcq" });

      } else {
        // T/F
        const qLine = lines.find(l => /^question:/i.test(l));
        if (!qLine) throw new Error("No 'Question:' line");
        const qText = qLine.replace(/^question:/i, "").trim();

        const ansLine = lines.find(l => /^correct answer:/i.test(l));
        if (!ansLine) throw new Error("No 'Correct answer:' line");
        const ansVal = ansLine.replace(/^correct answer:/i, "").trim().toLowerCase();
        if (ansVal !== "true" && ansVal !== "false") throw new Error(`Answer must be 'True' or 'False'`);
        const ansIdx = ansVal === "true" ? 0 : 1;
        added.push({ q: qText, options: ["True", "False"], answer: ansIdx, type: "tf" });
      }
    } catch (e) {
      errors.push(`Block ${idx + 1}: ${e.message}`);
    }
  });

  customQuestions.push(...added);
  renderQuestionList();

  let msg = "";
  if (added.length > 0) msg += `✅ ${added.length} question(s) imported. `;
  if (errors.length > 0) msg += `❌ ${errors.length} error(s): ${errors.join("; ")}`;
  $("batchResult").innerHTML = `<span style="color:${errors.length ? "var(--danger)" : "var(--success)"}">${msg}</span>`;

  if (added.length > 0) $("batchInput").value = "";
}

// ─── QUESTION LIST RENDERING ──────────────────────────────────────────
function renderQuestionList() {
  const list = $("questionList");
  const section = $("qListSection");
  const countLabel = $("qCountLabel");

  if (customQuestions.length === 0) {
    section.style.display = "none";
    return;
  }

  section.style.display = "block";
  countLabel.textContent = `${customQuestions.length} question${customQuestions.length !== 1 ? "s" : ""}`;

  list.innerHTML = customQuestions.map((q, i) => `
    <div class="q-row">
      <input type="checkbox" class="q-checkbox" id="qcheck-${i}" value="${i}">
      <span class="tag tag-cyan" style="font-size:10px;">${q.type.toUpperCase()}</span>
      <span class="q-text">${q.q}</span>
      <span class="q-del" onclick="removeQuestion(${i})">✕</span>
    </div>
  `).join("");
}

function removeQuestion(i) {
  customQuestions.splice(i, 1);
  renderQuestionList();
}

function selectAllQuestions() {
  document.querySelectorAll(".q-checkbox").forEach(cb => cb.checked = true);
}

function deselectAllQuestions() {
  document.querySelectorAll(".q-checkbox").forEach(cb => cb.checked = false);
}

function deleteSelected() {
  const checked = [...document.querySelectorAll(".q-checkbox:checked")].map(cb => parseInt(cb.value));
  if (checked.length === 0) return;
  if (!confirm(`Delete ${checked.length} selected question(s)?`)) return;
  customQuestions = customQuestions.filter((_, i) => !checked.includes(i));
  renderQuestionList();
}

// ─── GAME START ───────────────────────────────────────────────────────
function startGame() {
  if (!selectedGame) return;
  if (currentPlayers.length < 2) { alert("Need at least 2 players to start!"); return; }
  const settings = getSettings();
  socket.emit("host_select_game", { code: roomCode, game: selectedGame, settings });
  setTimeout(() => {
    socket.emit("host_start_game", { code: roomCode });
    $("runningGameName").textContent = GAMES.find(g => g.id === selectedGame)?.name || selectedGame;
    showSection("running");
  }, 500);
}

function showLeaderboard() {
  socket.emit("host_show_leaderboard", { code: roomCode });
}

function nextRound() {
  socket.emit("host_next_round", { code: roomCode });
}

function endGame() {
  if (!confirm("End the current game?")) return;
  socket.emit("host_end_game", { code: roomCode });
  showSection("select");
  cancelSelection();
}

// ─── SESSION LEADERBOARD ──────────────────────────────────────────────
function renderSessionLeaderboard(leaderboard) {
  const sideEl = $("sessionLBSidebar");
  const mainEl = $("sessionLBMain");
  const panel = $("sessionLBPanel");

  if (!leaderboard || leaderboard.length === 0) {
    if (sideEl) sideEl.innerHTML = `<span style="color:var(--text2); font-size:12px;">No games played yet</span>`;
    if (panel) panel.style.display = "none";
    return;
  }

  if (panel) panel.style.display = "block";

  const rows = leaderboard.map((p, i) => `
    <div class="session-lb-row">
      <div class="session-lb-rank" style="color:${i===0?"var(--accent3)":i===1?"#94a3b8":i===2?"#cd7c2f":"var(--text2)"}">
        ${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}
      </div>
      ${makeAvatarEl(p)}
      <span class="session-lb-name">${p.name}</span>
      <div style="display:flex; flex-direction:column; align-items:flex-end; gap:2px;">
        <span class="session-lb-score">${p.totalScore}</span>
        <span class="session-lb-meta">${p.gamesPlayed} game${p.gamesPlayed!==1?"s":""} · ${p.wins} win${p.wins!==1?"s":""}</span>
      </div>
    </div>
  `).join("");

  if (sideEl) sideEl.innerHTML = leaderboard.slice(0, 5).map((p, i) => `
    <div style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--border);">
      <span style="font-size:12px; color:var(--text2); width:16px;">${i+1}</span>
      ${makeAvatarEl(p)}
      <span style="flex:1; font-size:12px; font-weight:600;">${p.name}</span>
      <span style="font-family:var(--font-mono); font-size:13px; font-weight:700; color:var(--accent2);">${p.totalScore}</span>
    </div>
  `).join("");

  if (mainEl) mainEl.innerHTML = rows;
}

socket.on("session_leaderboard", ({ leaderboard }) => {
  renderSessionLeaderboard(leaderboard);
});

// ─── ROOM STATE ───────────────────────────────────────────────────────
socket.on("room_state", ({ players }) => {
  currentPlayers = players;
  updateSidebarPlayers(players);
  updateLiveLeaderboard(players);
});

function updateSidebarPlayers(players) {
  $("sidePlayerCount").textContent = players.length;
  $("sidePlayerList").innerHTML = players.map(p => `
    <div class="host-player-row">
      ${makeAvatarEl(p)}
      <span class="host-player-name">${p.name}</span>
      ${p.eliminated ? '<span class="tag tag-red" style="font-size:10px;">OUT</span>' : p.ready ? '<span class="tag tag-green" style="font-size:10px;">✓</span>' : ""}
      <span class="kick-btn" onclick="kickPlayer('${p.id}')">Kick</span>
    </div>
  `).join("");
}

function kickPlayer(id) {
  socket.emit("host_kick", { code: roomCode, playerId: id });
}

function updateLiveLeaderboard(players) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  $("liveLeaderboard").innerHTML = sorted.map((p, i) => `
    <div class="host-player-row" style="${p.eliminated ? "opacity:0.4;" : ""}">
      <div style="font-family:var(--font-mono); font-size:16px; font-weight:700; width:28px; color:${i===0?"var(--accent3)":"var(--text2)"};">${i+1}</div>
      ${makeAvatarEl(p)}
      <span class="host-player-name">${p.name}</span>
      ${p.eliminated ? '<span class="tag tag-red" style="font-size:10px;">ELIMINATED</span>' : ""}
      <span class="player-score">${p.score}</span>
    </div>
  `).join("");
}

socket.on("game_over", ({ players }) => {
  showSection("select");
  cancelSelection();
  updateSidebarPlayers(players);
});

// ─── GAME STATE TEXT ──────────────────────────────────────────────────
socket.on("trivial_question", ({ round, total }) => {
  $("stateText").textContent = `📚 Question ${round} of ${total}`;
});
socket.on("trivial_answer_received", ({ total }) => {
  $("stateText").textContent += ` — ${total} answered`;
});
socket.on("trivial_reveal", () => {
  $("stateText").textContent = "✅ Answer revealed — showing leaderboard...";
});
socket.on("math_question", ({ round, total }) => {
  $("stateText").textContent = `🔢 Math problem ${round} of ${total}`;
});
socket.on("reaction_waiting", ({ round }) => {
  $("stateText").textContent = `⚡ Round ${round} — waiting for flash...`;
});
socket.on("reaction_flash", () => {
  $("stateText").textContent = "💥 FLASH! 1.5s window...";
});
socket.on("reaction_result", ({ survived, eliminated }) => {
  $("stateText").textContent = `Round done — ${survived.length} survived, ${eliminated.length} eliminated`;
});
socket.on("imposter_round_start", ({ round }) => {
  $("stateText").textContent = `🕵️ Round ${round} — players reading roles...`;
});
socket.on("voting_start", () => {
  $("stateText").textContent = "🗳️ Voting in progress...";
});
socket.on("vote_cast", ({ totalVotes, totalVoters }) => {
  $("stateText").textContent = `🗳️ Voting: ${totalVotes}/${totalVoters} cast`;
});
socket.on("voting_result", ({ eliminatedName, wasImposter }) => {
  $("stateText").textContent = wasImposter
    ? `✅ ${eliminatedName} was the imposter! Game over.`
    : `❌ ${eliminatedName} was innocent. Game continues...`;
});
socket.on("roulette_round", ({ order }) => {
  $("stateText").textContent = `🎰 Turn order: ${order.map(p => p.name).join(" → ")}`;
});
socket.on("roulette_bang", ({ name }) => {
  $("stateText").textContent = `💥 ${name} was eliminated!`;
});
socket.on("roulette_safe", () => {
  $("stateText").textContent = "💨 Click! Safe this time...";
});
socket.on("wordcrack_round", ({ round, total, wordLength }) => {
  $("stateText").textContent = `🟩 Round ${round}/${total} — ${wordLength}-letter word`;
});
socket.on("wordcrack_solved", ({ name, word }) => {
  $("stateText").textContent = `🏆 ${name} cracked it! Word was: ${word}`;
});
socket.on("wordcrack_timeout", ({ word }) => {
  $("stateText").textContent = `⏰ Time's up! Word was: ${word}`;
});
socket.on("codebreaker_round", ({ round, total }) => {
  $("stateText").textContent = `🔐 Round ${round}/${total} — 4-digit code active`;
});
socket.on("codebreaker_solved", ({ name, code }) => {
  $("stateText").textContent = `🏆 ${name} cracked it! Code was: ${code}`;
});
socket.on("codebreaker_timeout", ({ code }) => {
  $("stateText").textContent = `⏰ Time's up! Code was: ${code}`;
});
socket.on("rapidfire_start", ({ duration }) => {
  $("stateText").textContent = `🔥 Rapid Fire — ${duration / 1000}s of questions!`;
});
socket.on("rapidfire_update", ({ players }) => {
  updateLiveLeaderboard(players);
});
socket.on("typing_round", ({ round, total }) => {
  $("stateText").textContent = `⌨️ Round ${round}/${total} — typing race started`;
});
socket.on("typing_player_done", ({ name, position, time }) => {
  $("stateText").textContent = `⌨️ ${name} finished in position #${position} — ${(time/1000).toFixed(2)}s`;
});
socket.on("typing_round_end", () => {
  $("stateText").textContent = "⌨️ Round over — moving to next round...";
});
socket.on("wyr_question", ({ round, total }) => {
  $("stateText").textContent = `🤔 Round ${round}/${total} — Would You Rather`;
});
socket.on("wyr_reveal", ({ aVotes, bVotes }) => {
  $("stateText").textContent = `Results: A got ${aVotes} votes, B got ${bVotes} votes`;
});
