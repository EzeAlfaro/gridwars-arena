// Juega una partida en navegador real como humano, con clicks, y saca capturas.
//   node test/play_browser.mjs <url-base> <carpeta>
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] || "http://localhost:8798";
const OUT = process.argv[3] || join(tmpdir(), "gw");
mkdirSync(OUT, { recursive: true });
const bin = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
const PORT = 9335;
const proc = spawn(bin, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(process.env.GW_TMP || tmpdir(), "gw-"))}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
let targets;
for (let i = 0; i < 50 && !targets; i++) {
  await new Promise((r) => setTimeout(r, 200));
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { /* arrancando */ }
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const waiting = new Map();
const problems = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); }
  if (d.method === "Runtime.exceptionThrown") problems.push(JSON.stringify(d.params.exceptionDetails).slice(0, 220));
  if (d.method === "Log.entryAdded" && d.params.entry.level === "error" && !/status of 4\d\d/.test(d.params.entry.text)) problems.push(d.params.entry.text.slice(0, 200));
};
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const js = async (e) => (await cdp("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (n, full) => writeFileSync(join(OUT, n + ".png"), Buffer.from((await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: !!full })).result.data, "base64"));
const until = async (e, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(e)) return true; await wait(100); } return false; };
const click = async (sel) => {
  await js(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:"center",behavior:"instant"})`);
  await wait(60);
  const b = JSON.parse(await js(`JSON.stringify(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect())`));
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  for (const type of ["mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
};
await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Log.enable");
let failed = 0;
const check = (n, ok, extra = "") => { console.log(ok ? "ok  " : "FAIL", n, extra); if (!ok) failed++; };

for (const [tag, width, height, mobile] of [["escritorio", 1280, 800, false], ["movil", 390, 844, true]]) {
  await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  await cdp("Page.navigate", { url: BASE + "/" });
  await wait(700);
  await shot(`${tag}-inicio`);
  check(`${tag}: portada sin desborde`, await js("document.documentElement.scrollWidth<=innerWidth"));
  await click("#vsbot");
  check(`${tag}: empieza la partida`, await until("!document.getElementById('match').hidden"));
  check(`${tag}: es mi turno`, await until("last&&last.your_turn"));
  await wait(200);
  await shot(`${tag}-partida`);
  check(`${tag}: casillas marcadas`, await js("document.querySelectorAll('.cell.can').length>0"));
  check(`${tag}: casillas cuadradas e iguales`, await js("[...document.querySelectorAll('.cell')].every((c)=>{const r=c.getBoundingClientRect();return Math.abs(r.width-r.height)<1.5})"));
  check(`${tag}: fichas redondas`, await js("[...document.querySelectorAll('.unit')].every((u)=>{const r=u.getBoundingClientRect();return r.width>0&&Math.abs(r.width-r.height)<1.5})"));
  check(`${tag}: partida sin desborde`, await js("document.documentElement.scrollWidth<=innerWidth"));
  let moves = 0;
  for (; moves < 200; moves++) {
    if (!(await until("last&&(last.your_turn||last.status==='finished')", 8000))) break;
    if (await js("last.status==='finished'")) break;
    const can = await js("document.querySelectorAll('.cell.can').length");
    const claim = await js("!document.getElementById('a-claim').hidden");
    const before = await js("JSON.stringify(last.state)");
    if (claim) await click("#a-claim");
    else if (can) await click(`.cell.can:nth-of-type(n)`);
    else await click("#a-end");
    const changed = await until(`JSON.stringify(last.state)!==${JSON.stringify(before)}||last.status==='finished'`, 5000);
    if (!changed) { check(`${tag}: click cambia el estado`, false, "sin cambios"); break; }
  }
  check(`${tag}: la partida termina jugando con clicks`, await js("last.status==='finished'"), `${moves} acciones: ` + (await js("document.getElementById('status').textContent+' / '+document.getElementById('sub').textContent")));
  check(`${tag}: registro con historia`, await js("document.querySelectorAll('#log li').length>3"));
  await wait(400);
  await shot(`${tag}-final`, true);
}
await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await cdp("Page.navigate", { url: BASE + "/" });
await wait(500);
await click("#host");
check("sala: muestra el codigo", await until("!document.getElementById('lobby').hidden"));
await wait(200);
await shot("sala");
const code = await js("document.getElementById('lcode').textContent");
const join2 = await fetch(BASE + `/api/matches/${code}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Amigo" }) });
const friend = await join2.json();
check("sala: un agente se une y arranca", join2.ok && friend.status === "playing", friend.status);
check("sala: el anfitrion entra solo", await until("!document.getElementById('match').hidden", 5000));
check("sin errores de JavaScript", problems.length === 0, problems.slice(0, 3).join(" | "));
console.log(failed ? `${failed} fallas` : "todo ok");
ws.close();
proc.kill();
process.exit(failed ? 1 : 0);
