const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const QRCode = require("qrcode");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["polling", "websocket"],
  pingTimeout: 60000,
  pingInterval: 25000
});

// ─── ONE-TIME HOST CODE ───────────────────────────────────────────────
const HOST_CODE = crypto.randomBytes(3).toString("hex").toUpperCase();

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Auth middleware for host page
app.get("/host", (req, res) => {
  const token = req.query.code;
  if (token !== HOST_CODE) {
    return res.send(`<!DOCTYPE html><html><head><title>Host Login</title>
    <style>
      body{font-family:sans-serif;background:#0f0f13;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
      .box{background:#1a1a24;border:1px solid #2a2a3a;border-radius:16px;padding:40px;width:320px;text-align:center;}
      h2{margin:0 0 8px;font-size:22px;letter-spacing:2px;}
      p{color:#888;font-size:13px;margin:0 0 24px;}
      input{width:100%;box-sizing:border-box;padding:12px;border-radius:8px;background:#0f0f13;border:1px solid #2a2a3a;color:#fff;font-size:18px;text-align:center;letter-spacing:4px;outline:none;margin-bottom:12px;}
      input:focus{border-color:#7c3aed;}
      button{width:100%;padding:12px;border-radius:8px;background:#7c3aed;color:#fff;border:none;font-size:15px;font-weight:700;cursor:pointer;}
      button:hover{background:#6d28d9;}
      .err{color:#ef4444;font-size:13px;margin-top:10px;display:none;}
    </style></head><body>
    <div class="box">
      <h2>🎮 HOST LOGIN</h2>
      <p>Enter the host code shown in your terminal</p>
      <input type="text" id="c" placeholder="XXXXXX" maxlength="6" oninput="this.value=this.value.toUpperCase()">
      <button onclick="go()">Enter</button>
      <div class="err" id="err">Wrong code</div>
    </div>
    <script>
      function go(){
        const v=document.getElementById('c').value.trim();
        if(!v){return;}
        window.location.href='/host?code='+v;
      }
      document.getElementById('c').addEventListener('keydown',e=>{if(e.key==='Enter')go();});
    </script></body></html>`);
  }
  res.sendFile(path.join(__dirname, "public/host.html"));
});

