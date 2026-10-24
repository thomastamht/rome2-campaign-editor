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

export function buildRequest(type, args, requestId) {
  if (typeof type !== "string" || !type) throw new Error("request type is required");
  if (!Number.isInteger(requestId) || requestId <= 0) throw new Error("request_id must be a positive integer");
  const reserved = Object.keys(args ?? {}).filter(k => k === "type" || k === "request_id");
  if (reserved.length) throw new Error(`argument may not be named ${reserved.join(", ")}`);
  return { ...(args ?? {}), type, request_id: requestId };
}

/** Result from a mutation handler: { ok: boolean, error?: string, ...fields }. */
export function assertOk(result, what) {
  if (result && result.ok === false) throw new Error(`${what}: ${result.error ?? "rejected by game"}`);
  return result;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export class FileBridge {
  /**
   * @param {FileSystemDirectoryHandle} directory
   * @param {{interval?: number, retries?: number, sleep?: (ms:number)=>Promise<void>}} [options]
   */
  constructor(directory, options = {}) {
    this.directory = directory;
    this.interval = options.interval ?? 100;
    this.retries = options.retries ?? 40;      // 4 s; get_active_characters on a big DEI map takes a few ticks
    this.sleep = options.sleep ?? sleep;
    this.nextId = Math.floor(Date.now() / 1000) % 100000 * 10 + 1; // never collides with a stale response.json
    this.queue = Promise.resolve();
    this.lastError = null;
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
    await this.writeRequest(buildRequest(type, args, requestId));
    for (let attempt = 0; attempt < this.retries; attempt++) {
      await this.sleep(this.interval);
      let value;
      try {
        value = parseResponse(await this.readResponseText());
      } catch {
        continue;                                  // game is mid-write; try again
      }
      if (value.request_id === requestId) {
        this.lastError = null;
        return value.result;
      }
    }
    this.lastError = `no answer for ${type} (#${requestId}) within ${(this.interval * this.retries) / 1000}s`;
    throw new Error(this.lastError + " - is the campaign loaded with the mod enabled?");
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
