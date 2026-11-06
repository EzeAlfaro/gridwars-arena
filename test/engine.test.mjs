// node --test test/
import assert from "node:assert/strict";
import { test } from "node:test";
import { advance, applyAction, botAction, legalActions, newMatch, MAX_ROUNDS, WIN_SCORE } from "../src/engine.js";

const seats = (n, bot = false) => Array.from({ length: n }, (_, i) => ({ name: "P" + i, bot }));

function place(s, seat, x, y) {
  s.players[seat].x = x;
  s.players[seat].y = y;
}

test("rejects bad player counts", () => {
  assert.throws(() => newMatch(seats(1)));
  assert.throws(() => newMatch(seats(5)));
});

test("illegal actions are refused and do not change state", () => {
  const s = newMatch(seats(2));
  const copy = structuredClone(s);
  assert.throws(() => applyAction(s, { type: "move", x: 5, y: 5 }));
  assert.throws(() => applyAction(s, { type: "fire", x: 6, y: 6 }));
  assert.throws(() => applyAction(s, { type: "teleport" }));
  assert.throws(() => applyAction(s, null));
  assert.deepEqual(s, copy);
});

test("moving spends action points and the turn passes at zero", () => {
  let s = newMatch(seats(2));
  assert.equal(s.ap, 2, "whoever opens gets one point less");
  s = applyAction(s, { type: "move", x: 1, y: 0 });
  assert.equal(s.ap, 1);
  s = applyAction(s, { type: "move", x: 2, y: 0 });
  assert.equal(s.turn, 1);
  assert.equal(s.ap, 3);
});

test("fire needs a clear line and two points; a commander blocks it", () => {
  let s = newMatch(seats(3));
  place(s, 0, 0, 0);
  place(s, 1, 3, 0);
  place(s, 2, 1, 0);
  assert.ok(!legalActions(s).some((a) => a.type === "fire" && a.x === 3));
  assert.ok(legalActions(s).some((a) => a.type === "fire" && a.x === 1));
  s.ap = 1;
  assert.ok(!legalActions(s).some((a) => a.type === "fire"));
});

test("shield absorbs two and is used up", () => {
  let s = newMatch(seats(2));
  place(s, 0, 0, 0);
  place(s, 1, 2, 0);
  s.players[1].shield = true;
  s = applyAction(s, { type: "fire", x: 2, y: 0 });
  assert.equal(s.players[1].hp, 9);
  assert.equal(s.players[1].shield, false);
});

test("a shove displaces, hurts, and needs free space behind", () => {
  let s = newMatch(seats(2));
  place(s, 0, 2, 3);
  place(s, 1, 3, 3);
  s = applyAction(s, { type: "shove", x: 3, y: 3 });
  assert.deepEqual([s.players[1].x, s.players[1].y, s.players[1].hp], [4, 3, 9]);
  const edge = newMatch(seats(2));
  place(edge, 0, 5, 0);
  place(edge, 1, 6, 0);
  assert.ok(!legalActions(edge).some((a) => a.type === "shove"));
});

test("beacons score at the start of the owner's turn and can be stolen", () => {
  let s = newMatch(seats(2));
  place(s, 0, 3, 3);
  s = applyAction(s, { type: "claim" });
  assert.equal(s.beacons.find((b) => b.x === 3 && b.y === 3).owner, 0);
  s = applyAction(s, { type: "end" });
  s = applyAction(s, { type: "end" });
  assert.equal(s.players[0].score, 1);
  place(s, 1, 3, 3);
  place(s, 0, 0, 0);
  s = applyAction(s, { type: "end" });
  s = applyAction(s, { type: "claim" });
  assert.equal(s.beacons.find((b) => b.x === 3 && b.y === 3).owner, 1);
});

test("reaching the target score wins", () => {
  let s = newMatch(seats(2));
  s.players[0].score = WIN_SCORE - 1;
  s.beacons[0].owner = 0;
  s = applyAction(s, { type: "end" });
  s = applyAction(s, { type: "end" });
  assert.equal(s.winner, 0);
  assert.deepEqual(legalActions(s), []);
  assert.throws(() => applyAction(s, { type: "end" }));
});

test("elimination frees beacons and the last commander wins", () => {
  let s = newMatch(seats(2));
  place(s, 0, 0, 0);
  place(s, 1, 1, 0);
  s.players[1].hp = 2;
  s.beacons[0].owner = 1;
  s = applyAction(s, { type: "fire", x: 1, y: 0 });
  assert.equal(s.winner, 0);
  assert.equal(s.beacons[0].owner, null);
});

test("an eliminated seat is skipped in a bigger match", () => {
  let s = newMatch(seats(3));
  s.players[1].alive = false;
  s = applyAction(s, { type: "end" });
  assert.equal(s.turn, 2);
});

test("the round limit ends the match on points", () => {
  let s = newMatch(seats(2));
  s.round = MAX_ROUNDS;
  s.players[1].score = 3;
  s = applyAction(s, { type: "end" });
  s = applyAction(s, { type: "end" });
  assert.equal(s.winner, 1);
});

test("bots only play legal moves and every match ends in time", () => {
  for (const n of [2, 3, 4]) {
    for (let seed = 0; seed < 30; seed++) {
      const s = advance(newMatch(seats(n, true), seed));
      assert.notEqual(s.winner, null, `${n}p seed ${seed}`);
      assert.ok(s.round <= MAX_ROUNDS);
    }
  }
});

test("no seat runs away with varied play", () => {
  let r = 42;
  const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const limit = { 2: 0.62, 3: 0.52, 4: 0.38 };
  for (const n of [2, 3, 4]) {
    const wins = Array(n).fill(0);
    const games = 400;
    for (let g = 0; g < games; g++) {
      let s = newMatch(seats(n), g);
      for (let i = 0; i < 2000 && s.winner === null; i++) {
        const legal = legalActions(s).filter((a) => a.type !== "end");
        s = applyAction(s, rnd() < 0.2 && legal.length ? legal[Math.floor(rnd() * legal.length)] : botAction(s));
      }
      wins[s.winner]++;
    }
    assert.ok(Math.max(...wins) / games < limit[n], `${n}p seats: ${wins}`);
  }
});

test("every turn offers a real choice", () => {
  let s = newMatch(seats(4));
  let turns = 0;
  while (s.winner === null && turns < 300) {
    assert.ok(legalActions(s).length >= 2);
    s = applyAction(s, botAction(s));
    turns++;
  }
});
