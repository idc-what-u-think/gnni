const socket = io();

let roomCode = new URLSearchParams(location.search).get("code") || "";
let currentPlayers = [];
let voteTimerInterval = null;
let trivTimerInterval = null;
let mathTimerInterval = null;
let rfTimerInterval = null;
let playerGrids = {};

const AVATAR_COLORS = ["#7c3aed","#06b6d4","#f59e0b","#10b981","#ef4444","#ec4899","#8b5cf6","#14b8a6","#f97316","#6366f1"];
const EMOJI_RE = /^emoji:([^|:<>"'\s]{1,12})\|(#[0-9a-fA-F]{3,8})$/u;
const IMG_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

function $(id) { return document.getElementById(id); }

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function showView(name) {
  document.querySelectorAll("[id^='view-']").forEach(el => el.style.display = "none");
  const el = $("view-" + name);
  if (el) el.style.display = name === "reaction-dark" ? "flex" : "block";
}

function makeAvatarEl(player, size = 44) {
  const a = player.avatar || "";
  const m = EMOJI_RE.exec(a);
  if (m) {
    return `<div class="avatar" style="width:${size}px;height:${size}px;background:${m[2]};font-size:${Math.floor(size*0.5)}px;">${esc(m[1])}</div>`;
  }
  if (IMG_RE.test(a)) {
    return `<div class="avatar" style="width:${size}px;height:${size}px;"><img src="${a}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>`;
  }
  const name = String(player.name || "?");
  const color = AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
  return `<div class="avatar" style="width:${size}px;height:${size}px;background:${color};font-size:${Math.floor(size*0.4)}px;">${esc(name.charAt(0).toUpperCase())}</div>`;
}

function updateLeaderboard(players) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  $("displayLeaderboard").innerHTML = sorted.map((p, i) => `
    <div class="lb-row rank-${i+1}" style="${p.eliminated ? 'opacity:0.35;' : ''}">
      <div class="lb-rank">${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i+1}</div>
      ${makeAvatarEl(p, 36)}
      <span class="lb-name">${esc(p.name)}</span>
      ${p.eliminated ? '<span class="lb-elim">OUT</span>' : ""}
      <span class="lb-score">${p.score}</span>
    </div>
  `).join("");
}

function startCountdown() {
  showView("countdown");
  let n = 3;
  $("countdownNum").textContent = n;
  $("countdownNum").classList.add("scale-in");
  const t = setInterval(() => {
    n--;
    if (n <= 0) { clearInterval(t); return; }
    $("countdownNum").textContent = n;
    $("countdownNum").classList.remove("scale-in");
    void $("countdownNum").offsetWidth;
    $("countdownNum").classList.add("scale-in");
  }, 1000);
}

function runBar(barId, duration) {
  let secs = Math.max(1, Math.round(duration / 1000));
  const total = secs;
  $(barId).style.width = "100%";
  return setInterval(() => {
    secs--;
    $(barId).style.width = Math.max(0, (secs / total) * 100) + "%";
  }, 1000);
}

/* ─── ROOM JOIN ───────────────────────────────────────────────────── */

function loadQR() {
  const q = roomCode ? "?code=" + encodeURIComponent(roomCode) : "";
  fetch("/qr" + q).then(r => r.json()).then(data => {
    $("displayUrl").textContent = data.url;
    $("qrImg").src = data.qr;
  }).catch(() => {});
}

socket.on("connect", () => {
  socket.emit("display_join", { code: roomCode });
  loadQR();
});

socket.on("display_room", ({ code }) => {
  const changed = code !== roomCode;
  roomCode = code;
  $("displayCode").textContent = code;
  if (changed || !$("qrImg").src) loadQR();
  socket.emit("display_join", { code });
});

socket.on("display_waiting", () => {
  $("displayCode").textContent = "----";
  $("topGameLabel").textContent = "Waiting for host...";
});

socket.on("error", ({ msg }) => {
  $("displayCode").textContent = "----";
  $("topGameLabel").textContent = msg;
  roomCode = "";
});

socket.on("room_state", ({ players, phase }) => {
  currentPlayers = players;
  updateLeaderboard(players);
  updateLobbyPlayers(players);
  if (phase === "lobby" || phase === "settings") showView("lobby");
});

function updateLobbyPlayers(players) {
  $("lobbyPlayersGrid").innerHTML = players.map(p => `
    <div class="player-bubble ${p.ready ? "ready" : ""}" style="${p.disconnected ? "opacity:0.45;" : ""}">
      ${makeAvatarEl(p, 56)}
      <div class="pname">${esc(p.name)}</div>
      ${p.ready ? '<div class="tag tag-green" style="font-size:11px;">Ready</div>' : ""}
    </div>
  `).join("");
}

socket.on("game_selected", ({ game }) => {
  $("topGameLabel").textContent = gameLabel(game);
});

socket.on("game_start", ({ game }) => {
  $("topGameLabel").textContent = gameLabel(game);
  startCountdown();
});

function gameLabel(g) {
  const map = { imposter:"🕵️ Who is the Imposter", trivial:"🎯 Trivial Quiz", reaction:"⚡ Reaction Royale",
    wouldyourather:"🤔 Would You Rather", mathquiz:"➕ Math Quiz", fasttyper:"⌨️ Fastest Typer",
    wordcrack:"🟩 Word Crack", codebreaker:"🔐 Code Breaker", roulette:"🎰 Russian Roulette", rapidfire:"🔥 Rapid Fire",
    hotpotato:"🥔 Hot Potato", wordchain:"🔗 Word Chain" };
  return map[g] || g;
}

/* ─── IMPOSTER ────────────────────────────────────────────────────── */

socket.on("imposter_round_start", ({ round, playerCount, numImposters, active }) => {
  $("topRound").style.display = "";
  $("topRound").textContent = `Round ${round}`;
  showView("imposter");
  $("impDisplayMsg").textContent = `${playerCount} players • ${numImposters} imposter${numImposters > 1 ? "s" : ""} • Say one word out loud!`;
  const list = active ? currentPlayers.filter(p => active.includes(p.id)) : currentPlayers.filter(p => !p.eliminated);
  $("impWordDisplay").innerHTML = list.map(p => `
    <div class="player-bubble">
      ${makeAvatarEl(p, 56)}
      <div class="pname">${esc(p.name)}</div>
      <div class="tag tag-purple" style="font-size:11px;">Ready</div>
    </div>
  `).join("");
});

socket.on("emergency_called", ({ by }) => {
  $("impDisplayMsg").textContent = `🚨 ${by} called an EMERGENCY!`;
});

socket.on("voting_start", ({ duration, players }) => {
  showView("imposter-voting");
  $("displayVoteProgress").textContent = "0/" + players.length + " voted";
  $("displayVoteBoard").innerHTML = players.map(p => `
    <div class="vote-row" id="dvote-${esc(p.id)}">
      ${makeAvatarEl(p)}
      <span class="vote-name">${esc(p.name)}</span>
      <div class="vote-indicator" id="dvote-ind-${esc(p.id)}"></div>
      <span class="vote-count" id="dvote-count-${esc(p.id)}">0</span>
    </div>
  `).join("");

  clearInterval(voteTimerInterval);
  voteTimerInterval = runBar("displayVoteTimer", duration);
});

socket.on("vote_cast", ({ totalVotes, totalVoters }) => {
  $("displayVoteProgress").textContent = `${totalVotes}/${totalVoters} voted`;
});

socket.on("voting_result", ({ tally, eliminatedId, eliminatedName, wasImposter, tie, noVotes, gameOver, word, imposterNames }) => {
  clearInterval(voteTimerInterval);
  Object.entries(tally).forEach(([id, count]) => {
    const countEl = $("dvote-count-" + id);
    const indEl = $("dvote-ind-" + id);
    if (countEl) countEl.textContent = count;
    if (indEl) indEl.innerHTML = Array(count).fill('<div class="vote-dot"></div>').join("");
  });
  const el = eliminatedId && $("dvote-" + eliminatedId);
  if (el) el.style.background = "rgba(239,68,68,0.2)";

  setTimeout(() => {
    let msg;
    if (tie) msg = "Tie vote! Nobody was eliminated.";
    else if (noVotes || !eliminatedName) msg = "Nobody voted. Nobody was eliminated.";
    else if (wasImposter) msg = `✅ ${eliminatedName} WAS the Imposter! (${word})`;
    else msg = `❌ ${eliminatedName} was NOT the Imposter... (${(imposterNames || []).join(", ")} was)`;
    $("impDisplayMsg").textContent = msg;
    showView("imposter");
  }, 1500);
});

/* ─── TRIVIAL ─────────────────────────────────────────────────────── */

socket.on("trivial_question", ({ round, total, question, options, duration }) => {
  showView("trivial");
  $("trivDisplayRound").textContent = `Round ${round}/${total}`;
  $("trivDisplayQ").textContent = question;
  const letters = ["A","B","C","D"];
  const colors = ["rgba(124,58,237,0.2)","rgba(6,182,212,0.2)","rgba(245,158,11,0.2)","rgba(239,68,68,0.2)"];
  const borderColors = ["rgba(124,58,237,0.5)","rgba(6,182,212,0.5)","rgba(245,158,11,0.5)","rgba(239,68,68,0.5)"];
  $("trivDisplayOpts").innerHTML = options.map((o, i) => `
    <div id="trivDisp-${i}" style="padding:14px 18px; border-radius:12px; background:${colors[i]}; border:2px solid ${borderColors[i]}; font-size:16px; font-weight:600; display:flex; align-items:center; gap:10px;">
      <span style="font-family:var(--font-mono); font-size:14px; font-weight:700; opacity:0.7;">${letters[i]}</span>${esc(o)}
    </div>
  `).join("");
  $("trivAnswerStatus").innerHTML = currentPlayers.map(p => `
    <div class="answer-chip" id="tchip-${esc(p.id)}">
      <div class="answer-dot waiting" id="tdot-${esc(p.id)}"></div>${esc(p.name)}
    </div>
  `).join("");
  clearInterval(trivTimerInterval);
  trivTimerInterval = runBar("trivDisplayTimer", duration);
});

socket.on("trivial_answer_received", ({ playerId }) => {
  const dot = $("tdot-" + playerId);
  const chip = $("tchip-" + playerId);
  if (dot) dot.className = "answer-dot answered";
  if (chip) chip.classList.add("done");
});

socket.on("trivial_reveal", ({ correctIndex, players }) => {
  clearInterval(trivTimerInterval);
  $("trivDisplayTimer").style.width = "0%";
  const el = $("trivDisp-" + correctIndex);
  if (el) el.style.background = "rgba(16,185,129,0.3)";
  updateLeaderboard(players);
});

/* ─── REACTION ────────────────────────────────────────────────────── */

socket.on("reaction_waiting", ({ round, players }) => {
  showView("reaction-dark");
  $("reactionDisplayText").textContent = `ROUND ${round}`;
  $("reactionDisplaySub").textContent = `${players.length} players. Tap when it flashes!`;
  $("reactionDisplayText").style.color = "#fff";
  $("view-reaction-dark").style.background = "#000";
  $("flashScreen").classList.remove("active");
});

socket.on("reaction_flash", () => {
  $("flashScreen").classList.add("active");
  $("view-reaction-dark").style.background = "#fff";
  $("reactionDisplayText").textContent = "TAP NOW!";
  $("reactionDisplayText").style.color = "#000";
  $("reactionDisplaySub").style.color = "rgba(0,0,0,0.5)";
  $("reactionDisplaySub").textContent = "1.5 seconds!";
  setTimeout(() => {
    $("flashScreen").classList.remove("active");
    $("view-reaction-dark").style.background = "#000";
    $("reactionDisplayText").style.color = "#fff";
    $("reactionDisplaySub").style.color = "rgba(255,255,255,0.4)";
  }, 1500);
});

socket.on("reaction_result", ({ survived, eliminated, players }) => {
  $("reactionDisplayText").textContent = eliminated.length > 0 ? `💥 ${eliminated.map(p => p.name).join(", ")} eliminated!` : "✅ Nobody eliminated!";
  $("reactionDisplaySub").textContent = `${survived.length} still in`;
  updateLeaderboard(players);
});

/* ─── WYR ─────────────────────────────────────────────────────────── */

let wyrTotalPlayers = 0;

socket.on("wyr_question", ({ round, total, optionA, optionB }) => {
  wyrTotalPlayers = currentPlayers.filter(p => !p.eliminated && !p.disconnected).length;
  showView("wyr");
  $("wyrDisplayRound").textContent = `Round ${round}/${total}`;
  $("wyrDisplayProgress").textContent = "0/" + wyrTotalPlayers + " voted";
  $("wyrDisplaySplit").innerHTML = `
    <div class="wyr-side a">
      <div style="font-size:28px; margin-bottom:8px;">🅰️</div>
      <div>${esc(optionA)}</div>
      <div class="wyr-pct" id="wyrDispPctA">—</div>
    </div>
    <div class="wyr-side b">
      <div style="font-size:28px; margin-bottom:8px;">🅱️</div>
      <div>${esc(optionB)}</div>
      <div class="wyr-pct" id="wyrDispPctB">—</div>
    </div>
  `;
});

socket.on("wyr_vote_received", ({ total }) => {
  $("wyrDisplayProgress").textContent = `${total}/${wyrTotalPlayers} voted`;
});

socket.on("wyr_reveal", ({ aVotes, bVotes, players }) => {
  const total = aVotes + bVotes || 1;
  const dispA = $("wyrDispPctA");
  const dispB = $("wyrDispPctB");
  if (dispA) dispA.textContent = Math.round((aVotes / total) * 100) + "%";
  if (dispB) dispB.textContent = Math.round((bVotes / total) * 100) + "%";
  updateLeaderboard(players);
});

/* ─── MATH ────────────────────────────────────────────────────────── */

socket.on("math_question", ({ round, total, question, duration }) => {
  showView("math");
  $("mathDisplayRound").textContent = `Round ${round}/${total}`;
  $("mathDisplayQ").textContent = question;
  $("mathAnswerStatus").innerHTML = currentPlayers.map(p => `
    <div class="answer-chip" id="mchip-${esc(p.id)}">
      <div class="answer-dot waiting" id="mdot-${esc(p.id)}"></div>${esc(p.name)}
    </div>
  `).join("");
  clearInterval(mathTimerInterval);
  mathTimerInterval = runBar("mathDisplayTimer", duration);
});

socket.on("math_answer_received", ({ playerId }) => {
  const dot = $("mdot-" + playerId);
  const chip = $("mchip-" + playerId);
  if (dot) dot.className = "answer-dot answered";
  if (chip) chip.classList.add("done");
});

socket.on("math_reveal", ({ players }) => {
  clearInterval(mathTimerInterval);
  $("mathDisplayTimer").style.width = "0%";
  updateLeaderboard(players);
});

/* ─── FAST TYPER ──────────────────────────────────────────────────── */

socket.on("typing_round", ({ round, total, prompt }) => {
  showView("fasttyper");
  $("typeDisplayRound").textContent = `Round ${round}/${total}`;
  $("typeDisplayPrompt").textContent = prompt;
  $("typeDisplayProgress").innerHTML = currentPlayers.filter(p => !p.eliminated).map(p => `
    <div class="typing-progress-row">
      ${makeAvatarEl(p, 32)}
      <span class="typing-progress-name">${esc(p.name)}</span>
      <div class="typing-bar-wrap"><div class="progress-bar"><div class="progress-fill" id="tpbar-${esc(p.id)}" style="width:0%"></div></div></div>
      <span class="typing-time" id="tptime-${esc(p.id)}">—</span>
    </div>
  `).join("");
});

socket.on("typing_player_done", ({ playerId, time, players }) => {
  const bar = $("tpbar-" + playerId);
  const timeEl = $("tptime-" + playerId);
  if (bar) bar.style.width = "100%";
  if (timeEl) timeEl.textContent = (time / 1000).toFixed(2) + "s";
  updateLeaderboard(players);
});

/* ─── WORD CRACK AND CODE BREAKER ─────────────────────────────────── */

function renderGuessGrid(targetId, grids) {
  const players = currentPlayers.filter(p => !p.eliminated);
  $(targetId).innerHTML = players.map(p => {
    const guesses = grids[p.id] || [];
    return `
      <div class="grid-player-card">
        <div class="grid-player-header">
          ${makeAvatarEl(p, 28)}
          <span>${esc(p.name)}</span>
          <span style="color:var(--text2); font-size:11px; margin-left:auto;">${guesses.length} ${guesses.length === 1 ? "try" : "tries"}</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:3px;">
          ${guesses.slice(-3).map(g => `
            <div style="display:flex; gap:3px;">
              ${g.guess.split("").map((c, i) => `<div class="wm-cell ${g.result[i]}">${esc(c)}</div>`).join("")}
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");
}

socket.on("wordcrack_round", ({ round, total, wordLength }) => {
  playerGrids = {};
  showView("wordcrack");
  $("wcDisplayRound").textContent = `Round ${round}/${total}`;
  $("wcDisplayMsg").textContent = `Find the hidden ${wordLength}-letter word!`;
  renderGuessGrid("wcDisplayGrid", playerGrids);
});

socket.on("wordcrack_grid_update", ({ grids }) => {
  playerGrids = grids;
  renderGuessGrid("wcDisplayGrid", playerGrids);
});

socket.on("wordcrack_solved", ({ name, word, players }) => {
  $("wcDisplayMsg").textContent = `🏆 ${name} cracked it! The word was: ${word}`;
  updateLeaderboard(players);
});

socket.on("wordcrack_timeout", ({ word }) => {
  $("wcDisplayMsg").textContent = `⏰ Time's up! The word was: ${word}`;
});

let cbGrids = {};

socket.on("codebreaker_round", ({ round, total }) => {
  cbGrids = {};
  showView("codebreaker");
  $("cbDisplayRound").textContent = `Round ${round}/${total}`;
  $("cbDisplayMsg").textContent = "Crack the 4-digit code!";
  renderGuessGrid("cbDisplayGrid", cbGrids);
});

socket.on("codebreaker_grid_update", ({ grids }) => {
  cbGrids = grids;
  renderGuessGrid("cbDisplayGrid", cbGrids);
});

socket.on("codebreaker_solved", ({ name, code: secret, players }) => {
  $("cbDisplayMsg").textContent = `🏆 ${name} cracked it! Code: ${secret}`;
  updateLeaderboard(players);
});

socket.on("codebreaker_timeout", ({ code: secret }) => {
  $("cbDisplayMsg").textContent = `⏰ Time's up! Code was: ${secret}`;
});

/* ─── ROULETTE ────────────────────────────────────────────────────── */

function updateRouletteDisplay(currentId) {
  const cur = currentPlayers.find(p => p.id === currentId);
  $("rouletteDisplayTurn").textContent = cur ? `${cur.name}'s Turn` : "Waiting...";
  $("rouletteDisplaySub").textContent = "Spin or Shoot?";
  $("rouletteDisplayPlayers").innerHTML = currentPlayers.filter(p => !p.eliminated).map(p => `
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px;border-radius:10px;background:${p.id===currentId?'rgba(124,58,237,0.2)':'var(--surface2)'};border:1px solid ${p.id===currentId?'var(--accent)':'var(--border)'};">
      ${makeAvatarEl(p, 36)}
      <span style="font-size:12px;font-weight:600;">${esc(p.name)}</span>
    </div>
  `).join("");
}

socket.on("roulette_round", ({ currentPlayer }) => {
  showView("roulette");
  $("rouletteDisplayGun").textContent = "🔫";
  updateRouletteDisplay(currentPlayer);
  $("rouletteDisplayChambers").innerHTML = Array(6).fill(0).map(() => `
    <div style="width:32px;height:32px;border-radius:50%;background:var(--surface2);border:2px solid var(--border);display:flex;align-items:center;justify-content:center;">○</div>
  `).join("");
});

socket.on("roulette_next", ({ currentPlayer }) => {
  $("rouletteDisplayGun").textContent = "🔫";
  updateRouletteDisplay(currentPlayer);
});

socket.on("roulette_spin", () => {
  $("rouletteDisplayGun").textContent = "🌀";
  $("rouletteDisplaySub").textContent = "Spinning the barrel...";
  setTimeout(() => { $("rouletteDisplayGun").textContent = "🔫"; }, 2000);
});

socket.on("roulette_safe", () => {
  $("rouletteDisplayGun").textContent = "💨";
  $("rouletteDisplaySub").textContent = "Click! Safe...";
  setTimeout(() => { $("rouletteDisplayGun").textContent = "🔫"; }, 1500);
});

socket.on("roulette_bang", ({ name }) => {
  $("rouletteDisplayGun").textContent = "💥";
  $("rouletteDisplayTurn").textContent = `💀 ${name} ELIMINATED!`;
  $("rouletteDisplayTurn").style.color = "var(--danger)";
  setTimeout(() => { $("rouletteDisplayTurn").style.color = ""; }, 3000);
});

/* ─── RAPID FIRE ──────────────────────────────────────────────────── */

socket.on("rapidfire_start", ({ duration, question }) => {
  showView("rapidfire");
  renderRFQuestion(question);
  clearInterval(rfTimerInterval);
  const end = Date.now() + duration;
  rfTimerInterval = setInterval(() => {
    const rem = Math.max(0, end - Date.now());
    $("rfDisplayTimer").style.width = (rem / duration * 100) + "%";
    if (rem <= 0) clearInterval(rfTimerInterval);
  }, 100);
});

socket.on("rapidfire_question", ({ question }) => {
  renderRFQuestion(question);
});

function renderRFQuestion(q) {
  $("rfDisplayQ").textContent = q.q;
  const sides = ["a","b","c","d"];
  const letters = ["A","B","C","D"];
  $("rfDisplayOpts").innerHTML = q.options.map((o, i) => `
    <div class="rf-opt ${sides[i]}"><span style="font-family:var(--font-mono);opacity:0.6;">${letters[i]}</span> ${esc(o)}</div>
  `).join("");
}

socket.on("rapidfire_update", ({ players }) => {
  updateLeaderboard(players);
});

socket.on("rapidfire_end", () => {
  clearInterval(rfTimerInterval);
});

/* ─── HOT POTATO ──────────────────────────────────────────────────── */

let potPlayers = [];
let potHolder = null;

function renderPotatoPlayers() {
  $("potDisplayPlayers").innerHTML = potPlayers.map(p => `
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px;border-radius:10px;background:${p.id===potHolder?'rgba(239,68,68,0.2)':'var(--surface2)'};border:1px solid ${p.id===potHolder?'var(--danger)':'var(--border)'};">
      ${makeAvatarEl(p, 36)}
      <span style="font-size:12px;font-weight:600;">${esc(p.name)}</span>
    </div>
  `).join("");
}

socket.on("potato_round", ({ round, holderId, holderName, players }) => {
  potPlayers = players;
  potHolder = holderId;
  showView("hotpotato");
  $("topRound").style.display = "";
  $("topRound").textContent = `Round ${round}`;
  $("potDisplayRound").textContent = `Round ${round}`;
  $("potDisplayIcon").classList.add("hot");
  $("potDisplayIcon").textContent = "🥔";
  $("potDisplayHolder").style.color = "";
  $("potDisplayHolder").textContent = `${holderName} has the potato!`;
  $("potDisplaySub").textContent = "Pass it on before it explodes!";
  renderPotatoPlayers();
});

socket.on("potato_pass", ({ fromName, toId, toName, passes }) => {
  potHolder = toId;
  $("potDisplayHolder").textContent = `${toName} has the potato!`;
  $("potDisplaySub").textContent = `${fromName} passed it (${passes} pass${passes === 1 ? "" : "es"})`;
  renderPotatoPlayers();
});

socket.on("potato_boom", ({ name, remaining, gameOver, players }) => {
  $("potDisplayIcon").classList.remove("hot");
  $("potDisplayIcon").textContent = "💥";
  $("potDisplayHolder").style.color = "var(--danger)";
  $("potDisplayHolder").textContent = `💀 ${name} EXPLODED!`;
  $("potDisplaySub").textContent = gameOver ? "We have a winner!" : `${remaining} players left`;
  potPlayers = potPlayers.filter(p => p.name !== name);
  renderPotatoPlayers();
  updateLeaderboard(players);
});

/* ─── WORD CHAIN ──────────────────────────────────────────────────── */

let chainTimerInterval = null;

function chainDisplayBar(duration) {
  clearInterval(chainTimerInterval);
  const end = Date.now() + duration;
  $("chainDisplayBar").style.width = "100%";
  chainTimerInterval = setInterval(() => {
    const left = Math.max(0, end - Date.now());
    $("chainDisplayBar").style.width = (left / duration * 100) + "%";
    if (left <= 0) clearInterval(chainTimerInterval);
  }, 100);
}

function chainDisplayRule(rule) {
  const el = $("chainDisplayRule");
  el.style.display = rule ? "block" : "none";
  el.textContent = rule ? "RULE ROUND: " + rule : "";
}

socket.on("chain_round", ({ round, total, seconds, rule }) => {
  clearInterval(chainTimerInterval);
  showView("wordchain");
  $("topRound").style.display = "";
  $("topRound").textContent = `Round ${round}`;
  $("chainDisplayRound").textContent = `Round ${round} / ${total} • ${seconds}s per turn`;
  $("chainDisplayTurn").style.color = "";
  $("chainDisplayTurn").textContent = rule ? "New rule!" : "Here we go";
  $("chainDisplaySub").textContent = "";
  chainDisplayRule(rule);
});

socket.on("chain_turn", ({ name, letter, duration, rule, recent, players }) => {
  showView("wordchain");
  $("chainDisplayLetter").textContent = letter.toUpperCase();
  $("chainDisplayTurn").style.color = "";
  $("chainDisplayTurn").textContent = `${name}'s turn`;
  $("chainDisplaySub").textContent = "";
  chainDisplayRule(rule);
  $("chainDisplayRecent").innerHTML = (recent || []).map(r => `<span class="tag tag-cyan">${esc(r.word)}</span>`).join("");
  chainDisplayBar(duration);
  updateLeaderboard(players);
});

socket.on("chain_word", ({ name, word, points, nextLetter, players }) => {
  clearInterval(chainTimerInterval);
  $("chainDisplayTurn").style.color = "var(--success)";
  $("chainDisplayTurn").textContent = `${name}: ${word}`;
  $("chainDisplaySub").textContent = `+${points} points. Next letter ${nextLetter.toUpperCase()}`;
  updateLeaderboard(players);
});

socket.on("chain_fail", ({ name, reason, lives, eliminated, penalty, gameOver, players }) => {
  clearInterval(chainTimerInterval);
  $("chainDisplayTurn").style.color = "var(--danger)";
  $("chainDisplayTurn").textContent = eliminated ? `${name} is OUT` : `${name}: ${reason}`;
  $("chainDisplaySub").textContent = gameOver ? "We have a winner!" : eliminated ? `-${penalty} points` : `-${penalty} points, ${lives} ${lives === 1 ? "life" : "lives"} left`;
  updateLeaderboard(players);
});

/* ─── GAME OVER ───────────────────────────────────────────────────── */

socket.on("game_over", ({ players }) => {
  currentPlayers = players;
  clearInterval(rfTimerInterval);
  clearInterval(chainTimerInterval);
  clearInterval(trivTimerInterval);
  clearInterval(mathTimerInterval);
  clearInterval(voteTimerInterval);
  showView("gameover");
  const winner = players[0];
  $("winnerDisplayName").textContent = winner ? winner.name : "—";
  $("gameoverLB").innerHTML = players.map((p, i) => `
    <div class="lb-row rank-${i+1}">
      <div class="lb-rank">${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</div>
      ${makeAvatarEl(p)}
      <span class="lb-name">${esc(p.name)}</span>
      <span class="lb-score">${p.score} pts</span>
    </div>
  `).join("");
  updateLeaderboard(players);
  launchConfetti();
});

socket.on("show_leaderboard", ({ players }) => {
  updateLeaderboard(players);
});

function launchConfetti() {
  const colors = ["#7c3aed","#06b6d4","#f59e0b","#10b981","#ef4444","#ec4899"];
  const container = document.createElement("div");
  container.className = "confetti";
  document.body.appendChild(container);
  for (let i = 0; i < 80; i++) {
    const el = document.createElement("div");
    const color = colors[Math.floor(Math.random() * colors.length)];
    el.style.cssText = `
      position:absolute; width:${6+Math.random()*8}px; height:${6+Math.random()*8}px;
      background:${color}; left:${Math.random()*100}vw; top:-20px;
      border-radius:${Math.random()>0.5?"50%":"2px"}; opacity:${0.6+Math.random()*0.4};
      animation: fall ${2+Math.random()*3}s ${Math.random()*2}s linear forwards;
    `;
    container.appendChild(el);
  }
  const style = document.createElement("style");
  style.textContent = `@keyframes fall { to { top: 110vh; transform: rotate(${Math.random()*720}deg); opacity:0; } }`;
  document.head.appendChild(style);
  setTimeout(() => { container.remove(); style.remove(); }, 6000);
}

showView("lobby");
