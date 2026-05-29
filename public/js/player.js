const socket = io();

let myId = null;
let myName = "";
let myAvatar = null;
let roomCode = "";
let myReconnectToken = null;
let currentGame = "";
let hasEmergency = true;
let hasVoted = false;
let typingStartTime = null;
let typingPrompt = "";
let cbCurrentGuess = [];
let wcGuesses = [];
let rfTimer = null;
let rfDuration = 60;
let rfStart = null;
let reactionActive = false;
let reactionTapped = false;

const AVATARS = ["🐶","🐱","🦊","🐼","🐨","🐯","🦁","🐸","🦋","🐙","🦄","🐲","🤖","👻","🎃","🦸","🧙","🧟","🎮","⚡"];
const AVATAR_COLORS = ["#7c3aed","#06b6d4","#f59e0b","#10b981","#ef4444","#ec4899","#8b5cf6","#14b8a6","#f97316","#6366f1"];

function $(id) { return document.getElementById(id); }

function showScreen(name) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const el = $("screen-" + name);
  if (el) { el.classList.add("active"); el.classList.add("fade-in"); }
  currentGame = name;
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
  if (player.avatar && player.avatar.startsWith("emoji:")) {
    return `<div class="avatar" style="background:${player.avatar.split("|")[1] || "#7c3aed"}; font-size:22px;">${player.avatar.split(":")[1].split("|")[0]}</div>`;
  } else if (player.avatar && player.avatar.startsWith("data:")) {
    return `<div class="avatar"><img src="${player.avatar}" alt="${player.name}"></div>`;
  }
  const color = AVATAR_COLORS[player.name.charCodeAt(0) % AVATAR_COLORS.length];
  return `<div class="avatar" style="background:${color}">${player.name.charAt(0).toUpperCase()}</div>`;
}

// Build emoji avatar grid
const grid = $("emojiGrid");
let selectedEmoji = null;
let selectedColor = AVATAR_COLORS[0];
AVATARS.forEach((emoji, i) => {
  const div = document.createElement("div");
  div.className = "avatar-opt";
  div.style.background = AVATAR_COLORS[i % AVATAR_COLORS.length];
  div.style.fontSize = "22px";
  div.textContent = emoji;
  div.onclick = () => {
    document.querySelectorAll(".avatar-opt").forEach(a => a.classList.remove("selected"));
    div.classList.add("selected");
    selectedEmoji = emoji;
    selectedColor = AVATAR_COLORS[i % AVATAR_COLORS.length];
    $("avatarPreview").style.display = "none";
    $("avatarUploadBtn").style.display = "flex";
    myAvatar = `emoji:${emoji}|${selectedColor}`;
  };
  grid.appendChild(div);
});

// Avatar file upload
$("avatarFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    myAvatar = ev.target.result;
    $("avatarPreview").src = ev.target.result;
    $("avatarPreview").style.display = "block";
    $("avatarUploadBtn").style.display = "none";
  };
  reader.readAsDataURL(file);
});

// Code input number pad
let codeChars = [];
const numPad = $("numPad");

