// Browser side of the file bridge. Mirrors the WH2 editor's transport:
//   write  request.json  = { type, request_id, ...args }
//   poll   response.json = { request_id, result }   until request_id matches.
// Directory handles come from the File System Access API (Chromium only).

export const REQUEST_FILE = "request.json";
export const RESPONSE_FILE = "response.json";

export function parseResponse(text) {
  if (typeof text !== "string" || text.trim() === "") throw new Error("response.json is empty");
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || !("request_id" in value)) throw new Error("response.json lacks request_id");
  return value;
}

/** sent_at (Unix seconds) lets a freshly started session tell a waiting request from a stale one. */
export function buildRequest(type, args, requestId, sentAt) {
  if (typeof type !== "string" || !type) throw new Error("request type is required");
  if (!Number.isInteger(requestId) || requestId <= 0) throw new Error("request_id must be a positive integer");
  const reserved = Object.keys(args ?? {}).filter(k => k === "type" || k === "request_id" || k === "sent_at");
  if (reserved.length) throw new Error(`argument may not be named ${reserved.join(", ")}`);
  const request = { ...(args ?? {}), type, request_id: requestId };
  if (sentAt !== undefined) request.sent_at = sentAt;
  return request;
}

/** Result from a mutation handler: { ok: boolean, error?: string, ...fields }. */
export function assertOk(result, what) {
  if (result && result.ok === false) throw new Error(`${what}: ${result.error ?? "rejected by game"}`);
  return result;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const DEFAULT_HINTS = {
  timeout: () => "the game is not responding. Keep the campaign map open and unpaused, then click Refresh.",
  stopped: () => "the game has left the campaign map (main menu, battle or loading). Return to the campaign, then click Refresh.",
};

/** The bridge writes {request_id:0,result:{status:"stopped"}} when the campaign UI goes away. */
export function isStoppedMarker(value) {
  return Boolean(value && value.request_id === 0 && value.result && value.result.status === "stopped");
}

export class FileBridge {
  /**
   * @param {FileSystemDirectoryHandle} directory
   * @param {{interval?: number, retries?: number, sleep?: (ms:number)=>Promise<void>, now?: () => number,
   *          hints?: {timeout?: () => string, stopped?: () => string}}} [options]
   */
  constructor(directory, options = {}) {
    this.directory = directory;
    this.interval = options.interval ?? 100;
    // 12 s: the game only reads requests while the campaign clock runs, and a busy turn can stall it.
    this.retries = options.retries ?? 120;
    this.sleep = options.sleep ?? sleep;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.hints = { ...DEFAULT_HINTS, ...options.hints };
    this.nextId = Math.floor(Date.now() / 1000) % 100000 * 10 + 1; // never collides with a stale response.json
    this.queue = Promise.resolve();
    this.stopped = false;
  }

  async readResponseText() {
    const handle = await this.directory.getFileHandle(RESPONSE_FILE);
    return (await handle.getFile()).text();
  }

  /** The bridge writes {request_id:0,result:{status:"ready",...}} when a campaign finishes loading. */
  async readReadyMarker() {
    try {
      const value = parseResponse(await this.readResponseText());
      return value.result && value.result.status === "ready" ? value.result : null;
    } catch {
      return null;
    }
  }

  /**
   * The ready marker only survives until the game answers its first request, so a campaign that
   * has already been used is detected by asking for a heartbeat instead.
   */
  async isAlive() {
    if (await this.readReadyMarker()) return true;
    try {
      const beat = await this.request("heartbeat");
      return Boolean(beat && beat.ok !== false);
    } catch {
      return false;
    }
  }

  async writeRequest(payload) {
    const handle = await this.directory.getFileHandle(REQUEST_FILE, { create: true });
    const writer = await handle.createWritable();
    await writer.write(JSON.stringify(payload));
    await writer.close();
  }

  /** Requests are serialised: the game answers one request_id at a time. */
  request(type, args) {
    const run = () => this.exchange(type, args);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  async exchange(type, args) {
    const requestId = this.nextId++;
    await this.writeRequest(buildRequest(type, args, requestId, this.now()));
    for (let attempt = 0; attempt < this.retries; attempt++) {
      await this.sleep(this.interval);
      let value;
      try {
        value = parseResponse(await this.readResponseText());
      } catch {
        continue;                                  // game is mid-write; try again
      }
      if (value.request_id === requestId) {
        this.stopped = false;
        return value.result;
      }
      if (isStoppedMarker(value)) {
        this.stopped = true;
        throw new Error(`${type} (#${requestId}): ${this.hints.stopped()}`);
      }
    }
    this.stopped = false;
    throw new Error(`no answer for ${type} (#${requestId}) within ${(this.interval * this.retries) / 1000}s - ${this.hints.timeout()}`);
  }
}

export function supportsFileSystemAccess(win = globalThis) {
  return typeof win.showDirectoryPicker === "function";
}

/**
 * Reuse the folder granted last time. `forcePick` is the "change folder" path.
 * A stale handle (the folder was deleted) falls through to the picker.
 */
export async function chooseDirectory({ saved, requestPermission, pick, forcePick = false }) {
  if (!forcePick && saved) {
    try {
      if (await requestPermission(saved) === "granted") return saved;
    } catch { /* handle no longer resolves */ }
  }
  return pick();
}

/** A stored folder the browser still allows without a click. Anything else waits for the Connect button. */
export async function reusableDirectory(saved, queryPermission) {
  if (!saved) return null;
  try {
    return await queryPermission(saved) === "granted" ? saved : null;
  } catch {
    return null;
  }
}
