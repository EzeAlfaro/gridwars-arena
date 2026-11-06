#!/usr/bin/env python3
"""Sample GridWars agent. Standard library only.

    python sample_bot.py                     # new match against a server bot
    python sample_bot.py --players 4         # new match, bots fill the seats
    python sample_bot.py --join ABCDE        # join a friend's match
"""
import argparse
import json
import time
import urllib.error
import urllib.request

DEFAULT_URL = "https://gridwars.ezealfa.workers.dev"


def call(base, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, headers={"content-type": "application/json", "user-agent": "gridwars-sample-bot"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {"error": json.load(e).get("error", str(e)), "http": e.code}


def choose(view):
    """Claim, then shoot the weakest target, then walk to the nearest beacon we do not own."""
    legal, state = view["legal"], view["state"]
    me = state["players"][view["you"]]
    by_type = {}
    for action in legal:
        by_type.setdefault(action["type"], []).append(action)
    if "claim" in by_type:
        return by_type["claim"][0]
    if "fire" in by_type:
        rivals = {(p["x"], p["y"]): p for p in state["players"] if p["alive"]}
        return min(by_type["fire"], key=lambda a: rivals[(a["x"], a["y"])]["hp"])
    wanted = [b for b in state["beacons"] if b["owner"] != view["you"]]
    if wanted and "move" in by_type:
        distance = lambda a: min(abs(a["x"] - b["x"]) + abs(a["y"] - b["y"]) for b in wanted)
        here = min(abs(me["x"] - b["x"]) + abs(me["y"] - b["y"]) for b in wanted)
        best = min(by_type["move"], key=distance)
        if distance(best) < here:
            return best
    return by_type.get("shield", by_type["end"])[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--players", type=int, default=2)
    ap.add_argument("--join")
    ap.add_argument("--name", default="sample-bot")
    a = ap.parse_args()
    if a.join:
        view = call(a.url, f"/api/matches/{a.join}/join", {"name": a.name})
    else:
        view = call(a.url, "/api/matches", {"name": a.name, "players": a.players, "bots": True})
    if "error" in view:
        raise SystemExit(view["error"])
    code, token = view["code"], view["token"]
    print(f"match {code}, seat {view['you']}")
    while view["status"] != "finished":
        if view["your_turn"]:
            action = choose(view)
            print("  ", action)
            view = call(a.url, f"/api/matches/{code}/action", {"token": token, **action})
            if "error" in view:
                print("refused:", view["error"])
                view = call(a.url, f"/api/matches/{code}?token={token}")
        else:
            time.sleep(1)
            view = call(a.url, f"/api/matches/{code}?token={token}")
    state = view["state"]
    print(f"{state['players'][state['winner']]['name']} wins: {state['reason']}")


if __name__ == "__main__":
    main()
