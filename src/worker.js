// GridWars server: lobby, turns and agent API. State lives in D1; a version column stops double moves.
import { advance, applyAction, botAction, legalActions, newMatch } from "./engine.js";
import PAGE from "./page.html";

const TURN_SECONDS = 45;
const LOBBY_SECONDS = 1800;
const MAX_CREATES_PER_HOUR = 40;
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const HEADERS = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" };

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const fail = (message, status = 400) => reply({ error: message }, status);
const clean = (raw, seat) => String(raw || "").replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 18) || `Player ${seat + 1}`;
const pick = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => ALPHABET[b % ALPHABET.length]).join("");
const token = () => [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, "0")).join("");

let schemaReady = false;
async function schema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS gw_matches (code TEXT PRIMARY KEY, body TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, ip TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS gw_matches_updated ON gw_matches (updated_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS gw_matches_ip ON gw_matches (ip, created_at)"),
  ]);
  schemaReady = true;
}

async function load(db, code) {
  const row = await db.prepare("SELECT body, version FROM gw_matches WHERE code = ?").bind(code).first();
  return row ? { ...JSON.parse(row.body), version: row.version } : null;
}

/** Saves only if nobody else moved since this copy was read. */
async function save(db, code, m) {
  const { version, ...body } = m;
  const r = await db.prepare("UPDATE gw_matches SET body = ?, version = version + 1, updated_at = ? WHERE code = ? AND version = ?")
    .bind(JSON.stringify(body), Date.now(), code, version).run();
  return r?.meta?.changes === 1;
}

/** Public view: never includes seat tokens. `you` is added only for the seat that proved its token. */
function view(code, m, seat) {
  const s = m.game;
  return {
    code,
    status: s ? (s.winner !== null ? "finished" : "playing") : "lobby",
    seats: m.seats.map((x) => ({ name: x.name, bot: x.bot })),
    capacity: m.capacity,
    you: seat ?? null,
    state: s ? { size: s.size, players: s.players, beacons: s.beacons, turn: s.turn, ap: s.ap, round: s.round, winner: s.winner, reason: s.reason } : null,
    log: s ? s.log : [],
    legal: s && seat !== undefined && s.turn === seat ? legalActions(s) : [],
    your_turn: Boolean(s && seat !== undefined && s.turn === seat && s.winner === null),
    turn_deadline: s && s.winner === null ? m.deadline : null,
  };
}

const seatOf = (m, t) => {
  if (!t) return undefined;
  const i = m.seats.findIndex((x) => x.token === t);
  return i === -1 ? undefined : i;
};

function startGame(m, now) {
  while (m.seats.length < m.capacity) m.seats.push({ name: `Bot ${m.seats.length + 1}`, bot: true, token: null });
  m.game = advance(newMatch(m.seats.map((x) => ({ name: x.name, bot: x.bot })), crypto.getRandomValues(new Uint32Array(1))[0]));
  m.deadline = now + TURN_SECONDS * 1000;
}

/** A seat that stops answering is played by the bot for that turn, so nobody can stall a match. */
function settle(m, now) {
  if (!m.game || m.game.winner !== null || now < m.deadline) return false;
  const seat = m.game.turn;
  let s = m.game;
  s.log.push({ round: s.round, text: `${s.players[seat].name} ran out of time. A bot plays this turn.` });
  for (let i = 0; i < 12 && s.winner === null && s.turn === seat; i++) s = applyAction(s, botAction(s));
  m.game = advance(s);
  m.deadline = now + TURN_SECONDS * 1000;
  return true;
}