function buildNumPad(container, onChar, onDel) {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".split("");
  letters.forEach(k => {
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

buildNumPad(numPad,
  (k) => {
    if (codeChars.length < 4) {
      codeChars.push(k);
      updateCodeDisplay();
    }
  },
  () => { codeChars.pop(); updateCodeDisplay(); }
);

function updateCodeDisplay() {
  for (let i = 0; i < 4; i++) {
    const el = $("d" + i);
    el.textContent = codeChars[i] || "_";
    el.classList.toggle("filled", !!codeChars[i]);
  }
}

$("joinBtn").onclick = () => {
  const name = $("nameInput").value.trim();
  const code = codeChars.join("");
  if (!name) { $("joinError").textContent = "Enter your name"; return; }
  if (code.length !== 4) { $("joinError").textContent = "Enter the 4-letter room code"; return; }
  myName = name;
  roomCode = code;
  if (!myAvatar) {
    const color = AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
    myAvatar = `emoji:${AVATARS[Math.floor(Math.random() * AVATARS.length)]}|${color}`;
  }
  socket.emit("player_join", { code, name, avatar: myAvatar });
};

// ─── AUTO-RECONNECT ON LOAD ─────────────────────────────────────────
window.addEventListener("load", () => {
  const token = localStorage.getItem("gn_token");
  const code  = localStorage.getItem("gn_code");
  const name  = localStorage.getItem("gn_name");
  const avatar = localStorage.getItem("gn_avatar");
  if (token && code && name) {
    myName = name;
    myAvatar = avatar || null;
    roomCode = code;
    // Pre-fill the join form in case reconnect fails
    const nameInput = $("nameInput");
    if (nameInput) nameInput.value = name;
    codeChars = code.split("");
    updateCodeDisplay();
    socket.emit("player_join", { code, name, avatar, reconnectToken: token });
  }
});

socket.on("joined", ({ player, code, reconnectToken }) => {
  myId = player.id;
  myName = player.name;
  roomCode = code;
  if (reconnectToken) {
    myReconnectToken = reconnectToken;
    localStorage.setItem("gn_token",  reconnectToken);
    localStorage.setItem("gn_code",   code);
    localStorage.setItem("gn_name",   player.name);
    localStorage.setItem("gn_avatar", player.avatar || "");
  }
  showScreen("waiting");
  $("waitRoomCode").textContent = `Room: ${code}`;
});

socket.on("error", ({ msg }) => {
  // If room is gone, wipe stale session so the player lands on join screen cleanly
  if (msg === "Room not found") {
    localStorage.removeItem("gn_token");
    localStorage.removeItem("gn_code");
    localStorage.removeItem("gn_name");
    localStorage.removeItem("gn_avatar");
    myReconnectToken = null;
  }
  $("joinError").textContent = msg;
  showSnackbar(msg, "error");
});

socket.on("kicked", () => {
  localStorage.removeItem("gn_token");
  localStorage.removeItem("gn_code");
  localStorage.removeItem("gn_name");
  localStorage.removeItem("gn_avatar");
  myReconnectToken = null;
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
          ${p.name}${p.id === myId ? " (You)" : ""}
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
  // Mid-game kick / disconnect visibility
  if (phase === "playing") {
    const kicked = players.filter(p => p.disconnected || p.eliminated).map(p => p.name);
    if (kicked.length) showSnackbar(`Disconnected: ${kicked.join(", ")}`);
  }
});

socket.on("player_reconnected", ({ name }) => {
  showSnackbar(`${name} reconnected! 🟢`);
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
    wordcrack:"Word Crack", codebreaker:"Code Breaker", roulette:"Russian Roulette", rapidfire:"Rapid Fire" };
  return map[g] || g;
}

// ─── SESSION LEADERBOARD ─────────────────────────────────────────────
socket.on("session_leaderboard", ({ leaderboard }) => {
  renderSessionLB(leaderboard);
});

function renderSessionLB(leaderboard) {
  // Show on game over screen
  const goEl = $("sessionLBGameOver");
  // Show on waiting screen
  const waitEl = $("sessionLBWaiting");

  const rows = leaderboard.map((p, i) => `
    <div style="display:flex; align-items:center; gap:10px; padding:10px 14px; background:var(--surface2); border-radius:10px; border:1px solid var(--border); margin-bottom:8px;">
      <div style="font-family:var(--font-mono); font-weight:700; font-size:16px; width:28px; color:${i===0?"#fbbf24":i===1?"#94a3b8":i===2?"#cd7c2f":"var(--text2)"};">
        ${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}
      </div>
      ${makeAvatarEl(p)}
      <span style="flex:1; font-weight:600; font-size:14px;">${p.name}${p.name===myName?" (You)":""}</span>
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

// ─── IMPOSTER ─────────────────────────────────────────────────────────
socket.on("imposter_round_start", ({ round }) => {
  $("impRound").textContent = round;
  $("imposter-voting-screen").style.display = "none";
  $("imposter-role-screen").style.display = "block";
  showScreen("imposter");
});

socket.on("imposter_role", ({ isImposter, word }) => {
  const display = $("impRoleDisplay");
  const instr = $("impInstruction");
  if (isImposter) {
    display.innerHTML = `<div class="imposter-reveal">IMPOSTER</div>`;
    instr.textContent = "Say something vague. Don't get caught!";
  } else {
    display.innerHTML = `<div class="word-reveal">${word}</div>`;
    instr.textContent = "Say a word close to this. Don't say the actual word!";
  }
  $("emergencyBtn").disabled = !hasEmergency;
  $("emergencyStatus").textContent = hasEmergency ? "You have 1 emergency call" : "Emergency used";
});

socket.on("emergency_called", ({ by }) => {
  showSnackbar(`🚨 ${by} called an emergency!`);
});

socket.on("voting_start", ({ duration, players }) => {
  hasVoted = false;
  $("imposter-role-screen").style.display = "none";
  $("imposter-voting-screen").style.display = "block";
  $("voteStatus").textContent = "Tap a player to vote them out";

  const list = $("votePlayerList");
  list.innerHTML = players.filter(p => p.id !== myId).map(p => `
    <div class="vote-player" id="vote-${p.id}" onclick="castVote('${p.id}', '${p.name}')">
      ${makeAvatarEl(p)}
      <span style="font-weight:600; font-size:15px;">${p.name}</span>
    </div>
  `).join("");

  let secs = Math.floor(duration / 1000);
  $("voteTimerBar").style.width = "100%";
  const t = setInterval(() => {
    secs--;
    $("voteTimerBar").style.width = Math.max(0, (secs / (duration / 1000)) * 100) + "%";
    if (secs <= 0) clearInterval(t);
  }, 1000);
});

function callEmergency() {
  if (!hasEmergency) return;
  hasEmergency = false;
  $("emergencyBtn").disabled = true;
  $("emergencyStatus").textContent = "Emergency used";
  socket.emit("player_emergency", { code: roomCode });
}

function castVote(targetId, name) {
  if (hasVoted) return;
  hasVoted = true;
  document.querySelectorAll(".vote-player").forEach(el => {
    el.style.pointerEvents = "none";
    el.style.opacity = "0.5";
  });
  const el = $("vote-" + targetId);
  if (el) { el.style.opacity = "1"; el.classList.add("selected"); }
  $("voteStatus").textContent = `Voted for ${name}`;
  socket.emit("player_vote", { code: roomCode, targetId });
}

socket.on("vote_cast", ({ totalVotes, totalVoters }) => {
  $("voteStatus").textContent = `${totalVotes}/${totalVoters} voted`;
});

socket.on("voting_result", ({ eliminatedName, wasImposter, gameOver, word, imposterNames }) => {
  const msg = wasImposter
    ? `✅ ${eliminatedName} was the Imposter! Crewmates win!`
    : `❌ ${eliminatedName} was NOT the imposter... (${imposterNames?.join(", ")} was)`;
  showSnackbar(msg);
  if (gameOver) setTimeout(() => showScreen("waiting"), 4000);
});

// ─── TRIVIAL ──────────────────────────────────────────────────────────
let trivTimer = null;
socket.on("trivial_question", ({ round, total, question, options, type, duration }) => {
  $("trivRound").textContent = round;
  $("trivTotal").textContent = total;
  $("trivQuestion").textContent = question;
  $("trivResult").style.display = "none";
  showScreen("trivial");

  const opts = $("trivOptions");
  
  if (type === "tf") {
    // True/False — two big buttons, no letter prefix
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
        <span class="option-letter">${letters[i]}</span>${o}
      </button>
    `).join("");
    opts.style.flexDirection = "";
  }

  let secs = Math.floor(duration / 1000);
  $("trivTimerBar").style.width = "100%";
  clearInterval(trivTimer);
  trivTimer = setInterval(() => {
    secs--;
    $("trivTimerBar").style.width = Math.max(0, (secs / (duration / 1000)) * 100) + "%";
    if (secs <= 0) clearInterval(trivTimer);
  }, 1000);
});

function answerTrivial(idx) {
  document.querySelectorAll(".option-btn").forEach(b => { b.disabled = true; });
  $("triv-opt-" + idx)?.classList.add("selected");
  socket.emit("player_answer", { code: roomCode, answer: idx, time: Date.now() });
}

socket.on("trivial_reveal", ({ correctIndex, answers, players }) => {
  clearInterval(trivTimer);
  document.querySelectorAll("#trivOptions .option-btn").forEach((b, i) => {
    if (i === correctIndex) b.classList.add("correct");
    else if (answers[myId] === i && i !== correctIndex) b.classList.add("wrong");
  });
  const myAnswer = answers[myId];
  const correct = myAnswer === correctIndex;
  $("trivResult").style.display = "block";
  $("trivResult").innerHTML = correct
    ? `<span class="text-success" style="font-size:18px; font-weight:700;">✅ Correct! +100</span>`
    : `<span class="text-danger" style="font-size:18px; font-weight:700;">❌ Wrong! The answer was ${correctIndex === 0 ? "True" : correctIndex === 1 ? "False" : "option " + String.fromCharCode(65 + correctIndex)}</span>`;
});

// ─── REACTION ─────────────────────────────────────────────────────────
socket.on("reaction_waiting", ({ round }) => {
  reactionTapped = false;
  reactionActive = false;
  showScreen("reaction");
  const scr = $("reactionScreen");
  scr.style.background = "#000";
  $("reactionMsg").textContent = "Round " + round;
  $("reactionSub").textContent = "Tap when the screen flashes!";
  $("reactionMsg").style.color = "#fff";
});

socket.on("reaction_flash", () => {
  reactionActive = true;
  reactionTapped = false;
  const scr = $("reactionScreen");
  scr.style.background = "#fff";
  $("reactionMsg").style.color = "#000";
  $("reactionMsg").textContent = "TAP NOW!";
  $("reactionSub").style.color = "rgba(0,0,0,0.5)";
  $("reactionSub").textContent = "TAP TAP TAP!";
});

function tapReaction() {
  if (!reactionActive || reactionTapped) return;
  reactionTapped = true;
  socket.emit("player_tap", { code: roomCode });
  $("reactionMsg").textContent = "✅ Tapped!";
}

socket.on("reaction_tapped", ({ success }) => {
  if (success) showSnackbar("✅ You survived!", "success");
});

socket.on("reaction_result", ({ survived, eliminated }) => {
  reactionActive = false;
  const scr = $("reactionScreen");
  scr.style.background = "#000";
  $("reactionMsg").style.color = "#fff";
  const iEliminated = eliminated.find(p => p.id === myId);
  if (iEliminated) {
    $("reactionMsg").textContent = "💀 Eliminated!";
    $("reactionSub").style.color = "rgba(255,50,50,0.8)";
    $("reactionSub").textContent = "Too slow!";
    setTimeout(() => showScreen("spectator"), 2000);
  } else {
    $("reactionMsg").textContent = "✅ Survived!";
    $("reactionSub").style.color = "rgba(100,255,100,0.8)";
    $("reactionSub").textContent = "Next round incoming...";
  }
});

// ─── WOULD YOU RATHER ────────────────────────────────────────────────
let wyrVoted = false;
socket.on("wyr_question", ({ round, total, optionA, optionB }) => {
  wyrVoted = false;
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
  $("wyrA").style.pointerEvents = "none";
  $("wyrB").style.pointerEvents = "none";
  if (choice === 0) $("wyrA").classList.add("selected");
  else $("wyrB").classList.add("selected");
  socket.emit("player_answer", { code: roomCode, answer: choice, time: Date.now() });
}

socket.on("wyr_vote_received", ({ total }) => {
  showSnackbar(`${total} voted so far`);
});

socket.on("wyr_reveal", ({ aVotes, bVotes, minority }) => {
  const myVote = wyrVoted
    ? ($("wyrA").classList.contains("selected") ? 0 : 1)
    : null;
  const tie = minority === -1;
  const lost = !tie && myVote !== null && myVote === minority;
  const won  = !tie && myVote !== null && myVote !== minority;
  const didNotVote = myVote === null;
  $("wyrResult").style.display = "block";
  $("wyrResult").innerHTML = `
    <div style="font-size:14px; color:var(--text2);">Results</div>
    <div style="font-size:20px; font-weight:700; margin-top:6px;">🅰️ ${aVotes} vs 🅱️ ${bVotes}</div>
    ${didNotVote
      ? '<div class="text-muted mt-2">You didn\'t vote in time</div>'
      : tie
        ? '<div class="text-muted mt-2">It\'s a tie! No points change.</div>'
        : lost
          ? '<div class="text-danger mt-2">You were in the minority! -10 points</div>'
          : '<div class="text-success mt-2">You were in the majority! +20 points ✅</div>'
    }
  `;
});

// ─── MATH QUIZ ───────────────────────────────────────────────────────
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
      <span class="option-letter">${letters[i]}</span>${o}
    </button>
  `).join("");

  let secs = Math.floor(duration / 1000);
  $("mathTimerBar").style.width = "100%";
  clearInterval(mathTimer);
  mathTimer = setInterval(() => {
    secs--;
    $("mathTimerBar").style.width = Math.max(0, (secs / (duration / 1000)) * 100) + "%";
    if (secs <= 0) clearInterval(mathTimer);
  }, 1000);
});

function answerMath(idx) {
  if (mathAnswered) return;
  mathAnswered = true;
  document.querySelectorAll("#mathOptions .option-btn").forEach(b => b.disabled = true);
  $("math-opt-" + idx)?.classList.add("selected");
  socket.emit("player_answer", { code: roomCode, answer: idx, time: Date.now() });
}

socket.on("math_reveal", ({ correctIndex, answers }) => {
  clearInterval(mathTimer);
  document.querySelectorAll("#mathOptions .option-btn").forEach((b, i) => {
    if (i === correctIndex) b.classList.add("correct");
    else if (answers[myId] === i && i !== correctIndex) b.classList.add("wrong");
  });
  const correct = answers[myId] === correctIndex;
  $("mathResult").style.display = "block";
  $("mathResult").innerHTML = correct
    ? `<span class="text-success" style="font-size:18px; font-weight:700;">✅ Correct! Fast bonus applied</span>`
    : `<span class="text-danger" style="font-size:18px; font-weight:700;">❌ Wrong!</span>`;
});

// ─── FAST TYPER ──────────────────────────────────────────────────────
let typingDone = false;
socket.on("typing_round", ({ round, total, prompt }) => {
  typingDone = false;
  typingPrompt = prompt;
  typingStartTime = null;
  $("typeRound").textContent = round;
  $("typeTotal").textContent = total;
  $("typingInput").value = "";
  $("typingInput").disabled = false;
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
    if (i < typed.length) {
      const correct = typed[i] === typingPrompt[i];
      html += `<span class="${correct ? "char-correct" : "char-wrong"}">${typingPrompt[i]}</span>`;
    } else if (i === typed.length) {
      html += `<span class="typing-cursor" style="border-left: 2px solid var(--accent);">${typingPrompt[i]}</span>`;
    } else {
      html += `<span class="char-pending">${typingPrompt[i]}</span>`;
    }
  }
  $("typingPromptDisplay").innerHTML = html;
}

$("typingInput").addEventListener("input", () => {
  if (typingDone) return;
  if (!typingStartTime) typingStartTime = Date.now();
  const typed = $("typingInput").value;
  renderTypingPrompt(typed);
  const progress = Math.min(100, (typed.length / typingPrompt.length) * 100);
  $("typeProgress").style.width = progress + "%";
  let correct = 0;
  for (let i = 0; i < typed.length; i++) {
    if (typed[i] === typingPrompt[i]) correct++;
  }
  const acc = typed.length > 0 ? Math.round((correct / typed.length) * 100) : 100;
  $("typeAccuracy").textContent = acc + "%";

  if (typed === typingPrompt) {
    typingDone = true;
    $("typingInput").disabled = true;
    const elapsed = Date.now() - typingStartTime;
    socket.emit("player_typing_done", { code: roomCode, time: elapsed, accuracy: acc });
    $("typeResult").style.display = "block";
    $("typeResult").innerHTML = `<span class="text-success" style="font-size:18px; font-weight:700;">✅ Done! ${(elapsed/1000).toFixed(2)}s — ${acc}% accuracy</span>`;
  }
});

socket.on("typing_player_done", ({ name, position, time }) => {
  if (name !== myName) showSnackbar(`${name} finished in position #${position}!`);
});