app.get("/display", (req, res) => res.sendFile(path.join(__dirname, "public/display.html")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public/index.html")));

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "localhost";
}

app.get("/qr", async (req, res) => {
  // On Render (or any cloud), use the public URL from env or request host
  const publicUrl = process.env.RENDER_EXTERNAL_URL
    || `https://${req.headers.host}`
    || `http://${getLocalIP()}:${PORT}`;
  const url = publicUrl.replace(/\/$/, "");
  const qr = await QRCode.toDataURL(url);
  res.json({ qr, url });
});

// ─── GLOBAL SESSION LEADERBOARD ───────────────────────────────────────
// Tracks cumulative scores across all games in the session
const sessionLeaderboard = {}; // { playerName: { name, avatar, totalScore, gamesPlayed, wins } }

function updateSessionLeaderboard(room) {
  room.players.forEach(p => {
    if (!sessionLeaderboard[p.name]) {
      sessionLeaderboard[p.name] = { name: p.name, avatar: p.avatar, totalScore: 0, gamesPlayed: 0, wins: 0 };
    }
    sessionLeaderboard[p.name].totalScore += p.score;
    sessionLeaderboard[p.name].gamesPlayed += 1;
    sessionLeaderboard[p.name].avatar = p.avatar;
  });

  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  if (sorted[0]) {
    if (!sessionLeaderboard[sorted[0].name]) {
      sessionLeaderboard[sorted[0].name] = { name: sorted[0].name, avatar: sorted[0].avatar, totalScore: 0, gamesPlayed: 0, wins: 0 };
    }
    sessionLeaderboard[sorted[0].name].wins += 1;
  }
}

function getSessionLeaderboard() {
  return Object.values(sessionLeaderboard).sort((a, b) => b.totalScore - a.totalScore);
}

app.get("/session-leaderboard", (req, res) => {
  res.json({ leaderboard: getSessionLeaderboard() });
});

const rooms = {};

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function getRoom(code) { return rooms[code]; }

function broadcastRoom(code, event, data) {
  io.to(code).emit(event, data);
}

function getRoomState(room) {
  return {
    players: room.players.map(p => ({
      id: p.id, name: p.name, avatar: p.avatar,
      score: p.score, lives: p.lives, eliminated: p.eliminated,
      ready: p.ready, disconnected: p.disconnected || false
    })),
    game: room.game,
    gameState: room.gameState,
    phase: room.phase,
    settings: room.settings
  };
}

const WORDS = [
  "apple","bicycle","camera","diamond","elephant","forest","guitar","hammer","island","jungle",
  "kitchen","library","mountain","notebook","ocean","pillow","queen","rocket","shadow","table",
  "umbrella","violin","window","xylophone","yellow","zebra","airplane","bridge","candle","desert",
  "engine","flower","garden","harbor","iceberg","journey","kingdom","lantern","mirror","needle",
  "orange","palace","quarter","river","silver","trophy","universe","valley","wallet","xerox",
  "yacht","anchor","bottle","castle","dolphin","eagle","fabric","goblin","helmet","igloo",
  "jacket","knife","lemon","magnet","nurse","oyster","puzzle","quartz","rubber","spider",
  "temple","turtle","upper","velvet","wizard","xenon","yogurt","zipper","accent","basket",
  "cement","dollar","effect","finger","ginger","hunter","impact","jigsaw","kennel","lizard",
  "market","napkin","outlet","pepper","rabbit","saddle","tissue","unlock","vessel","warden",
  "carpet","donkey","escape","fossil","gravel","handle","insect","jockey","kidney","locker",
  "muffin","nickel","opinion","parrot","quiver","raisin","staple","timber","utmost","vendor",
  "walnut","yonder","alarm","beard","clown","disco","evade","flute","globe","horse",
  "input","jewel","kneel","latch","moose","nylon","otter","plumb","quest","roast",
  "sauce","towel","udder","vapor","wrist","extra","yeast","zonal","atlas","blank",
  "crown","dream","eight","fence","grant","hinge","inlet","joust","knack","lodge",
  "minor","nerve","onset","plank","quota","ranch","screw","thorn","ultra","venom",
  "wheat","oxide","yodel","zones","adopt","bloom","coast","dwarf","elder","flank",
  "giant","hyena","imply","joker","knave","lyric","metal","noble","opera","piano",
  "quail","realm","scout","trend","union","vigor","wheat","axiom","yield","zenith"
];

const WOULD_YOU_RATHER = [
  ["Always be 10 minutes late", "Always be 20 minutes early"],
  ["Have no phone for a month", "Have no internet for a month"],
  ["Fight 100 duck-sized horses", "Fight 1 horse-sized duck"],
  ["Be able to fly but only at walking speed", "Be able to run at 100mph but can't fly"],
  ["Know how you will die", "Know when you will die"],
  ["Always speak in rhymes", "Always speak in questions"],
  ["Live without music", "Live without TV and movies"],
  ["Have free flights for life", "Have free food for life"],
  ["Be able to talk to animals", "Be able to speak every human language"],
  ["Never use social media again", "Never watch another movie or TV show"],
  ["Always be overdressed", "Always be underdressed"],
  ["Have a rewind button for your life", "Have a pause button for your life"],
  ["Be famous but hated", "Be unknown but loved"],
  ["Only eat sweet foods forever", "Only eat savory foods forever"],
  ["Have super strength", "Have super speed"],
  ["Live in the past", "Live in the future"],
  ["Always have to sing instead of speak", "Always have to dance instead of walk"],
  ["Never sleep again", "Never have to eat again"],
  ["Know all the secrets of the universe", "Know every person you meet truly likes you"],
  ["Be 4 feet tall", "Be 8 feet tall"],
];

const TRIVIA = [
  { q: "What is the capital of France?", options: ["London","Berlin","Paris","Rome"], answer: 2, type: "mcq" },
  { q: "What is 7 × 8?", options: ["54","56","58","64"], answer: 1, type: "mcq" },
  { q: "The sun is a planet.", options: ["True","False"], answer: 1, type: "tf" },
  { q: "Which element has the symbol O?", options: ["Gold","Oxygen","Osmium","Oganesson"], answer: 1, type: "mcq" },
  { q: "How many continents are there?", options: ["5","6","7","8"], answer: 2, type: "mcq" },
  { q: "A group of lions is called a pride.", options: ["True","False"], answer: 0, type: "tf" },
  { q: "Which planet is closest to the sun?", options: ["Venus","Mars","Mercury","Earth"], answer: 2, type: "mcq" },
  { q: "Water boils at 100°C at sea level.", options: ["True","False"], answer: 0, type: "tf" },
  { q: "What is the largest ocean?", options: ["Atlantic","Indian","Arctic","Pacific"], answer: 3, type: "mcq" },
  { q: "Shakespeare wrote Romeo and Juliet.", options: ["True","False"], answer: 0, type: "tf" },
  { q: "How many sides does a hexagon have?", options: ["5","6","7","8"], answer: 1, type: "mcq" },
  { q: "The Great Wall of China is visible from space.", options: ["True","False"], answer: 1, type: "tf" },
  { q: "Which country is the largest by area?", options: ["China","USA","Canada","Russia"], answer: 3, type: "mcq" },
  { q: "Sound travels faster than light.", options: ["True","False"], answer: 1, type: "tf" },
  { q: "What gas do plants absorb?", options: ["Oxygen","Nitrogen","CO2","Hydrogen"], answer: 2, type: "mcq" },
];

const RAPID_FIRE = [
  { q: "What color is the sky?", options: ["Green","Blue","Red","Yellow"], answer: 1 },
  { q: "2 + 2 = ?", options: ["3","4","5","6"], answer: 1 },
  { q: "How many days in a week?", options: ["5","6","7","8"], answer: 2 },
  { q: "Which animal says moo?", options: ["Dog","Cat","Cow","Pig"], answer: 2 },
  { q: "What is the opposite of hot?", options: ["Warm","Cold","Cool","Icy"], answer: 1 },
  { q: "3 × 3 = ?", options: ["6","8","9","12"], answer: 2 },
  { q: "Which fruit is yellow?", options: ["Apple","Grape","Banana","Orange"], answer: 2 },
  { q: "How many months in a year?", options: ["10","11","12","13"], answer: 2 },
  { q: "What shape has 3 sides?", options: ["Square","Circle","Triangle","Rectangle"], answer: 2 },
  { q: "What is 10 - 4?", options: ["5","6","7","8"], answer: 1 },
  { q: "Which is the fastest land animal?", options: ["Lion","Cheetah","Horse","Leopard"], answer: 1 },
  { q: "What do bees make?", options: ["Milk","Honey","Butter","Wax"], answer: 1 },
  { q: "How many legs does a spider have?", options: ["6","8","10","12"], answer: 1 },
  { q: "What planet do we live on?", options: ["Mars","Venus","Earth","Jupiter"], answer: 2 },
  { q: "What is 5 × 5?", options: ["20","25","30","35"], answer: 1 },
  { q: "Which ocean is the largest?", options: ["Atlantic","Pacific","Indian","Arctic"], answer: 1 },
  { q: "How many colors in a rainbow?", options: ["5","6","7","8"], answer: 2 },
  { q: "What is H2O?", options: ["Fire","Air","Water","Earth"], answer: 2 },
  { q: "What is 15 + 7?", options: ["21","22","23","24"], answer: 1 },
  { q: "Which is the tallest mountain?", options: ["K2","Kilimanjaro","Everest","Alps"], answer: 2 },
];

const TYPING_PROMPTS = [
  "The quick brown fox jumps over the lazy dog",
  "All that glitters is not gold",
  "To be or not to be that is the question",
  "A journey of a thousand miles begins with a single step",
  "Actions speak louder than words in every situation",
  "Better late than never but never late is better",
  "Every cloud has a silver lining somewhere out there",
  "The early bird catches the worm every single morning",
  "Practice makes perfect when you try hard enough daily",
  "Where there is a will there is always a way",
  "Time flies when you are having fun with friends",
  "Life is what happens when you are busy making plans",
  "In the middle of difficulty lies opportunity for greatness",
  "Knowledge is power but wisdom is knowing when to use it",
  "The best way to predict your future is to create it",
];

function generateMathQuestion(difficulty) {
  const ops = ["+", "-", "*", "/"];
  let a, b, op, answer, question;

  if (difficulty === "easy") {
    a = Math.floor(Math.random() * 20) + 1;
    b = Math.floor(Math.random() * 20) + 1;
    op = ops[Math.floor(Math.random() * 2)];
  } else if (difficulty === "medium") {
    a = Math.floor(Math.random() * 50) + 10;
    b = Math.floor(Math.random() * 30) + 5;
    op = ops[Math.floor(Math.random() * 3)];
  } else {
    op = ops[Math.floor(Math.random() * 4)];
    if (Math.random() > 0.5) {
      const base = Math.floor(Math.random() * 10) + 2;
      const squared = base * base;
      question = `√${squared}`;
      answer = base;
      const wrong = [answer + 1, answer - 1, answer + 2].filter(x => x > 0);
      const opts = shuffle([answer, ...wrong.slice(0, 3)]);
      return { question, answer: opts.indexOf(answer), options: opts.map(String) };
    }
    a = Math.floor(Math.random() * 100) + 10;
    b = Math.floor(Math.random() * 50) + 5;
  }

  if (op === "/") {
    b = Math.floor(Math.random() * 9) + 2;
    a = b * (Math.floor(Math.random() * 10) + 1);
    answer = a / b;
    question = `${a} ÷ ${b}`;
  } else if (op === "*") {
    a = Math.floor(Math.random() * 12) + 2;
    b = Math.floor(Math.random() * 12) + 2;
    answer = a * b;
    question = `${a} × ${b}`;
  } else {
    answer = op === "+" ? a + b : a - b;
    if (op === "-" && answer < 0) { [a, b] = [b, a]; answer = a - b; }
    question = `${a} ${op} ${b}`;
  }

  const offsets = [1, 2, 3, 5, 10];
  const wrong = new Set();
  while (wrong.size < 3) {
    const offset = offsets[Math.floor(Math.random() * offsets.length)];
    const w = answer + (Math.random() > 0.5 ? offset : -offset);
    if (w !== answer && w >= 0) wrong.add(w);
  }
  const opts = shuffle([answer, ...[...wrong].slice(0, 3)]);
  return { question, answer: opts.indexOf(answer), options: opts.map(String) };
}

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

function getRandomWord() {
  return WORDS[Math.floor(Math.random() * WORDS.length)].toUpperCase();
}

io.on("connection", (socket) => {

  socket.on("create_room", ({ hostId }) => {
    const code = generateCode();
    rooms[code] = {
      code,
      hostId,
      displayId: null,
      players: [],
      game: null,
      phase: "lobby",
      gameState: {},
      settings: {},
      timers: {}
    };
    socket.join(code);
    socket.emit("room_created", { code });
    // Send session leaderboard to host on room create
    socket.emit("session_leaderboard", { leaderboard: getSessionLeaderboard() });
  });

  socket.on("display_join", ({ code }) => {
    const room = getRoom(code);
    if (!room) return socket.emit("error", { msg: "Room not found" });
    room.displayId = socket.id;
    socket.join(code);
    socket.emit("room_state", getRoomState(room));
  });

  socket.on("player_join", ({ code, name, avatar, reconnectToken }) => {
    const room = getRoom(code);
    if (!room) return socket.emit("error", { msg: "Room not found" });

    // ── RECONNECT PATH ──────────────────────────────────────────────
    if (reconnectToken) {
      const ghost = room.players.find(p => p.reconnectToken === reconnectToken);
      if (ghost) {
        if (ghost._disconnectTimer) {
          clearTimeout(ghost._disconnectTimer);
          ghost._disconnectTimer = null;
        }
        ghost.id = socket.id;
        ghost.disconnected = false;
        socket.join(code);
        socket.data.roomCode = code;
        socket.emit("joined", { player: ghost, code, reconnectToken: ghost.reconnectToken });
        socket.emit("session_leaderboard", { leaderboard: getSessionLeaderboard() });
        broadcastRoom(code, "player_reconnected", { id: ghost.id, name: ghost.name });
        broadcastRoom(code, "room_state", getRoomState(room));
        if (room.phase === "playing" && room.game) {
          socket.emit("game_start", { game: room.game, settings: room.settings });
        }
        return;
      }
      // Token not found — fall through to fresh join
    }

    // ── FRESH JOIN PATH ─────────────────────────────────────────────
    if (room.players.length >= 15) return socket.emit("error", { msg: "Room is full" });
    const existing = room.players.find(
      p => p.name.toLowerCase() === name.toLowerCase() && !p.disconnected
    );
    if (existing) return socket.emit("error", { msg: "Name already taken" });

    const token = crypto.randomUUID();
    const player = {
      id: socket.id, name, avatar: avatar || null,
      score: 0, lives: 3, eliminated: false, ready: false,
      disconnected: false, reconnectToken: token, _disconnectTimer: null
    };
    room.players.push(player);
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit("joined", { player, code, reconnectToken: token });
    broadcastRoom(code, "room_state", getRoomState(room));
    socket.emit("session_leaderboard", { leaderboard: getSessionLeaderboard() });
  });

  socket.on("player_ready", ({ code }) => {
    const room = getRoom(code);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) { player.ready = !player.ready; broadcastRoom(code, "room_state", getRoomState(room)); }
  });

  socket.on("host_kick", ({ code, playerId }) => {
    const room = getRoom(code);
    if (!room) return;
    const kicked = room.players.find(p => p.id === playerId);
    if (kicked) {
      if (kicked._disconnectTimer) clearTimeout(kicked._disconnectTimer);
      // Invalidate token so they cannot reconnect
      kicked.reconnectToken = null;
    }
    room.players = room.players.filter(p => p.id !== playerId);
    io.to(playerId).emit("kicked");
    broadcastRoom(code, "room_state", getRoomState(room));
  });

  socket.on("host_select_game", ({ code, game, settings }) => {
    const room = getRoom(code);
    if (!room) return;
    room.game = game;
    room.settings = settings || {};
    room.phase = "settings";
    room.players.forEach(p => { p.score = 0; p.lives = 3; p.eliminated = false; p.ready = false; });
    broadcastRoom(code, "game_selected", { game, settings: room.settings });
    broadcastRoom(code, "room_state", getRoomState(room));
  });

  socket.on("host_start_game", ({ code }) => {
    const room = getRoom(code);
    if (!room) return;
    room.phase = "playing";
    room.round = 1;
    startGame(code);
  });

  socket.on("host_next_round", ({ code }) => {
    const room = getRoom(code);
    if (!room) return;
    room.round = (room.round || 1) + 1;
    startRound(code);
  });

  socket.on("host_show_leaderboard", ({ code }) => {
    const room = getRoom(code);
    if (!room) return;
    broadcastRoom(code, "show_leaderboard", { players: getSortedPlayers(room) });
  });

  socket.on("host_show_session_leaderboard", ({ code }) => {
    const room = getRoom(code);
    if (!room) return;
    broadcastRoom(code, "session_leaderboard", { leaderboard: getSessionLeaderboard() });
  });

  socket.on("host_end_game", ({ code }) => {
    const room = getRoom(code);
    if (!room) return;
    endGame(code);
  });

  socket.on("host_reset_session_leaderboard", ({ code }) => {
    const room = getRoom(code);
    if (!room) return;
    // Clear all session leaderboard entries
    Object.keys(sessionLeaderboard).forEach(k => delete sessionLeaderboard[k]);
    broadcastRoom(code, "session_leaderboard", { leaderboard: [] });
  });

  socket.on("player_answer", ({ code, answer, time }) => {
    const room = getRoom(code);
    if (!room) return;
    handleAnswer(code, socket.id, answer, time);
  });

  socket.on("player_tap", ({ code }) => {
    const room = getRoom(code);
    if (!room || room.game !== "reaction") return;
    handleReactionTap(code, socket.id);
  });

  socket.on("player_emergency", ({ code }) => {
    const room = getRoom(code);
    if (!room || room.game !== "imposter") return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.eliminated) return;
    if (room.gameState.emergencyUsed && room.gameState.emergencyUsed[socket.id]) return;
    if (!room.gameState.emergencyUsed) room.gameState.emergencyUsed = {};
    room.gameState.emergencyUsed[socket.id] = true;
    broadcastRoom(code, "emergency_called", { by: player.name });
    startVoting(code);
  });

  socket.on("player_vote", ({ code, targetId }) => {
    const room = getRoom(code);
    if (!room || room.phase !== "voting") return;
    const voter = room.players.find(p => p.id === socket.id);
    if (!voter || voter.eliminated) return;
    if (room.gameState.votes[socket.id]) return;
    room.gameState.votes[socket.id] = targetId;
    broadcastRoom(code, "vote_cast", {
      voterId: socket.id,
      totalVotes: Object.keys(room.gameState.votes).length,
      totalVoters: room.players.filter(p => !p.eliminated && !p.disconnected).length
    });
  });

  socket.on("player_shoot", ({ code, spin }) => {
    const room = getRoom(code);
    if (!room || room.game !== "roulette") return;
    handleRoulette(code, socket.id, spin);
  });

  socket.on("player_guess", ({ code, guess }) => {
    const room = getRoom(code);
    if (!room) return;
    handleGuess(code, socket.id, guess);
  });

  socket.on("player_typing_done", ({ code, time, accuracy }) => {
    const room = getRoom(code);
    if (!room || room.game !== "fasttyper") return;
    handleTypingDone(code, socket.id, time, accuracy);
  });

  socket.on("request_session_leaderboard", ({ code }) => {
    socket.emit("session_leaderboard", { leaderboard: getSessionLeaderboard() });
  });

  socket.on("request_room_state", ({ code }) => {
    const room = getRoom(code);
    if (!room) return;
    socket.emit("room_state", getRoomState(room));
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = getRoom(code);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    // Mark as disconnected, start 60s grace window before full removal
    player.disconnected = true;
    broadcastRoom(code, "player_disconnected", { id: socket.id, name: player.name });
    broadcastRoom(code, "room_state", getRoomState(room));

    player._disconnectTimer = setTimeout(() => {
      const r = getRoom(code);
      if (!r) return;
      r.players = r.players.filter(p => p.reconnectToken !== player.reconnectToken);
      broadcastRoom(code, "room_state", getRoomState(r));
    }, 60000);
  });
});

