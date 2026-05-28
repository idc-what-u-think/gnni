const socket = io();

let roomCode = "";
let currentPlayers = [];
let voteTimerInterval = null;
let trivTimerInterval = null;
let mathTimerInterval = null;
let rfTimerInterval = null;
let playerGrids = {};

const AVATAR_COLORS = ["#7c3aed","#06b6d4","#f59e0b","#10b981","#ef4444","#ec4899","#8b5cf6","#14b8a6","#f97316","#6366f1"];

function $(id) { return document.getElementById(id); }

function showView(name) {
  document.querySelectorAll("[id^='view-']").forEach(el => el.style.display = "none");
  const el = $("view-" + name);
  if (el) { el.style.display = name === "reaction-dark" ? "flex" : (name === "lobby" ? "block" : "block"); }
}

function makeAvatarEl(player, size = 44) {
  if (player.avatar && player.avatar.startsWith("emoji:")) {
    const parts = player.avatar.split("|");
    const emoji = player.avatar.split(":")[1].split("|")[0];
    const color = parts[1] || "#7c3aed";
    return `<div class="avatar" style="width:${size}px;height:${size}px;background:${color};font-size:${Math.floor(size*0.5)}px;">${emoji}</div>`;
  } else if (player.avatar && player.avatar.startsWith("data:")) {
    return `<div class="avatar" style="width:${size}px;height:${size}px;"><img src="${player.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>`;
  }
  const color = AVATAR_COLORS[player.name.charCodeAt(0) % AVATAR_COLORS.length];
  return `<div class="avatar" style="width:${size}px;height:${size}px;background:${color};font-size:${Math.floor(size*0.4)}px;">${player.name.charAt(0).toUpperCase()}</div>`;
}

function updateLeaderboard(players) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  $("displayLeaderboard").innerHTML = sorted.map((p, i) => `
    <div class="lb-row rank-${i+1}" style="${p.eliminated ? 'opacity:0.35;' : ''}">
      <div class="lb-rank">${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i+1}</div>
      ${makeAvatarEl(p, 36)}
      <span class="lb-name">${p.name}</span>
      ${p.eliminated ? '<span class="lb-elim">OUT</span>' : ""}
      <span class="lb-score">${p.score}</span>
    </div>
  `).join("");
}

function startCountdown(cb) {
  showView("countdown");
  let n = 3;
  $("countdownNum").textContent = n;
  $("countdownNum").classList.add("scale-in");
  const t = setInterval(() => {
    n--;
    if (n <= 0) { clearInterval(t); cb(); return; }
    $("countdownNum").textContent = n;
    $("countdownNum").classList.remove("scale-in");
    void $("countdownNum").offsetWidth;
    $("countdownNum").classList.add("scale-in");
  }, 1000);
}

// Get QR + code + url on load
(async () => {
  const res = await fetch("/qr");
  const data = await res.json();
  roomCode = "JOINING";
  $("displayUrl").textContent = data.url;
  $("qrImg").src = data.qr;
})();

socket.emit("display_join", { code: "JOINING" });

socket.on("connect", () => {
  fetch("/qr").then(r => r.json()).then(data => {
    $("displayUrl").textContent = data.url;
    $("qrImg").src = data.qr;
  });
});

socket.on("room_state", ({ players, phase, game }) => {
  currentPlayers = players;
  updateLeaderboard(players);
  updateLobbyPlayers(players);
  if (phase === "lobby" || phase === "settings") showView("lobby");
});

function updateLobbyPlayers(players) {
  $("lobbyPlayersGrid").innerHTML = players.map(p => `
    <div class="player-bubble ${p.ready ? "ready" : ""}">
      ${makeAvatarEl(p, 56)}
      <div class="pname">${p.name}</div>
      ${p.ready ? '<div class="tag tag-green" style="font-size:11px;">Ready</div>' : ""}
    </div>
  `).join("");
}

socket.on("room_created", ({ code }) => {
  roomCode = code;
  $("displayCode").textContent = code;
  socket.emit("display_join", { code });
});

socket.on("game_selected", ({ game }) => {
  $("topGameLabel").textContent = gameLabel(game);
});

socket.on("game_start", ({ game, settings }) => {
  $("topGameLabel").textContent = gameLabel(game);
  startCountdown(() => {});
});

