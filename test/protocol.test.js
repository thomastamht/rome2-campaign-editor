import test from "node:test";
import assert from "node:assert/strict";
import { FileBridge, buildRequest, parseResponse, assertOk, chooseDirectory, reusableDirectory } from "../src/protocol.js";
import { DemoBridge } from "../src/sample.js";

/** In-memory FileSystemDirectoryHandle: the game side is simulated by `answer`. */
function fakeDirectory(initialResponse = "") {
  const files = { "response.json": initialResponse };
  const dir = {
    writes: [],
    getFileHandle: async (name, opts) => {
      if (!(name in files) && !opts?.create) throw new DOMException("not found", "NotFoundError");
      return {
        getFile: async () => ({ text: async () => files[name] ?? "" }),
        createWritable: async () => ({ write: async (v) => { files[name] = v; dir.writes.push(JSON.parse(v)); }, close: async () => {} }),
      };
    },
    answer(fn) { const req = JSON.parse(files["request.json"]); files["response.json"] = JSON.stringify({ request_id: req.request_id, result: fn(req) }); },
    corrupt(text) { files["response.json"] = text; },
  };
  return dir;
}

test("buildRequest produces the WH2 envelope and rejects reserved argument names", () => {
  assert.deepEqual(buildRequest("treasury_mod", { faction: "rom_rome", amount: 5 }, 7), { faction: "rom_rome", amount: 5, type: "treasury_mod", request_id: 7 });
  assert.throws(() => buildRequest("", {}, 1), /type/);
  assert.throws(() => buildRequest("x", { request_id: 2 }, 1), /request_id/);
  assert.throws(() => buildRequest("x", {}, 0), /positive/);
});

test("parseResponse accepts the game's envelope and rejects noise", () => {
  assert.deepEqual(parseResponse('{"request_id":3,"result":{"a":1}}'), { request_id: 3, result: { a: 1 } });
  assert.throws(() => parseResponse(""), /empty/);
  assert.throws(() => parseResponse("{}"), /request_id/);
  assert.throws(() => parseResponse('{"request_id":'), SyntaxError);
});

test("readReadyMarker returns the result only for request_id 0 ready markers", async () => {
  const ready = new FileBridge(fakeDirectory('{"request_id":0,"result":{"status":"ready","game":"rome2"}}'));
  assert.equal((await ready.readReadyMarker()).game, "rome2");
  const stale = new FileBridge(fakeDirectory('{"request_id":44,"result":{}}'));
  assert.equal(await stale.readReadyMarker(), null);
  const empty = new FileBridge(fakeDirectory(""));
  assert.equal(await empty.readReadyMarker(), null);
});

test("isAlive accepts the ready marker, or a heartbeat answer once the marker is overwritten", async () => {
  assert.equal(await new FileBridge(fakeDirectory('{"request_id":0,"result":{"status":"ready"}}')).isAlive(), true);

  const used = fakeDirectory('{"request_id":265747,"result":{"regions":[]}}');
  const live = new FileBridge(used, { interval: 1, retries: 5, sleep: async () => used.answer(() => ({ ok: true, game: "rome2" })) });
  assert.equal(await live.isAlive(), true);
  assert.equal(used.writes.at(-1).type, "heartbeat");

  const gone = new FileBridge(fakeDirectory('{"request_id":265747,"result":{}}'), { interval: 1, retries: 3, sleep: async () => {} });
  assert.equal(await gone.isAlive(), false);
});

test("request writes request.json, waits for the matching request_id and ignores stale/partial responses", async () => {
  const dir = fakeDirectory('{"request_id":1,"result":"stale"}');
  let ticks = 0;
  const bridge = new FileBridge(dir, { interval: 1, retries: 10, sleep: async () => {
    ticks++;
    if (ticks === 1) dir.corrupt('{"request_id":'); // game mid-write
    if (ticks === 2) dir.answer(req => ({ echoed: req.type, faction: req.faction }));
  } });
  bridge.nextId = 5;
  const result = await bridge.request("treasury_mod", { faction: "rom_rome", amount: 100 });
  assert.deepEqual(result, { echoed: "treasury_mod", faction: "rom_rome" });
  assert.deepEqual(dir.writes[0], { faction: "rom_rome", amount: 100, type: "treasury_mod", request_id: 5 });
  assert.equal(ticks, 2);
});

