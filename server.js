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
  transports: ["polling", "websocket"],
  pingTimeout: 20000,
  pingInterval: 10000,
  maxHttpBufferSize: 2e5
});

const PORT = process.env.PORT || 3000;
const HOST_CODE = crypto.randomBytes(4).toString("hex").toUpperCase();
const START_DELAY = 3000;
const GRACE_MS = 60000;
const MAX_PLAYERS = 15;

const rooms = {};
const graceTimers = new Map();
const pendingDisplays = new Set();
const hostAttempts = new Map();
let latestRoomCode = null;

/* ─── AUTH HELPERS ─────────────────────────────────────────────────── */

function digest(s) {
  return crypto.createHash("sha256").update(String(s)).digest();
}

function safeEq(a, b) {
  return crypto.timingSafeEqual(digest(a), digest(b));
}

function attemptAllowed(ip) {
  const rec = hostAttempts.get(ip);
  if (!rec || Date.now() > rec.reset) return true;
  return rec.n < 8;
}

function recordFailure(ip) {
  const now = Date.now();
  const rec = hostAttempts.get(ip);
  if (!rec || now > rec.reset) hostAttempts.set(ip, { n: 1, reset: now + 10 * 60 * 1000 });
  else rec.n++;
}

function socketIp(socket) {
  return (socket.handshake && socket.handshake.address) || "unknown";
}

/* ─── HTTP ─────────────────────────────────────────────────────────── */

app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "public"), { index: false, dotfiles: "ignore" }));

function loginPage(wrong) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Host Login</title>
    <style>
      body{font-family:sans-serif;background:#0f0f13;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
      .box{background:#1a1a24;border:1px solid #2a2a3a;border-radius:16px;padding:40px;width:320px;text-align:center;}
      h2{margin:0 0 8px;font-size:22px;letter-spacing:2px;}
      p{color:#888;font-size:13px;margin:0 0 24px;}
      input{width:100%;box-sizing:border-box;padding:12px;border-radius:8px;background:#0f0f13;border:1px solid #2a2a3a;color:#fff;font-size:18px;text-align:center;letter-spacing:4px;outline:none;margin-bottom:12px;}
      input:focus{border-color:#7c3aed;}
      button{width:100%;padding:12px;border-radius:8px;background:#7c3aed;color:#fff;border:none;font-size:15px;font-weight:700;cursor:pointer;}
      button:hover{background:#6d28d9;}
      .err{color:#ef4444;font-size:13px;margin-top:10px;display:${wrong ? "block" : "none"};}
    </style></head><body>
    <div class="box">
      <h2>HOST LOGIN</h2>
      <p>Enter the host code shown in your terminal</p>
      <input type="text" id="c" placeholder="XXXXXXXX" maxlength="8" autocomplete="off" oninput="this.value=this.value.toUpperCase()">
      <button onclick="go()">Enter</button>
      <div class="err" id="err">${wrong === "limited" ? "Too many attempts. Try again later." : "Wrong code"}</div>
    </div>
    <script>
      function go(){
        var v=document.getElementById('c').value.trim();
        if(!v){return;}
        window.location.href='/host?code='+encodeURIComponent(v);
      }
      document.getElementById('c').addEventListener('keydown',function(e){if(e.key==='Enter')go();});
    </script></body></html>`;
}

app.get("/host", (req, res) => {
  const token = typeof req.query.code === "string" ? req.query.code : "";
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || "unknown";
  if (!token) return res.send(loginPage(false));
  if (!attemptAllowed(ip)) return res.status(429).send(loginPage("limited"));
  if (!safeEq(token.toUpperCase(), HOST_CODE)) {
    recordFailure(ip);
    return res.status(401).send(loginPage(true));
  }
  res.sendFile(path.join(__dirname, "views/host.html"));
});

app.get("/display", (req, res) => res.sendFile(path.join(__dirname, "public/display.html")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public/index.html")));

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  let fallback = null;
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(iface.address)) return iface.address;
      if (!fallback) fallback = iface.address;
    }
  }
  return fallback || "localhost";
}

function baseUrl(req) {
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "");
  const fwd = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = fwd === "https" || fwd === "http" ? fwd : (req.protocol || "http");
  let host = String(req.headers.host || "");
  if (!/^[A-Za-z0-9.\-:\[\]]+$/.test(host)) host = `${getLocalIP()}:${PORT}`;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(host)) {
    const m = host.match(/:(\d+)$/);
    host = `${getLocalIP()}:${m ? m[1] : PORT}`;
  }
  return `${proto}://${host}`;
}

app.get("/qr", async (req, res) => {
  try {
    const base = baseUrl(req);
    const code = normCode(req.query.code);
    const joinUrl = code && rooms[code] ? `${base}/?code=${code}` : base;
    const qr = await QRCode.toDataURL(joinUrl);
    res.json({ qr, url: base });
  } catch (e) {
    res.status(500).json({ error: "qr_failed" });
  }
});

app.get("/session-leaderboard", (req, res) => {
  const room = rooms[normCode(req.query.code)];
  res.json({ leaderboard: room ? getSessionLeaderboard(room) : [] });
});

/* ─── GENERIC HELPERS ──────────────────────────────────────────────── */

function normCode(c) {
  return typeof c === "string" ? c.trim().toUpperCase().slice(0, 4) : "";
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function rand(n) {
  return Math.floor(Math.random() * n);
}

function cleanText(s, max) {
  if (typeof s !== "string") return "";
  return s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanName(n) {
  if (typeof n !== "string") return "";
  return n.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 16);
}

const EMOJI_AVATAR = /^emoji:[^|:<>"'\s]{1,12}\|#[0-9a-fA-F]{3,8}$/u;
const IMG_AVATAR = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

function cleanAvatar(a) {
  if (typeof a !== "string" || a.length > 60000) return null;
  return EMOJI_AVATAR.test(a) || IMG_AVATAR.test(a) ? a : null;
}

function cleanQuestions(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const q of raw.slice(0, 200)) {
    if (!q || typeof q !== "object") continue;
    const text = cleanText(q.q, 200);
    if (!text) continue;
    const type = q.type === "tf" ? "tf" : "mcq";
    let options = ["True", "False"];
    if (type === "mcq") {
      if (!Array.isArray(q.options)) continue;
      options = q.options.slice(0, 4).map(o => cleanText(o, 80));
      if (options.length < 2 || options.some(o => !o)) continue;
    }
    const answer = Number.isInteger(q.answer) && q.answer >= 0 && q.answer < options.length ? q.answer : 0;
    out.push({ q: text, options, answer, type });
  }
  return out.length ? out : null;
}

const SETTING_DEFS = {
  imposter: { imposters: { min: 1, max: 4, def: 1 }, votingTime: { min: 10, max: 120, def: 30 } },
  trivial: { rounds: { min: 3, max: 30, def: 10 }, questionTime: { min: 5, max: 60, def: 20 } },
  reaction: { rounds: { min: 1, max: 10, def: 5 }, mode: { opts: ["laststanding", "mosttaps"], def: "laststanding" } },
  wouldyourather: { rounds: { min: 3, max: 20, def: 10 } },
  mathquiz: {
    rounds: { min: 3, max: 20, def: 10 },
    questionTime: { min: 5, max: 60, def: 15 },
    difficulty: { opts: ["easy", "medium", "hard"], def: "medium" }
  },
  fasttyper: { rounds: { min: 2, max: 10, def: 5 } },
  wordcrack: { rounds: { min: 2, max: 10, def: 5 } },
  codebreaker: { rounds: { min: 2, max: 10, def: 5 } },
  roulette: { mode: { opts: ["laststanding", "mostrounds"], def: "laststanding" } },
  rapidfire: { duration: { min: 30, max: 180, def: 60 } },
  hotpotato: { fuse: { opts: ["short", "medium", "long"], def: "medium" } }
};

const MIN_PLAYERS = { imposter: 3, hotpotato: 3 };

function cleanSettings(game, raw) {
  const defs = SETTING_DEFS[game];
  if (!defs) return null;
  const src = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const [k, d] of Object.entries(defs)) {
    if (d.opts) out[k] = d.opts.includes(src[k]) ? src[k] : d.def;
    else {
      const n = parseInt(src[k], 10);
      out[k] = Number.isFinite(n) ? Math.min(d.max, Math.max(d.min, n)) : d.def;
    }
  }
  return out;
}

/* ─── CONTENT ──────────────────────────────────────────────────────── */

const WORDS = [...new Set([
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
  "quail","realm","scout","trend","union","vigor","axiom","yield","zenith"
])].map(w => w.toUpperCase());

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
  ["Be 4 feet tall", "Be 8 feet tall"]
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
  { q: "What gas do plants absorb?", options: ["Oxygen","Nitrogen","CO2","Hydrogen"], answer: 2, type: "mcq" }
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
  { q: "Which is the tallest mountain?", options: ["K2","Kilimanjaro","Everest","Alps"], answer: 2 }
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
  "The best way to predict your future is to create it"
];

function generateMathQuestion(difficulty) {
  const ops = ["+", "-", "*", "/"];
  let a, b, op, answer, question;

  if (difficulty === "easy") {
    a = rand(20) + 1;
    b = rand(20) + 1;
    op = ops[rand(2)];
  } else if (difficulty === "medium") {
    a = rand(50) + 10;
    b = rand(30) + 5;
    op = ops[rand(3)];
  } else {
    op = ops[rand(4)];
    if (Math.random() > 0.5) {
      const base = rand(10) + 2;
      question = `√${base * base}`;
      answer = base;
      const opts = shuffle([answer, answer + 1, answer - 1, answer + 2]);
      return { question, answer: opts.indexOf(answer), options: opts.map(String) };
    }
    a = rand(100) + 10;
    b = rand(50) + 5;
  }

  if (op === "/") {
    b = rand(9) + 2;
    a = b * (rand(10) + 1);
    answer = a / b;
    question = `${a} ÷ ${b}`;
  } else if (op === "*") {
    a = rand(12) + 2;
    b = rand(12) + 2;
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
    const offset = offsets[rand(offsets.length)];
    const w = answer + (Math.random() > 0.5 ? offset : -offset);
    if (w !== answer && w >= 0) wrong.add(w);
  }
  const opts = shuffle([answer, ...wrong]);
  return { question, answer: opts.indexOf(answer), options: opts.map(String) };
}

/* ─── ROOM MODEL ───────────────────────────────────────────────────── */

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[rand(chars.length)]).join("");
  } while (rooms[code]);
  return code;
}

function newRoom() {
  const code = generateCode();
  rooms[code] = {
    code,
    hostSocketId: null,
    hostKey: crypto.randomBytes(16).toString("hex"),
    hostConnected: true,
    players: [],
    game: null,
    phase: "lobby",
    gameState: {},
    settings: {},
    questions: null,
    deck: [],
    round: 0,
    total: 0,
    timers: new Set(),
    replay: [],
    priv: {},
    lb: {},
    lastActive: Date.now()
  };
  return rooms[code];
}

function deleteRoom(room) {
  clearAllTimers(room);
  room.players.forEach(p => {
    const t = graceTimers.get(p.token);
    if (t) { clearTimeout(t); graceTimers.delete(p.token); }
  });
  delete rooms[room.code];
  if (latestRoomCode === room.code) latestRoomCode = null;
}

function touch(room) {
  room.lastActive = Date.now();
}

function findPlayer(room, id) {
  return room.players.find(p => p.id === id);
}

function publicPlayer(p) {
  return {
    id: p.id, name: p.name, avatar: p.avatar, score: p.score, lives: p.lives,
    eliminated: p.eliminated, ready: p.ready, disconnected: p.disconnected
  };
}

function getSortedPlayers(room) {
  return [...room.players]
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ ...publicPlayer(p), rank: i + 1 }));
}