function startGame(code) {
  const room = getRoom(code);
  if (!room) return;
  room.round = 1;
  clearAllTimers(room);
  broadcastRoom(code, "game_start", { game: room.game, settings: room.settings });
  setTimeout(() => startRound(code), 1500);
}

function startRound(code) {
  const room = getRoom(code);
  if (!room) return;
  clearAllTimers(room);
  const game = room.game;

  if (game === "imposter") startImposterRound(code);
  else if (game === "trivial") startTrivialRound(code);
  else if (game === "reaction") startReactionRound(code);
  else if (game === "wouldyourather") startWouldYouRatherRound(code);
  else if (game === "mathquiz") startMathRound(code);
  else if (game === "fasttyper") startFastTyperRound(code);
  else if (game === "wordcrack") startWordCrackRound(code);
  else if (game === "codebreaker") startCodeBreakerRound(code);
  else if (game === "roulette") startRouletteRound(code);
  else if (game === "rapidfire") startRapidFireRound(code);
}

function startImposterRound(code) {
  const room = getRoom(code);
  const activePlayers = room.players.filter(p => !p.eliminated);
  const numImposters = Math.min(room.settings.imposters || 1, Math.floor(activePlayers.length / 3));
  const word = getRandomWord();
  const imposterIds = shuffle(activePlayers.map(p => p.id)).slice(0, numImposters);

  room.gameState = { word, imposterIds, phase: "hint", emergencyUsed: {}, votes: {} };
  room.phase = "playing";

  activePlayers.forEach(p => {
    const isImposter = imposterIds.includes(p.id);
    io.to(p.id).emit("imposter_role", { isImposter, word: isImposter ? null : word });
  });

  broadcastRoom(code, "imposter_round_start", {
    round: room.round,
    playerCount: activePlayers.length,
    numImposters
  });
}

