import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { agentDisplayName } from "../src/loc.js";

const agents = JSON.parse(fs.readFileSync(new URL("../public/loc/agents.json", import.meta.url), "utf8"));

test("agent titles follow the faction, and the job stays spy, dignitary or champion", () => {
  const rome = { subculture: "sc_rom_roman" };
  assert.equal(agentDisplayName(agents, "dignitary", { ...rome, male: true, lang: "en" }), "Patrician");
  assert.equal(agentDisplayName(agents, "dignitary", { ...rome, male: true, lang: "zh" }), "权要");
  assert.equal(agentDisplayName(agents, "dignitary", { ...rome, male: true, lang: "tw" }), "權要");
  assert.equal(agentDisplayName(agents, "champion", { ...rome, male: true, lang: "en" }), "Veteran");
  assert.equal(agentDisplayName(agents, "spy", { ...rome, lang: "tw" }), "間諜");

  const gaul = { subculture: "sc_rom_gaul" };
  assert.equal(agentDisplayName(agents, "dignitary", { ...gaul, lang: "en" }), "Druid / Druidess");
  assert.equal(agentDisplayName(agents, "dignitary", { ...gaul, male: false, lang: "zh" }), "女德鲁伊");
  assert.equal(agentDisplayName(agents, "dignitary", { ...gaul, male: false, lang: "tw" }), "女德魯伊");
  assert.equal(agentDisplayName(agents, "spy", { ...gaul, male: true, lang: "en" }), "Scout");

  assert.equal(agentDisplayName(agents, "dignitary", { faction: "rom_celtici", subculture: "sc_rom_roman", male: true, lang: "en" }), "Druid");
  assert.equal(agentDisplayName(agents, "spy", { subculture: "missing", lang: "en" }), undefined);
});