function publicSettings(room) {
  const s = { ...room.settings };
  if (room.questions) s.questionCount = room.questions.length;
  return s;
}

function getRoomState(room) {
  return {
    players: room.players.map(publicPlayer),
    game: room.game,
    phase: room.phase,
    settings: publicSettings(room),
    round: room.round
  };
}

function activePlayers(room) {
  return room.players.filter(p => !p.eliminated);
}

function livePlayers(room) {
  return room.players.filter(p => !p.eliminated && !p.disconnected);
}

function allAnswered(room, map) {
  const live = livePlayers(room);
  return live.length > 0 && live.every(p => map[p.id] !== undefined);
}

/* ─── SCHEDULER AND EMIT HELPERS ───────────────────────────────────── */

function later(room, fn, ms) {
  const t = setTimeout(() => {
    room.timers.delete(t);
    try { fn(); } catch (e) { console.error("timer error:", e); }
  }, ms);
  room.timers.add(t);
  return t;
}

function cancel(room, t) {
  if (!t) return;
  clearTimeout(t);
  room.timers.delete(t);
}

function clearAllTimers(room) {
  room.timers.forEach(t => clearTimeout(t));
  room.timers.clear();
}

function toRoom(room, ev, data) {
  io.to(room.code).emit(ev, data);
}

function toDisplay(room, ev, data) {
  io.to(room.code + ":d").emit(ev, data);
}

function toPlayer(room, p, ev, data) {
  if (p && p.socketId && !p.disconnected) io.to(p.socketId).emit(ev, data);
}

function resetReplay(room) {
  room.replay = [];
  room.priv = {};
}

function pub(room, ev, data, replace) {
  toRoom(room, ev, data);
  if (replace) room.replay = room.replay.filter(e => e.ev !== ev);
  room.replay.push({ ev, data, at: Date.now() });
}

function priv(room, p, ev, data) {
  toPlayer(room, p, ev, data);
  (room.priv[p.id] = room.priv[p.id] || []).push({ ev, data, at: Date.now() });
}

function replayEvents(room, list, send) {
  const now = Date.now();
  list.forEach(e => {
    let d = e.data;
    if (d && typeof d === "object" && typeof d.duration === "number") {
      d = { ...d, duration: Math.max(500, d.duration - (now - e.at)) };
    }
    send(e.ev, d);
  });
}

function replayToPlayer(room, p) {
  replayEvents(room, room.replay, (ev, d) => toPlayer(room, p, ev, d));
  replayEvents(room, room.priv[p.id] || [], (ev, d) => toPlayer(room, p, ev, d));
}

/* ─── SESSION LEADERBOARD ──────────────────────────────────────────── */

