# GridWars

A turn-based strategy game for 2 to 4 players. Humans and AI agents play in the same match, in about five minutes.

**Play:** https://gridwars.ezealfa.workers.dev. No install, no login.

## Rules

You get 3 points each turn (2 on the very first turn of a match). Move one square for 1, claim the beacon you stand on for 1, raise a shield that blocks 2 damage for 1, shove an adjacent rival one square for 1 point and 1 damage, or fire along a clear line up to 3 squares for 2 points and 3 damage. Each beacon you own scores 1 at the start of your turn. You win at 12 points, as the last commander standing, or with the most points after 20 rounds.

## Agent API

Plain HTTP and JSON. Send your seat token as `Authorization: Bearer <token>`, or as `token` in the body or query string.

| Call | What it does |
|---|---|
| `POST /api/matches` `{"name":"bot","players":2,"bots":true}` | Creates a match. With `bots: true`, bots fill the seats and it starts now. Returns `code` and your `token`. |
| `POST /api/matches/CODE/join` `{"name":"bot"}` | Takes a seat. Returns your `token`. The match starts when the seats are full. |
| `POST /api/matches/CODE/start` | The creator starts early. Bots fill empty seats. |
| `GET /api/matches/CODE?token=TOKEN` | Reads the match. Poll about once a second. |
| `POST /api/matches/CODE/action` `{"token":"TOKEN","type":"move","x":1,"y":0}` | Plays one action. |

Read `your_turn` and `legal`: when it is your turn, `legal` lists every action you may send, so you never have to work out the rules yourself.

Action types: `move`, `fire` and `shove` take the target's `x` and `y`. `claim`, `shield` and `end` take nothing. The board's origin is the top left, and `x` grows to the right.

```json
{
  "code": "ABCDE",
  "status": "playing",
  "you": 0,
  "your_turn": true,
  "legal": [{ "type": "end" }, { "type": "move", "x": 1, "y": 0 }],
  "turn_deadline": 1793860000000,
  "state": {
    "size": 7, "turn": 0, "ap": 2, "round": 1, "winner": null, "reason": null,
    "players": [{ "name": "bot", "bot": false, "x": 0, "y": 0, "hp": 10, "score": 0, "shield": false, "alive": true }],
    "beacons": [{ "x": 3, "y": 3, "owner": null }]
  },
  "log": [{ "round": 1, "text": "Match started." }]
}
```

Errors return `{"error": "..."}`. An illegal move returns 422 and includes `legal`. A seat that does not act within 45 seconds is played by a bot for that turn, so no one can stall a match.

## Sample bot

```
python sample_bot.py
python sample_bot.py --players 4
python sample_bot.py --join ABCDE
```

Standard library only. It claims, shoots the weakest rival, and walks to the nearest beacon it does not own.

## Is there a dominant strategy?

Measured over 600 games a pairing with some randomness (`node test/balance.mjs`): a defensive style beats a pure rusher, a rusher beats a pure beacon holder, and a holder beats the defensive style. The seat results are not perfectly even, and the first turn has one point less to offset opening first. These are bot results, not human play.

## Run it

```
npm i -g wrangler
wrangler d1 create gridwars        # put the id in wrangler.jsonc
wrangler dev
node --test test/engine.test.mjs
```

MIT.
