// GridWars rules. Pure functions over plain JSON, so the server, tests and bots share one truth.

export const SIZE = 7;
export const AP_PER_TURN = 3;
// Whoever opens gets one point less, which offsets reaching the beacons first.
const FIRST_TURN_AP = 2;
export const WIN_SCORE = 12;
export const MAX_ROUNDS = 20;
export const MAX_HP = 10;
const FIRE_RANGE = 3;
const FIRE_DAMAGE = 3;
const SHOVE_DAMAGE = 1;
const SHIELD_BLOCK = 2;
// With three, opposite corners leave one seat alone while the other two fight, and that seat won 73%.
const STARTS = {
  2: [[0, 0], [6, 6]],
  3: [[1, 0], [6, 3], [0, 6]],
  4: [[0, 0], [6, 6], [6, 0], [0, 6]],
};
// Mirror-symmetric layouts: every seat is the same distance from its nearest beacons.
const LAYOUTS = [
  [[3, 3], [3, 1], [3, 5], [1, 3], [5, 3]],
  [[3, 3], [2, 2], [4, 4], [2, 4], [4, 2]],
  [[3, 3], [1, 1], [5, 5], [1, 5], [5, 1]],
];

export function newMatch(seats, seed = 0) {
  if (!Array.isArray(seats) || seats.length < 2 || seats.length > 4) throw new Error("a match needs 2 to 4 players");
  const layout = LAYOUTS[Math.abs(seed) % LAYOUTS.length];
  const start = STARTS[seats.length];
  return {
    size: SIZE,
    players: seats.map((p, i) => ({ name: p.name, bot: !!p.bot, x: start[i][0], y: start[i][1], hp: MAX_HP, score: 0, shield: false, alive: true })),
    beacons: layout.map(([x, y]) => ({ x, y, owner: null })),
    turn: 0,
    ap: FIRST_TURN_AP,
    round: 1,
    winner: null,
    reason: null,
    log: [{ round: 1, text: "Match started." }],
  };
}

const at = (s, x, y) => s.players.findIndex((p) => p.alive && p.x === x && p.y === y);
const inside = (s, x, y) => x >= 0 && y >= 0 && x < s.size && y < s.size;

/** Clear straight-line shot: same row or column, in range, no other commander in the way. */
function canFire(s, from, to) {
  if (from.x !== to.x && from.y !== to.y) return false;
  const dist = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
  if (dist < 1 || dist > FIRE_RANGE) return false;
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  for (let i = 1; i < dist; i++) if (at(s, from.x + dx * i, from.y + dy * i) !== -1) return false;
  return true;
}

export function legalActions(s) {
  if (s.winner !== null) return [];
  const me = s.players[s.turn];
  const out = [{ type: "end" }];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = me.x + dx;
    const y = me.y + dy;
    if (!inside(s, x, y)) continue;
    const other = at(s, x, y);
    if (other === -1) out.push({ type: "move", x, y });
    else if (inside(s, x + dx, y + dy) && at(s, x + dx, y + dy) === -1) out.push({ type: "shove", x, y });
  }
  if (s.ap >= 2) {
    s.players.forEach((p, i) => {
      if (i !== s.turn && p.alive && canFire(s, me, p)) out.push({ type: "fire", x: p.x, y: p.y });
    });
  }
  const beacon = s.beacons.find((b) => b.x === me.x && b.y === me.y);
  if (beacon && beacon.owner !== s.turn) out.push({ type: "claim" });
  if (!me.shield) out.push({ type: "shield" });
  return out;
}

function hit(s, victim, damage) {
  const p = s.players[victim];
  const taken = p.shield ? Math.max(0, damage - SHIELD_BLOCK) : damage;
  p.shield = false;
  p.hp -= taken;
  if (p.hp <= 0) {
    p.hp = 0;
    p.alive = false;
    for (const b of s.beacons) if (b.owner === victim) b.owner = null;
    s.log.push({ round: s.round, text: `${p.name} is out. Their beacons are free.` });
  }
  return taken;
}

function finish(s, winner, reason) {
  s.winner = winner;
  s.reason = reason;
  s.log.push({ round: s.round, text: `${s.players[winner].name} wins: ${reason}.` });
}

/** Most points, then most health, then the player who lost fewest beacons to turn order: the earlier seat. */
function leader(s) {
  let best = -1;
  s.players.forEach((p, i) => {
    if (!p.alive) return;
    if (best === -1) best = i;
    const b = s.players[best];
    if (p.score > b.score || (p.score === b.score && p.hp > b.hp)) best = i;
  });
  return best;
}

function checkEnd(s) {
  const alive = s.players.map((p, i) => (p.alive ? i : -1)).filter((i) => i >= 0);
  if (alive.length === 1) {
    finish(s, alive[0], "last commander standing");
    return true;
  }
  return false;
}