function updateSessionLeaderboard(room) {
  const top = room.players.reduce((m, p) => Math.max(m, p.score), 0);
  room.players.forEach(p => {
    const key = p.name.toLowerCase();
    if (!room.lb[key]) room.lb[key] = { name: p.name, avatar: p.avatar, totalScore: 0, gamesPlayed: 0, wins: 0 };
    const e = room.lb[key];
    e.totalScore += p.score;
    e.gamesPlayed += 1;
    e.avatar = p.avatar;
    if (top > 0 && p.score === top) e.wins += 1;
  });
}

function getSessionLeaderboard(room) {
  return Object.values(room.lb).sort((a, b) => b.totalScore - a.totalScore);
}

/* ─── GAME LIFECYCLE ───────────────────────────────────────────────── */

function prepareGame(room) {
  const s = room.settings;
  room.gameState = {};
  room.total = 0;
  room.deck = [];
  switch (room.game) {
    case "trivial": {
      const qs = room.questions || TRIVIA;
      room.deck = shuffle(qs.map((_, i) => i));
      room.total = Math.min(s.rounds, qs.length);
      break;
    }
    case "wouldyourather":
      room.deck = shuffle(WOULD_YOU_RATHER.map((_, i) => i));
      room.total = Math.min(s.rounds, WOULD_YOU_RATHER.length);
      break;
    case "fasttyper":
      room.deck = shuffle(TYPING_PROMPTS.map((_, i) => i));
      room.total = s.rounds;
      break;
    case "wordcrack":
      room.deck = shuffle(WORDS.map((_, i) => i));
      room.total = s.rounds;
      break;
    case "reaction":
    case "mathquiz":
    case "codebreaker":
      room.total = s.rounds;
      break;
  }
}

function startGame(room) {
  clearAllTimers(room);
  room.phase = "playing";
  room.round = 1;
  room.players.forEach(p => { p.score = 0; p.lives = 3; p.eliminated = false; p.ready = false; });
  resetReplay(room);
  prepareGame(room);
  toRoom(room, "game_start", { game: room.game, settings: publicSettings(room) });
  toRoom(room, "room_state", getRoomState(room));
  later(room, () => startRound(room), START_DELAY);
}

function startRound(room) {
  if (room.phase !== "playing") return;
  switch (room.game) {
    case "imposter": return startImposterRound(room);
    case "trivial": return startTrivialRound(room);
    case "reaction": return startReactionRound(room);
    case "wouldyourather": return startWYRRound(room);
    case "mathquiz": return startMathRound(room);
    case "fasttyper": return startTyperRound(room);
    case "wordcrack": return startGuessRound(room, "wordcrack");
    case "codebreaker": return startGuessRound(room, "codebreaker");
    case "roulette": return startRouletteRound(room);
    case "rapidfire": return startRapidFireRound(room);
    case "hotpotato": return startPotatoRound(room);
  }
}

function advance(room, delay) {
  later(room, () => {
    if (room.round >= room.total) endGame(room);
    else { room.round++; startRound(room); }
  }, delay);
}

function endGame(room) {
  if (room.phase !== "playing") return;
  clearAllTimers(room);
  room.phase = "ended";
  room.gameState = {};
  updateSessionLeaderboard(room);
  const lb = getSessionLeaderboard(room);

  toRoom(room, "game_over", { players: getSortedPlayers(room), game: room.game });
  later(room, () => toRoom(room, "session_leaderboard", { leaderboard: lb }), 1000);
  later(room, () => {
    if (room.phase !== "ended") return;
    room.phase = "lobby";
    room.players = room.players.filter(p => !(p.disconnected && p.gone));
    room.players.forEach(p => { p.ready = false; });
    toRoom(room, "room_state", getRoomState(room));
  }, 6000);
}

function afterPresenceChange(room) {
  if (room.phase !== "playing") return;
  const gs = room.gameState || {};
  switch (room.game) {
    case "trivial":
      if (!gs.revealed && gs.answers && allAnswered(room, gs.answers)) revealTrivial(room);
      break;
    case "mathquiz":
      if (!gs.revealed && gs.answers && allAnswered(room, gs.answers)) revealMath(room);
      break;
    case "wouldyourather":
      if (!gs.revealed && gs.votes && allAnswered(room, gs.votes)) revealWYR(room);
      break;
    case "fasttyper":
      if (!gs.closed && gs.finished && allAnswered(room, gs.finished)) scheduleTyperEnd(room);
      break;
    case "imposter":
      if (gs.phase === "voting" && allAnswered(room, gs.votes)) resolveVoting(room);
      break;
    case "roulette": {
      const p = gs.current && findPlayer(room, gs.current);
      if (gs.order && gs.current && !gs.busy && (!p || p.disconnected)) {
        cancel(room, gs.turnTimer);
        gs.turnTimer = later(room, () => rouletteShoot(room, gs.current, true), 1500);
      }
      break;
    }
    case "hotpotato":
      watchHolder(room);
      break;
  }
}

/* ─── IMPOSTER ─────────────────────────────────────────────────────── */

function startImposterRound(room) {
  resetReplay(room);
  const active = activePlayers(room);
  const maxImp = Math.max(1, Math.floor((active.length - 1) / 2));
  const numImposters = Math.min(room.settings.imposters, maxImp);
  const word = WORDS[rand(WORDS.length)];
  const imposterIds = shuffle(active.map(p => p.id)).slice(0, numImposters);

  room.gameState = { word, imposterIds, phase: "hint", emergencyUsed: {}, votes: {} };

  active.forEach(p => {
    const isImposter = imposterIds.includes(p.id);
    priv(room, p, "imposter_role", { isImposter, word: isImposter ? null : word, emergencyAvailable: true });
  });

  pub(room, "imposter_round_start", {
    round: room.round,
    playerCount: active.length,
    numImposters,
    active: active.map(p => p.id)
  });
}

function startVoting(room) {
  const gs = room.gameState;
  if (gs.phase !== "hint") return;
  gs.phase = "voting";
  gs.votes = {};
  const duration = room.settings.votingTime * 1000;
  pub(room, "voting_start", {
    duration,
    players: activePlayers(room).map(p => ({ id: p.id, name: p.name, avatar: p.avatar }))
  });
  gs.voteTimer = later(room, () => resolveVoting(room), duration);
}

function resolveVoting(room) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "voting") return;
  gs.phase = "resolving";
  cancel(room, gs.voteTimer);

  const tally = {};
  Object.values(gs.votes).forEach(id => { tally[id] = (tally[id] || 0) + 1; });
  const max = Math.max(0, ...Object.values(tally));
  const top = Object.keys(tally).filter(id => tally[id] === max);
  const tie = top.length > 1;
  const eliminatedId = max > 0 && !tie ? top[0] : null;
  const out = eliminatedId ? findPlayer(room, eliminatedId) : null;
  if (out) out.eliminated = true;

  const imps = gs.imposterIds;
  const impAlive = imps.filter(id => { const p = findPlayer(room, id); return p && !p.eliminated; });
  const crewAlive = activePlayers(room).filter(p => !imps.includes(p.id));
  const crewWon = impAlive.length === 0;
  const gameOver = crewWon || crewAlive.length <= impAlive.length;

  pub(room, "voting_result", {
    tally,
    eliminatedId: out ? out.id : null,
    eliminatedName: out ? out.name : null,
    wasImposter: out ? imps.includes(out.id) : false,
    tie,
    noVotes: max === 0,
    gameOver,
    crewWon,
    word: gs.word,
    imposterIds: imps,
    imposterNames: imps.map(id => (findPlayer(room, id) || {}).name).filter(Boolean)
  });

  if (gameOver) {
    if (crewWon) room.players.filter(p => !imps.includes(p.id)).forEach(p => { p.score += 100; });
    else imps.forEach(id => { const p = findPlayer(room, id); if (p) p.score += 150; });
    later(room, () => endGame(room), 5000);
  } else {
    later(room, () => { room.round++; startImposterRound(room); }, 5000);
  }
}