function startVoting(code) {
  const room = getRoom(code);
  room.phase = "voting";
  room.gameState.votes = {};
  const duration = (room.settings.votingTime || 30) * 1000;

  broadcastRoom(code, "voting_start", {
    duration,
    players: room.players.filter(p => !p.eliminated).map(p => ({ id: p.id, name: p.name, avatar: p.avatar }))
  });

  room.timers.voting = setTimeout(() => resolveVoting(code), duration);
}

function resolveVoting(code) {
  const room = getRoom(code);
  if (!room) return;
  const votes = room.gameState.votes;
  const tally = {};
  Object.values(votes).forEach(id => { tally[id] = (tally[id] || 0) + 1; });

  let maxVotes = 0, eliminated = null;
  Object.entries(tally).forEach(([id, count]) => {
    if (count > maxVotes) { maxVotes = count; eliminated = id; }
  });

  const eliminatedPlayer = room.players.find(p => p.id === eliminated);
  if (eliminatedPlayer) eliminatedPlayer.eliminated = true;

  const isImposter = eliminated && room.gameState.imposterIds.includes(eliminated);
  const allImpostersGone = room.gameState.imposterIds.every(id => room.players.find(p => p.id === id)?.eliminated);
  const activePlayers = room.players.filter(p => !p.eliminated);
  const activeImposters = room.gameState.imposterIds.filter(id => !room.players.find(p => p.id === id)?.eliminated);
  const gameOver = allImpostersGone || activePlayers.length <= activeImposters.length;

  broadcastRoom(code, "voting_result", {
    tally,
    eliminatedId: eliminated,
    eliminatedName: eliminatedPlayer?.name,
    wasImposter: isImposter,
    gameOver,
    word: room.gameState.word,
    imposterIds: room.gameState.imposterIds,
    imposterNames: room.gameState.imposterIds.map(id => room.players.find(p => p.id === id)?.name)
  });

  if (gameOver) {
    room.phase = "results";
    if (allImpostersGone) room.players.filter(p => !room.gameState.imposterIds.includes(p.id)).forEach(p => p.score += 100);
    else room.gameState.imposterIds.forEach(id => { const p = room.players.find(x => x.id === id); if (p) p.score += 150; });
    setTimeout(() => endGame(code), 5000);
  } else {
    room.phase = "playing";
    setTimeout(() => startImposterRound(code), 5000);
  }
}