function nextTurn(s) {
  let i = s.turn;
  do {
    i = (i + 1) % s.players.length;
    if (i === 0) s.round += 1;
  } while (!s.players[i].alive);
  if (s.round > MAX_ROUNDS) {
    s.round = MAX_ROUNDS;
    finish(s, leader(s), `most points after ${MAX_ROUNDS} rounds`);
    return;
  }
  s.turn = i;
  s.ap = AP_PER_TURN;
  const me = s.players[i];
  me.shield = false;
  const owned = s.beacons.filter((b) => b.owner === i).length;
  if (owned) {
    me.score += owned;
    s.log.push({ round: s.round, text: `${me.name} scores ${owned} from beacons (${me.score}).` });
    if (me.score >= WIN_SCORE) finish(s, i, `reached ${WIN_SCORE} points`);
  }
}

/** Applies one action and returns a new state. Throws if the action is not legal right now. */
export function applyAction(state, action) {
  const s = structuredClone(state);
  if (s.winner !== null) throw new Error("the match is over");
  const legal = legalActions(s).find((a) => a.type === action?.type && a.x === action?.x && a.y === action?.y);
  if (!legal) throw new Error("that action is not legal now");
  const me = s.players[s.turn];
  if (legal.type === "end") {
    s.log.push({ round: s.round, text: `${me.name} ends their turn.` });
    nextTurn(s);
    return s;
  }
  if (legal.type === "move") {
    me.x = legal.x;
    me.y = legal.y;
    s.ap -= 1;
  } else if (legal.type === "claim") {
    s.beacons.find((b) => b.x === me.x && b.y === me.y).owner = s.turn;
    s.ap -= 1;
    s.log.push({ round: s.round, text: `${me.name} claims the beacon at ${me.x},${me.y}.` });
  } else if (legal.type === "shield") {
    me.shield = true;
    s.ap -= 1;
    s.log.push({ round: s.round, text: `${me.name} raises a shield.` });
  } else if (legal.type === "fire") {
    const v = at(s, legal.x, legal.y);
    const taken = hit(s, v, FIRE_DAMAGE);
    s.ap -= 2;
    s.log.push({ round: s.round, text: `${me.name} fires at ${s.players[v].name} for ${taken}.` });
  } else if (legal.type === "shove") {
    const v = at(s, legal.x, legal.y);
    const victim = s.players[v];
    victim.x += legal.x - me.x;
    victim.y += legal.y - me.y;
    const taken = hit(s, v, SHOVE_DAMAGE);
    s.ap -= 1;
    s.log.push({ round: s.round, text: `${me.name} shoves ${victim.name} for ${taken}.` });
  }
  if (checkEnd(s)) return s;
  if (s.ap <= 0) nextTurn(s);
  return s;
}

const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** The bot that fills empty seats. Readable on purpose: the sample agent starts from the same ideas. */
export function botAction(s) {
  const me = s.players[s.turn];
  const legal = legalActions(s);
  const find = (t) => legal.filter((a) => a.type === t);
  const claim = find("claim")[0];
  if (claim) return claim;
  const shots = find("fire").map((a) => ({ a, p: s.players[at(s, a.x, a.y)] }));
  if (shots.length) {
    shots.sort((x, y) => (x.p.hp - y.p.hp) || (y.p.score - x.p.score));
    return shots[0].a;
  }
  // Knocking someone off a beacon they stand on is worth a point of health to them and a tempo to us.
  const shove = find("shove").find((a) => s.beacons.some((b) => b.x === a.x && b.y === a.y));
  if (shove) return shove;
  const targets = s.beacons.filter((b) => b.owner !== s.turn);
  const moves = find("move");
  if (targets.length && moves.length) {
    const near = (p) => Math.min(...targets.map((b) => distance(p, b)));
    const best = moves.reduce((a, b) => (near(b) < near(a) ? b : a));
    if (near(best) < near(me)) return best;
  }
  if (find("shield").length && s.ap === 1) return find("shield")[0];
  const enemies = s.players.filter((p, i) => i !== s.turn && p.alive);
  if (enemies.length && moves.length) {
    const chase = (p) => Math.min(...enemies.map((e) => distance(p, e)));
    const best = moves.reduce((a, b) => (chase(b) < chase(a) ? b : a));
    if (chase(best) > 1 && chase(best) < chase(me)) return best;
  }
  return find("shield")[0] || { type: "end" };
}

/** Plays bot seats, and any seat past its deadline, until a waiting human or the end. */
export function advance(s) {
  let state = s;
  for (let guard = 0; guard < 400 && state.winner === null && state.players[state.turn].bot; guard++) {
    state = applyAction(state, botAction(state));
  }
  return state;
}