/* ─── TRIVIAL ──────────────────────────────────────────────────────── */

function startTrivialRound(room) {
  resetReplay(room);
  const qs = room.questions || TRIVIA;
  const src = qs[room.deck[(room.round - 1) % room.deck.length]];
  let options = src.options.slice();
  let answer = src.answer;
  if (src.type !== "tf") {
    const idx = shuffle(options.map((_, i) => i));
    options = idx.map(i => src.options[i]);
    answer = idx.indexOf(src.answer);
  }
  const duration = room.settings.questionTime * 1000;
  const gs = { question: { q: src.q, options, answer, type: src.type }, answers: {}, revealed: false };
  room.gameState = gs;

  pub(room, "trivial_question", {
    round: room.round, total: room.total, question: src.q, options, type: src.type, duration
  });
  gs.timer = later(room, () => revealTrivial(room), duration);
}

function revealTrivial(room) {
  const gs = room.gameState;
  if (room.phase !== "playing" || !gs || gs.revealed) return;
  gs.revealed = true;
  cancel(room, gs.timer);
  room.players.forEach(p => { if (gs.answers[p.id] === gs.question.answer) p.score += 100; });
  pub(room, "trivial_reveal", { correctIndex: gs.question.answer, answers: gs.answers, players: getSortedPlayers(room) });
  advance(room, 4000);
}

/* ─── REACTION ─────────────────────────────────────────────────────── */

function startReactionRound(room) {
  resetReplay(room);
  const active = activePlayers(room);
  const gs = { tapped: {}, flashActive: false };
  room.gameState = gs;

  pub(room, "reaction_waiting", { round: room.round, players: active.map(p => ({ id: p.id, name: p.name })) });
  gs.flashTimer = later(room, () => triggerFlash(room), 2000 + Math.random() * 6000);
}

function triggerFlash(room) {
  const gs = room.gameState;
  gs.flashActive = true;
  toRoom(room, "reaction_flash");

  later(room, () => {
    gs.flashActive = false;
    const active = activePlayers(room);
    const missed = active.filter(p => !gs.tapped[p.id]);
    const mode = room.settings.mode;
    let out = [];
    if (mode === "laststanding" && missed.length < active.length) {
      out = missed;
      out.forEach(p => { p.eliminated = true; });
    }

    pub(room, "reaction_result", {
      survived: active.filter(p => !p.eliminated).map(p => p.id),
      eliminated: out.map(p => ({ id: p.id, name: p.name })),
      players: getSortedPlayers(room)
    });

    const remaining = activePlayers(room);
    const lastRound = room.round >= room.total;
    if (mode === "laststanding" && (remaining.length <= 1 || lastRound)) {
      remaining.forEach(p => { p.score += 100 * room.round; });
      later(room, () => endGame(room), 3000);
    } else if (lastRound) {
      later(room, () => endGame(room), 3000);
    } else {
      advance(room, 3000);
    }
  }, 1500);
}

function handleReactionTap(room, p) {
  const gs = room.gameState;
  if (!gs || !gs.flashActive || p.eliminated || gs.tapped[p.id]) return;
  gs.tapped[p.id] = true;
  if (room.settings.mode === "mosttaps") p.score += 10;
  toPlayer(room, p, "reaction_tapped", { success: true });
}

/* ─── WOULD YOU RATHER ─────────────────────────────────────────────── */

function startWYRRound(room) {
  resetReplay(room);
  const q = WOULD_YOU_RATHER[room.deck[(room.round - 1) % room.deck.length]];
  const duration = 30000;
  const gs = { question: q, votes: {}, revealed: false };
  room.gameState = gs;

  pub(room, "wyr_question", { round: room.round, total: room.total, optionA: q[0], optionB: q[1], duration });
  gs.timer = later(room, () => revealWYR(room), duration);
}

function revealWYR(room) {
  const gs = room.gameState;
  if (room.phase !== "playing" || !gs || gs.revealed) return;
  gs.revealed = true;
  cancel(room, gs.timer);

  let aVotes = 0, bVotes = 0;
  Object.values(gs.votes).forEach(v => { if (v === 0) aVotes++; else bVotes++; });
  const minority = aVotes < bVotes ? 0 : bVotes < aVotes ? 1 : -1;
  room.players.forEach(p => {
    if (gs.votes[p.id] === undefined || minority === -1) return;
    p.score += gs.votes[p.id] === minority ? -10 : 20;
  });

  pub(room, "wyr_reveal", { aVotes, bVotes, minority, players: getSortedPlayers(room) });
  advance(room, 4000);
}

/* ─── MATH QUIZ ────────────────────────────────────────────────────── */

function startMathRound(room) {
  resetReplay(room);
  const q = generateMathQuestion(room.settings.difficulty);
  const duration = room.settings.questionTime * 1000;
  const gs = { question: q, answers: {}, startTime: Date.now(), duration, revealed: false };
  room.gameState = gs;

  pub(room, "math_question", { round: room.round, total: room.total, question: q.question, options: q.options, duration });
  gs.timer = later(room, () => revealMath(room), duration);
}

function revealMath(room) {
  const gs = room.gameState;
  if (room.phase !== "playing" || !gs || gs.revealed) return;
  gs.revealed = true;
  cancel(room, gs.timer);

  room.players.forEach(p => {
    const a = gs.answers[p.id];
    if (a && a.answer === gs.question.answer) {
      const bonus = Math.max(0, Math.floor((gs.duration - (a.at - gs.startTime)) / 100));
      p.score += 100 + bonus;
    }
  });

  pub(room, "math_reveal", {
    correctIndex: gs.question.answer,
    answers: Object.fromEntries(Object.entries(gs.answers).map(([id, a]) => [id, a.answer])),
    players: getSortedPlayers(room)
  });
  advance(room, 4000);
}

/* ─── FAST TYPER ───────────────────────────────────────────────────── */

const FASTTYPER_TIMEOUT = 90 * 1000;

function startTyperRound(room) {
  resetReplay(room);
  const prompt = TYPING_PROMPTS[room.deck[(room.round - 1) % room.deck.length]];
  const gs = { prompt, finished: {}, startTime: Date.now(), closed: false };
  room.gameState = gs;

  pub(room, "typing_round", { round: room.round, total: room.total, prompt, duration: FASTTYPER_TIMEOUT });
  gs.timer = later(room, () => endTyperRound(room), FASTTYPER_TIMEOUT);
}

function scheduleTyperEnd(room) {
  const gs = room.gameState;
  if (gs.endScheduled) return;
  gs.endScheduled = true;
  later(room, () => endTyperRound(room), 1000);
}

function endTyperRound(room) {
  const gs = room.gameState;
  if (room.phase !== "playing" || !gs || gs.closed) return;
  gs.closed = true;
  cancel(room, gs.timer);
  pub(room, "typing_round_end", { players: getSortedPlayers(room) });
  advance(room, 3000);
}

