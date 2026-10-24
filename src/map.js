// Campaign map: plots characters/settlements from their logical positions and converts
// clicks (selection, right-click create) back into game coordinates.
//
// Rome II exposes two coordinate systems per character:
//   display_position_x/y  - world units used by the camera and rendering (floats)
//   logical_position_x/y  - map tiles used by create_force / move_to (integers)
// Nothing documents the transform, so it is fitted at runtime from characters that report both.

export function factionColor(key) {
  let hash = 2166136261;
  for (const ch of String(key)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  const hue = hash % 360;
  const sat = 55 + (hash >>> 9) % 25;
  const light = 48 + (hash >>> 17) % 14;
  return `hsl(${hue} ${sat}% ${light}%)`;
}

/** Least-squares fit of l = a*d + b. Returns null when the sample cannot determine a line. */
export function fitLinear(pairs) {
  const pts = pairs.filter(p => Number.isFinite(p.d) && Number.isFinite(p.l));
  if (pts.length < 2) return null;
  const n = pts.length;
  const meanD = pts.reduce((s, p) => s + p.d, 0) / n;
  const meanL = pts.reduce((s, p) => s + p.l, 0) / n;
  let sdd = 0, sdl = 0;
  for (const p of pts) { sdd += (p.d - meanD) ** 2; sdl += (p.d - meanD) * (p.l - meanL); }
  if (sdd < 1e-9) return null;
  const a = sdl / sdd;
  return { a, b: meanL - a * meanD };
}

/** Builds display<->logical converters from any records carrying x/y and lx/ly. */
export function coordinateModel(records) {
  const fx = fitLinear(records.map(r => ({ d: r.x, l: r.lx })));
  const fy = fitLinear(records.map(r => ({ d: r.y, l: r.ly })));
  if (!fx || !fy) return null;
  return {
    toLogical(x, y) { return { lx: Math.round(fx.a * x + fx.b), ly: Math.round(fy.a * y + fy.b) }; },
    toDisplay(lx, ly) { return { x: (lx - fx.b) / fx.a, y: (ly - fy.b) / fy.a }; },
    scale: { x: fx.a, y: fy.a },
  };
}

export function computeBounds(points) {
  const xs = points.map(p => p.x).filter(Number.isFinite);
  const ys = points.map(p => p.y).filter(Number.isFinite);
  if (!xs.length || !ys.length) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const padX = Math.max((maxX - minX) * 0.04, 1), padY = Math.max((maxY - minY) * 0.04, 1);
  return { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY };
}

/** Maps world display coordinates onto a canvas, preserving aspect ratio. flipY: north is up. */
export function projector(bounds, width, height, { flipY = true, zoom = 1, panX = 0, panY = 0 } = {}) {
  const spanX = bounds.maxX - bounds.minX || 1;
  const spanY = bounds.maxY - bounds.minY || 1;
  const scale = Math.min(width / spanX, height / spanY) * zoom;
  const offsetX = (width - spanX * scale) / 2 + panX;
  const offsetY = (height - spanY * scale) / 2 + panY;
  return {
    scale,
    toCanvas(x, y) {
      const px = offsetX + (x - bounds.minX) * scale;
      const py = flipY ? offsetY + (bounds.maxY - y) * scale : offsetY + (y - bounds.minY) * scale;
      return { px, py };
    },
    fromCanvas(px, py) {
      const x = bounds.minX + (px - offsetX) / scale;
      const y = flipY ? bounds.maxY - (py - offsetY) / scale : bounds.minY + (py - offsetY) / scale;
      return { x, y };
    },
  };
}

export function nearest(items, x, y, pos = (item) => ({ x: item.x, y: item.y })) {
  let best = null, bestDist = Infinity;
  for (const item of items) {
    const at = pos(item);
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) continue;
    const d = (at.x - x) ** 2 + (at.y - y) ** 2;
    if (d < bestDist) { bestDist = d; best = item; }
  }
  return best ? { item: best, distance: Math.sqrt(bestDist) } : null;
}

/** Settlements without engine positions borrow the centroid of characters garrisoned in them. */
export function inferRegionPositions(regions, characters) {
  const sums = new Map();
  for (const c of characters) {
    if (!c.in_settlement || !c.region || !Number.isFinite(c.x)) continue;
    const s = sums.get(c.region) ?? { x: 0, y: 0, lx: 0, ly: 0, n: 0 };
    s.x += c.x; s.y += c.y; s.lx += c.lx ?? 0; s.ly += c.ly ?? 0; s.n++;
    sums.set(c.region, s);
  }
  return regions.map(r => {
    if (Number.isFinite(r.x) && Number.isFinite(r.y)) return { ...r, position_source: "engine" };
    const s = sums.get(r.key);
    if (!s) return { ...r, position_source: "none" };
    return { ...r, x: s.x / s.n, y: s.y / s.n, lx: Math.round(s.lx / s.n), ly: Math.round(s.ly / s.n), position_source: "garrison" };
  });
}

