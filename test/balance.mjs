// Mide equilibrio: ventaja por asiento y estilos enfrentados. node test/balance.mjs
import { applyAction, botAction, legalActions, newMatch } from "../src/engine.js";

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (l) => l[Math.floor(rnd() * l.length)];
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const noisy = (s, f, eps = 0.2) => (rnd() < eps ? pick(legalActions(s).filter((a) => a.type !== "end")) || { type: "end" } : f(s));

const toward = (s, targets) => {
  const me = s.players[s.turn];
  const moves = legalActions(s).filter((a) => a.type === "move");
  if (!targets.length || !moves.length) return null;
  const d = (p) => Math.min(...targets.map((t) => dist(p, t)));
  const best = moves.reduce((a, b) => (d(b) < d(a) ? b : a));
  return d(best) < d(me) ? best : null;
};
const has = (s, t) => legalActions(s).filter((a) => a.type === t);

const STYLES = {
  balanced: botAction,
  rusher(s) {
    const fire = has(s, "fire")[0];
    if (fire) return fire;
    const enemies = s.players.filter((p, i) => i !== s.turn && p.alive);
    return toward(s, enemies) || has(s, "shove")[0] || has(s, "shield")[0] || { type: "end" };
  },
  holder(s) {
    const claim = has(s, "claim")[0];
    if (claim) return claim;
    const free = s.beacons.filter((b) => b.owner !== s.turn);
    return toward(s, free) || has(s, "shield")[0] || { type: "end" };
  },
  turtle(s) {
    const me = s.players[s.turn];
    if (!me.shield && s.ap === 1) return has(s, "shield")[0] || { type: "end" };
    const claim = has(s, "claim")[0];
    if (claim) return claim;
    const fire = has(s, "fire")[0];
    if (fire) return fire;
    const mine = s.beacons.filter((b) => b.owner === null);
    return toward(s, mine) || has(s, "shield")[0] || { type: "end" };
  },
};

function play(styles, gameSeed, eps) {
  let s = newMatch(styles.map((n, i) => ({ name: n + i })), gameSeed);
  for (let i = 0; i < 2000 && s.winner === null; i++) s = applyAction(s, noisy(s, STYLES[styles[s.turn]], eps));
  return s;
}

const N = 600;
for (const n of [2, 3, 4]) {
  const wins = Array(n).fill(0);
  let rounds = 0;
  const reasons = {};
  for (let g = 0; g < N; g++) {
    const s = play(Array(n).fill("balanced"), g, 0.2);
    wins[s.winner]++;
    rounds += s.round;
    const r = s.reason.split(" ")[0];
    reasons[r] = (reasons[r] || 0) + 1;
  }
  console.log(`${n}p asientos %:`, wins.map((w) => Math.round((w / N) * 100)).join(" "), "| rondas", (rounds / N).toFixed(1), "|", JSON.stringify(reasons));
}
const names = Object.keys(STYLES);
console.log("\nfila vs columna, % de victorias de la fila (asientos alternados):");
console.log("".padEnd(10) + names.map((x) => x.padEnd(10)).join(""));
for (const a of names) {
  const row = names.map((b) => {
    if (a === b) return "-";
    let w = 0;
    for (let g = 0; g < N / 2; g++) {
      if (play([a, b], g, 0.15).winner === 0) w++;
      if (play([b, a], g, 0.15).winner === 1) w++;
    }
    return Math.round((w / N) * 100) + "";
  });
  console.log(a.padEnd(10) + row.map((x) => x.padEnd(10)).join(""));
}