function handleTypingDone(room, p, data) {
  const gs = room.gameState;
  if (room.phase !== "playing" || !gs || gs.closed || p.eliminated || gs.finished[p.id]) return;
  if (typeof data.text !== "string" || data.text !== gs.prompt) return;

  const elapsed = Date.now() - gs.startTime;
  if (elapsed < gs.prompt.length * 40) return;

  const errors = Math.min(500, Math.max(0, parseInt(data.errors, 10) || 0));
  const len = gs.prompt.length;
  const accuracy = Math.round((len / (len + errors)) * 100);
  const timeBonus = Math.round(500 * Math.max(0, 1 - elapsed / 45000));
  p.score += timeBonus + accuracy * 2;
  gs.finished[p.id] = { time: elapsed, accuracy };

  pub(room, "typing_player_done", {
    playerId: p.id, name: p.name, position: Object.keys(gs.finished).length,
    time: elapsed, accuracy, players: getSortedPlayers(room)
  });
  if (allAnswered(room, gs.finished)) scheduleTyperEnd(room);
}

/* ─── WORD CRACK AND CODE BREAKER ──────────────────────────────────── */

const GUESS_KINDS = {
  wordcrack: { round: "wordcrack_round", result: "wordcrack_result", grid: "wordcrack_grid_update", solved: "wordcrack_solved", timeout: "wordcrack_timeout", ms: 90000, key: "word" },
  codebreaker: { round: "codebreaker_round", result: "codebreaker_result", grid: "codebreaker_grid_update", solved: "codebreaker_solved", timeout: "codebreaker_timeout", ms: 90000, key: "code" }
};

function startGuessRound(room, kind) {
  resetReplay(room);
  const k = GUESS_KINDS[kind];
  let secret;
  const payload = { round: room.round, total: room.total, duration: k.ms };
  if (kind === "wordcrack") {
    secret = WORDS[room.deck[(room.round - 1) % room.deck.length]];
    payload.wordLength = secret.length;
  } else {
    secret = Array.from({ length: 4 }, () => rand(10)).join("");
  }
  const gs = { secret, grids: {}, solved: false, closed: false };
  room.gameState = gs;

  pub(room, k.round, payload);
  gs.timer = later(room, () => {
    if (gs.solved || gs.closed) return;
    gs.closed = true;
    pub(room, k.timeout, { [k.key]: gs.secret });
    advance(room, 4000);
  }, k.ms);
}

function handleGuess(room, p, guess) {
  const kind = room.game;
  const k = GUESS_KINDS[kind];
  const gs = room.gameState;
  if (!k || room.phase !== "playing" || !gs || !gs.secret || gs.solved || gs.closed || p.eliminated) return;
  if (typeof guess !== "string") return;

  let g;
  if (kind === "wordcrack") {
    g = guess.trim().toUpperCase();
    if (!/^[A-Z]+$/.test(g) || g.length !== gs.secret.length) {
      return toPlayer(room, p, "guess_rejected", { msg: `Word must be ${gs.secret.length} letters` });
    }
  } else {
    g = guess.trim();
    if (!/^\d{4}$/.test(g)) return toPlayer(room, p, "guess_rejected", { msg: "Enter 4 digits" });
  }

  const list = gs.grids[p.id] = gs.grids[p.id] || [];
  if (list.length >= 30) return toPlayer(room, p, "guess_rejected", { msg: "No guesses left" });

  const result = guessResult(gs.secret, g);
  const correct = g === gs.secret;
  list.push({ guess: g, result });

  toPlayer(room, p, k.result, { guess: g, result, correct });
  toDisplay(room, k.grid, { playerId: p.id, grids: gs.grids });

  if (correct) {
    gs.solved = true;
    cancel(room, gs.timer);
    p.score += 200;
    pub(room, k.solved, { playerId: p.id, name: p.name, [k.key]: gs.secret, players: getSortedPlayers(room) });
    advance(room, 4000);
  }
}

function guessResult(word, guess) {
  const result = Array(word.length).fill("absent");
  const used = Array(word.length).fill(false);
  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === word[i]) { result[i] = "correct"; used[i] = true; }
  }
  for (let i = 0; i < guess.length; i++) {
    if (result[i] === "correct") continue;
    const j = [...word].findIndex((w, wi) => w === guess[i] && !used[wi]);
    if (j !== -1) { result[i] = "present"; used[j] = true; }
  }
  return result;
}

/* ─── ROULETTE ─────────────────────────────────────────────────────── */

const ROULETTE_TURN_MS = 20000;

function startRouletteRound(room) {
  resetReplay(room);
  const order = shuffle(activePlayers(room).map(p => p.id));
  if (order.length < 2) return endGame(room);
  const gs = {
    order, idx: 0, chamber: rand(6), shot: 0, spun: false, busy: false, current: null, turnTimer: null
  };
  room.gameState = gs;

  pub(room, "roulette_round", {
    round: room.round,
    order: order.map(id => ({ id, name: (findPlayer(room, id) || {}).name })),
    currentPlayer: order[0]
  });
  beginRouletteTurn(room);
}

function beginRouletteTurn(room) {
  const gs = room.gameState;
  if (room.phase !== "playing" || !gs.order) return;
  gs.order = gs.order.filter(id => { const p = findPlayer(room, id); return p && !p.eliminated; });
  if (gs.order.length <= 1) return finishRoulette(room);

  gs.idx = gs.idx % gs.order.length;
  const p = findPlayer(room, gs.order[gs.idx]);
  gs.current = p.id;
  gs.spun = false;
  gs.busy = false;
  room.priv = {};

  pub(room, "roulette_next", { currentPlayer: p.id, name: p.name, duration: ROULETTE_TURN_MS }, true);
  priv(room, p, "your_turn", { game: "roulette", duration: ROULETTE_TURN_MS });
  const wait = p.disconnected ? 1500 : ROULETTE_TURN_MS;
  gs.turnTimer = later(room, () => rouletteShoot(room, p.id, true), wait);
}

function finishRoulette(room) {
  const gs = room.gameState;
  gs.busy = true;
  const winner = activePlayers(room)[0];
  if (winner) winner.score += room.settings.mode === "mostrounds" ? 100 : 300;
  later(room, () => endGame(room), 3000);
}

function rouletteSpin(room, p) {
  const gs = room.gameState;
  if (room.phase !== "playing" || !gs.order || gs.current !== p.id || gs.busy) return;
  if (gs.spun) return toPlayer(room, p, "roulette_spin_denied", { msg: "You already spun this turn" });
  gs.spun = true;
  gs.busy = true;
  gs.chamber = rand(6);
  gs.shot = 0;
  cancel(room, gs.turnTimer);
  toRoom(room, "roulette_spin", { playerId: p.id });
  later(room, () => {
    gs.busy = false;
    toPlayer(room, p, "roulette_spin_done");
    gs.turnTimer = later(room, () => rouletteShoot(room, p.id, true), ROULETTE_TURN_MS);
  }, 2000);
}

