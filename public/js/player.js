const socket = io();

let myId = null;
let myName = "";
let myAvatar = null;
let roomCode = "";
let myReconnectToken = null;
let hasEmergency = true;
let hasVoted = false;
let typingStartTime = null;
let typingPrompt = "";
let typingErrors = 0;
let typingPrevLen = 0;
let typingKeys = 0;
let rfTimer = null;
let rfQi = 0;
let reactionActive = false;
let reactionTapped = false;
let voteCandidates = [];
let voteTimer = null;

const AVATARS = ["🐶","🐱","🦊","🐼","🐨","🐯","🦁","🐸","🦋","🐙","🦄","🐲","🤖","👻","🎃","🦸","🧙","🧟","🎮","⚡"];
const AVATAR_COLORS = ["#7c3aed","#06b6d4","#f59e0b","#10b981","#ef4444","#ec4899","#8b5cf6","#14b8a6","#f97316","#6366f1"];
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const EMOJI_RE = /^emoji:([^|:<>"'\s]{1,12})\|(#[0-9a-fA-F]{3,8})$/u;
const IMG_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

function $(id) { return document.getElementById(id); }

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function store(key, val) {
  try {
    if (val === undefined) return localStorage.getItem(key);
    if (val === null) localStorage.removeItem(key);
    else localStorage.setItem(key, val);
  } catch (e) {}
  return null;
}

function clearSession() {
  ["gn_token", "gn_code", "gn_name", "gn_avatar"].forEach(k => store(k, null));
  myReconnectToken = null;
}

function showScreen(name) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const el = $("screen-" + name);
  if (el) { el.classList.add("active"); el.classList.add("fade-in"); }
}

function showSnackbar(msg, type = "") {
  const old = document.querySelector(".snackbar");
  if (old) old.remove();
  const el = document.createElement("div");
  el.className = "snackbar";
  el.style.color = type === "error" ? "var(--danger)" : type === "success" ? "var(--success)" : "var(--text)";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function makeAvatarEl(player) {
  const a = player.avatar || "";
  const m = EMOJI_RE.exec(a);
  if (m) return `<div class="avatar" style="background:${m[2]}; font-size:22px;">${esc(m[1])}</div>`;
  if (IMG_RE.test(a)) return `<div class="avatar"><img src="${a}" alt=""></div>`;
  const name = String(player.name || "?");
  const color = AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
  return `<div class="avatar" style="background:${color}">${esc(name.charAt(0).toUpperCase())}</div>`;
}

function clearTimers() {
  clearInterval(rfTimer);
  clearInterval(trivTimer);
  clearInterval(mathTimer);
  clearInterval(voteTimer);
  clearInterval(chainTimer);
}

function runBar(barId, duration, holder) {
  let secs = Math.max(1, Math.round(duration / 1000));
  const total = secs;
  $(barId).style.width = "100%";
  return setInterval(() => {
    secs--;
    $(barId).style.width = Math.max(0, (secs / total) * 100) + "%";
  }, 1000);
}

/* ─── AVATAR PICKER ───────────────────────────────────────────────── */

const grid = $("emojiGrid");
AVATARS.forEach((emoji, i) => {
  const div = document.createElement("div");
  div.className = "avatar-opt";
  div.style.background = AVATAR_COLORS[i % AVATAR_COLORS.length];
  div.style.fontSize = "22px";
  div.textContent = emoji;
  div.onclick = () => {
    document.querySelectorAll(".avatar-opt").forEach(a => a.classList.remove("selected"));
    div.classList.add("selected");
    $("avatarPreview").style.display = "none";
    $("avatarUploadBtn").style.display = "flex";
    myAvatar = `emoji:${emoji}|${AVATAR_COLORS[i % AVATAR_COLORS.length]}`;
  };
  grid.appendChild(div);
});

$("avatarFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const size = 96;
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const side = Math.min(img.width, img.height);
      c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      myAvatar = c.toDataURL("image/jpeg", 0.8);
      $("avatarPreview").src = myAvatar;
      $("avatarPreview").style.display = "block";
      $("avatarUploadBtn").style.display = "none";
    };
    img.onerror = () => showSnackbar("Could not read that image", "error");
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

/* ─── ROOM CODE PAD ───────────────────────────────────────────────── */

let codeChars = [];

function buildNumPad(container, onChar, onDel) {
  CODE_CHARS.split("").forEach(k => {
    const btn = document.createElement("div");
    btn.className = "num-btn";
    btn.textContent = k;
    btn.onclick = () => onChar(k);
    container.appendChild(btn);
  });
  const del = document.createElement("div");
  del.className = "num-btn del"; del.textContent = "⌫"; del.onclick = onDel;
  container.appendChild(del);
}

buildNumPad($("numPad"),
  (k) => { if (codeChars.length < 4) { codeChars.push(k); updateCodeDisplay(); } },
  () => { codeChars.pop(); updateCodeDisplay(); }
);

function updateCodeDisplay() {
  for (let i = 0; i < 4; i++) {
    const el = $("d" + i);
    el.textContent = codeChars[i] || "_";
    el.classList.toggle("filled", !!codeChars[i]);
  }
}

(function prefillFromUrl() {
  const q = new URLSearchParams(location.search).get("code");
  const code = (q || "").toUpperCase();
  if (code.length === 4 && code.split("").every(c => CODE_CHARS.includes(c))) {
    if (store("gn_code") !== code) clearSession();
    codeChars = code.split("");
    updateCodeDisplay();
  }
})();

$("joinBtn").onclick = () => {
  const name = $("nameInput").value.trim();
  const code = codeChars.join("");
  if (!name) { $("joinError").textContent = "Enter your name"; return; }
  if (code.length !== 4) { $("joinError").textContent = "Enter the 4-letter room code"; return; }
  $("joinError").textContent = "";
  myName = name;
  roomCode = code;
  if (!myAvatar) {
    const color = AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
    myAvatar = `emoji:${AVATARS[Math.floor(Math.random() * AVATARS.length)]}|${color}`;
  }
  socket.emit("player_join", { code, name, avatar: myAvatar });
};

/* ─── CONNECTION ──────────────────────────────────────────────────── */

socket.on("connect", () => {
  const token = store("gn_token");
  const code = store("gn_code");
  const name = store("gn_name");
  if (token && code && name) {
    myName = name;
    roomCode = code;
    const nameInput = $("nameInput");
    if (nameInput && !nameInput.value) nameInput.value = name;
    if (!codeChars.length) { codeChars = code.split(""); updateCodeDisplay(); }
    socket.emit("player_join", { code, name, avatar: store("gn_avatar") || null, reconnectToken: token });
  }
});

socket.on("disconnect", () => {
  showSnackbar("Connection lost. Reconnecting...", "error");
});

socket.on("joined", ({ player, code, reconnectToken }) => {
  myId = player.id;
  myName = player.name;
  roomCode = code;
  if (reconnectToken) {
    myReconnectToken = reconnectToken;
    store("gn_token", reconnectToken);
    store("gn_code", code);
    store("gn_name", player.name);
    store("gn_avatar", player.avatar || "");
  }
  showScreen("waiting");
  $("waitRoomCode").textContent = `Room: ${code}`;
});

socket.on("error", ({ msg }) => {
  if (msg === "Room not found") {
    clearSession();
    showScreen("join");
  }
  $("joinError").textContent = msg;
  showSnackbar(msg, "error");
});

socket.on("kicked", () => {
  clearSession();
  clearTimers();
  showScreen("join");
  showSnackbar("You were kicked by the host", "error");
});

socket.on("room_state", ({ players, phase }) => {
  if (phase === "lobby" || phase === "settings" || phase === "ended") {
    $("waitPlayerCount").textContent = players.filter(p => !p.disconnected).length;
    $("waitPlayerList").innerHTML = players.map(p => `
      <div class="player-row" style="${p.disconnected ? "opacity:0.45;" : ""}">
        ${makeAvatarEl(p)}
        <span class="player-name">
          ${esc(p.name)}${p.id === myId ? " (You)" : ""}
          ${p.disconnected ? " 🔴" : ""}
        </span>
        ${p.disconnected
          ? '<span class="tag">Reconnecting...</span>'
          : p.ready
            ? '<span class="tag tag-green">Ready</span>'
            : '<span class="tag">Waiting</span>'
        }
      </div>
    `).join("");
  }
});

socket.on("player_reconnected", ({ id, name }) => {
  if (id !== myId) showSnackbar(`${name} reconnected`);
});

socket.on("player_disconnected", ({ id, name }) => {
  if (id !== myId) showSnackbar(`${name} disconnected`);
});

function toggleReady() {
  socket.emit("player_ready", { code: roomCode });
}

socket.on("game_selected", ({ game }) => {
  showSnackbar("Game: " + gameLabel(game));
});

socket.on("game_start", ({ game }) => {
  hasEmergency = true;
  hasVoted = false;
  showSnackbar("Starting " + gameLabel(game) + "...");
});

function gameLabel(g) {
  const map = { imposter:"Who is the Imposter", trivial:"Trivial Quiz", reaction:"Reaction Royale",
    wouldyourather:"Would You Rather", mathquiz:"Math Quiz", fasttyper:"Fastest Typer",
    wordcrack:"Word Crack", codebreaker:"Code Breaker", roulette:"Russian Roulette", rapidfire:"Rapid Fire",
    hotpotato:"Hot Potato", wordchain:"Word Chain" };
  return map[g] || g;
}

/* ─── SESSION LEADERBOARD ─────────────────────────────────────────── */

socket.on("session_leaderboard", ({ leaderboard }) => {
  renderSessionLB(leaderboard);
});

function renderSessionLB(leaderboard) {
  const goEl = $("sessionLBGameOver");
  const waitEl = $("sessionLBWaiting");

  const rows = leaderboard.map((p, i) => `
    <div style="display:flex; align-items:center; gap:10px; padding:10px 14px; background:var(--surface2); border-radius:10px; border:1px solid var(--border); margin-bottom:8px;">
      <div style="font-family:var(--font-mono); font-weight:700; font-size:16px; width:28px; color:${i===0?"#fbbf24":i===1?"#94a3b8":i===2?"#cd7c2f":"var(--text2)"};">
        ${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}
      </div>
      ${makeAvatarEl(p)}
      <span style="flex:1; font-weight:600; font-size:14px;">${esc(p.name)}${p.name===myName?" (You)":""}</span>
      <div style="display:flex; flex-direction:column; align-items:flex-end; gap:2px;">
        <span style="font-family:var(--font-mono); font-weight:700; font-size:16px; color:var(--accent2);">${p.totalScore}</span>
        <span style="font-size:11px; color:var(--text2);">${p.gamesPlayed}g · ${p.wins}W</span>
      </div>
    </div>
  `).join("");

  if (goEl) goEl.innerHTML = leaderboard.length ? rows : '<span style="color:var(--text2); font-size:13px;">No games yet</span>';
  if (waitEl) {
    waitEl.innerHTML = leaderboard.length ? rows : "";
    const wrap = $("sessionLBWaitingWrap");
    if (wrap) wrap.style.display = leaderboard.length ? "block" : "none";
  }
}

function requestSessionLB() {
  socket.emit("request_session_leaderboard", { code: roomCode });
}

/* ─── IMPOSTER ────────────────────────────────────────────────────── */

socket.on("imposter_round_start", ({ round, active }) => {
  clearInterval(voteTimer);
  $("impRound").textContent = round;
  $("imposter-voting-screen").style.display = "none";
  $("imposter-role-screen").style.display = "block";
  if (active && !active.includes(myId)) { showScreen("spectator"); return; }
  showScreen("imposter");
});

socket.on("imposter_role", ({ isImposter, word, emergencyAvailable }) => {
  hasEmergency = emergencyAvailable !== false;
  const display = $("impRoleDisplay");
  const instr = $("impInstruction");
  if (isImposter) {
    display.innerHTML = `<div class="imposter-reveal">IMPOSTER</div>`;
    instr.textContent = "Say something vague. Don't get caught!";
  } else {
    display.innerHTML = `<div class="word-reveal">${esc(word)}</div>`;
    instr.textContent = "Say a word close to this. Don't say the actual word!";
  }
  $("emergencyBtn").disabled = !hasEmergency;
  $("emergencyStatus").textContent = hasEmergency ? "You have 1 emergency call" : "Emergency used";
});

socket.on("emergency_called", ({ by }) => {
  showSnackbar(`${by} called an emergency!`);
});

socket.on("voting_start", ({ duration, players }) => {
  hasVoted = false;
  voteCandidates = players;
  const imIn = players.some(p => p.id === myId);
  $("imposter-role-screen").style.display = "none";
  $("imposter-voting-screen").style.display = "block";
  $("voteStatus").textContent = imIn ? "Tap a player to vote them out" : "You are out. Watching the vote.";

  const list = $("votePlayerList");
  list.innerHTML = imIn ? players.filter(p => p.id !== myId).map(p => `
    <div class="vote-player" data-id="${esc(p.id)}">
      ${makeAvatarEl(p)}
      <span style="font-weight:600; font-size:15px;">${esc(p.name)}</span>
    </div>
  `).join("") : "";
  list.querySelectorAll(".vote-player").forEach(el => { el.onclick = () => castVote(el.dataset.id); });

  clearInterval(voteTimer);
  voteTimer = runBar("voteTimerBar", duration);
});

function callEmergency() {
  if (!hasEmergency) return;
  hasEmergency = false;
  $("emergencyBtn").disabled = true;
  $("emergencyStatus").textContent = "Emergency used";
  socket.emit("player_emergency", { code: roomCode });
}

function castVote(targetId) {
  if (hasVoted) return;
  hasVoted = true;
  const target = voteCandidates.find(p => p.id === targetId);
  document.querySelectorAll(".vote-player").forEach(el => {
    el.style.pointerEvents = "none";
    el.style.opacity = "0.5";
    if (el.dataset.id === targetId) { el.style.opacity = "1"; el.classList.add("selected"); }
  });
  $("voteStatus").textContent = `Voted for ${target ? target.name : "player"}`;
  socket.emit("player_vote", { code: roomCode, targetId });
}

socket.on("vote_cast", ({ totalVotes, totalVoters }) => {
  if (hasVoted) $("voteStatus").textContent = `${totalVotes}/${totalVoters} voted`;
});

socket.on("voting_result", ({ eliminatedId, eliminatedName, wasImposter, tie, noVotes, gameOver, imposterNames }) => {
  clearInterval(voteTimer);
  let msg;
  if (tie) msg = "Tie vote. Nobody was eliminated.";
  else if (noVotes || !eliminatedName) msg = "Nobody voted. Nobody was eliminated.";
  else if (wasImposter) msg = `${eliminatedName} was the Imposter! Crewmates win!`;
  else msg = `${eliminatedName} was NOT the imposter. (${(imposterNames || []).join(", ")} was)`;
  showSnackbar(msg);
  if (eliminatedId === myId) setTimeout(() => showScreen("spectator"), 3000);
  else if (gameOver) setTimeout(() => showScreen("waiting"), 4000);
});

/* ─── TRIVIAL ─────────────────────────────────────────────────────── */

let trivTimer = null;
let trivOptions = [];

socket.on("trivial_question", ({ round, total, question, options, type, duration }) => {
  trivOptions = options;
  $("trivRound").textContent = round;
  $("trivTotal").textContent = total;
  $("trivQuestion").textContent = question;
  $("trivResult").style.display = "none";
  showScreen("trivial");

  const opts = $("trivOptions");
  if (type === "tf") {
    opts.innerHTML = `
      <button class="option-btn tf-btn" id="triv-opt-0" onclick="answerTrivial(0)" style="font-size:18px; padding:20px; flex:1;">
        ✅ True
      </button>
      <button class="option-btn tf-btn" id="triv-opt-1" onclick="answerTrivial(1)" style="font-size:18px; padding:20px; flex:1;">
        ❌ False
      </button>
    `;
    opts.style.flexDirection = "column";
  } else {
    const letters = ["A","B","C","D"];
    opts.innerHTML = options.map((o, i) => `
      <button class="option-btn" id="triv-opt-${i}" onclick="answerTrivial(${i})">
        <span class="option-letter">${letters[i]}</span>${esc(o)}
      </button>
    `).join("");
    opts.style.flexDirection = "";
  }

  clearInterval(trivTimer);
  trivTimer = runBar("trivTimerBar", duration);
});

function answerTrivial(idx) {
  document.querySelectorAll("#trivOptions .option-btn").forEach(b => { b.disabled = true; });
  $("triv-opt-" + idx)?.classList.add("selected");
  socket.emit("player_answer", { code: roomCode, answer: idx });
}

socket.on("trivial_reveal", ({ correctIndex, answers, players }) => {
  clearInterval(trivTimer);
  document.querySelectorAll("#trivOptions .option-btn").forEach((b, i) => {
    b.disabled = true;
    if (i === correctIndex) b.classList.add("correct");
    else if (answers[myId] === i) b.classList.add("wrong");
  });
  const correct = answers[myId] === correctIndex;
  const answerText = trivOptions[correctIndex] !== undefined ? trivOptions[correctIndex] : "option " + String.fromCharCode(65 + correctIndex);
  $("trivResult").style.display = "block";
  $("trivResult").innerHTML = correct
    ? `<span class="text-success" style="font-size:18px; font-weight:700;">✅ Correct! +100</span>`
    : `<span class="text-danger" style="font-size:18px; font-weight:700;">❌ ${answers[myId] === undefined ? "Too slow!" : "Wrong!"} The answer was ${esc(answerText)}</span>`;
});

/* ─── REACTION ────────────────────────────────────────────────────── */

socket.on("reaction_waiting", ({ round, players }) => {
  reactionTapped = false;
  reactionActive = false;
  if (players && !players.some(p => p.id === myId)) { showScreen("spectator"); return; }
  showScreen("reaction");
  $("reactionScreen").style.background = "#000";
  $("reactionMsg").textContent = "Round " + round;
  $("reactionSub").style.color = "rgba(255,255,255,0.5)";
  $("reactionSub").textContent = "Tap when the screen flashes!";
  $("reactionMsg").style.color = "#fff";
});

socket.on("reaction_flash", () => {
  reactionActive = true;
  reactionTapped = false;
  $("reactionScreen").style.background = "#fff";
  $("reactionMsg").style.color = "#000";
  $("reactionMsg").textContent = "TAP NOW!";
  $("reactionSub").style.color = "rgba(0,0,0,0.5)";
  $("reactionSub").textContent = "TAP!";
});

function tapReaction() {
  if (!reactionActive || reactionTapped) return;
  reactionTapped = true;
  socket.emit("player_tap", { code: roomCode });
  $("reactionMsg").textContent = "✅ Tapped!";
}

socket.on("reaction_tapped", ({ success }) => {
  if (success) showSnackbar("Tap registered", "success");
});

socket.on("reaction_result", ({ eliminated }) => {
  reactionActive = false;
  $("reactionScreen").style.background = "#000";
  $("reactionMsg").style.color = "#fff";
  const iEliminated = eliminated.find(p => p.id === myId);
  if (iEliminated) {
    $("reactionMsg").textContent = "💀 Eliminated!";
    $("reactionSub").style.color = "rgba(255,50,50,0.8)";
    $("reactionSub").textContent = "Too slow!";
    setTimeout(() => showScreen("spectator"), 2000);
  } else {
    $("reactionMsg").textContent = "✅ Still in!";
    $("reactionSub").style.color = "rgba(100,255,100,0.8)";
    $("reactionSub").textContent = "Next round incoming...";
  }
});

/* ─── WOULD YOU RATHER ────────────────────────────────────────────── */

let wyrVoted = false;
let wyrChoice = null;

socket.on("wyr_question", ({ round, total, optionA, optionB }) => {
  wyrVoted = false;
  wyrChoice = null;
  $("wyrRound").textContent = round;
  $("wyrTotal").textContent = total;
  $("wyrA").textContent = "🅰️ " + optionA;
  $("wyrB").textContent = "🅱️ " + optionB;
  $("wyrA").classList.remove("selected");
  $("wyrB").classList.remove("selected");
  $("wyrA").style.pointerEvents = "";
  $("wyrB").style.pointerEvents = "";
  $("wyrResult").style.display = "none";
  showScreen("wouldyourather");
});

function voteWYR(choice) {
  if (wyrVoted) return;
  wyrVoted = true;
  wyrChoice = choice;
  $("wyrA").style.pointerEvents = "none";
  $("wyrB").style.pointerEvents = "none";
  $(choice === 0 ? "wyrA" : "wyrB").classList.add("selected");
  socket.emit("player_answer", { code: roomCode, answer: choice });
}

socket.on("wyr_vote_received", ({ total }) => {
  showSnackbar(`${total} voted so far`);
});

socket.on("wyr_reveal", ({ aVotes, bVotes, minority }) => {
  const tie = minority === -1;
  const lost = !tie && wyrChoice !== null && wyrChoice === minority;
  $("wyrResult").style.display = "block";
  $("wyrResult").innerHTML = `
    <div style="font-size:14px; color:var(--text2);">Results</div>
    <div style="font-size:20px; font-weight:700; margin-top:6px;">🅰️ ${aVotes} vs 🅱️ ${bVotes}</div>
    ${wyrChoice === null
      ? '<div class="text-muted mt-2">You didn\'t vote in time</div>'
      : tie
        ? '<div class="text-muted mt-2">It\'s a tie! No points change.</div>'
        : lost
          ? '<div class="text-danger mt-2">You were in the minority! -10 points</div>'
          : '<div class="text-success mt-2">You were in the majority! +20 points ✅</div>'
    }
  `;
});

/* ─── MATH QUIZ ───────────────────────────────────────────────────── */

let mathTimer = null;
let mathAnswered = false;

socket.on("math_question", ({ round, total, question, options, duration }) => {
  mathAnswered = false;
  $("mathRound").textContent = round;
  $("mathTotal").textContent = total;
  $("mathQuestion").textContent = question;
  $("mathResult").style.display = "none";
  showScreen("mathquiz");

  const letters = ["A","B","C","D"];
  $("mathOptions").innerHTML = options.map((o, i) => `
    <button class="option-btn" id="math-opt-${i}" onclick="answerMath(${i})">
      <span class="option-letter">${letters[i]}</span>${esc(o)}
    </button>
  `).join("");

  clearInterval(mathTimer);
  mathTimer = runBar("mathTimerBar", duration);
});

function answerMath(idx) {
  if (mathAnswered) return;
  mathAnswered = true;
  document.querySelectorAll("#mathOptions .option-btn").forEach(b => b.disabled = true);
  $("math-opt-" + idx)?.classList.add("selected");
  socket.emit("player_answer", { code: roomCode, answer: idx });
}

socket.on("math_reveal", ({ correctIndex, answers }) => {
  clearInterval(mathTimer);
  document.querySelectorAll("#mathOptions .option-btn").forEach((b, i) => {
    b.disabled = true;
    if (i === correctIndex) b.classList.add("correct");
    else if (answers[myId] === i) b.classList.add("wrong");
  });
  const correct = answers[myId] === correctIndex;
  $("mathResult").style.display = "block";
  $("mathResult").innerHTML = correct
    ? `<span class="text-success" style="font-size:18px; font-weight:700;">✅ Correct!</span>`
    : `<span class="text-danger" style="font-size:18px; font-weight:700;">❌ ${answers[myId] === undefined ? "Too slow!" : "Wrong!"}</span>`;
});

/* ─── FAST TYPER ──────────────────────────────────────────────────── */

let typingDone = false;

socket.on("typing_round", ({ round, total, prompt }) => {
  typingDone = false;
  typingPrompt = prompt;
  typingStartTime = null;
  typingErrors = 0;
  typingPrevLen = 0;
  typingKeys = 0;
  $("typeRound").textContent = round;
  $("typeTotal").textContent = total;
  $("typingInput").value = "";
  $("typingInput").disabled = false;
  $("typingInput").maxLength = prompt.length;
  $("typeProgress").style.width = "0%";
  $("typeAccuracy").textContent = "100%";
  $("typeResult").style.display = "none";
  showScreen("fasttyper");
  renderTypingPrompt("");
  $("typingInput").focus();
});

function renderTypingPrompt(typed) {
  let html = "";
  for (let i = 0; i < typingPrompt.length; i++) {
    const ch = esc(typingPrompt[i]);
    if (i < typed.length) {
      html += `<span class="${typed[i] === typingPrompt[i] ? "char-correct" : "char-wrong"}">${ch}</span>`;
    } else if (i === typed.length) {
      html += `<span class="typing-cursor" style="border-left: 2px solid var(--accent);">${ch}</span>`;
    } else {
      html += `<span class="char-pending">${ch}</span>`;
    }
  }
  $("typingPromptDisplay").innerHTML = html;
}

["paste", "drop", "cut"].forEach(ev => {
  $("typingInput").addEventListener(ev, (e) => e.preventDefault());
});

$("typingInput").addEventListener("input", () => {
  if (typingDone) return;
  if (!typingStartTime) typingStartTime = Date.now();
  const typed = $("typingInput").value;
  if (typed.length > typingPrevLen) {
    typingKeys += typed.length - typingPrevLen;
    const i = typed.length - 1;
    if (typed[i] !== typingPrompt[i]) typingErrors++;
  }
  typingPrevLen = typed.length;

  renderTypingPrompt(typed);
  $("typeProgress").style.width = Math.min(100, (typed.length / typingPrompt.length) * 100) + "%";
  const acc = typingKeys > 0 ? Math.round(((typingKeys - typingErrors) / typingKeys) * 100) : 100;
  $("typeAccuracy").textContent = acc + "%";

  if (typed === typingPrompt) {
    typingDone = true;
    $("typingInput").disabled = true;
    socket.emit("player_typing_done", { code: roomCode, text: typed, errors: typingErrors });
    $("typeResult").style.display = "block";
    $("typeResult").innerHTML = `<span class="text-success" style="font-size:18px; font-weight:700;">✅ Done! Waiting for results...</span>`;
  }
});

socket.on("typing_player_done", ({ playerId, name, position, time, accuracy }) => {
  if (playerId === myId) {
    $("typeResult").innerHTML = `<span class="text-success" style="font-size:18px; font-weight:700;">✅ #${position} in ${(time / 1000).toFixed(2)}s, ${accuracy}% accuracy</span>`;
  } else {
    showSnackbar(`${name} finished in position #${position}!`);
  }
});

socket.on("typing_round_end", () => {
  if (!typingDone) {
    $("typeResult").style.display = "block";
    $("typeResult").innerHTML = `<span class="text-danger" style="font-size:16px; font-weight:700;">⏰ Time's up! Round over.</span>`;
    $("typingInput").disabled = true;
  }
});

/* ─── WORD CRACK ──────────────────────────────────────────────────── */

let wcWordLen = 5;
let wcGuesses = [];

socket.on("wordcrack_round", ({ round, total, wordLength }) => {
  wcWordLen = wordLength;
  wcGuesses = [];
  $("wcRound").textContent = round;
  $("wcTotal").textContent = total;
  $("wcWordLen").textContent = wordLength;
  $("wcInput").value = "";
  $("wcInput").disabled = false;
  $("wcInput").maxLength = wordLength;
  $("wcMsg").textContent = "";
  $("wcMsg").style.color = "";
  $("wcResult").style.display = "none";
  renderWCGrid();
  showScreen("wordcrack");
});

function renderWCGrid() {
  const size = Math.min(52, 260 / wcWordLen);
  $("wcGrid").innerHTML = wcGuesses.map(g => `
    <div class="wordle-row">${g.guess.split("").map((c, i) => `
      <div class="wordle-cell ${g.result[i]}" style="width:${size}px; height:${size}px; font-size:${Math.min(20, 100 / wcWordLen * 2)}px;">${esc(c)}</div>
    `).join("")}</div>
  `).join("");
}

function submitWordGuess() {
  const val = $("wcInput").value.toUpperCase().trim();
  if (val.length !== wcWordLen) { $("wcMsg").textContent = `Word must be ${wcWordLen} letters`; return; }
  socket.emit("player_guess", { code: roomCode, guess: val });
  $("wcInput").value = "";
  $("wcMsg").textContent = "";
}

$("wcInput").addEventListener("keydown", (e) => { if (e.key === "Enter") submitWordGuess(); });

socket.on("wordcrack_result", ({ guess, result, correct }) => {
  wcGuesses.push({ guess, result });
  renderWCGrid();
  if (correct) {
    $("wcMsg").textContent = "🎉 You got it!";
    $("wcMsg").style.color = "var(--success)";
  }
});

socket.on("wordcrack_solved", ({ playerId, name, word }) => {
  $("wcInput").disabled = true;
  $("wcResult").style.display = "block";
  $("wcResult").innerHTML = playerId === myId
    ? `<span class="text-success" style="font-size:18px; font-weight:700;">🏆 You won! Word was: ${esc(word)}</span>`
    : `<span class="text-muted" style="font-size:16px;">${esc(name)} cracked it first! Word was: <strong>${esc(word)}</strong></span>`;
});

socket.on("wordcrack_timeout", ({ word }) => {
  $("wcResult").style.display = "block";
  $("wcResult").innerHTML = `<span class="text-danger" style="font-size:16px; font-weight:700;">⏰ Time's up! Word was: <strong>${esc(word)}</strong></span>`;
  $("wcInput").disabled = true;
});

socket.on("guess_rejected", ({ msg }) => {
  showSnackbar(msg, "error");
  if ($("screen-wordcrack").classList.contains("active")) $("wcMsg").textContent = msg;
  if ($("screen-codebreaker").classList.contains("active")) $("cbMsg").textContent = msg;
});

/* ─── CODE BREAKER ────────────────────────────────────────────────── */

let cbGuesses = [];
let cbCurrentInput = [];

socket.on("codebreaker_round", ({ round, total }) => {
  cbGuesses = [];
  cbCurrentInput = [];
  $("cbRound").textContent = round;
  $("cbTotal").textContent = total;
  $("cbMsg").textContent = "";
  $("cbMsg").style.color = "";
  $("cbResult").style.display = "none";
  renderCBGrid();
  renderCBInput();
  buildCBNumPad();
  showScreen("codebreaker");
});

function buildCBNumPad() {
  const pad = $("cbNumPad");
  pad.innerHTML = "";
  for (let i = 0; i <= 9; i++) {
    const btn = document.createElement("div");
    btn.className = "num-btn";
    btn.textContent = i;
    btn.onclick = () => {
      if (cbCurrentInput.length < 4) {
        cbCurrentInput.push(i.toString());
        renderCBInput();
      }
    };
    pad.appendChild(btn);
  }
  const del = document.createElement("div");
  del.className = "num-btn del"; del.textContent = "⌫";
  del.onclick = () => { cbCurrentInput.pop(); renderCBInput(); };
  pad.appendChild(del);
}

function lockCBPad() {
  document.querySelectorAll("#cbNumPad .num-btn").forEach(b => b.style.pointerEvents = "none");
}

function renderCBInput() {
  for (let i = 0; i < 4; i++) {
    const el = $("cb" + i);
    el.textContent = cbCurrentInput[i] || "_";
    el.classList.toggle("filled", !!cbCurrentInput[i]);
  }
}

function renderCBGrid() {
  $("cbGrid").innerHTML = cbGuesses.map(g => `
    <div class="wordle-row">${g.guess.split("").map((c, i) => `
      <div class="wordle-cell ${g.result[i]}" style="width:52px; height:52px;">${esc(c)}</div>
    `).join("")}</div>
  `).join("");
}

function submitCodeGuess() {
  if (cbCurrentInput.length !== 4) { $("cbMsg").textContent = "Enter all 4 digits"; return; }
  socket.emit("player_guess", { code: roomCode, guess: cbCurrentInput.join("") });
  cbCurrentInput = [];
  renderCBInput();
  $("cbMsg").textContent = "";
}

socket.on("codebreaker_result", ({ guess, result, correct }) => {
  cbGuesses.push({ guess, result });
  renderCBGrid();
  if (correct) { $("cbMsg").textContent = "🎉 Code cracked!"; $("cbMsg").style.color = "var(--success)"; }
});

socket.on("codebreaker_solved", ({ playerId, name, code: secret }) => {
  lockCBPad();
  $("cbResult").style.display = "block";
  $("cbResult").innerHTML = playerId === myId
    ? `<span class="text-success" style="font-size:18px; font-weight:700;">🏆 You cracked it! Code: ${esc(secret)}</span>`
    : `<span class="text-muted">${esc(name)} cracked it first! Code was: <strong>${esc(secret)}</strong></span>`;
});

socket.on("codebreaker_timeout", ({ code: secret }) => {
  lockCBPad();
  $("cbResult").style.display = "block";
  $("cbResult").innerHTML = `<span class="text-danger" style="font-size:16px; font-weight:700;">⏰ Time's up! Code was: <strong>${esc(secret)}</strong></span>`;
});

/* ─── ROULETTE ────────────────────────────────────────────────────── */

let isMyTurn = false;

function showRouletteControls(spinAllowed) {
  $("rouletteControls").style.display = "block";
  const spinBtn = $("spinBtn");
  if (spinBtn) spinBtn.style.display = spinAllowed ? "" : "none";
}

function hideRouletteControls() {
  $("rouletteControls").style.display = "none";
  $("rouletteControls").classList.remove("your-turn-glow");
}

socket.on("roulette_round", ({ order }) => {
  isMyTurn = false;
  $("rouletteResult").style.display = "none";
  $("rouletteGun").textContent = "🔫";
  hideRouletteControls();
  $("rouletteMsg").textContent = "Waiting for your turn...";
  $("rouletteSub").textContent = `Players: ${order.map(p => p.name).join(", ")}`;
  showScreen("roulette");
});

socket.on("your_turn", ({ game }) => {
  if (game !== "roulette") return;
  isMyTurn = true;
  $("rouletteMsg").textContent = "Your Turn!";
  $("rouletteSub").textContent = "Spin once, or shoot. You have 20 seconds.";
  $("rouletteControls").classList.add("your-turn-glow");
  showRouletteControls(true);
});

socket.on("roulette_next", ({ currentPlayer, name }) => {
  isMyTurn = currentPlayer === myId;
  if (!isMyTurn) {
    hideRouletteControls();
    $("rouletteMsg").textContent = `${name}'s turn`;
    $("rouletteSub").textContent = "Watching...";
  }
});

function playerSpin() {
  if (!isMyTurn) return;
  hideRouletteControls();
  $("rouletteMsg").textContent = "Spinning...";
  $("rouletteGun").style.animation = "imposterPulse 0.3s 5";
  socket.emit("player_shoot", { code: roomCode, spin: true });
}

socket.on("roulette_spin_done", () => {
  $("rouletteMsg").textContent = "Chamber spun!";
  $("rouletteSub").textContent = "Now shoot!";
  showRouletteControls(false);
});

socket.on("roulette_spin_denied", ({ msg }) => {
  showSnackbar(msg, "error");
  if (isMyTurn) {
    $("rouletteMsg").textContent = "Your Turn!";
    $("rouletteSub").textContent = "Already spun. Shoot!";
    showRouletteControls(false);
  }
});

socket.on("roulette_spin", ({ playerId }) => {
  showSnackbar(`${playerId === myId ? "You" : "They"} spun the barrel!`);
});

function playerShoot() {
  if (!isMyTurn) return;
  isMyTurn = false;
  hideRouletteControls();
  $("rouletteMsg").textContent = "SHOOTING...";
  socket.emit("player_shoot", { code: roomCode, spin: false });
}

socket.on("roulette_bang", ({ playerId, name }) => {
  hideRouletteControls();
  $("rouletteGun").style.animation = "";
  $("rouletteGun").textContent = "💥";
  $("rouletteResult").style.display = "block";
  if (playerId === myId) {
    isMyTurn = false;
    $("rouletteResult").innerHTML = `<span class="text-danger" style="font-size:24px; font-weight:700;">💀 YOU'RE ELIMINATED!</span>`;
    setTimeout(() => showScreen("spectator"), 3000);
  } else {
    $("rouletteResult").innerHTML = `<span class="text-muted" style="font-size:18px;">${esc(name)} was eliminated! 💥</span>`;
  }
});

socket.on("roulette_safe", ({ playerId }) => {
  hideRouletteControls();
  $("rouletteGun").style.animation = "";
  $("rouletteGun").textContent = "💨";
  if (playerId === myId) {
    isMyTurn = false;
    showSnackbar("💨 Click! Safe... this time.", "success");
    $("rouletteGun").textContent = "😅";
  }
  setTimeout(() => { $("rouletteGun").textContent = "🔫"; $("rouletteResult").style.display = "none"; }, 1000);
});

/* ─── RAPID FIRE ──────────────────────────────────────────────────── */

let rfAnswered = false;

socket.on("rapidfire_start", ({ duration, question, qi }) => {
  rfQi = qi || 0;
  rfAnswered = false;
  $("rfFeedback").style.display = "none";
  showScreen("rapidfire");
  renderRFQuestion(question);
  startRFTimer(duration);
});

socket.on("rapidfire_question", ({ question, qi }) => {
  rfQi = qi;
  rfAnswered = false;
  $("rfFeedback").style.display = "none";
  renderRFQuestion(question);
});

function renderRFQuestion(q) {
  $("rfQuestion").textContent = q.q;
  const letters = ["A","B","C","D"];
  $("rfOptions").innerHTML = q.options.map((o, i) => `
    <button class="option-btn" id="rf-opt-${i}" onclick="answerRF(${i})">
      <span class="option-letter">${letters[i]}</span>${esc(o)}
    </button>
  `).join("");
}

function answerRF(idx) {
  if (rfAnswered) return;
  rfAnswered = true;
  document.querySelectorAll("#rfOptions .option-btn").forEach(b => b.disabled = true);
  $("rf-opt-" + idx)?.classList.add("selected");
  socket.emit("player_answer", { code: roomCode, answer: idx, q: rfQi });
}

socket.on("rapidfire_correct", () => {
  $("rfFeedback").style.display = "block";
  $("rfFeedback").innerHTML = `<span class="text-success" style="font-size:18px; font-weight:700;">✅ +50</span>`;
});

socket.on("rapidfire_wrong", () => {
  $("rfFeedback").style.display = "block";
  $("rfFeedback").innerHTML = `<span class="text-danger" style="font-size:18px; font-weight:700;">❌ Wrong!</span>`;
});

function startRFTimer(duration) {
  clearInterval(rfTimer);
  const end = Date.now() + duration;
  rfTimer = setInterval(() => {
    const remaining = Math.max(0, end - Date.now());
    $("rfTimerBar").style.width = (remaining / duration * 100) + "%";
    if (remaining <= 0) clearInterval(rfTimer);
  }, 100);
}

socket.on("rapidfire_end", () => {
  clearInterval(rfTimer);
  showSnackbar("Rapid Fire Over!");
});

/* ─── HOT POTATO ──────────────────────────────────────────────────── */

let potPlayers = [];
let potPrev = null;
let potHolder = null;
let potDone = false;

function renderPotato() {
  const me = potHolder === myId;
  const holder = potPlayers.find(p => p.id === potHolder);
  $("potIcon").classList.toggle("hot", me);
  $("potCard").classList.toggle("your-turn-glow", me);
  const box = $("potTargets");

  if (potDone) { box.style.display = "none"; return; }

  if (me) {
    $("potMsg").textContent = "YOU HAVE THE POTATO!";
    $("potSub").textContent = "Pass it before it explodes!";
    const targets = potPlayers.filter(p => p.id !== myId && (potPlayers.length <= 2 || p.id !== potPrev));
    box.innerHTML = targets.map(p => `
      <div class="vote-player" data-id="${esc(p.id)}">
        ${makeAvatarEl(p)}
        <span style="font-weight:600; font-size:15px;">${esc(p.name)}</span>
      </div>
    `).join("");
    box.querySelectorAll(".vote-player").forEach(el => { el.onclick = () => passPotato(el.dataset.id); });
    box.style.display = "flex";
    if (navigator.vibrate) navigator.vibrate(120);
  } else {
    $("potMsg").textContent = `${holder ? holder.name : "Someone"} has the potato`;
    $("potSub").textContent = "Stay calm...";
    box.style.display = "none";
  }
}

function passPotato(targetId) {
  if (potHolder !== myId || potDone) return;
  document.querySelectorAll("#potTargets .vote-player").forEach(el => { el.style.pointerEvents = "none"; el.style.opacity = "0.5"; });
  socket.emit("player_pass", { code: roomCode, targetId });
}

socket.on("potato_round", ({ round, holderId, players }) => {
  potDone = false;
  potPlayers = players;
  potPrev = null;
  potHolder = holderId;
  $("potRound").textContent = round;
  $("potResult").style.display = "none";
  if (!players.some(p => p.id === myId)) { showScreen("spectator"); return; }
  showScreen("hotpotato");
  renderPotato();
});

socket.on("potato_pass", ({ fromId, toId }) => {
  potPrev = fromId;
  potHolder = toId;
  if ($("screen-hotpotato").classList.contains("active")) renderPotato();
});

socket.on("potato_denied", ({ msg }) => {
  showSnackbar(msg, "error");
  renderPotato();
});

socket.on("potato_boom", ({ id, name, remaining, gameOver }) => {
  potDone = true;
  renderPotato();
  if (navigator.vibrate) navigator.vibrate([200, 80, 200]);
  $("potIcon").classList.remove("hot");
  $("potCard").classList.remove("your-turn-glow");
  $("potMsg").textContent = "BOOM!";
  $("potResult").style.display = "block";
  if (id === myId) {
    $("potSub").textContent = "";
    $("potResult").innerHTML = `<span class="text-danger" style="font-size:22px; font-weight:700;">💥 You exploded! You are out.</span>`;
    setTimeout(() => showScreen("spectator"), 3000);
  } else {
    $("potSub").textContent = `${name} exploded`;
    $("potResult").innerHTML = gameOver
      ? `<span class="text-success" style="font-size:18px; font-weight:700;">🏆 You survived to the end! +200 bonus</span>`
      : `<span class="text-success" style="font-size:18px; font-weight:700;">You survived this round! +100 (${remaining} left)</span>`;
  }
});

/* ─── GAME OVER ───────────────────────────────────────────────────── */

socket.on("game_over", ({ players }) => {
  clearTimers();
  showScreen("gameover");
  $("finalLeaderboard").innerHTML = players.map((p, i) => `
    <div class="leaderboard-row rank-${i + 1}">
      <div class="rank-num">${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</div>
      ${makeAvatarEl(p)}
      <span class="player-name">${esc(p.name)}${p.id === myId ? " (You)" : ""}</span>
      <span class="player-score">${p.score}</span>
    </div>
  `).join("");
});

function backToWaiting() {
  showScreen("waiting");
  requestSessionLB();
  socket.emit("request_room_state", { code: roomCode });
}

socket.on("show_leaderboard", ({ players }) => {
  $("spectatorLB").innerHTML = players.map((p, i) => `
    <div class="leaderboard-row rank-${i+1}">
      <div class="rank-num">${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i+1}</div>
      ${makeAvatarEl(p)}
      <span class="player-name">${esc(p.name)}</span>
      <span class="player-score">${p.score}</span>
    </div>
  `).join("");
});


/* ─── WORD CHAIN ──────────────────────────────────────────────────── */

let chainTimer = null;
let chainCurrent = null;
let chainLetter = "";
let chainBusy = false;

function chainBar(duration) {
  clearInterval(chainTimer);
  const end = Date.now() + duration;
  $("chainBar").style.width = "100%";
  chainTimer = setInterval(() => {
    const left = Math.max(0, end - Date.now());
    $("chainBar").style.width = (left / duration * 100) + "%";
    $("chainSecs").textContent = Math.ceil(left / 1000);
    if (left <= 0) clearInterval(chainTimer);
  }, 100);
}

function chainRecent(list) {
  $("chainRecent").innerHTML = (list || []).map(r => `<span class="tag tag-cyan">${esc(r.word)}</span>`).join(" ");
}

function chainLives(players) {
  const me = (players || []).find(p => p.id === myId);
  if (!me) return;
  $("chainLives").textContent = me.eliminated ? "Out" : "Lives " + me.lives;
  $("chainScore").textContent = me.score + " pts";
}

socket.on("chain_round", ({ round, total, seconds, rule, order }) => {
  clearInterval(chainTimer);
  chainCurrent = null;
  $("chainRound").textContent = round + " / " + total;
  const banner = $("chainRule");
  banner.style.display = rule ? "block" : "none";
  banner.textContent = rule ? "RULE ROUND: " + rule : "";
  $("chainMsg").textContent = rule ? "New rule this round" : `${seconds}s per turn`;
  $("chainInputBox").style.display = "none";
  $("chainFeedback").textContent = "";
  if (!order.some(p => p.id === myId)) { showScreen("spectator"); return; }
  showScreen("wordchain");
});

socket.on("chain_turn", ({ playerId, name, letter, duration, rule, recent, players }) => {
  chainCurrent = playerId;
  chainLetter = letter;
  chainBusy = false;
  showScreen("wordchain");
  const rb = $("chainRule");
  rb.style.display = rule ? "block" : "none";
  rb.textContent = rule ? "RULE ROUND: " + rule : "";
  $("chainLetter").textContent = letter.toUpperCase();
  chainRecent(recent);
  chainLives(players);
  chainBar(duration);
  const mine = playerId === myId;
  $("chainInputBox").style.display = mine ? "block" : "none";
  $("chainCard").classList.toggle("your-turn-glow", mine);
  $("chainFeedback").textContent = "";
  if (mine) {
    $("chainMsg").textContent = `Your turn: word starting with ${letter.toUpperCase()}`;
    const inp = $("chainInput");
    inp.value = "";
    inp.disabled = false;
    inp.focus();
    if (navigator.vibrate) navigator.vibrate(80);
  } else {
    $("chainMsg").textContent = `${name} is thinking...`;
  }
});

function sendChainWord() {
  if (chainCurrent !== myId || chainBusy) return;
  const w = $("chainInput").value.trim();
  if (!w) return;
  socket.emit("player_word", { code: roomCode, word: w });
}

$("chainSend").onclick = sendChainWord;
$("chainInput").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); sendChainWord(); } });

