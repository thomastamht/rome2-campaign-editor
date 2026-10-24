import test from "node:test";
import assert from "node:assert/strict";
import { fitLinear, coordinateModel, computeBounds, projector, nearest, inferRegionPositions, factionColor } from "../src/map.js";

test("fitLinear recovers the display->logical transform and rejects degenerate samples", () => {
  const fit = fitLinear([{ d: 100, l: 10 }, { d: 200, l: 20 }, { d: 350, l: 35 }]);
  assert.ok(Math.abs(fit.a - 0.1) < 1e-9 && Math.abs(fit.b) < 1e-9);
  assert.equal(fitLinear([{ d: 1, l: 1 }]), null);
  assert.equal(fitLinear([{ d: 5, l: 1 }, { d: 5, l: 2 }]), null, "all samples at the same display coordinate");
  assert.equal(fitLinear([{ d: NaN, l: 1 }, { d: undefined, l: 2 }]), null);
});

test("coordinateModel round-trips logical tiles through display units", () => {
  const records = [
    { x: 421.5, y: 312.25, lx: 42, ly: 31 }, { x: 381.0, y: 182.0, lx: 38, ly: 18 },
    { x: 690.2, y: 150.9, lx: 69, ly: 15 }, { x: 330.4, y: 420.1, lx: 33, ly: 42 },
  ];
  const model = coordinateModel(records);
  assert.deepEqual(model.toLogical(500, 250), { lx: 50, ly: 25 });
  const back = model.toDisplay(50, 25);
  assert.ok(Math.abs(back.x - 500) < 2 && Math.abs(back.y - 250) < 2);
  assert.equal(coordinateModel([{ x: 1, y: 1, lx: 1, ly: 1 }]), null);
});

test("projector maps world bounds onto the canvas with north up and inverts exactly", () => {
  const bounds = computeBounds([{ x: 0, y: 0 }, { x: 900, y: 700 }]);
  const proj = projector(bounds, 1000, 600);
  const topLeft = proj.toCanvas(bounds.minX, bounds.maxY);
  assert.ok(topLeft.py < proj.toCanvas(bounds.minX, bounds.minY).py, "larger y is drawn higher");
  for (const [x, y] of [[0, 0], [450, 350], [900, 700]]) {
    const p = proj.toCanvas(x, y);
    const w = proj.fromCanvas(p.px, p.py);
    assert.ok(Math.abs(w.x - x) < 1e-6 && Math.abs(w.y - y) < 1e-6);
  }
  const zoomed = projector(bounds, 1000, 600, { zoom: 2, panX: 30, panY: -10 });
  const q = zoomed.toCanvas(450, 350);
  const w = zoomed.fromCanvas(q.px, q.py);
  assert.ok(Math.abs(w.x - 450) < 1e-6 && Math.abs(w.y - 350) < 1e-6);
  const flat = projector(bounds, 1000, 600, { flipY: false });
  assert.ok(flat.toCanvas(0, 0).py < flat.toCanvas(0, 700).py);
});

test("nearest and inferRegionPositions fill settlement positions from garrisons", () => {
  const regions = [{ key: "a", x: 10, y: 10 }, { key: "b" }, { key: "c" }];
  const chars = [
    { region: "b", in_settlement: true, x: 100, y: 200, lx: 10, ly: 20 },
    { region: "b", in_settlement: true, x: 102, y: 198, lx: 10, ly: 20 },
    { region: "b", in_settlement: false, x: 500, y: 500, lx: 50, ly: 50 },
  ];
  const filled = inferRegionPositions(regions, chars);
  assert.equal(filled[0].position_source, "engine");
  assert.deepEqual([filled[1].x, filled[1].y, filled[1].lx, filled[1].ly, filled[1].position_source], [101, 199, 10, 20, "garrison"]);
  assert.equal(filled[2].position_source, "none");
  assert.equal(nearest(filled, 95, 205).item.key, "b");
  assert.equal(nearest([{ key: "nopos" }], 0, 0), null);
});

test("factionColor is stable and distinct for different keys", () => {
  assert.equal(factionColor("rom_rome"), factionColor("rom_rome"));
  assert.notEqual(factionColor("rom_rome"), factionColor("rom_carthage"));
  assert.match(factionColor("x"), /^hsl\(\d+ \d+% \d+%\)$/);
});