function rouletteShoot(room, playerId, auto) {
  const gs = room.gameState;
  if (room.phase !== "playing" || !gs.order || gs.current !== playerId || gs.busy) return;
  gs.busy = true;
  cancel(room, gs.turnTimer);
  const p = findPlayer(room, playerId);
  const bang = gs.shot === gs.chamber;
  gs.shot++;
  room.priv = {};

  if (bang) {
    if (p) p.eliminated = true;
    pub(room, "roulette_bang", { playerId, name: p ? p.name : "", auto: !!auto }, true);
    gs.chamber = rand(6);
    gs.shot = 0;
    gs.order = gs.order.filter(id => id !== playerId);
    if (activePlayers(room).length <= 1) finishRoulette(room);
    else later(room, () => beginRouletteTurn(room), 3000);
  } else {
    if (p && room.settings.mode === "mostrounds") p.score += 50;
    toRoom(room, "roulette_safe", { playerId, auto: !!auto });
    gs.idx = (gs.idx + 1) % gs.order.length;
    later(room, () => beginRouletteTurn(room), 2000);
  }
}

/* ─── RAPID FIRE ───────────────────────────────────────────────────── */

function startRapidFireRound(room) {
  resetReplay(room);
  const duration = room.settings.duration * 1000;
  const gs = { questions: shuffle(RAPID_FIRE), currentQ: 0, qi: 0, answers: {}, ended: false };
  room.gameState = gs;

  const first = gs.questions[0];
  pub(room, "rapidfire_start", { duration, question: { q: first.q, options: first.options }, qi: 0 });
  gs.timer = later(room, () => endRapidFire(room), duration);
  gs.qTimer = later(room, () => nextRapidFireQuestion(room), 5000);
}

function nextRapidFireQuestion(room) {
  const gs = room.gameState;
  if (room.phase !== "playing" || gs.ended) return;
  gs.currentQ++;
  gs.qi++;
  gs.answers = {};
  if (gs.currentQ >= gs.questions.length) {
    gs.questions = shuffle(RAPID_FIRE);
    gs.currentQ = 0;
  }
  const q = gs.questions[gs.currentQ];
  pub(room, "rapidfire_question", { question: { q: q.q, options: q.options }, qi: gs.qi }, true);
  gs.qTimer = later(room, () => nextRapidFireQuestion(room), 5000);
}

function endRapidFire(room) {
  const gs = room.gameState;
  if (room.phase !== "playing" || gs.ended) return;
  gs.ended = true;
  cancel(room, gs.qTimer);
  pub(room, "rapidfire_end", { players: getSortedPlayers(room) });
  later(room, () => endGame(room), 3000);
}

/* ─── HOT POTATO ───────────────────────────────────────────────────── */

const FUSE_RANGES = { short: [10000, 20000], medium: [15000, 35000], long: [25000, 50000] };

function startPotatoRound(room) {
  resetReplay(room);
  const active = activePlayers(room);
  if (active.length < 2) return endGame(room);
  const live = active.filter(p => !p.disconnected);
  const holder = (live.length ? live : active)[rand((live.length ? live : active).length)];
  const [lo, hi] = FUSE_RANGES[room.settings.fuse];
  const gs = { holder: holder.id, prev: null, passes: 0, busy: false, done: false };
  room.gameState = gs;

  pub(room, "potato_round", {
    round: room.round,
    holderId: holder.id,
    holderName: holder.name,
    players: active.map(p => ({ id: p.id, name: p.name, avatar: p.avatar }))
  });
  gs.fuseTimer = later(room, () => explodePotato(room), lo + Math.random() * (hi - lo));
  watchHolder(room);
}

function potatoTargets(room, fromId) {
  const gs = room.gameState;
  const active = activePlayers(room);
  return active.filter(p => p.id !== fromId && (active.length <= 2 || p.id !== gs.prev));
}

function passPotato(room, fromId, toId) {
  const gs = room.gameState;
  const from = findPlayer(room, fromId);
  const to = findPlayer(room, toId);
  if (!from || !to) return;
  gs.prev = fromId;
  gs.holder = toId;
  gs.passes++;
  pub(room, "potato_pass", {
    fromId, fromName: from.name, toId, toName: to.name, passes: gs.passes
  }, true);
  watchHolder(room);
}

function watchHolder(room) {
  const gs = room.gameState;
  if (room.phase !== "playing" || !gs || gs.done || gs.busy) return;
  const holder = findPlayer(room, gs.holder);
  if (holder && !holder.disconnected) return;
  cancel(room, gs.autoTimer);
  gs.autoTimer = later(room, () => {
    const h = findPlayer(room, gs.holder);
    if (gs.done || (h && !h.disconnected)) return;
    const targets = potatoTargets(room, gs.holder);
    const live = targets.filter(p => !p.disconnected);
    const pool = live.length ? live : targets;
    if (!pool.length) return;
    passPotato(room, gs.holder, pool[rand(pool.length)].id);
  }, 1500);
}

function explodePotato(room) {
  const gs = room.gameState;
  if (room.phase !== "playing" || !gs || gs.done) return;
  gs.done = true;
  gs.busy = true;
  cancel(room, gs.autoTimer);
  const victim = findPlayer(room, gs.holder);
  if (victim) victim.eliminated = true;
  const survivors = activePlayers(room);
  survivors.forEach(p => { p.score += 100; });
  const finished = survivors.length <= 1;
  if (finished && survivors[0]) survivors[0].score += 200;

  pub(room, "potato_boom", {
    id: gs.holder,
    name: victim ? victim.name : "",
    passes: gs.passes,
    remaining: survivors.length,
    gameOver: finished,
    players: getSortedPlayers(room)
  });
  if (finished) later(room, () => endGame(room), 4000);
  else later(room, () => { room.round++; startPotatoRound(room); }, 4000);
}

/* ─── ANSWER ROUTER ────────────────────────────────────────────────── */

function handleAnswer(room, p, data) {
  if (room.phase !== "playing" || p.eliminated) return;
  const gs = room.gameState;
  const answer = data.answer;
  if (!gs || !Object.keys(gs).length || !Number.isInteger(answer)) return;

  if (room.game === "trivial") {
    if (gs.revealed || answer < 0 || answer >= gs.question.options.length || gs.answers[p.id] !== undefined) return;
    gs.answers[p.id] = answer;
    toRoom(room, "trivial_answer_received", { playerId: p.id, total: Object.keys(gs.answers).length });
    if (allAnswered(room, gs.answers)) revealTrivial(room);
  } else if (room.game === "mathquiz") {
    if (gs.revealed || answer < 0 || answer >= gs.question.options.length || gs.answers[p.id] !== undefined) return;
    gs.answers[p.id] = { answer, at: Date.now() };
    toRoom(room, "math_answer_received", { playerId: p.id, total: Object.keys(gs.answers).length });
    if (allAnswered(room, gs.answers)) revealMath(room);
  } else if (room.game === "wouldyourather") {
    if (gs.revealed || (answer !== 0 && answer !== 1) || gs.votes[p.id] !== undefined) return;
    gs.votes[p.id] = answer;
    toRoom(room, "wyr_vote_received", { total: Object.keys(gs.votes).length });
    if (allAnswered(room, gs.votes)) revealWYR(room);
  } else if (room.game === "rapidfire") {
    if (gs.ended || data.q !== gs.qi || gs.answers[p.id] !== undefined) return;
    const q = gs.questions[gs.currentQ];
    if (answer < 0 || answer >= q.options.length) return;
    gs.answers[p.id] = answer;
    if (answer === q.answer) {
      p.score += 50;
      toPlayer(room, p, "rapidfire_correct");
    } else {
      toPlayer(room, p, "rapidfire_wrong");
    }
    toRoom(room, "rapidfire_update", { players: getSortedPlayers(room) });
  }
}