const DRAG_THRESHOLD = 4;

/** Two (display, image-fraction) pairs -> edge coordinates of the image. Fractions: 0..1 from left / from top. */
export function boundsFromPairs(pairs) {
  if (pairs.length < 2) return null;
  const [a, b] = pairs;
  const dfx = b.f.x - a.f.x, dfy = b.f.y - a.f.y;
  if (Math.abs(dfx) < 0.02 || Math.abs(dfy) < 0.02) return null;   // points too close on one axis
  const spanX = (b.d.x - a.d.x) / dfx;
  const spanY = (a.d.y - b.d.y) / dfy;                              // image y grows downward, map y grows north
  if (!(spanX > 0 && spanY > 0)) return null;
  const minX = a.d.x - a.f.x * spanX;
  const maxY = a.d.y + a.f.y * spanY;
  return { minX, maxX: minX + spanX, minY: maxY - spanY, maxY };
}

const MAX_ZOOM = 40;     // zoom 1 = image fitted inside the view; the floor is the "cover" zoom (see minZoom)

export class MapView {
  constructor(canvas, handlers = {}) {
    this.canvas = canvas;
    this.handlers = handlers;
    this.data = { characters: [], regions: [], colors: () => "#888", flag: () => null, pos: (item) => ({ x: item.x, y: item.y }) };
    this.view = { flipY: true, zoom: 1, panX: 0, panY: 0 };
    this.selectedKey = null;
    this.pan = null;
    this.hover = null;
    this.bind();
  }

  /** Map coordinates of an item (logical tiles by default once the app supplies `pos`). */
  at(item) { return this.data.pos(item); }