function startTrivialRound(code) {
  const room = getRoom(code);
  const questions = room.settings.questions || TRIVIA;
  const idx = (room.round - 1) % questions.length;
  const q = questions[idx];
  room.gameState = { question: q, answers: {}, revealed: false };
  const duration = (room.settings.questionTime || 20) * 1000;

  broadcastRoom(code, "trivial_question", {
    round: room.round,
    total: room.settings.rounds || questions.length,
    question: q.q,
    options: q.options,
    type: q.type,
    duration
  });

  room.timers.question = setTimeout(() => revealTrivialAnswer(code), duration);
}

function revealTrivialAnswer(code) {
  const room = getRoom(code);
  if (!room || room.game !== "trivial") return;
  const q = room.gameState.question;
  const answers = room.gameState.answers;

  room.players.forEach(p => {
    if (answers[p.id] === q.answer) p.score += 100;
  });

  broadcastRoom(code, "trivial_reveal", {
    correctIndex: q.answer,
    answers,
    players: getSortedPlayers(room)
  });

  const totalRounds = room.settings.rounds || 10;
  if (room.round >= totalRounds) {
    setTimeout(() => endGame(code), 4000);
  } else {
    setTimeout(() => { room.round++; startRound(code); }, 4000);
  }
}

function startReactionRound(code) {
  const room = getRoom(code);
  const activePlayers = room.players.filter(p => !p.eliminated);
  room.gameState = { tapped: {}, flashActive: false, roundOver: false };
  room.phase = "playing";

  broadcastRoom(code, "reaction_waiting", { round: room.round, players: activePlayers.map(p => ({ id: p.id, name: p.name })) });

  const delay = 2000 + Math.random() * 6000;
  room.timers.flash = setTimeout(() => triggerFlash(code), delay);
}

function triggerFlash(code) {
  const room = getRoom(code);
  if (!room) return;
  room.gameState.flashActive = true;
  room.gameState.flashTime = Date.now();
  broadcastRoom(code, "reaction_flash");

  room.timers.flashEnd = setTimeout(() => {
    room.gameState.flashActive = false;
    const activePlayers = room.players.filter(p => !p.eliminated);
    const missed = activePlayers.filter(p => !room.gameState.tapped[p.id]);
    missed.forEach(p => { p.eliminated = true; });

    broadcastRoom(code, "reaction_result", {
      survived: activePlayers.filter(p => room.gameState.tapped[p.id]).map(p => p.id),
      eliminated: missed.map(p => ({ id: p.id, name: p.name })),
      players: getSortedPlayers(room)
    });

    const remaining = room.players.filter(p => !p.eliminated);
    const totalRounds = room.settings.rounds || 5;

    if (remaining.length <= 1 || room.round >= totalRounds) {
      // Award winner points in laststanding mode
      if (room.settings.mode !== "mosttaps" && remaining.length === 1) {
        remaining[0].score += 100 * room.round;
      }
      setTimeout(() => endGame(code), 3000);
    } else {
      setTimeout(() => { room.round++; startRound(code); }, 3000);
    }
  }, 1500);
}

function handleReactionTap(code, playerId) {
  const room = getRoom(code);
  if (!room || !room.gameState.flashActive) return;
  room.gameState.tapped[playerId] = true;
  const player = room.players.find(p => p.id === playerId);
  if (room.settings.mode === "mosttaps") { if (player) player.score += 10; }
  io.to(playerId).emit("reaction_tapped", { success: true });
}

function startWouldYouRatherRound(code) {
  const room = getRoom(code);
  const q = WOULD_YOU_RATHER[Math.floor(Math.random() * WOULD_YOU_RATHER.length)];
  room.gameState = { question: q, votes: {}, revealed: false };

  broadcastRoom(code, "wyr_question", {
    round: room.round,
    total: room.settings.rounds || 10,
    optionA: q[0],
    optionB: q[1]
  });

  room.timers.question = setTimeout(() => revealWYR(code), 30000);
}

