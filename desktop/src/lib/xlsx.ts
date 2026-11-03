// minimal .xlsx reader for the excel viewer: unzip + xml, cell values only.
// no styles, formulas, merges or dates (date cells come back as serial numbers).

export type XlsxSheet = {
  name: string;
  data: (string | number)[][];
};

type ZipEntry = { name: string; method: number; compressedSize: number; offset: number };

const CENTRAL_DIR_SIG = 0x02014b50;
const END_OF_CENTRAL_SIG = 0x06054b50;
const LOCAL_HEADER_SIG = 0x04034b50;

function readCentralDirectory(buf: Uint8Array<ArrayBuffer>): ZipEntry[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // end of central directory record is at the tail, before an optional comment (<= 65535 bytes)
  const minEnd = Math.max(0, buf.length - 22 - 65535);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minEnd; i--) {
    if (view.getUint32(i, true) === END_OF_CENTRAL_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = view.getUint16(eocd + 10, true);
  let pos = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(pos, true) !== CENTRAL_DIR_SIG) throw new Error('bad zip central directory');
    const method = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const offset = view.getUint32(pos + 42, true);
    const name = decoder.decode(buf.subarray(pos + 46, pos + 46 + nameLen));
    entries.push({ name, method, compressedSize, offset });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(controller) { controller.enqueue(data); controller.close(); },
  });
  const stream = source.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readEntry(buf: Uint8Array<ArrayBuffer>, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint32(entry.offset, true) !== LOCAL_HEADER_SIG) throw new Error(`bad zip entry ${entry.name}`);
  const nameLen = view.getUint16(entry.offset + 26, true);
  const extraLen = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return inflateRaw(raw);
  throw new Error(`unsupported zip compression ${entry.method} in ${entry.name}`);
}

export async function unzip(buf: Uint8Array<ArrayBuffer>): Promise<Map<string, () => Promise<string>>> {
  const files = new Map<string, () => Promise<string>>();
  const decoder = new TextDecoder();
  for (const entry of readCentralDirectory(buf)) {
    files.set(entry.name, async () => decoder.decode(await readEntry(buf, entry)));
  }
  return files;
}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error('malformed xml in workbook');
  return doc;
}

function descendants(node: Document | Element, localName: string): Element[] {
  return Array.from(node.getElementsByTagNameNS('*', localName));
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, body: string) => {
    if (body[0] === '#') return String.fromCodePoint(parseInt(body[1] === 'x' ? body.slice(2) : body.slice(1), body[1] === 'x' ? 16 : 10));
    return ENTITIES[body] ?? m;
  });
}

// sheet and shared-string xml are parsed with regexes instead of a dom: the
// element set is fixed and flat, and dom parsing was ~20x slower on 5k-row sheets.
// tag matching is namespace-tolerant (<x:t>, <ns0:c>).
const TEXT_RE = /<(?:\w+:)?t(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?t>|<(?:\w+:)?t(?:\s[^>]*)?\/>/g;
const SI_RE = /<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g;
const ROW_RE = /<(?:\w+:)?row(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?row>/g;
const CELL_RE = /<(?:\w+:)?c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
const VALUE_RE = /<(?:\w+:)?v(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?v>/;

// plain <t> or rich-text runs <r><t>: concatenate every text node
function richText(inner: string): string {
  let out = '';
  for (const m of inner.matchAll(TEXT_RE)) out += decodeEntities(m[1] ?? '');
  return out;
}

export function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(SI_RE)) out.push(richText(m[1]));
  return out;
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : undefined;
}

function normalizeTarget(target: string): string {
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const parts: string[] = [];
  for (const p of path.split('/')) {
    if (p === '..') parts.pop();
    else if (p !== '.' && p !== '') parts.push(p);
  }
  return parts.join('/');
}

export function columnIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

function cellValue(attrs: string, inner: string, shared: string[]): string | number {
  const type = attr(attrs, 't');
  if (type === 'inlineStr') return richText(inner);
  const v = decodeEntities(VALUE_RE.exec(inner)?.[1] ?? '');
  switch (type) {
    case 's': return shared[Number(v)] ?? '';
    case 'b': return v === '1' ? 'TRUE' : 'FALSE';
    case 'str':
    case 'e': return v;
    default: {
      if (v === '') return '';
      const num = Number(v);
      return Number.isNaN(num) ? v : num;
    }
  }
}

export function parseSheetXml(xml: string, shared: string[]): (string | number)[][] {
  const rows: (string | number)[][] = [];
  for (const row of xml.matchAll(ROW_RE)) {
    const cells: (string | number)[] = [];
    let col = 0;
    for (const c of row[1].matchAll(CELL_RE)) {
      const attrs = c[1] ?? '';
      const ref = attr(attrs, 'r');
      const idx = ref ? columnIndex(ref) : col;
      while (cells.length < idx) cells.push('');
      cells[idx] = cellValue(attrs, c[2] ?? '', shared);
      col = idx + 1;
    }
    if (cells.some(v => v !== '')) rows.push(cells);
  }
  return rows;
}

export async function readXlsx(bytes: Uint8Array<ArrayBuffer>): Promise<XlsxSheet[]> {
  const files = await unzip(bytes);
  const read = async (name: string) => {
    const f = files.get(name);
    if (!f) throw new Error(`missing ${name}`);
    return f();
  };

  const workbook = parseXml(await read('xl/workbook.xml'));
  const rels = parseXml(await read('xl/_rels/workbook.xml.rels'));
  const relTargets = new Map<string, string>();
  for (const rel of descendants(rels, 'Relationship')) {
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    if (id && target) relTargets.set(id, normalizeTarget(target));
  }

  const sst = files.get('xl/sharedStrings.xml');
  const shared = sst ? parseSharedStrings(await sst()) : [];

  const sheets: XlsxSheet[] = [];
  for (const sheet of descendants(workbook, 'sheet')) {
    const name = sheet.getAttribute('name') ?? `Sheet${sheets.length + 1}`;
    const relId = sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
      ?? sheet.getAttribute('r:id');
    const target = relId ? relTargets.get(relId) : undefined;
    if (!target || !files.has(target)) continue;
    sheets.push({ name, data: parseSheetXml(await read(target), shared) });
  }
  return sheets;
}
