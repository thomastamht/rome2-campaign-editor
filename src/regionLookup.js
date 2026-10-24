// Region-under-tile lookup from the game's campaign_maps\<campaign>\*_lookup.tga, exported by
// tools/extract-assets.mjs as a greyscale PNG whose pixel value is the region index. The index ->
// region key table is learned from the settlements the game reports (one settlement per region).

const base = import.meta.env?.BASE_URL ?? "/";

export class RegionLookup {
  constructor() { this.width = 0; this.height = 0; this.indices = null; this.sea = null; this.keys = new Map(); this.campaign = null; }

  async load(campaign) {
    if (this.campaign === campaign && this.indices) return true;
    this.campaign = campaign;
    this.indices = null;
    const img = new Image();
    img.src = `${base}maps/${campaign}_lookup.png`;
    try { await img.decode(); } catch { return false; }
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    this.width = canvas.width; this.height = canvas.height;
    this.indices = new Uint8Array(this.width * this.height);
    const hist = new Uint32Array(256);
    for (let i = 0; i < this.indices.length; i++) { const v = rgba[i * 4]; this.indices[i] = v; hist[v]++; }
    let best = 0;
    for (let v = 1; v < 256; v++) if (hist[v] > hist[best]) best = v;
    this.sea = best;                                  // the sea is by far the largest single index
    return true;
  }

  /** bounds: logical tile extents of the image (minX/maxX/minY/maxY). */
  indexAt(lx, ly, bounds) {
    if (!this.indices) return null;
    const fx = (lx + 0.5 - bounds.minX) / (bounds.maxX - bounds.minX);
    const fy = 1 - (ly + 0.5 - bounds.minY) / (bounds.maxY - bounds.minY);
    const ix = Math.floor(fx * this.width), iy = Math.floor(fy * this.height);
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return null;
    return this.indices[iy * this.width + ix];
  }

  /** Learn index -> region key from settlements (regions with lx/ly). */
  learn(regions, bounds) {
    this.keys.clear();
    for (const r of regions) {
      if (!Number.isFinite(r.lx)) continue;
      const idx = this.indexAt(r.lx, r.ly, bounds);
      if (idx != null && idx !== this.sea && !this.keys.has(idx)) this.keys.set(idx, r.key);
    }
    return this.keys.size;
  }

  /** Region key under a tile; null for sea / outside / unknown index. */
  regionAt(lx, ly, bounds) {
    const idx = this.indexAt(lx, ly, bounds);
    if (idx == null || idx === this.sea) return null;
    return this.keys.get(idx) ?? null;
  }

  isSea(lx, ly, bounds) {
    const idx = this.indexAt(lx, ly, bounds);
    return idx == null || idx === this.sea;
  }
}
