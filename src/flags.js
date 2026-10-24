// Faction flag icons extracted by tools/extract-assets.mjs into public/flags/.
// index.json maps faction key -> { flag: folder, name } (folder = ui\flags\<folder> in the packs).

const base = import.meta.env?.BASE_URL ?? "/";
let index = {};
const images = new Map();
let onReady = () => {};

export async function loadFlagIndex() {
  try {
    const res = await fetch(`${base}flags/index.json`);
    if (res.ok) index = await res.json();
  } catch {
    index = {};
  }
  return index;
}

export function setFlagReadyCallback(fn) { onReady = fn; }

export function flagInfo(factionKey) { return index[factionKey] ?? null; }

/** Returns a decoded HTMLImageElement, or null while loading / when no flag exists. */
export function flagImage(factionKey) {
  const info = index[factionKey];
  if (!info) return null;
  const cached = images.get(info.flag);
  if (cached !== undefined) return cached && cached.complete && cached.naturalWidth ? cached : null;
  const img = new Image();
  images.set(info.flag, img);
  img.onload = () => onReady();
  img.onerror = () => images.set(info.flag, null);
  img.src = `${base}flags/${encodeURIComponent(info.flag)}/mon_64.png`;
  return null;
}