function revealWYR(code) {
  const room = getRoom(code);
  if (!room) return;
  const votes = room.gameState.votes;
  let aVotes = 0, bVotes = 0;
  Object.values(votes).forEach(v => { if (v === 0) aVotes++; else bVotes++; });

  const minority = aVotes < bVotes ? 0 : bVotes < aVotes ? 1 : -1;
  room.players.forEach(p => {
    if (!votes.hasOwnProperty(p.id)) return; // didn't vote — no change
    if (minority === -1) return;              // tie — no penalty/reward
    if (votes[p.id] === minority) {
      p.score -= 10; // minority loses
    } else {
      p.score += 20; // majority wins
    }
  });

  broadcastRoom(code, "wyr_reveal", {
    aVotes, bVotes,
    minority,
    players: getSortedPlayers(room)
  });

  clearTimeout(room.timers.question);
  const totalRounds = room.settings.rounds || 10;
  if (room.round >= totalRounds) {
    setTimeout(() => endGame(code), 4000);
  } else {
    setTimeout(() => { room.round++; startRound(code); }, 4000);
  }
}

function startMathRound(code) {
  const room = getRoom(code);
  const q = generateMathQuestion(room.settings.difficulty || "medium");
  room.gameState = { question: q, answers: {}, startTime: Date.now() };
  const duration = (room.settings.questionTime || 15) * 1000;

  broadcastRoom(code, "math_question", {
    round: room.round,
    total: room.settings.rounds || 10,
    question: q.question,
    options: q.options,
    duration
  });

  room.timers.question = setTimeout(() => revealMathAnswer(code), duration);
}

function revealMathAnswer(code) {
  const room = getRoom(code);
  if (!room) return;
  const q = room.gameState.question;
  const answers = room.gameState.answers;
  const duration = (room.settings.questionTime || 15) * 1000;

  room.players.forEach(p => {
    const ans = answers[p.id];
    if (ans && ans.answer === q.answer) {
      const timeBonus = Math.max(0, Math.floor((duration - (ans.time - room.gameState.startTime)) / 100));
      p.score += 100 + timeBonus;
    }
  });

  broadcastRoom(code, "math_reveal", {
    correctIndex: q.answer,
    answers: Object.fromEntries(Object.entries(answers).map(([id, a]) => [id, a.answer])),
    players: getSortedPlayers(room)
  });

  clearTimeout(room.timers.question);
  const totalRounds = room.settings.rounds || 10;
  if (room.round >= totalRounds) {
    setTimeout(() => endGame(code), 4000);
  } else {
    setTimeout(() => { room.round++; startRound(code); }, 4000);
  }
}

// ─── FAST TYPER — with timeout ────────────────────────────────────────
const FASTTYPER_TIMEOUT = 120 * 1000; // 2 minutes max per round

function startFastTyperRound(code) {
  const room = getRoom(code);
  const prompt = TYPING_PROMPTS[Math.floor(Math.random() * TYPING_PROMPTS.length)];
  room.gameState = { prompt, finished: {}, startTime: Date.now() };

  broadcastRoom(code, "typing_round", {
    round: room.round,
    total: room.settings.rounds || 5,
    prompt
  });

  // Timeout — force end if players don't finish
  room.timers.typingTimeout = setTimeout(() => {
    const r = getRoom(code);
    if (!r || r.game !== "fasttyper") return;
    broadcastRoom(code, "typing_round_end", { players: getSortedPlayers(r) });
    const totalRounds = r.settings.rounds || 5;
    if (r.round >= totalRounds) setTimeout(() => endGame(code), 3000);
    else setTimeout(() => { r.round++; startRound(code); }, 3000);
  }, FASTTYPER_TIMEOUT);
}

function handleTypingDone(code, playerId, time, accuracy) {
  const room = getRoom(code);
  if (!room || room.gameState.finished[playerId]) return;
  room.gameState.finished[playerId] = { time, accuracy };
  const player = room.players.find(p => p.id === playerId);
  const position = Object.keys(room.gameState.finished).length;
  const timeBonus = Math.max(0, 500 - Math.floor(time / 10));
  const accBonus = Math.floor(accuracy * 2);
  if (player) player.score += timeBonus + accBonus;

  broadcastRoom(code, "typing_player_done", {
    playerId,
    name: player?.name,
    position,
    time,
    accuracy,
    players: getSortedPlayers(room)
  });

  const activePlayers = room.players.filter(p => !p.eliminated && !p.disconnected);
  if (Object.keys(room.gameState.finished).length >= activePlayers.length) {
    clearTimeout(room.timers.typingTimeout);
    setTimeout(() => {
      broadcastRoom(code, "typing_round_end", { players: getSortedPlayers(room) });
      const totalRounds = room.settings.rounds || 5;
      if (room.round >= totalRounds) setTimeout(() => endGame(code), 3000);
      else setTimeout(() => { room.round++; startRound(code); }, 3000);
    }, 1000);
  }
}

// ─── WORD CRACK — with timeout ────────────────────────────────────────
const WORDCRACK_TIMEOUT = 90 * 1000; // 90 seconds max per round

function startWordCrackRound(code) {
  const room = getRoom(code);
  const word = getRandomWord();
  room.gameState = { word, grids: {}, solved: false };

  broadcastRoom(code, "wordcrack_round", {
    round: room.round,
    total: room.settings.rounds || 5,
    wordLength: word.length
  });

  // Timeout — reveal word and move on if nobody solves it
  room.timers.wordTimeout = setTimeout(() => {
    const r = getRoom(code);
    if (!r || r.game !== "wordcrack" || r.gameState.solved) return;
    broadcastRoom(code, "wordcrack_timeout", { word: r.gameState.word });
    const totalRounds = r.settings.rounds || 5;
    if (r.round >= totalRounds) setTimeout(() => endGame(code), 4000);
    else setTimeout(() => { r.round++; startRound(code); }, 4000);
  }, WORDCRACK_TIMEOUT);
}