function gameLabel(g) {
  const map = { imposter:"🕵️ Who is the Imposter", trivial:"🎯 Trivial Quiz", reaction:"⚡ Reaction Royale",
    wouldyourather:"🤔 Would You Rather", mathquiz:"➕ Math Quiz", fasttyper:"⌨️ Fastest Typer",
    wordcrack:"🟩 Word Crack", codebreaker:"🔐 Code Breaker", roulette:"🎰 Russian Roulette", rapidfire:"🔥 Rapid Fire" };
  return map[g] || g;
}

// ─── IMPOSTER ─────────────────────────────────────────────────────────
socket.on("imposter_round_start", ({ round, playerCount, numImposters }) => {
  $("topRound").style.display = "";
  $("topRound").textContent = `Round ${round}`;
  showView("imposter");
  $("impDisplayMsg").textContent = `${playerCount} players • ${numImposters} imposter${numImposters > 1 ? "s" : ""} • Say one word out loud!`;
  $("impWordDisplay").innerHTML = currentPlayers.filter(p => !p.eliminated).map(p => `
    <div class="player-bubble" id="imp-bubble-${p.id}">
      ${makeAvatarEl(p, 56)}
      <div class="pname">${p.name}</div>
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
    <div class="vote-row" id="dvote-${p.id}">
      ${makeAvatarEl(p)}
      <span class="vote-name">${p.name}</span>
      <div class="vote-indicator" id="dvote-ind-${p.id}"></div>
      <span class="vote-count" id="dvote-count-${p.id}">0</span>
    </div>
  `).join("");

  let secs = Math.floor(duration / 1000);
  $("displayVoteTimer").style.width = "100%";
  clearInterval(voteTimerInterval);
  voteTimerInterval = setInterval(() => {
    secs--;
    $("displayVoteTimer").style.width = Math.max(0, (secs / (duration / 1000)) * 100) + "%";
    if (secs <= 0) clearInterval(voteTimerInterval);
  }, 1000);
});

socket.on("vote_cast", ({ totalVotes, totalVoters }) => {
  $("displayVoteProgress").textContent = `${totalVotes}/${totalVoters} voted`;
});

socket.on("voting_result", ({ tally, eliminatedId, eliminatedName, wasImposter, gameOver, word, imposterNames }) => {
  clearInterval(voteTimerInterval);
  Object.entries(tally).forEach(([id, count]) => {
    const countEl = $("dvote-count-" + id);
    const indEl = $("dvote-ind-" + id);
    if (countEl) countEl.textContent = count;
    if (indEl) indEl.innerHTML = Array(count).fill('<div class="vote-dot"></div>').join("");
  });
  const el = $("dvote-" + eliminatedId);
  if (el) el.style.background = "rgba(239,68,68,0.2)";

  setTimeout(() => {
    const msg = wasImposter
      ? `✅ ${eliminatedName} WAS the Imposter! (${word})`
      : `❌ ${eliminatedName} was NOT the Imposter... (${imposterNames?.join(", ")} was)`;
    $("impDisplayMsg").textContent = msg;
    if (gameOver) {
      setTimeout(() => showView("lobby"), 5000);
    }
  }, 1000);
});