  bind() {
    const c = this.canvas;
    c.addEventListener("pointerdown", e => this.onDown(e));
    c.addEventListener("pointermove", e => this.onMove(e));
    c.addEventListener("pointerup", e => this.onUp(e));
    c.addEventListener("pointerleave", () => { this.hover = null; this.handlers.onHover?.(null); this.draw(); });
    c.addEventListener("wheel", e => this.onWheel(e), { passive: false });
    c.addEventListener("contextmenu", e => this.onContext(e));
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => { this.clampView(); this.draw(); }).observe(c);
  }

  setData({ characters, regions, colors, flag, pos }) {
    this.data = { characters, regions, colors, flag: flag ?? (() => null), pos: pos ?? this.data.pos };
    this.dataBounds = computeBounds([...characters, ...regions].map(i => this.at(i)));
    this.bounds = this.background ? this.background.bounds : this.dataBounds;
    this.draw();
  }

  /** Image size in canvas pixels at zoom 1 (fitted inside the view). */
  fittedSize() {
    const { width, height } = this.size();
    const base = projector(this.bounds ?? computeBounds([]), width, height, { ...this.view, zoom: 1, panX: 0, panY: 0 });
    const tl = base.toCanvas(this.bounds.minX, this.view.flipY ? this.bounds.maxY : this.bounds.minY);
    const br = base.toCanvas(this.bounds.maxX, this.view.flipY ? this.bounds.minY : this.bounds.maxY);
    return { imgW: br.px - tl.px, imgH: br.py - tl.py, width, height };
  }

  /** Smallest zoom at which the image still covers the whole view (no bars on any side). */
  minZoom() {
    if (!this.bounds) return 1;
    const { imgW, imgH, width, height } = this.fittedSize();
    return Math.max(1, width / imgW, height / imgH);
  }

  /** Keeps the image covering the viewport: no panning past the edges, no zooming out below cover. */
  clampView() {
    this.view.zoom = Math.min(Math.max(this.view.zoom, this.minZoom()), MAX_ZOOM);
    if (!this.bounds) return;
    const { width, height } = this.size();
    const { panX, panY } = this.view;
    this.view.panX = 0; this.view.panY = 0;
    const base = this.project();
    const tl = base.toCanvas(this.bounds.minX, this.view.flipY ? this.bounds.maxY : this.bounds.minY);
    const br = base.toCanvas(this.bounds.maxX, this.view.flipY ? this.bounds.minY : this.bounds.maxY);
    const imgW = br.px - tl.px, imgH = br.py - tl.py;
    // when the image is wider than the view it may slide but never reveal the background; otherwise it stays centred
    this.view.panX = imgW <= width + 1 ? 0 : Math.min(Math.max(panX, width - br.px), -tl.px);
    this.view.panY = imgH <= height + 1 ? 0 : Math.min(Math.max(panY, height - br.py), -tl.py);
  }

  /** Position of a canvas point inside the background image as fractions (0..1 from left / from top). */
  imageFraction(px, py) {
    if (!this.background) return null;
    const b = this.background.bounds;
    const w = this.project().fromCanvas(px, py);
    return { x: (w.x - b.minX) / (b.maxX - b.minX), y: (b.maxY - w.y) / (b.maxY - b.minY) };
  }

  /**
   * Campaign minimap drawn under the markers. `bounds` are the display coordinates at the image
   * edges (minX/minY = bottom-left, maxX/maxY = top-right), i.e. the campaign logical grid.
   */
  setBackground(image, bounds) {
    this.background = image && bounds ? { image, bounds } : null;
    this.bounds = this.background ? this.background.bounds : this.dataBounds;
    this.clampView();
    this.draw();
  }

  setFlipY(flipY) { this.view.flipY = flipY; this.draw(); }
  resetView() { this.view.zoom = this.minZoom(); this.view.panX = 0; this.view.panY = 0; this.clampView(); this.draw(); }
  /** key: "character:<cqi>" | "region:<key>" | null */
  select(key) { this.selectedKey = key; this.draw(); }

  centerOn(x, y, zoom) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (zoom) this.view.zoom = zoom;
    const { width, height } = this.size();
    this.view.panX = 0; this.view.panY = 0;
    const p = this.project().toCanvas(x, y);
    this.view.panX = width / 2 - p.px;
    this.view.panY = height / 2 - p.py;
    this.clampView();
    this.draw();
  }

  size() {
    const rect = this.canvas.getBoundingClientRect();
    return { width: Math.max(rect.width, 50), height: Math.max(rect.height, 50) };
  }

  project() {
    const { width, height } = this.size();
    return projector(this.bounds ?? computeBounds([]), width, height, this.view);
  }

  localPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { px: e.clientX - rect.left, py: e.clientY - rect.top };
  }

  markerSize(kind, item) {
    const z = Math.min(Math.max(this.view.zoom, 1), 3);
    if (kind === "region") return 16 * z;
    if (item.is_agent) return 7 * z;
    return 13 * z;
  }

  hitTest(px, py) {
    const proj = this.project();
    let best = null, bestDist = Infinity;
    const consider = (kind, item) => {
      const at = this.at(item);
      if (!Number.isFinite(at.x)) return;
      const p = proj.toCanvas(at.x, at.y);
      const d = Math.hypot(p.px - px, p.py - py);
      const size = this.markerSize(kind, item);
      const reach = size + 2;
      if (d <= reach && d < bestDist) { bestDist = d; best = { kind, item }; }
    };
    for (const ch of this.data.characters) consider("character", ch);   // characters sit above settlements
    if (best) return best;
    for (const r of this.data.regions) consider("region", r);
    return best;
  }

  onDown(e) {
    if (e.button !== 0) return;
    const { px, py } = this.localPoint(e);
    const hit = this.hitTest(px, py);
    this.canvas.setPointerCapture(e.pointerId);
    // Markers are not draggable (Rome II has no teleport API); a press either pans or selects.
    this.pan = { startPx: px, startPy: py, panX: this.view.panX, panY: this.view.panY, hit };
  }

  onMove(e) {
    const { px, py } = this.localPoint(e);
    if (this.pan) {
      this.view.panX = this.pan.panX + (px - this.pan.startPx);
      this.view.panY = this.pan.panY + (py - this.pan.startPy);
      this.clampView();
      this.draw();
      return;
    }
    const hit = this.hitTest(px, py);
    const key = hit ? `${hit.kind}:${hit.item.cqi ?? hit.item.key}` : null;
    if (key !== this.hover) {
      this.hover = key;
      this.handlers.onHover?.(hit, e);
      this.canvas.style.cursor = hit ? "pointer" : "default";
    } else if (hit) {
      this.handlers.onHover?.(hit, e);
    }
  }

  onUp(e) {
    const { px, py } = this.localPoint(e);
    if (this.pan) {
      const pan = this.pan;
      this.pan = null;
      if (Math.hypot(px - pan.startPx, py - pan.startPy) <= DRAG_THRESHOLD) {
        if (pan.hit) {
          this.selectedKey = `${pan.hit.kind}:${pan.hit.item.cqi ?? pan.hit.item.key}`;
          this.handlers.onSelect?.(pan.hit, e);
        } else {
          this.handlers.onEmptyClick?.(this.project().fromCanvas(px, py), this.imageFraction(px, py), e);
        }
      }
      this.draw();
    }
  }

  onWheel(e) {
    e.preventDefault();
    const { px, py } = this.localPoint(e);
    const before = this.project().fromCanvas(px, py);
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    this.view.zoom = Math.min(Math.max(this.view.zoom * factor, this.minZoom()), MAX_ZOOM);
    const after = this.project().toCanvas(before.x, before.y);
    this.view.panX += px - after.px;
    this.view.panY += py - after.py;
    this.clampView();
    this.draw();
  }

  onContext(e) {
    e.preventDefault();
    const { px, py } = this.localPoint(e);
    const world = this.project().fromCanvas(px, py);
    this.handlers.onContextMenu?.(world, this.hitTest(px, py), e);
  }

  draw() {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const { width, height } = this.size();
    const dpr = globalThis.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#1b2a2e";
    ctx.fillRect(0, 0, width, height);
    const proj = this.project();
    if (this.background) {
      const b = this.background.bounds;
      const tl = this.view.flipY ? proj.toCanvas(b.minX, b.maxY) : proj.toCanvas(b.minX, b.minY);
      const br = this.view.flipY ? proj.toCanvas(b.maxX, b.minY) : proj.toCanvas(b.maxX, b.maxY);
      ctx.drawImage(this.background.image, tl.px, tl.py, br.px - tl.px, br.py - tl.py);
    } else {
      this.drawGrid(ctx, proj, width, height);
    }

    for (const r of this.data.regions) {
      const at = this.at(r);
      if (!Number.isFinite(at.x)) continue;
      this.drawRegion(ctx, proj.toCanvas(at.x, at.y), r, this.selectedKey === `region:${r.key}`);
    }

    for (const ch of this.data.characters) {
      const at = this.at(ch);
      if (!Number.isFinite(at.x)) continue;
      this.drawCharacter(ctx, proj.toCanvas(at.x, at.y), ch, this.selectedKey === `character:${ch.cqi}`);
    }

  }

  drawFlag(ctx, p, factionKey, size, { ring, ringWidth = 2, alpha = 1 } = {}) {
    const img = this.data.flag(factionKey);
    ctx.globalAlpha = alpha;
    ctx.shadowColor = "rgba(0,0,0,.55)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    if (img) {
      ctx.drawImage(img, p.px - size / 2, p.py - size / 2, size, size);
    } else {
      ctx.fillStyle = this.data.colors(factionKey);
      ctx.beginPath(); ctx.arc(p.px, p.py, size / 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    if (ring) {
      ctx.strokeStyle = ring; ctx.lineWidth = ringWidth;
      ctx.beginPath(); ctx.arc(p.px, p.py, size / 2 + 2, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawRegion(ctx, p, r, selected) {
    const size = this.markerSize("region", r);
    // settlements: same flag treatment as armies (no pole), just larger
    this.drawFlag(ctx, p, r.owner, size, { ring: selected ? "#ffd56b" : "rgba(255,255,255,.85)", ringWidth: selected ? 3 : 1.5 });
    if (this.view.zoom >= 1.6) {
      const label = r.name ?? r.key;
      ctx.font = `600 ${Math.round(9 + this.view.zoom * 1.2)}px Inter, Segoe UI, sans-serif`;
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(20,24,26,.85)"; ctx.lineJoin = "round";
      ctx.strokeText(label, p.px + size / 2 + 4, p.py + 4);
      ctx.fillStyle = "rgba(255,248,230,.95)";
      ctx.fillText(label, p.px + size / 2 + 4, p.py + 4);
    }
  }

  drawCharacter(ctx, p, ch, selected, alpha = 1) {
    const size = this.markerSize("character", ch);
    if (ch.is_agent) {
      this.drawFlag(ctx, p, ch.faction, size, { ring: selected ? "#ffd56b" : "rgba(255,255,255,.55)", ringWidth: 1, alpha });
      return;
    }
    // armies/navies: banner pole under the flag; navies get a blue ring
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "rgba(20,24,26,.9)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(p.px, p.py + size / 2); ctx.lineTo(p.px, p.py + size / 2 + 8); ctx.stroke();
    ctx.fillStyle = this.data.colors(ch.faction);
    ctx.beginPath(); ctx.arc(p.px, p.py + size / 2 + 8, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    const ring = selected ? "#ffd56b" : ch.is_navy ? "rgba(90,170,230,.95)" : "rgba(255,255,255,.85)";
    this.drawFlag(ctx, p, ch.faction, size, { ring, ringWidth: selected ? 3 : 1.5, alpha });
  }

  drawGrid(ctx, proj, width, height) {
    ctx.strokeStyle = "rgba(255,255,255,.05)";
    ctx.lineWidth = 1;
    const step = 50;
    const b = this.bounds ?? computeBounds([]);
    for (let x = Math.floor(b.minX / step) * step; x <= b.maxX; x += step) {
      const p = proj.toCanvas(x, b.minY);
      ctx.beginPath(); ctx.moveTo(p.px, 0); ctx.lineTo(p.px, height); ctx.stroke();
    }
    for (let y = Math.floor(b.minY / step) * step; y <= b.maxY; y += step) {
      const p = proj.toCanvas(b.minX, y);
      ctx.beginPath(); ctx.moveTo(0, p.py); ctx.lineTo(width, p.py); ctx.stroke();
    }
  }

}