// ─── CODE BREAKER — with timeout ─────────────────────────────────────
const CODEBREAKER_TIMEOUT = 90 * 1000; // 90 seconds max per round

function startCodeBreakerRound(code) {
  const room = getRoom(code);
  const digits = Array.from({ length: 4 }, () => Math.floor(Math.random() * 10)).join("");
  room.gameState = { code: digits, grids: {}, solved: false };

  broadcastRoom(code, "codebreaker_round", {
    round: room.round,
    total: room.settings.rounds || 5
  });

  // Timeout — reveal code and move on if nobody cracks it
  room.timers.codeTimeout = setTimeout(() => {
    const r = getRoom(code);
    if (!r || r.game !== "codebreaker" || r.gameState.solved) return;
    broadcastRoom(code, "codebreaker_timeout", { code: r.gameState.code });
    const totalRounds = r.settings.rounds || 5;
    if (r.round >= totalRounds) setTimeout(() => endGame(code), 4000);
    else setTimeout(() => { r.round++; startRound(code); }, 4000);
  }, CODEBREAKER_TIMEOUT);
}

function handleGuess(code, playerId, guess) {
  const room = getRoom(code);
  if (!room) return;

  if (room.game === "wordcrack") {
    const word = room.gameState.word;
    const g = guess.toUpperCase().slice(0, word.length);
    const result = getWordCrackResult(word, g);
    const isCorrect = g === word;

    if (!room.gameState.grids[playerId]) room.gameState.grids[playerId] = [];
    room.gameState.grids[playerId].push({ guess: g, result });

    io.to(playerId).emit("wordcrack_result", { guess: g, result, correct: isCorrect });
    broadcastRoom(code, "wordcrack_grid_update", { playerId, grids: room.gameState.grids });

    if (isCorrect && !room.gameState.solved) {
      room.gameState.solved = true;
      clearTimeout(room.timers.wordTimeout);
      const player = room.players.find(p => p.id === playerId);
      if (player) player.score += 200;
      broadcastRoom(code, "wordcrack_solved", { playerId, name: player?.name, word, players: getSortedPlayers(room) });
      const totalRounds = room.settings.rounds || 5;
      if (room.round >= totalRounds) setTimeout(() => endGame(code), 4000);
      else setTimeout(() => { room.round++; startRound(code); }, 4000);
    }
  } else if (room.game === "codebreaker") {
    const code_ = room.gameState.code;
    const g = guess.toString().padStart(4, "0").slice(0, 4);
    const result = getCodeBreakerResult(code_, g);
    const isCorrect = g === code_;

    if (!room.gameState.grids[playerId]) room.gameState.grids[playerId] = [];
    room.gameState.grids[playerId].push({ guess: g, result });

    io.to(playerId).emit("codebreaker_result", { guess: g, result, correct: isCorrect });
    broadcastRoom(code, "codebreaker_grid_update", { playerId, grids: room.gameState.grids });

    if (isCorrect && !room.gameState.solved) {
      room.gameState.solved = true;
      clearTimeout(room.timers.codeTimeout);
      const player = room.players.find(p => p.id === playerId);
      if (player) player.score += 200;
      broadcastRoom(code, "codebreaker_solved", { playerId, name: player?.name, code: code_, players: getSortedPlayers(room) });
      const totalRounds = room.settings.rounds || 5;
      if (room.round >= totalRounds) setTimeout(() => endGame(code), 4000);
      else setTimeout(() => { room.round++; startRound(code); }, 4000);
    }
  }
}

function getWordCrackResult(word, guess) {
  const result = Array(word.length).fill("absent");
  const wordArr = word.split("");
  const guessArr = guess.split("");
  const used = Array(word.length).fill(false);

  guessArr.forEach((c, i) => { if (c === wordArr[i]) { result[i] = "correct"; used[i] = true; } });
  guessArr.forEach((c, i) => {
    if (result[i] === "correct") return;
    const j = wordArr.findIndex((w, wi) => w === c && !used[wi]);
    if (j !== -1) { result[i] = "present"; used[j] = true; }
  });
  return result;
}

function getCodeBreakerResult(code, guess) {
  return getWordCrackResult(code, guess);
}

function startRouletteRound(code) {
  const room = getRoom(code);
  const activePlayers = room.players.filter(p => !p.eliminated);
  const order = shuffle(activePlayers.map(p => p.id));
  room.gameState = { chamber: Math.floor(Math.random() * 6), currentShot: 0, order, currentIdx: 0, spinsUsed: {} };
  room.phase = "playing";

  broadcastRoom(code, "roulette_round", {
    round: room.round,
    order: order.map(id => ({ id, name: room.players.find(p => p.id === id)?.name })),
    currentPlayer: order[0]
  });

  io.to(order[0]).emit("your_turn", { game: "roulette" });
}

function handleRoulette(code, playerId, spin) {
  const room = getRoom(code);
  if (!room) return;
  const gs = room.gameState;
  if (gs.order[gs.currentIdx] !== playerId) return;

  if (spin) {
    if (gs.spinsUsed[playerId]) {
      io.to(playerId).emit("roulette_spin_denied", { msg: "You already spun this turn" });
      return;
    }
    gs.spinsUsed[playerId] = true;
    gs.chamber = Math.floor(Math.random() * 6);
    gs.currentShot = 0;
    broadcastRoom(code, "roulette_spin", { playerId });
    setTimeout(() => io.to(playerId).emit("roulette_spin_done"), 2000);
    return;
  }

  const bang = gs.currentShot === gs.chamber;
  gs.currentShot++;

  if (bang) {
    const player = room.players.find(p => p.id === playerId);
    if (player) player.eliminated = true;
    broadcastRoom(code, "roulette_bang", { playerId, name: player?.name });

    const remaining = room.players.filter(p => !p.eliminated);

    if (remaining.length <= 1) {
      if (remaining[0]) remaining[0].score += 300;
      setTimeout(() => endGame(code), 3000);
    } else {
      gs.chamber = Math.floor(Math.random() * 6);
      gs.currentShot = 0;
      gs.order = gs.order.filter(id => id !== playerId);
      gs.currentIdx = gs.currentIdx % gs.order.length;
      setTimeout(() => nextRoulettePlayer(code), 3000);
    }
  } else {
    broadcastRoom(code, "roulette_safe", { playerId });
    gs.currentIdx = (gs.currentIdx + 1) % gs.order.length;
    while (room.players.find(p => p.id === gs.order[gs.currentIdx])?.eliminated) {
      gs.currentIdx = (gs.currentIdx + 1) % gs.order.length;
    }
    setTimeout(() => nextRoulettePlayer(code), 2000);
  }
}