socket.on("chain_rejected", ({ msg }) => {
  $("chainFeedback").innerHTML = `<span class="text-danger">${esc(msg)}</span>`;
  if (navigator.vibrate) navigator.vibrate(60);
});

socket.on("chain_word", ({ playerId, name, word, points, nextLetter, players }) => {
  clearInterval(chainTimer);
  chainBusy = true;
  chainCurrent = null;
  $("chainInputBox").style.display = "none";
  $("chainCard").classList.remove("your-turn-glow");
  $("chainMsg").textContent = `${name}: ${word} (+${points})`;
  $("chainFeedback").textContent = `Next letter: ${nextLetter.toUpperCase()}`;
  chainLives(players);
});

socket.on("chain_fail", ({ playerId, name, reason, lives, eliminated, penalty, gameOver, winnerId, players }) => {
  clearInterval(chainTimer);
  chainBusy = true;
  chainCurrent = null;
  $("chainInputBox").style.display = "none";
  $("chainCard").classList.remove("your-turn-glow");
  chainLives(players);
  const you = playerId === myId;
  $("chainMsg").textContent = you ? `${reason}. -${penalty} pts` : `${name}: ${reason}`;
  $("chainFeedback").innerHTML = eliminated
    ? `<span class="text-danger">${you ? "You are out" : esc(name) + " is out"}</span>`
    : `${you ? "You have" : esc(name) + " has"} ${lives} ${lives === 1 ? "life" : "lives"} left`;
  if (you && eliminated) setTimeout(() => showScreen("spectator"), 3000);
  if (gameOver && winnerId === myId) $("chainFeedback").textContent = "You win! +50 bonus";
});
