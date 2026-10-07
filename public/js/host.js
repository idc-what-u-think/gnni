const socket = io();

let roomCode = "";
let selectedGame = null;
let customQuestions = [];
let currentPlayers = [];
let currentBatchMode = "mcq";
let currentQTab = "single";
let starting = false;

const HOST_AUTH = new URLSearchParams(location.search).get("code") || "";
const EMOJI_RE = /^emoji:([^|:<>"'\s]{1,12})\|(#[0-9a-fA-F]{3,8})$/u;
const IMG_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

const GAMES = [
  { id: "imposter", icon: "🕵️", name: "Who is the Imposter", desc: "One word. Find the spy.", min: 3 },
  { id: "trivial", icon: "🎯", name: "Trivial Quiz", desc: "T/F + MCQ questions", min: 2 },
  { id: "reaction", icon: "⚡", name: "Reaction Royale", desc: "Flash. Tap. Survive.", min: 2 },
  { id: "wouldyourather", icon: "🤔", name: "Would You Rather", desc: "Majority rules", min: 2 },
  { id: "mathquiz", icon: "➕", name: "Math Quiz", desc: "Solve it faster", min: 2 },
  { id: "fasttyper", icon: "⌨️", name: "Fastest Typer", desc: "Speed + accuracy", min: 2 },
  { id: "wordcrack", icon: "🟩", name: "Word Crack", desc: "Multiplayer Wordle", min: 2 },
  { id: "codebreaker", icon: "🔐", name: "Code Breaker", desc: "Crack the 4-digit code", min: 2 },
  { id: "roulette", icon: "🎰", name: "Russian Roulette", desc: "Spin. Shoot. Survive.", min: 2 },
  { id: "rapidfire", icon: "🔥", name: "Rapid Fire", desc: "60 seconds of chaos", min: 2 },
  { id: "hotpotato", icon: "🥔", name: "Hot Potato", desc: "Pass it before it blows", min: 3 }
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
    { key: "mode", label: "Win Mode", type: "select", default: "laststanding", options: [{ v: "laststanding", l: "Last Standing" }, { v: "mosttaps", l: "Most Taps (no eliminations)" }] }
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
    { key: "mode", label: "Win Mode", type: "select", default: "laststanding", options: [{ v: "laststanding", l: "Last Standing (+300)" }, { v: "mostrounds", l: "Most Rounds Survived (+50 per safe shot)" }] }
  ],
  rapidfire: [
    { key: "duration", label: "Duration (seconds)", type: "number", default: 60, min: 30, max: 180 }
  ],
  hotpotato: [
    { key: "fuse", label: "Fuse Length", type: "select", default: "medium", options: [{ v: "short", l: "Short (10-20s)" }, { v: "medium", l: "Medium (15-35s)" }, { v: "long", l: "Long (25-50s)" }] }
  ]
};

function $(id) { return document.getElementById(id); }

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function gameName(id) {
  const g = GAMES.find(x => x.id === id);
  return g ? g.name : id || "Game Running";
}

function showSection(name) {
  document.querySelectorAll(".screen-section").forEach(s => s.classList.remove("active"));
  $("section-" + name)?.classList.add("active");
}

function makeAvatarEl(player) {
  const a = player.avatar || "";
  const m = EMOJI_RE.exec(a);
  if (m) return `<div class="avatar" style="background:${m[2]}; font-size:18px;">${esc(m[1])}</div>`;
  if (IMG_RE.test(a)) return `<div class="avatar"><img src="${a}" alt=""></div>`;
  const colors = ["#7c3aed","#06b6d4","#f59e0b","#10b981","#ef4444","#ec4899","#8b5cf6"];
  const name = String(player.name || "?");
  return `<div class="avatar" style="background:${colors[name.charCodeAt(0) % colors.length]}">${esc(name.charAt(0).toUpperCase())}</div>`;
}

/* ─── ROOM SETUP AND RESUME ───────────────────────────────────────── */

function readSaved() {
  try { return JSON.parse(sessionStorage.getItem("gn_host") || "null"); } catch (e) { return null; }
}

function writeSaved(v) {
  try {
    if (v) sessionStorage.setItem("gn_host", JSON.stringify(v));
    else sessionStorage.removeItem("gn_host");
  } catch (e) {}
}

socket.on("connect", () => {
  const saved = readSaved();
  if (saved && saved.code && saved.key) socket.emit("host_resume", { code: saved.code, hostKey: saved.key });
  else socket.emit("create_room", { hostCode: HOST_AUTH });
});

socket.on("host_resume_failed", () => {
  writeSaved(null);
  socket.emit("create_room", { hostCode: HOST_AUTH });
});

socket.on("auth_failed", () => {
  window.location.href = "/host";
});

socket.on("room_created", ({ code, hostKey }) => {
  roomCode = code;
  writeSaved({ code, key: hostKey });
  $("roomCodeDisplay").textContent = code;
  $("displayLink").href = "/display?code=" + code;
  loadQR();
  buildGameGrid();
});

socket.on("error", ({ msg }) => {
  starting = false;
  alert(msg);
});

async function loadQR() {
  try {
    const res = await fetch("/qr?code=" + encodeURIComponent(roomCode));
    const data = await res.json();
    $("url-display").textContent = data.url;
    $("qrImg").src = data.qr;
    $("qrImg").style.display = "block";
    $("qrPlaceholder").style.display = "none";
  } catch (e) {
    $("url-display").textContent = location.origin;
  }
}

function buildGameGrid() {
  $("gameGrid").innerHTML = GAMES.map(g => `
    <div class="game-card" id="gc-${g.id}" onclick="selectGame('${g.id}')">
      <div class="icon">${g.icon}</div>
      <div class="name">${esc(g.name)}</div>
      <div class="desc">${esc(g.desc)}</div>
    </div>
  `).join("");
  if (selectedGame) $("gc-" + selectedGame)?.classList.add("selected");
}

function selectGame(id) {
  selectedGame = id;
  document.querySelectorAll(".game-card").forEach(c => c.classList.remove("selected"));
  $("gc-" + id)?.classList.add("selected");

  const game = GAMES.find(g => g.id === id);
  $("settingsTitle").textContent = `${game.icon} ${game.name} Settings`;
  $("settingsPanel").style.display = "block";

  $("settingsGrid").innerHTML = (SETTINGS[id] || []).map(s => `
    <div class="setting-item">
      <label class="setting-label">${esc(s.label)}</label>
      ${s.type === "select"
        ? `<select class="setting-input" id="setting-${s.key}">${s.options.map(o => `<option value="${o.v}" ${o.v === s.default ? "selected" : ""}>${esc(o.l)}</option>`).join("")}</select>`
        : `<input class="setting-input" type="number" id="setting-${s.key}" value="${s.default}" min="${s.min}" max="${s.max}">`
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
  (SETTINGS[selectedGame] || []).forEach(s => {
    const el = $("setting-" + s.key);
    if (!el) return;
    if (s.type === "number") {
      const n = parseInt(el.value, 10);
      settings[s.key] = Number.isFinite(n) ? Math.min(s.max, Math.max(s.min, n)) : s.default;
    } else {
      settings[s.key] = el.value;
    }
  });
  if (selectedGame === "trivial" && customQuestions.length > 0) settings.questions = customQuestions;
  return settings;
}

/* ─── QUESTION MANAGER ────────────────────────────────────────────── */

function switchQTab(tab) {
  currentQTab = tab;
  $("tabSingle").classList.toggle("active", tab === "single");
  $("tabBatch").classList.toggle("active", tab === "batch");
  $("singleQForm").style.display = tab === "single" ? "flex" : "none";
  $("batchQForm").style.display = tab === "batch" ? "block" : "none";
}

function onQTypeChange() {
  const tf = $("qType").value === "tf";
  $("mcqOptions").style.display = tf ? "none" : "block";
  $("qTfAnswer").style.display = tf ? "block" : "none";
}

function addQuestion() {
  const text = $("qText").value.trim();
  if (!text) return;
  let q;
  if ($("qType").value === "tf") {
    q = { q: text, options: ["True", "False"], answer: parseInt($("qTfAnswer").value, 10) || 0, type: "tf" };
  } else {
    const opts = [$("qOpt0"), $("qOpt1"), $("qOpt2"), $("qOpt3")].map(el => el.value.trim()).filter(Boolean);
    if (opts.length < 2) { alert("Add at least 2 options. First option is correct."); return; }
    q = { q: text, options: opts, answer: 0, type: "mcq" };
  }
  customQuestions.push(q);
  renderQuestionList();
  $("qText").value = "";
  [$("qOpt0"), $("qOpt1"), $("qOpt2"), $("qOpt3")].forEach(el => { if (el) el.value = ""; });
}

function setBatchMode(mode) {
  currentBatchMode = mode;
  $("batchMCQ").classList.toggle("active", mode === "mcq");
  $("batchTF").classList.toggle("active", mode === "tf");

  $("batchFormatHint").textContent = mode === "mcq"
    ? `Format (one block per question):
Question: Your question here
A. Option A
B. Option B
C. Option C
D. Option D
Correct answer: A

Question: Next question...`
    : `Format (one block per question):
Question: Your question here
Correct answer: True

Question: Next question...`;
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
      const qLine = lines.find(l => /^question:/i.test(l));
      if (!qLine) throw new Error("No 'Question:' line");
      const qText = qLine.replace(/^question:/i, "").trim();
      const ansLine = lines.find(l => /^correct answer:/i.test(l));
      if (!ansLine) throw new Error("No 'Correct answer:' line");
      const ansRaw = ansLine.replace(/^correct answer:/i, "").trim();

      if (currentBatchMode === "mcq") {
        const opts = [];
        ["A", "B", "C", "D"].forEach(letter => {
          const l = lines.find(ln => new RegExp(`^${letter}[.):]`, "i").test(ln));
          opts.push(l ? l.replace(/^[A-D][.):\s]+/i, "").trim() : null);
        });
        const ansIdx = ["A", "B", "C", "D"].indexOf(ansRaw.toUpperCase());
        if (ansIdx === -1) throw new Error(`Invalid answer '${ansRaw}', use A/B/C/D`);
        const present = opts.filter(Boolean);
        if (present.length < 2) throw new Error("Need at least 2 options (A, B...)");
        if (!opts[ansIdx]) throw new Error(`Option ${ansRaw.toUpperCase()} is missing`);
        const correctAt = opts.slice(0, ansIdx + 1).filter(Boolean).length - 1;
        const rest = present.filter((_, i) => i !== correctAt);
        added.push({ q: qText, options: [present[correctAt], ...rest], answer: 0, type: "mcq" });
      } else {
        const v = ansRaw.toLowerCase();
        if (v !== "true" && v !== "false") throw new Error("Answer must be 'True' or 'False'");
        added.push({ q: qText, options: ["True", "False"], answer: v === "true" ? 0 : 1, type: "tf" });
      }
    } catch (e) {
      errors.push(`Block ${idx + 1}: ${e.message}`);
    }
  });

  customQuestions.push(...added);
  renderQuestionList();

  let msg = "";
  if (added.length > 0) msg += `${added.length} question(s) imported. `;
  if (errors.length > 0) msg += `${errors.length} error(s): ${errors.join("; ")}`;
  $("batchResult").innerHTML = `<span style="color:${errors.length ? "var(--danger)" : "var(--success)"}">${esc(msg)}</span>`;

  if (added.length > 0) $("batchInput").value = "";
}

function renderQuestionList() {
  const section = $("qListSection");
  if (customQuestions.length === 0) {
    section.style.display = "none";
    return;
  }
  section.style.display = "block";
  $("qCountLabel").textContent = `${customQuestions.length} question${customQuestions.length !== 1 ? "s" : ""}`;

  $("questionList").innerHTML = customQuestions.map((q, i) => `
    <div class="q-row">
      <input type="checkbox" class="q-checkbox" id="qcheck-${i}" value="${i}">
      <span class="tag tag-cyan" style="font-size:10px;">${esc(q.type.toUpperCase())}</span>
      <span class="q-text">${esc(q.q)}</span>
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
  const checked = [...document.querySelectorAll(".q-checkbox:checked")].map(cb => parseInt(cb.value, 10));
  if (checked.length === 0) return;
  if (!confirm(`Delete ${checked.length} selected question(s)?`)) return;
  customQuestions = customQuestions.filter((_, i) => !checked.includes(i));
  renderQuestionList();
}

/* ─── GAME CONTROL ────────────────────────────────────────────────── */

function startGame() {
  if (!selectedGame || starting) return;
  const game = GAMES.find(g => g.id === selectedGame);
  const connected = currentPlayers.filter(p => !p.disconnected).length;
  if (connected < game.min) { alert(`Need at least ${game.min} players to start ${game.name}!`); return; }
  starting = true;
  setTimeout(() => { starting = false; }, 3000);
  socket.emit("host_select_game", { code: roomCode, game: selectedGame, settings: getSettings() });
  socket.emit("host_start_game", { code: roomCode });
}

socket.on("game_start", ({ game }) => {
  starting = false;
  $("runningGameName").textContent = gameName(game);
  $("stateText").textContent = "Game starting...";
  showSection("running");
});

function showLeaderboard() {
  socket.emit("host_show_leaderboard", { code: roomCode });
}

function nextRound() {
  socket.emit("host_next_round", { code: roomCode });
}

function endGame() {
  if (!confirm("End the current game?")) return;
  socket.emit("host_end_game", { code: roomCode });
}

/* ─── SESSION LEADERBOARD ─────────────────────────────────────────── */

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
      <span class="session-lb-name">${esc(p.name)}</span>
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
      <span style="flex:1; font-size:12px; font-weight:600;">${esc(p.name)}</span>
      <span style="font-family:var(--font-mono); font-size:13px; font-weight:700; color:var(--accent2);">${p.totalScore}</span>
    </div>
  `).join("");

  if (mainEl) mainEl.innerHTML = rows;
}

socket.on("session_leaderboard", ({ leaderboard }) => {
  renderSessionLeaderboard(leaderboard);
});

/* ─── ROOM STATE ──────────────────────────────────────────────────── */

socket.on("room_state", ({ players, phase, game }) => {
  currentPlayers = players;
  updateSidebarPlayers(players);
  updateLiveLeaderboard(players);
  const running = $("section-running").classList.contains("active");
  if (phase === "playing" && !running) {
    $("runningGameName").textContent = gameName(game);
    showSection("running");
  } else if ((phase === "lobby" || phase === "settings") && running) {
    showSection("select");
  }
});

function updateSidebarPlayers(players) {
  $("sidePlayerCount").textContent = players.length;
  $("sidePlayerList").innerHTML = players.map(p => `
    <div class="host-player-row" style="${p.disconnected ? "opacity:0.5;" : ""}">
      ${makeAvatarEl(p)}
      <span class="host-player-name">${esc(p.name)}</span>
      ${p.disconnected ? '<span class="tag" style="font-size:10px;">OFFLINE</span>' : p.eliminated ? '<span class="tag tag-red" style="font-size:10px;">OUT</span>' : p.ready ? '<span class="tag tag-green" style="font-size:10px;">✓</span>' : ""}
      <span class="kick-btn" data-id="${esc(p.id)}">Kick</span>
    </div>
  `).join("");
  $("sidePlayerList").querySelectorAll(".kick-btn").forEach(el => {
    el.onclick = () => socket.emit("host_kick", { code: roomCode, playerId: el.dataset.id });
  });
}

function updateLiveLeaderboard(players) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  $("liveLeaderboard").innerHTML = sorted.map((p, i) => `
    <div class="host-player-row" style="${p.eliminated ? "opacity:0.4;" : ""}">
      <div style="font-family:var(--font-mono); font-size:16px; font-weight:700; width:28px; color:${i===0?"var(--accent3)":"var(--text2)"};">${i+1}</div>
      ${makeAvatarEl(p)}
      <span class="host-player-name">${esc(p.name)}</span>
      ${p.eliminated ? '<span class="tag tag-red" style="font-size:10px;">ELIMINATED</span>' : ""}
      <span class="player-score">${p.score}</span>
    </div>
  `).join("");
}

socket.on("game_over", ({ players }) => {
  showSection("select");
  cancelSelection();
  currentPlayers = players;
  updateSidebarPlayers(players);
});

/* ─── GAME STATE TEXT ─────────────────────────────────────────────── */

function setState(t) { $("stateText").textContent = t; }

socket.on("trivial_question", ({ round, total }) => setState(`Question ${round} of ${total}`));
socket.on("trivial_answer_received", ({ total }) => { $("stateText").textContent += ` | ${total} answered`; });
socket.on("trivial_reveal", () => setState("Answer revealed"));
socket.on("math_question", ({ round, total }) => setState(`Math problem ${round} of ${total}`));
socket.on("math_reveal", () => setState("Answer revealed"));
socket.on("reaction_waiting", ({ round }) => setState(`Round ${round}: waiting for flash...`));
socket.on("reaction_flash", () => setState("FLASH! 1.5s window..."));
socket.on("reaction_result", ({ survived, eliminated }) => {
  setState(`Round done: ${survived.length} still in, ${eliminated.length} eliminated`);
});
socket.on("imposter_round_start", ({ round }) => setState(`Round ${round}: players reading roles. Use Next Round to open the vote.`));
socket.on("voting_start", () => setState("Voting in progress..."));
socket.on("vote_cast", ({ totalVotes, totalVoters }) => setState(`Voting: ${totalVotes}/${totalVoters} cast`));
socket.on("voting_result", ({ eliminatedName, wasImposter, tie, noVotes }) => {
  if (tie) setState("Tie vote. Nobody eliminated.");
  else if (noVotes || !eliminatedName) setState("No votes cast. Nobody eliminated.");
  else setState(wasImposter ? `${eliminatedName} was the imposter!` : `${eliminatedName} was innocent. Game continues...`);
});
socket.on("roulette_round", ({ order }) => setState(`Turn order: ${order.map(p => p.name).join(" > ")}`));
socket.on("roulette_next", ({ name }) => setState(`${name}'s turn`));
socket.on("roulette_bang", ({ name }) => setState(`${name} was eliminated!`));
socket.on("roulette_safe", () => setState("Click! Safe this time..."));
socket.on("wordcrack_round", ({ round, total, wordLength }) => setState(`Round ${round}/${total}: ${wordLength}-letter word`));
socket.on("wordcrack_solved", ({ name, word }) => setState(`${name} cracked it! Word was: ${word}`));
socket.on("wordcrack_timeout", ({ word }) => setState(`Time's up! Word was: ${word}`));
socket.on("codebreaker_round", ({ round, total }) => setState(`Round ${round}/${total}: 4-digit code active`));
socket.on("codebreaker_solved", ({ name, code }) => setState(`${name} cracked it! Code was: ${code}`));
socket.on("codebreaker_timeout", ({ code }) => setState(`Time's up! Code was: ${code}`));
socket.on("rapidfire_start", ({ duration }) => setState(`Rapid Fire: ${Math.round(duration / 1000)}s of questions`));
socket.on("rapidfire_update", ({ players }) => updateLiveLeaderboard(players));
socket.on("typing_round", ({ round, total }) => setState(`Round ${round}/${total}: typing race started`));
socket.on("typing_player_done", ({ name, position, time, players }) => {
  setState(`${name} finished #${position} in ${(time / 1000).toFixed(2)}s`);
  updateLiveLeaderboard(players);
});
socket.on("typing_round_end", () => setState("Round over. Next round soon..."));
socket.on("wyr_question", ({ round, total }) => setState(`Round ${round}/${total}: Would You Rather`));
socket.on("wyr_reveal", ({ aVotes, bVotes }) => setState(`Results: A got ${aVotes} votes, B got ${bVotes} votes`));
socket.on("potato_round", ({ round, holderName }) => setState(`Round ${round}: ${holderName} has the potato`));
socket.on("potato_pass", ({ fromName, toName, passes }) => setState(`${fromName} passed to ${toName} (${passes} passes)`));
socket.on("potato_boom", ({ name, remaining }) => {
  setState(`BOOM! ${name} is out. ${remaining} left.`);
});
