// Shared Total War pack-file (PFH4 / PFH5) layout helpers. No dependencies.
//
// Header (28 bytes, little-endian):
//   char[4] magic            "PFH4" (Rome II / Attila) or "PFH5" (Warhammer+)
//   u32     type_and_flags   low nibble: 0=boot 1=release 2=patch 3=mod 4=movie
//                            flags: 0x40 index-has-timestamps, 0x80 encrypted index,
//                                   0x100 extended header, 0x10 encrypted data
//   u32     pack_file_count  number of dependency pack names that follow the header
//   u32     pack_file_index_size
//   u32     file_count
//   u32     file_index_size
//   u32     timestamp
// PFH5 with flag 0x100 has an extra 20 bytes (unused here).
// Index entry:
//   u32 size, [u32 timestamp if 0x40], [u8 is_compressed if PFH5], path\0 (backslashes)
// Data: raw file bytes concatenated in index order.
import fs from "node:fs";

export const PACK_TYPE = { boot: 0, release: 1, patch: 2, mod: 3, movie: 4 };
export const FLAG_INDEX_TIMESTAMPS = 0x40;
export const FLAG_EXTENDED_HEADER = 0x100;
export const HEADER_SIZE = 28;

export function parseHeader(buf) {
  const magic = buf.toString("latin1", 0, 4);
  if (magic !== "PFH4" && magic !== "PFH5") throw new Error(`Unsupported pack magic ${JSON.stringify(magic)}`);
  const typeAndFlags = buf.readUInt32LE(4);
  const header = {
    magic,
    typeAndFlags,
    type: typeAndFlags & 0xf,
    flags: typeAndFlags & ~0xf,
    packFileCount: buf.readUInt32LE(8),
    packFileIndexSize: buf.readUInt32LE(12),
    fileCount: buf.readUInt32LE(16),
    fileIndexSize: buf.readUInt32LE(20),
    timestamp: buf.readUInt32LE(24),
  };
  header.headerSize = HEADER_SIZE + (magic === "PFH5" && (header.flags & FLAG_EXTENDED_HEADER) ? 20 : 0);
  header.hasIndexTimestamps = Boolean(header.flags & FLAG_INDEX_TIMESTAMPS);
  header.hasCompressionByte = magic === "PFH5";
  return header;
}

function readCString(buf, offset) {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  if (end >= buf.length) throw new Error("Unterminated path string in pack index");
  return { value: buf.toString("latin1", offset, end), next: end + 1 };
}

/** Parse pack headers + index using a file descriptor, without loading the file data. */
export function readPackIndex(path) {
  const fd = fs.openSync(path, "r");
  try {
    const head = Buffer.alloc(HEADER_SIZE + 20);
    fs.readSync(fd, head, 0, head.length, 0);
    const header = parseHeader(head);
    const indexBytes = Buffer.alloc(header.packFileIndexSize + header.fileIndexSize);
    fs.readSync(fd, indexBytes, 0, indexBytes.length, header.headerSize);

    let pos = 0;
    const dependencies = [];
    for (let i = 0; i < header.packFileCount; i++) {
      const { value, next } = readCString(indexBytes, pos);
      dependencies.push(value);
      pos = next;
    }
    if (pos !== header.packFileIndexSize) throw new Error(`pack-file index size mismatch (${pos} != ${header.packFileIndexSize})`);

    const entries = [];
    let dataOffset = header.headerSize + indexBytes.length;
    for (let i = 0; i < header.fileCount; i++) {
      const size = indexBytes.readUInt32LE(pos); pos += 4;
      let timestamp = null;
      if (header.hasIndexTimestamps) { timestamp = indexBytes.readUInt32LE(pos); pos += 4; }
      let compressed = false;
      if (header.hasCompressionByte) { compressed = indexBytes[pos] !== 0; pos += 1; }
      const { value, next } = readCString(indexBytes, pos);
      pos = next;
      entries.push({ path: value, size, timestamp, compressed, offset: dataOffset });
      dataOffset += size;
    }
    if (pos !== indexBytes.length) throw new Error(`file index size mismatch (${pos} != ${indexBytes.length})`);
    const fileSize = fs.fstatSync(fd).size;
    return { header, dependencies, entries, dataEnd: dataOffset, fileSize };
  } finally {
    fs.closeSync(fd);
  }
}

export function readEntry(path, entry) {
  const fd = fs.openSync(path, "r");
  try {
    const buf = Buffer.alloc(entry.size);
    fs.readSync(fd, buf, 0, entry.size, entry.offset);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

/** Build a PFH4 mod pack image in memory. files: [{path, data: Buffer}] (paths may use / or \). */
export function buildPfh4(files, { timestamp = Math.floor(Date.now() / 1000), type = PACK_TYPE.mod } = {}) {
  const normalized = files.map(f => ({ path: f.path.replace(/\//g, "\\"), data: Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data) }));
  const indexParts = normalized.map(f => {
    const size = Buffer.alloc(4); size.writeUInt32LE(f.data.length, 0);
    return Buffer.concat([size, Buffer.from(f.path, "latin1"), Buffer.from([0])]);
  });
  const index = Buffer.concat(indexParts);
  const header = Buffer.alloc(HEADER_SIZE);
  header.write("PFH4", 0, "latin1");
  header.writeUInt32LE(type, 4);
  header.writeUInt32LE(0, 8);
  header.writeUInt32LE(0, 12);
  header.writeUInt32LE(normalized.length, 16);
  header.writeUInt32LE(index.length, 20);
  header.writeUInt32LE(timestamp >>> 0, 24);
  return Buffer.concat([header, index, ...normalized.map(f => f.data)]);
}

/** Parse a whole pack held in memory (used by tests and self-checks). */
export function parsePackBuffer(buf) {
  const header = parseHeader(buf);
  let pos = header.headerSize;
  const dependencies = [];
  for (let i = 0; i < header.packFileCount; i++) { const r = readCString(buf, pos); dependencies.push(r.value); pos = r.next; }
  const entries = [];
  let dataOffset = header.headerSize + header.packFileIndexSize + header.fileIndexSize;
  for (let i = 0; i < header.fileCount; i++) {
    const size = buf.readUInt32LE(pos); pos += 4;
    let timestamp = null;
    if (header.hasIndexTimestamps) { timestamp = buf.readUInt32LE(pos); pos += 4; }
    let compressed = false;
    if (header.hasCompressionByte) { compressed = buf[pos] !== 0; pos += 1; }
    const r = readCString(buf, pos); pos = r.next;
    entries.push({ path: r.value, size, timestamp, compressed, offset: dataOffset, data: buf.subarray(dataOffset, dataOffset + size) });
    dataOffset += size;
  }
  if (dataOffset !== buf.length) throw new Error(`data section mismatch (${dataOffset} != ${buf.length})`);
  return { header, dependencies, entries };
}