function skipRound(room) {
  if (room.phase !== "playing") return;
  const gs = room.gameState;
  switch (room.game) {
    case "imposter": return startVoting(room);
    case "trivial": return revealTrivial(room);
    case "mathquiz": return revealMath(room);
    case "wouldyourather": return revealWYR(room);
    case "fasttyper": return endTyperRound(room);
    case "wordcrack":
    case "codebreaker":
      if (gs && !gs.solved && !gs.closed) {
        gs.closed = true;
        cancel(room, gs.timer);
        const k = GUESS_KINDS[room.game];
        pub(room, k.timeout, { [k.key]: gs.secret });
        advance(room, 4000);
      }
      return;
  }
}

/* ─── SOCKET LAYER ─────────────────────────────────────────────────── */

function on(socket, ev, fn) {
  socket.on(ev, (data) => {
    const now = Date.now();
    const rl = socket.data.rl || (socket.data.rl = { t: now, n: 0 });
    if (now - rl.t > 1000) { rl.t = now; rl.n = 0; }
    if (++rl.n > 60) return;
    try {
      fn(data && typeof data === "object" ? data : {});
    } catch (e) {
      console.error(`[${ev}]`, e);
    }
  });
}

function playerCtx(socket, code) {
  const room = rooms[normCode(code)];
  if (!room || socket.data.roomCode !== room.code) return {};
  touch(room);
  return { room, p: findPlayer(room, socket.data.pid) };
}

function hostRoom(socket, code) {
  const room = rooms[normCode(code)];
  if (!room || room.hostSocketId !== socket.id) return null;
  touch(room);
  return room;
}

function attachPlayer(socket, room, p, reconnect) {
  const grace = graceTimers.get(p.token);
  if (grace) { clearTimeout(grace); graceTimers.delete(p.token); }

  if (p.socketId && p.socketId !== socket.id && io.sockets && io.sockets.sockets) {
    const old = io.sockets.sockets.get(p.socketId);
    if (old) { old.leave(room.code); old.data.pid = null; old.data.roomCode = null; }
  }
  p.socketId = socket.id;
  p.disconnected = false;
  p.gone = false;
  socket.join(room.code);
  socket.data.roomCode = room.code;
  socket.data.pid = p.id;

  socket.emit("joined", { player: publicPlayer(p), code: room.code, reconnectToken: p.token });
  socket.emit("session_leaderboard", { leaderboard: getSessionLeaderboard(room) });
  if (reconnect) toRoom(room, "player_reconnected", { id: p.id, name: p.name });
  toRoom(room, "room_state", getRoomState(room));
  if (room.phase === "playing") {
    replayToPlayer(room, p);
    afterPresenceChange(room);
  }
}

function sendHostState(socket, room, resumed) {
  socket.emit("room_created", { code: room.code, hostKey: room.hostKey, resumed: !!resumed });
  socket.emit("room_state", getRoomState(room));
  socket.emit("session_leaderboard", { leaderboard: getSessionLeaderboard(room) });
  pendingDisplays.forEach(id => {
    io.to(id).emit("display_room", { code: room.code });
  });
}

function attachDisplay(socket, room) {
  pendingDisplays.delete(socket.id);
  socket.join(room.code);
  socket.join(room.code + ":d");
  socket.data.displayRoom = room.code;
  socket.emit("display_room", { code: room.code });
  socket.emit("room_state", getRoomState(room));
  if (room.phase === "playing" && room.game) {
    socket.emit("game_selected", { game: room.game });
    replayEvents(room, room.replay, (ev, d) => socket.emit(ev, d));
  }
}