function nextRoulettePlayer(code) {
  const room = getRoom(code);
  if (!room) return;
  const gs = room.gameState;
  const nextId = gs.order[gs.currentIdx];
  broadcastRoom(code, "roulette_next", { currentPlayer: nextId, name: room.players.find(p => p.id === nextId)?.name });
  io.to(nextId).emit("your_turn", { game: "roulette" });
}

function startRapidFireRound(code) {
  const room = getRoom(code);
  const duration = (room.settings.duration || 60) * 1000;
  room.gameState = { questions: shuffle([...RAPID_FIRE]), currentQ: 0, answers: {}, startTime: Date.now() };

  const firstQ = room.gameState.questions[0];
  broadcastRoom(code, "rapidfire_start", {
    duration,
    question: { q: firstQ.q, options: firstQ.options }
  });

  room.timers.rapidfire = setTimeout(() => endRapidFire(code), duration);
  room.timers.nextQ = setTimeout(() => nextRapidFireQuestion(code), 5000);
}

function nextRapidFireQuestion(code) {
  const room = getRoom(code);
  if (!room || room.game !== "rapidfire") return;
  room.gameState.currentQ++;
  room.gameState.answers = {};
  if (room.gameState.currentQ >= room.gameState.questions.length) {
    room.gameState.questions = shuffle([...RAPID_FIRE]);
    room.gameState.currentQ = 0;
  }
  const curQ = room.gameState.questions[room.gameState.currentQ];
  broadcastRoom(code, "rapidfire_question", { question: { q: curQ.q, options: curQ.options } });
  room.timers.nextQ = setTimeout(() => nextRapidFireQuestion(code), 5000);
}

function endRapidFire(code) {
  clearTimeout(rooms[code]?.timers.nextQ);
  broadcastRoom(code, "rapidfire_end", { players: getSortedPlayers(rooms[code]) });
  setTimeout(() => endGame(code), 3000);
}

function handleAnswer(code, playerId, answer, time) {
  const room = getRoom(code);
  if (!room) return;

  if (room.game === "trivial") {
    if (room.gameState.answers[playerId] !== undefined) return;
    room.gameState.answers[playerId] = answer;
    broadcastRoom(code, "trivial_answer_received", { playerId, total: Object.keys(room.gameState.answers).length });
    if (Object.keys(room.gameState.answers).length >= room.players.filter(p => !p.eliminated && !p.disconnected).length) {
      clearTimeout(room.timers.question);
      revealTrivialAnswer(code);
    }
  } else if (room.game === "mathquiz") {
    if (room.gameState.answers[playerId]) return;
    room.gameState.answers[playerId] = { answer, time };
    broadcastRoom(code, "math_answer_received", { playerId, total: Object.keys(room.gameState.answers).length });
    if (Object.keys(room.gameState.answers).length >= room.players.filter(p => !p.eliminated && !p.disconnected).length) {
      clearTimeout(room.timers.question);
      revealMathAnswer(code);
    }
  } else if (room.game === "wouldyourather") {
    if (room.gameState.votes[playerId] !== undefined) return;
    room.gameState.votes[playerId] = answer;
    broadcastRoom(code, "wyr_vote_received", { total: Object.values(room.gameState.votes).length });
    if (Object.keys(room.gameState.votes).length >= room.players.filter(p => !p.eliminated && !p.disconnected).length) {
      clearTimeout(room.timers.question);
      revealWYR(code);
    }
  } else if (room.game === "rapidfire") {
    const gs = room.gameState;
    const q = gs.questions[gs.currentQ];
    if (gs.answers[playerId]) return;
    gs.answers[playerId] = answer;
    if (answer === q.answer) {
      const player = room.players.find(p => p.id === playerId);
      if (player) player.score += 50;
      io.to(playerId).emit("rapidfire_correct");
    } else {
      io.to(playerId).emit("rapidfire_wrong");
    }
    broadcastRoom(code, "rapidfire_update", { players: getSortedPlayers(room) });
  }
}

function getSortedPlayers(room) {
  return [...room.players].sort((a, b) => b.score - a.score).map((p, i) => ({ ...p, rank: i + 1 }));
}

function endGame(code) {
  const room = getRoom(code);
  if (!room) return;
  clearAllTimers(room);
  room.phase = "ended";

  // Update session leaderboard
  updateSessionLeaderboard(room);
  const sessionLB = getSessionLeaderboard();

  broadcastRoom(code, "game_over", { players: getSortedPlayers(room), game: room.game });
  // Broadcast updated session leaderboard after game ends
  setTimeout(() => broadcastRoom(code, "session_leaderboard", { leaderboard: sessionLB }), 1000);

  // Reset ready flags and phase → lobby after a short delay so players can return to waiting
  setTimeout(() => {
    if (!getRoom(code)) return;
    room.phase = "lobby";
    room.players.forEach(p => { p.ready = false; });
    broadcastRoom(code, "room_state", getRoomState(room));
  }, 6000);
}

function clearAllTimers(room) {
  Object.values(room.timers || {}).forEach(t => clearTimeout(t));
  room.timers = {};
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  const ip = getLocalIP();
  const publicUrl = process.env.RENDER_EXTERNAL_URL || `http://${ip}:${PORT}`;
  console.log("\n🎮 Game Night Server Running!");
  console.log(`\n   ╔══════════════════════════════════╗`);
  console.log(`   ║  HOST CODE: ${HOST_CODE}              ║`);
  console.log(`   ║  Keep this secret!               ║`);
  console.log(`   ╚══════════════════════════════════╝`);
  console.log(`\n   Host Panel  → ${publicUrl}/host?code=${HOST_CODE}`);
  console.log(`   Players     → ${publicUrl}`);
  console.log(`\n   Share with players: ${publicUrl}\n`);
});