test("request times out with a helpful error and serialises concurrent calls", async () => {
  const dir = fakeDirectory("");
  const bridge = new FileBridge(dir, { interval: 1, retries: 3, sleep: async () => {} });
  await assert.rejects(bridge.request("heartbeat"), /no answer for heartbeat .*campaign loaded/);
  const order = [];
  const seq = new FileBridge(fakeDirectory(""), { interval: 1, retries: 5, sleep: async () => { seq.dir?.answer?.(req => req.type); } });
  seq.dir = seq.directory;
  const a = seq.request("get_factions").then(r => order.push(r));
  const b = seq.request("get_regions").then(r => order.push(r));
  await Promise.all([a, b]);
  assert.deepEqual(order, ["get_factions", "get_regions"]);
  assert.ok(seq.directory.writes[1].request_id > seq.directory.writes[0].request_id);
});

test("assertOk surfaces handler errors", () => {
  assert.throws(() => assertOk({ ok: false, error: "faction not found: x" }, "treasury_mod"), /treasury_mod: faction not found: x/);
  assert.deepEqual(assertOk({ ok: true, v: 1 }, "x"), { ok: true, v: 1 });
  assert.deepEqual(assertOk({ a: 1 }, "x"), { a: 1 });
});

test("DemoBridge mirrors the handler set and mutates its sample campaign", async () => {
  const demo = new DemoBridge();
  const info = await demo.request("get_game_info");
  assert.equal(info.capabilities.treasury_mod, "verified");
  const before = (await demo.request("get_factions")).find(f => f.key === "rom_rome").treasury;
  assert.deepEqual(await demo.request("treasury_mod", { faction: "rom_rome", amount: 250 }), { ok: true, faction: "rom_rome", treasury: before + 250 });
  assert.equal((await demo.request("transfer_region_to_faction", { region: "rom_africa_zeugitana", faction: "rom_rome" })).owner, "rom_rome");
  const chars = await demo.request("get_active_characters");
  const general = chars.find(c => c.cqi === 201);
  const reloc = await demo.request("relocate_force", { cqi: 201, region: "rom_italia_latium", x: 43, y: 33 });
  assert.equal(reloc.ok, true);
  assert.equal(reloc.units, general.units - 1);
  const after = await demo.request("get_active_characters");
  assert.equal(after.some(c => c.cqi === 201), false);
  assert.equal(after.length, chars.length);
  assert.match((await demo.request("nope")).error, /unknown request type/);
});

test("chooseDirectory reuses a granted folder and falls back to the picker", async () => {
  const saved = { name: "saved" };
  const picked = { name: "picked" };
  assert.equal(await chooseDirectory({ saved, requestPermission: async () => "granted", pick: async () => picked }), saved);
  assert.equal(await chooseDirectory({ saved, requestPermission: async () => "prompt", pick: async () => picked }), picked);
  assert.equal(await chooseDirectory({ saved, requestPermission: async () => "granted", pick: async () => picked, forcePick: true }), picked);
  assert.equal(await chooseDirectory({ saved, requestPermission: async () => { throw new Error("stale"); }, pick: async () => picked }), picked);
});

test("reusableDirectory only returns a folder the browser already allows", async () => {
  const saved = { name: "saved" };
  assert.equal(await reusableDirectory(null, async () => "granted"), null);
  assert.equal(await reusableDirectory(saved, async () => "granted"), saved);
  assert.equal(await reusableDirectory(saved, async () => "prompt"), null);
  assert.equal(await reusableDirectory(saved, async () => { throw new Error("stale"); }), null);
});