async function create(request, db, body, now) {
  const capacity = Number(body.players ?? 2);
  if (![2, 3, 4].includes(capacity)) return fail("players must be 2, 3 or 4");
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const recent = await db.prepare("SELECT COUNT(*) AS n FROM gw_matches WHERE ip = ? AND created_at > ?").bind(ip, now - 3600000).first();
  if ((recent?.n || 0) >= MAX_CREATES_PER_HOUR) return fail("Too many new matches from here. Try again in an hour.", 429);
  await db.prepare("DELETE FROM gw_matches WHERE updated_at < ?").bind(now - 7 * 86400000).run();
  const seat = { name: clean(body.name, 0), bot: false, token: token() };
  const m = { capacity, seats: [seat], game: null, deadline: now + LOBBY_SECONDS * 1000 };
  if (body.bots === true) startGame(m, now);
  for (let tries = 0; tries < 5; tries++) {
    const code = pick(5);
    const r = await db.prepare("INSERT OR IGNORE INTO gw_matches (code, body, ip, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(code, JSON.stringify(m), ip, now, now).run();
    if (r?.meta?.changes === 1) return reply({ ...view(code, m, 0), token: seat.token }, 201);
  }
  return fail("Could not create a match. Try again.", 503);
}

export async function handle(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: { ...HEADERS, "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type,authorization" } });
  }
  if (url.pathname === "/" && request.method === "GET") {
    return new Response(PAGE, { headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    } });
  }
  if (!url.pathname.startsWith("/api/")) return fail("not found", 404);
  if (url.pathname === "/api/health") return reply({ ok: true });
  const db = env.DB;
  await schema(db);
  const now = Date.now();
  let body = {};
  if (request.method === "POST") {
    const raw = await request.text();
    if (raw.length > 2000) return fail("body too large", 413);
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        return fail("body must be JSON");
      }
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("body must be a JSON object");
  }
  if (url.pathname === "/api/matches" && request.method === "POST") return create(request, db, body, now);

  const hit = url.pathname.match(/^\/api\/matches\/([A-Za-z0-9]{5})(?:\/(join|start|action))?$/);
  if (!hit) return fail("not found", 404);
  const code = hit[1].toUpperCase();
  const route = hit[2];
  const auth = request.headers.get("authorization") || "";
  const t = auth.startsWith("Bearer ") ? auth.slice(7) : body.token || url.searchParams.get("token") || null;

  for (let attempt = 0; attempt < 4; attempt++) {
    const m = await load(db, code);
    if (!m) return fail("No match with that code.", 404);
    const seat = seatOf(m, t);
    let extra = {};
    if (!route) {
      if (request.method !== "GET") return fail("use GET", 405);
      if (!settle(m, now)) return reply(view(code, m, seat));
    } else if (request.method !== "POST") {
      return fail("use POST", 405);
    } else if (route === "join") {
      if (m.game) return fail("That match already started.", 409);
      if (seat !== undefined) return reply({ ...view(code, m, seat), token: t });
      const i = m.seats.length;
      if (i >= m.capacity) return fail("That match is full.", 409);
      const tk = token();
      m.seats.push({ name: clean(body.name, i), bot: false, token: tk });
      if (m.seats.length === m.capacity) startGame(m, now);
      extra = { token: tk };
    } else if (route === "start") {
      if (seat !== 0) return fail("Only the player who created the match can start it.", 403);
      if (m.game) return reply(view(code, m, seat));
      startGame(m, now);
    } else {
      if (seat === undefined) return fail("A valid seat token is required.", 401);
      if (!m.game) return fail("The match has not started.", 409);
      if (m.game.winner !== null) return fail("The match is over.", 409);
      settle(m, now);
      if (m.game.turn !== seat) return fail("It is not your turn.", 409);
      try {
        m.game = advance(applyAction(m.game, { type: body.type, x: body.x, y: body.y }));
      } catch (e) {
        return reply({ error: e.message, legal: legalActions(m.game) }, 422);
      }
      m.deadline = now + TURN_SECONDS * 1000;
    }
    if (await save(db, code, m)) {
      const you = extra.token ? m.seats.length - 1 : seat;
      const after = route === "join" && extra.token ? m.seats.findIndex((x) => x.token === extra.token) : you;
      return reply({ ...view(code, m, after), ...extra });
    }
  }
  return fail("The match is busy. Try again.", 503);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch {
      return fail("Something went wrong on our side. Try again.", 500);
    }
  },
};