// ─── TRIVIAL ──────────────────────────────────────────────────────────
let trivDuration = 20;
socket.on("trivial_question", ({ round, total, question, options, type, duration }) => {
  trivDuration = duration / 1000;
  showView("trivial");
  $("trivDisplayRound").textContent = `Round ${round}/${total}`;
  $("trivDisplayQ").textContent = question;
  const letters = ["A","B","C","D"];
  const colors = ["rgba(124,58,237,0.2)","rgba(6,182,212,0.2)","rgba(245,158,11,0.2)","rgba(239,68,68,0.2)"];
  const borderColors = ["rgba(124,58,237,0.5)","rgba(6,182,212,0.5)","rgba(245,158,11,0.5)","rgba(239,68,68,0.5)"];
  $("trivDisplayOpts").innerHTML = options.map((o, i) => `
    <div id="trivDisp-${i}" style="padding:14px 18px; border-radius:12px; background:${colors[i]}; border:2px solid ${borderColors[i]}; font-size:16px; font-weight:600; display:flex; align-items:center; gap:10px;">
      <span style="font-family:var(--font-mono); font-size:14px; font-weight:700; opacity:0.7;">${letters[i]}</span>${o}
    </div>
  `).join("");
  $("trivAnswerStatus").innerHTML = currentPlayers.map(p => `
    <div class="answer-chip" id="tchip-${p.id}">
      <div class="answer-dot waiting" id="tdot-${p.id}"></div>${p.name}
    </div>
  `).join("");
  $("trivDisplayTimer").style.width = "100%";
  clearInterval(trivTimerInterval);
  let secs = trivDuration;
  trivTimerInterval = setInterval(() => {
    secs--;
    $("trivDisplayTimer").style.width = Math.max(0, (secs / trivDuration) * 100) + "%";
    if (secs <= 0) clearInterval(trivTimerInterval);
  }, 1000);
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

// ─── REACTION ─────────────────────────────────────────────────────────
socket.on("reaction_waiting", ({ round, players }) => {
  showView("reaction-dark");
  $("reactionDisplayText").textContent = `ROUND ${round}`;
  $("reactionDisplaySub").textContent = `${players.length} players — Tap when it flashes!`;
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
  $("reactionDisplayText").textContent = eliminated.length > 0 ? `💥 ${eliminated.map(p => p.name).join(", ")} eliminated!` : "✅ Everyone survived!";
  $("reactionDisplaySub").textContent = `${survived.length} survived`;
  updateLeaderboard(players);
});

// ─── WYR ──────────────────────────────────────────────────────────────
let wyrTotalPlayers = 0;
socket.on("wyr_question", ({ round, total, optionA, optionB }) => {
  wyrTotalPlayers = currentPlayers.filter(p => !p.eliminated).length;
  showView("wyr");
  $("wyrDisplayRound").textContent = `Round ${round}/${total}`;
  $("wyrDisplayProgress").textContent = "0/" + wyrTotalPlayers + " voted";
  $("wyrDisplaySplit").innerHTML = `
    <div class="wyr-side a">
      <div style="font-size:28px; margin-bottom:8px;">🅰️</div>
      <div>${optionA}</div>
      <div class="wyr-pct" id="wyrDispPctA">—</div>
    </div>
    <div class="wyr-side b">
      <div style="font-size:28px; margin-bottom:8px;">🅱️</div>
      <div>${optionB}</div>
      <div class="wyr-pct" id="wyrDispPctB">—</div>
    </div>
  `;
});

socket.on("wyr_vote_received", ({ total }) => {
  $("wyrDisplayProgress").textContent = `${total}/${wyrTotalPlayers} voted`;
});

socket.on("wyr_reveal", ({ aVotes, bVotes, players }) => {
  const total = aVotes + bVotes || 1;
  const pctA = Math.round((aVotes / total) * 100);
  const pctB = Math.round((bVotes / total) * 100);
  const dispA = $("wyrDispPctA");
  const dispB = $("wyrDispPctB");
  if (dispA) dispA.textContent = pctA + "%";
  if (dispB) dispB.textContent = pctB + "%";
  updateLeaderboard(players);
});

// ─── MATH ─────────────────────────────────────────────────────────────
let mathDuration = 15;
socket.on("math_question", ({ round, total, question, duration }) => {
  mathDuration = duration / 1000;
  showView("math");
  $("mathDisplayRound").textContent = `Round ${round}/${total}`;
  $("mathDisplayQ").textContent = question;
  $("mathAnswerStatus").innerHTML = currentPlayers.map(p => `
    <div class="answer-chip" id="mchip-${p.id}">
      <div class="answer-dot waiting" id="mdot-${p.id}"></div>${p.name}
    </div>
  `).join("");
  $("mathDisplayTimer").style.width = "100%";
  clearInterval(mathTimerInterval);
  let secs = mathDuration;
  mathTimerInterval = setInterval(() => {
    secs--;
    $("mathDisplayTimer").style.width = Math.max(0, (secs / mathDuration) * 100) + "%";
    if (secs <= 0) clearInterval(mathTimerInterval);
  }, 1000);
});

socket.on("math_answer_received", ({ playerId }) => {
  const dot = $("mdot-" + playerId);
  const chip = $("mchip-" + playerId);
  if (dot) dot.className = "answer-dot answered";
  if (chip) chip.classList.add("done");
});

socket.on("math_reveal", ({ correctIndex, players }) => {
  clearInterval(mathTimerInterval);
  $("mathDisplayTimer").style.width = "0%";
  updateLeaderboard(players);
});

// ─── FAST TYPER ───────────────────────────────────────────────────────
socket.on("typing_round", ({ round, total, prompt }) => {
  showView("fasttyper");
  $("typeDisplayRound").textContent = `Round ${round}/${total}`;
  $("typeDisplayPrompt").textContent = prompt;
  $("typeDisplayProgress").innerHTML = currentPlayers.filter(p => !p.eliminated).map(p => `
    <div class="typing-progress-row" id="tprow-${p.id}">
      ${makeAvatarEl(p, 32)}
      <span class="typing-progress-name">${p.name}</span>
      <div class="typing-bar-wrap"><div class="progress-bar"><div class="progress-fill" id="tpbar-${p.id}" style="width:0%"></div></div></div>
      <span class="typing-time" id="tptime-${p.id}">—</span>
    </div>
  `).join("");
});

socket.on("typing_player_done", ({ playerId, position, time, accuracy, players }) => {
  const bar = $("tpbar-" + playerId);
  const timeEl = $("tptime-" + playerId);
  if (bar) bar.style.width = "100%";
  if (timeEl) timeEl.textContent = (time / 1000).toFixed(2) + "s";
  updateLeaderboard(players);
});

// ─── WORD CRACK ───────────────────────────────────────────────────────
socket.on("wordcrack_round", ({ round, total, wordLength }) => {
  playerGrids = {};
  showView("wordcrack");
  $("wcDisplayRound").textContent = `Round ${round}/${total}`;
  $("wcDisplayMsg").textContent = `Find the hidden ${wordLength}-letter word!`;
  renderWCDisplayGrid();
});

socket.on("wordcrack_grid_update", ({ playerId, grids }) => {
  playerGrids = grids;
  renderWCDisplayGrid();
});

function renderWCDisplayGrid() {
  const players = currentPlayers.filter(p => !p.eliminated);
  $("wcDisplayGrid").innerHTML = players.map(p => {
    const guesses = playerGrids[p.id] || [];
    return `
      <div class="grid-player-card">
        <div class="grid-player-header">
          ${makeAvatarEl(p, 28)}
          <span>${p.name}</span>
          <span style="color:var(--text2); font-size:11px; margin-left:auto;">${guesses.length} guess${guesses.length !== 1 ? "es" : ""}</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:3px;">
          ${guesses.slice(-3).map(g => `
            <div style="display:flex; gap:3px;">
              ${g.guess.split("").map((c, i) => `
                <div class="wm-cell ${g.result[i]}">${c}</div>
              `).join("")}
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");
}

socket.on("wordcrack_solved", ({ name, word, players }) => {
  $("wcDisplayMsg").textContent = `🏆 ${name} cracked it! The word was: ${word}`;
  updateLeaderboard(players);
});

// ─── CODE BREAKER ─────────────────────────────────────────────────────
let cbGrids = {};
socket.on("codebreaker_round", ({ round, total }) => {
  cbGrids = {};
  showView("codebreaker");
  $("cbDisplayRound").textContent = `Round ${round}/${total}`;
  $("cbDisplayMsg").textContent = "Crack the 4-digit code!";
  renderCBDisplayGrid();
});

socket.on("codebreaker_grid_update", ({ playerId, grids }) => {
  cbGrids = grids;
  renderCBDisplayGrid();
});

function renderCBDisplayGrid() {
  const players = currentPlayers.filter(p => !p.eliminated);
  $("cbDisplayGrid").innerHTML = players.map(p => {
    const guesses = cbGrids[p.id] || [];
    return `
      <div class="grid-player-card">
        <div class="grid-player-header">
          ${makeAvatarEl(p, 28)}
          <span>${p.name}</span>
          <span style="color:var(--text2); font-size:11px; margin-left:auto;">${guesses.length} tries</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:3px;">
          ${guesses.slice(-3).map(g => `
            <div style="display:flex; gap:3px;">
              ${g.guess.split("").map((c, i) => `
                <div class="wm-cell ${g.result[i]}">${c}</div>
              `).join("")}
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");
}

socket.on("codebreaker_solved", ({ name, code: secret, players }) => {
  $("cbDisplayMsg").textContent = `🏆 ${name} cracked it! Code: ${secret}`;
  updateLeaderboard(players);
});

// ─── ROULETTE ─────────────────────────────────────────────────────────
socket.on("roulette_round", ({ order }) => {
  showView("roulette");
  $("rouletteDisplayGun").textContent = "🔫";
  updateRouletteDisplay(order.map(p => p.name), order[0]);
  $("rouletteDisplayChambers").innerHTML = Array(6).fill(0).map((_, i) => `
    <div style="width:32px;height:32px;border-radius:50%;background:${i===0?'rgba(239,68,68,0.3)':'var(--surface2)'};border:2px solid ${i===0?'var(--danger)':'var(--border)'};display:flex;align-items:center;justify-content:center;">
      ${i === 0 ? "●" : "○"}
    </div>
  `).join("");
});

function updateRouletteDisplay(names, currentId) {
  const cur = currentPlayers.find(p => p.id === currentId);
  $("rouletteDisplayTurn").textContent = cur ? `${cur.name}'s Turn` : "Waiting...";
  $("rouletteDisplaySub").textContent = "Spin or Shoot?";
  $("rouletteDisplayPlayers").innerHTML = currentPlayers.filter(p => !p.eliminated).map(p => `
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px;border-radius:10px;background:${p.id===currentId?'rgba(124,58,237,0.2)':'var(--surface2)'};border:1px solid ${p.id===currentId?'var(--accent)':'var(--border)'};">
      ${makeAvatarEl(p, 36)}
      <span style="font-size:12px;font-weight:600;">${p.name}</span>
    </div>
  `).join("");
}

socket.on("roulette_next", ({ currentPlayer, name }) => {
  $("rouletteDisplayTurn").textContent = `${name}'s Turn`;
  $("rouletteDisplayGun").textContent = "🔫";
  updateRouletteDisplay([], currentPlayer);
});

socket.on("roulette_spin", ({ playerId }) => {
  $("rouletteDisplayGun").textContent = "🌀";
  $("rouletteDisplaySub").textContent = "Spinning the barrel...";
  setTimeout(() => { $("rouletteDisplayGun").textContent = "🔫"; }, 2000);
});

socket.on("roulette_safe", ({ playerId }) => {
  $("rouletteDisplayGun").textContent = "💨";
  $("rouletteDisplaySub").textContent = "Click! Safe...";
  setTimeout(() => { $("rouletteDisplayGun").textContent = "🔫"; }, 1500);
});

socket.on("roulette_bang", ({ playerId, name }) => {
  $("rouletteDisplayGun").textContent = "💥";
  $("rouletteDisplayTurn").textContent = `💀 ${name} ELIMINATED!`;
  $("rouletteDisplayTurn").style.color = "var(--danger)";
  setTimeout(() => { $("rouletteDisplayTurn").style.color = ""; }, 3000);
});

// ─── RAPID FIRE ───────────────────────────────────────────────────────
let rfTotalDuration = 60000;
let rfEndTime = 0;
socket.on("rapidfire_start", ({ duration, question }) => {
  rfTotalDuration = duration;
  rfEndTime = Date.now() + duration;
  showView("rapidfire");
  renderRFQuestion(question);
  clearInterval(rfTimerInterval);
  rfTimerInterval = setInterval(() => {
    const rem = Math.max(0, rfEndTime - Date.now());
    $("rfDisplayTimer").style.width = (rem / rfTotalDuration * 100) + "%";
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
    <div class="rf-opt ${sides[i]}"><span style="font-family:var(--font-mono);opacity:0.6;">${letters[i]}</span> ${o}</div>
  `).join("");
}

socket.on("rapidfire_update", ({ players }) => {
  updateLeaderboard(players);
});

socket.on("rapidfire_end", () => {
  clearInterval(rfTimerInterval);
});

// ─── GAME OVER ────────────────────────────────────────────────────────
socket.on("game_over", ({ players }) => {
  currentPlayers = players;
  clearInterval(rfTimerInterval);
  clearInterval(trivTimerInterval);
  clearInterval(mathTimerInterval);
  clearInterval(voteTimerInterval);
  showView("gameover");
  const winner = players[0];
  $("winnerDisplayName").textContent = winner?.name || "—";
  $("gameoverLB").innerHTML = players.map((p, i) => `
    <div class="lb-row rank-${i+1}">
      <div class="lb-rank">${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</div>
      ${makeAvatarEl(p)}
      <span class="lb-name">${p.name}</span>
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