socket.on("typing_round_end", () => {
  if (!typingDone) {
    $("typeResult").style.display = "block";
    $("typeResult").innerHTML = `<span class="text-danger" style="font-size:16px; font-weight:700;">⏰ Time's up! Round over.</span>`;
    $("typingInput").disabled = true;
  }
});

// ─── WORD CRACK ──────────────────────────────────────────────────────
let wcWordLen = 5;
let wcCurrentGuess = [];

socket.on("wordcrack_round", ({ round, total, wordLength }) => {
  wcWordLen = wordLength;
  wcGuesses = [];
  $("wcRound").textContent = round;
  $("wcTotal").textContent = total;
  $("wcWordLen").textContent = wordLength;
  $("wcInput").value = "";
  $("wcInput").maxLength = wordLength;
  $("wcMsg").textContent = "";
  $("wcResult").style.display = "none";
  renderWCGrid();
  showScreen("wordcrack");
});

function renderWCGrid() {
  const grid = $("wcGrid");
  grid.innerHTML = wcGuesses.map(g => `
    <div class="wordle-row">${g.guess.split("").map((c, i) => `
      <div class="wordle-cell ${g.result[i]}" style="width:${Math.min(52, 260/wcWordLen)}px; height:${Math.min(52, 260/wcWordLen)}px; font-size:${Math.min(20, 100/wcWordLen * 2)}px;">${c}</div>
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

socket.on("wordcrack_solved", ({ name, word }) => {
  $("wcResult").style.display = "block";
  $("wcResult").innerHTML = name === myName
    ? `<span class="text-success" style="font-size:18px; font-weight:700;">🏆 You won! Word was: ${word}</span>`
    : `<span class="text-muted" style="font-size:16px;">${name} cracked it first! Word was: <strong>${word}</strong></span>`;
});

// Timeout — nobody solved it
socket.on("wordcrack_timeout", ({ word }) => {
  $("wcResult").style.display = "block";
  $("wcResult").innerHTML = `<span class="text-danger" style="font-size:16px; font-weight:700;">⏰ Time's up! Word was: <strong>${word}</strong></span>`;
  $("wcInput").disabled = true;
});

// ─── CODE BREAKER ─────────────────────────────────────────────────────
let cbGuesses = [];
let cbCurrentInput = [];

socket.on("codebreaker_round", ({ round, total }) => {
  cbGuesses = [];
  cbCurrentInput = [];
  $("cbRound").textContent = round;
  $("cbTotal").textContent = total;
  $("cbMsg").textContent = "";
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
      <div class="wordle-cell ${g.result[i]}" style="width:52px; height:52px;">${c}</div>
    `).join("")}</div>
  `).join("");
}

function submitCodeGuess() {
  if (cbCurrentInput.length !== 4) { $("cbMsg").textContent = "Enter all 4 digits"; return; }
  const guess = cbCurrentInput.join("");
  socket.emit("player_guess", { code: roomCode, guess });
  cbCurrentInput = [];
  renderCBInput();
}

socket.on("codebreaker_result", ({ guess, result, correct }) => {
  cbGuesses.push({ guess, result });
  renderCBGrid();
  if (correct) { $("cbMsg").textContent = "🎉 Code cracked!"; $("cbMsg").style.color = "var(--success)"; }
});

socket.on("codebreaker_solved", ({ name, code: secret }) => {
  $("cbResult").style.display = "block";
  $("cbResult").innerHTML = name === myName
    ? `<span class="text-success" style="font-size:18px; font-weight:700;">🏆 You cracked it! Code: ${secret}</span>`
    : `<span class="text-muted">${name} cracked it first! Code was: <strong>${secret}</strong></span>`;
});

// Timeout — nobody cracked it
socket.on("codebreaker_timeout", ({ code: secret }) => {
  $("cbResult").style.display = "block";
  $("cbResult").innerHTML = `<span class="text-danger" style="font-size:16px; font-weight:700;">⏰ Time's up! Code was: <strong>${secret}</strong></span>`;
  // Disable numpad
  document.querySelectorAll("#cbNumPad .num-btn").forEach(b => b.style.pointerEvents = "none");
});

// ─── ROULETTE ─────────────────────────────────────────────────────────
let isMyTurn = false;
socket.on("roulette_round", ({ order }) => {
  isMyTurn = false;
  $("rouletteResult").style.display = "none";
  $("rouletteControls").style.display = "none";
  $("rouletteMsg").textContent = "Waiting for your turn...";
  $("rouletteSub").textContent = `Players: ${order.map(p => p.name).join(", ")}`;
  showScreen("roulette");
});

socket.on("your_turn", ({ game }) => {
  if (game !== "roulette") return;
  isMyTurn = true;
  $("rouletteMsg").textContent = "Your Turn!";
  $("rouletteSub").textContent = "Spin or shoot?";
  $("rouletteControls").style.display = "block";
  $("rouletteControls").classList.add("your-turn-glow");
  // Restore spin button for this new turn
  const spinBtn = document.getElementById("spinBtn");
  if (spinBtn) spinBtn.style.display = "";
});

socket.on("roulette_next", ({ currentPlayer, name }) => {
  isMyTurn = currentPlayer === myId;
  if (!isMyTurn) {
    $("rouletteMsg").textContent = `${name}'s turn`;
    $("rouletteSub").textContent = "Watching...";
    $("rouletteControls").style.display = "none";
  }
});

function playerSpin() {
  if (!isMyTurn) return;
  $("rouletteControls").style.display = "none";
  $("rouletteMsg").textContent = "Spinning...";
  $("rouletteGun").style.animation = "imposterPulse 0.3s 5";
  socket.emit("player_shoot", { code: roomCode, spin: true });
}

socket.on("roulette_spin_done", () => {
  $("rouletteMsg").textContent = "Chamber spun!";
  $("rouletteSub").textContent = "Now shoot!";
  $("rouletteControls").style.display = "block";
  // Hide spin button after use — one spin per turn
  const spinBtn = document.getElementById("spinBtn");
  if (spinBtn) spinBtn.style.display = "none";
});

socket.on("roulette_spin_denied", ({ msg }) => {
  showSnackbar(msg, "error");
});

socket.on("roulette_spin", ({ playerId }) => {
  const name = playerId === myId ? "You" : "They";
  showSnackbar(`${name} spun the barrel!`);
});

function playerShoot() {
  if (!isMyTurn) return;
  isMyTurn = false;
  $("rouletteControls").style.display = "none";
  $("rouletteMsg").textContent = "SHOOTING...";
  socket.emit("player_shoot", { code: roomCode, spin: false });
}

socket.on("roulette_bang", ({ playerId, name }) => {
  $("rouletteGun").textContent = "💥";
  $("rouletteResult").style.display = "block";
  if (playerId === myId) {
    $("rouletteResult").innerHTML = `<span class="text-danger" style="font-size:24px; font-weight:700;">💀 YOU'RE ELIMINATED!</span>`;
    setTimeout(() => showScreen("spectator"), 3000);
  } else {
    $("rouletteResult").innerHTML = `<span class="text-muted" style="font-size:18px;">${name} was eliminated! 💥</span>`;
  }
});

socket.on("roulette_safe", ({ playerId }) => {
  $("rouletteGun").textContent = "💨";
  if (playerId === myId) {
    showSnackbar("💨 Click! Safe... this time.", "success");
    $("rouletteGun").textContent = "😅";
  }
  setTimeout(() => { $("rouletteGun").textContent = "🔫"; }, 1000);
});

// ─── RAPID FIRE ──────────────────────────────────────────────────────
let rfAnswered = false;
socket.on("rapidfire_start", ({ duration, question }) => {
  rfDuration = duration / 1000;
  rfStart = Date.now();
  rfAnswered = false;
  showScreen("rapidfire");
  renderRFQuestion(question);
  startRFTimer(duration);
});

socket.on("rapidfire_question", ({ question }) => {
  rfAnswered = false;
  $("rfFeedback").style.display = "none";
  renderRFQuestion(question);
});

function renderRFQuestion(q) {
  $("rfQuestion").textContent = q.q;
  const letters = ["A","B","C","D"];
  // Only send answer index to server — correct answer NOT exposed in HTML
  $("rfOptions").innerHTML = q.options.map((o, i) => `
    <button class="option-btn" id="rf-opt-${i}" onclick="answerRF(${i})">
      <span class="option-letter">${letters[i]}</span>${o}
    </button>
  `).join("");
}

function answerRF(idx) {
  if (rfAnswered) return;
  rfAnswered = true;
  document.querySelectorAll("#rfOptions .option-btn").forEach(b => b.disabled = true);
  $("rf-opt-" + idx)?.classList.add("selected");
  socket.emit("player_answer", { code: roomCode, answer: idx, time: Date.now() });
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

// ─── GAME OVER ───────────────────────────────────────────────────────
socket.on("game_over", ({ players, game }) => {
  clearInterval(rfTimer);
  clearInterval(trivTimer);
  clearInterval(mathTimer);
  showScreen("gameover");
  const myRank = players.findIndex(p => p.id === myId) + 1;
  $("finalLeaderboard").innerHTML = players.map((p, i) => `
    <div class="leaderboard-row rank-${i + 1}">
      <div class="rank-num">${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</div>
      ${makeAvatarEl(p)}
      <span class="player-name">${p.name}${p.id === myId ? " (You)" : ""}</span>
      <span class="player-score">${p.score}</span>
    </div>
  `).join("");
});

// Session leaderboard shown on game over screen and waiting screen
socket.on("session_leaderboard", ({ leaderboard }) => {
  renderSessionLB(leaderboard);
});

function backToWaiting() {
  showScreen("waiting");
  requestSessionLB();
  // Re-sync player list (phase may be "ended" — server handles that now)
  socket.emit("request_room_state", { code: roomCode });
}

socket.on("show_leaderboard", ({ players }) => {
  $("spectatorLB").innerHTML = players.map((p, i) => `
    <div class="leaderboard-row rank-${i+1}">
      <div class="rank-num">${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i+1}</div>
      ${makeAvatarEl(p)}
      <span class="player-name">${p.name}</span>
      <span class="player-score">${p.score}</span>
    </div>
  `).join("");
});

socket.on("player_disconnected", ({ id }) => {
  if (id !== myId) showSnackbar("A player disconnected");
});