io.on("connection", (socket) => {

  on(socket, "create_room", ({ hostCode }) => {
    const ip = socketIp(socket);
    if (!attemptAllowed(ip)) return socket.emit("auth_failed", { msg: "Too many attempts" });
    if (typeof hostCode !== "string" || !safeEq(hostCode.toUpperCase(), HOST_CODE)) {
      recordFailure(ip);
      return socket.emit("auth_failed", { msg: "Invalid host code" });
    }
    const room = newRoom();
    room.hostSocketId = socket.id;
    latestRoomCode = room.code;
    socket.join(room.code);
    socket.data.hostRoom = room.code;
    sendHostState(socket, room, false);
  });

  on(socket, "host_resume", ({ code, hostKey }) => {
    const room = rooms[normCode(code)];
    if (!room || typeof hostKey !== "string" || !safeEq(hostKey, room.hostKey)) {
      return socket.emit("host_resume_failed");
    }
    room.hostSocketId = socket.id;
    room.hostConnected = true;
    latestRoomCode = room.code;
    touch(room);
    socket.join(room.code);
    socket.data.hostRoom = room.code;
    sendHostState(socket, room, true);
  });

  on(socket, "display_join", ({ code }) => {
    const wanted = normCode(code);
    const room = wanted ? rooms[wanted] : rooms[latestRoomCode];
    if (!room) {
      if (wanted) return socket.emit("error", { msg: "Room not found" });
      pendingDisplays.add(socket.id);
      return socket.emit("display_waiting");
    }
    attachDisplay(socket, room);
  });

  on(socket, "player_join", ({ code, name, avatar, reconnectToken }) => {
    const room = rooms[normCode(code)];
    if (!room) return socket.emit("error", { msg: "Room not found" });
    touch(room);

    if (socket.data.roomCode === room.code && findPlayer(room, socket.data.pid)) return;

    if (typeof reconnectToken === "string" && reconnectToken) {
      const ghost = room.players.find(p => p.token === reconnectToken);
      if (ghost) return attachPlayer(socket, room, ghost, true);
    }

    const clean = cleanName(name);
    if (!clean) return socket.emit("error", { msg: "Enter your name" });
    if (room.players.length >= MAX_PLAYERS) return socket.emit("error", { msg: "Room is full" });
    if (room.players.some(p => p.name.toLowerCase() === clean.toLowerCase())) {
      return socket.emit("error", { msg: "Name already taken" });
    }

    const player = {
      id: crypto.randomBytes(6).toString("hex"),
      token: crypto.randomUUID(),
      socketId: null,
      name: clean,
      avatar: cleanAvatar(avatar),
      score: 0, lives: 3, eliminated: false, ready: false, disconnected: false, gone: false
    };
    room.players.push(player);
    attachPlayer(socket, room, player, false);
  });

  on(socket, "player_ready", ({ code }) => {
    const { room, p } = playerCtx(socket, code);
    if (!p) return;
    p.ready = !p.ready;
    toRoom(room, "room_state", getRoomState(room));
  });

  on(socket, "player_answer", (d) => {
    const { room, p } = playerCtx(socket, d.code);
    if (p) handleAnswer(room, p, d);
  });

  on(socket, "player_tap", ({ code }) => {
    const { room, p } = playerCtx(socket, code);
    if (p && room.phase === "playing" && room.game === "reaction") handleReactionTap(room, p);
  });

  on(socket, "player_emergency", ({ code }) => {
    const { room, p } = playerCtx(socket, code);
    if (!p || room.phase !== "playing" || room.game !== "imposter" || p.eliminated) return;
    const gs = room.gameState;
    if (gs.phase !== "hint" || gs.emergencyUsed[p.id]) return;
    gs.emergencyUsed[p.id] = true;
    toRoom(room, "emergency_called", { by: p.name });
    startVoting(room);
  });

  on(socket, "player_vote", ({ code, targetId }) => {
    const { room, p } = playerCtx(socket, code);
    if (!p || room.phase !== "playing" || room.game !== "imposter" || p.eliminated) return;
    const gs = room.gameState;
    if (gs.phase !== "voting" || gs.votes[p.id] !== undefined) return;
    const target = findPlayer(room, targetId);
    if (!target || target.eliminated || target.id === p.id) return;
    gs.votes[p.id] = target.id;
    toRoom(room, "vote_cast", {
      voterId: p.id,
      totalVotes: Object.keys(gs.votes).length,
      totalVoters: livePlayers(room).length
    });
    if (allAnswered(room, gs.votes)) resolveVoting(room);
  });

  on(socket, "player_shoot", ({ code, spin }) => {
    const { room, p } = playerCtx(socket, code);
    if (!p || room.game !== "roulette") return;
    if (spin) rouletteSpin(room, p);
    else rouletteShoot(room, p.id, false);
  });

  on(socket, "player_guess", ({ code, guess }) => {
    const { room, p } = playerCtx(socket, code);
    if (p) handleGuess(room, p, guess);
  });

  on(socket, "player_typing_done", (d) => {
    const { room, p } = playerCtx(socket, d.code);
    if (p && room.game === "fasttyper") handleTypingDone(room, p, d);
  });

  on(socket, "player_pass", ({ code, targetId }) => {
    const { room, p } = playerCtx(socket, code);
    if (!p || room.phase !== "playing" || room.game !== "hotpotato") return;
    const gs = room.gameState;
    if (gs.done || gs.holder !== p.id) return;
    const ok = potatoTargets(room, p.id).find(t => t.id === targetId);
    if (!ok) return toPlayer(room, p, "potato_denied", { msg: "You cannot pass to that player" });
    passPotato(room, p.id, ok.id);
  });

  on(socket, "request_session_leaderboard", ({ code }) => {
    const { room } = playerCtx(socket, code);
    if (room) socket.emit("session_leaderboard", { leaderboard: getSessionLeaderboard(room) });
  });

  on(socket, "request_room_state", ({ code }) => {
    const { room } = playerCtx(socket, code);
    if (room) socket.emit("room_state", getRoomState(room));
  });

  on(socket, "host_kick", ({ code, playerId }) => {
    const room = hostRoom(socket, code);
    if (!room) return;
    const kicked = findPlayer(room, playerId);
    if (!kicked) return;
    const t = graceTimers.get(kicked.token);
    if (t) { clearTimeout(t); graceTimers.delete(kicked.token); }
    room.players = room.players.filter(p => p.id !== playerId);
    if (kicked.socketId) {
      io.to(kicked.socketId).emit("kicked");
      const s = io.sockets && io.sockets.sockets && io.sockets.sockets.get(kicked.socketId);
      if (s) { s.leave(room.code); s.data.roomCode = null; s.data.pid = null; }
    }
    toRoom(room, "room_state", getRoomState(room));
    afterPresenceChange(room);
  });

  on(socket, "host_select_game", ({ code, game, settings }) => {
    const room = hostRoom(socket, code);
    if (!room || room.phase === "playing") return;
    const clean = cleanSettings(game, settings);
    if (!clean) return socket.emit("error", { msg: "Unknown game" });
    room.game = game;
    room.settings = clean;
    room.questions = game === "trivial" ? cleanQuestions(settings && settings.questions) : null;
    room.phase = "settings";
    room.players.forEach(p => { p.score = 0; p.lives = 3; p.eliminated = false; p.ready = false; });
    toRoom(room, "game_selected", { game, settings: publicSettings(room) });
    toRoom(room, "room_state", getRoomState(room));
  });

  on(socket, "host_start_game", ({ code }) => {
    const room = hostRoom(socket, code);
    if (!room || room.phase !== "settings" || !room.game) return;
    const min = MIN_PLAYERS[room.game] || 2;
    const connected = room.players.filter(p => !p.disconnected).length;
    if (connected < min) return socket.emit("error", { msg: `Need at least ${min} connected players` });
    startGame(room);
  });

  on(socket, "host_next_round", ({ code }) => {
    const room = hostRoom(socket, code);
    if (room) skipRound(room);
  });

  on(socket, "host_show_leaderboard", ({ code }) => {
    const room = hostRoom(socket, code);
    if (room) toRoom(room, "show_leaderboard", { players: getSortedPlayers(room) });
  });

  on(socket, "host_show_session_leaderboard", ({ code }) => {
    const room = hostRoom(socket, code);
    if (room) toRoom(room, "session_leaderboard", { leaderboard: getSessionLeaderboard(room) });
  });

  on(socket, "host_end_game", ({ code }) => {
    const room = hostRoom(socket, code);
    if (!room) return;
    if (room.phase === "playing") endGame(room);
    else if (room.phase === "settings") {
      room.phase = "lobby";
      toRoom(room, "room_state", getRoomState(room));
    }
  });

  on(socket, "host_reset_session_leaderboard", ({ code }) => {
    const room = hostRoom(socket, code);
    if (!room) return;
    room.lb = {};
    toRoom(room, "session_leaderboard", { leaderboard: [] });
  });

  socket.on("disconnect", () => {
    pendingDisplays.delete(socket.id);
    const hostCode = socket.data.hostRoom;
    if (hostCode && rooms[hostCode] && rooms[hostCode].hostSocketId === socket.id) {
      rooms[hostCode].hostConnected = false;
    }

    const room = rooms[socket.data.roomCode];
    if (!room) return;
    const p = findPlayer(room, socket.data.pid);
    if (!p || p.socketId !== socket.id) return;

    p.disconnected = true;
    toRoom(room, "player_disconnected", { id: p.id, name: p.name });
    toRoom(room, "room_state", getRoomState(room));
    afterPresenceChange(room);

    const token = p.token;
    const timer = setTimeout(() => {
      graceTimers.delete(token);
      if (!rooms[room.code] || !p.disconnected) return;
      if (room.phase === "playing") {
        p.gone = true;
      } else {
        room.players = room.players.filter(x => x.token !== token);
        toRoom(room, "room_state", getRoomState(room));
      }
    }, GRACE_MS);
    graceTimers.set(token, timer);
  });
});

setInterval(() => {
  const now = Date.now();
  Object.values(rooms).forEach(room => {
    const anyone = room.hostConnected || room.players.some(p => !p.disconnected);
    if (!anyone && now - room.lastActive > 2 * 60 * 60 * 1000) deleteRoom(room);
  });
}, 10 * 60 * 1000).unref();

server.listen(PORT, "0.0.0.0", () => {
  const ip = getLocalIP();
  const publicUrl = process.env.RENDER_EXTERNAL_URL || `http://${ip}:${PORT}`;
  console.log("\nGame Night Server Running!");
  console.log("\n   ╔════════════════════════════════════╗");
  console.log(`   ║  HOST CODE: ${HOST_CODE}                ║`);
  console.log("   ║  Keep this secret!                 ║");
  console.log("   ╚════════════════════════════════════╝");
  console.log(`\n   Host Panel  → ${publicUrl}/host?code=${HOST_CODE}`);
  console.log(`   Display     → ${publicUrl}/display`);
  console.log(`   Players     → ${publicUrl}`);
  console.log(`\n   Share with players: ${publicUrl}\n`);
});
