'use strict';

// documentText unit tests — pins docs/spec/server/infrastructure/vectorMath.md §4.2.
// RED-first: written before the module exists (AGENTS §2.1).

const zlib = require('zlib');

const { extractText } = require('../documentText');

// --- fixture builders (deterministic; no fixture files shipped) ---

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Minimal ZIP writer (deflate entries) — enough for a docx container fixture.
function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const deflated = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, deflated);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0x21, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(deflated.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + deflated.length;
  }
  const cdStart = offset;
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, cd, eocd]);
}

const DOCX_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:body>' +
  '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Hel</w:t><w:t>lo again</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>A &amp; B &lt;tag&gt;</w:t></w:r></w:p>' +
  '</w:body></w:document>';

function buildPdf(pageTexts) {
  // Object layout: 1 catalog, 2 pages, 3 font, then per page: page obj + content obj.
  const bodies = [];
  const nPages = pageTexts.length;
  const kids = [];
  for (let i = 0; i < nPages; i++) {
    const pageId = 4 + i * 2;
    const contentId = 5 + i * 2;
    kids.push(`${pageId} 0 R`);
    bodies[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R ` +
      '/Resources << /Font << /F1 3 0 R >> >> >>';
    const stream = `BT /F1 12 Tf 72 720 Td (${pageTexts[i]}) Tj ET`;
    bodies[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  bodies[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  bodies[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${nPages} >>`;
  bodies[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let id = 1; id < bodies.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${bodies[id]}\nendobj\n`;
  }
  const xrefOffset = out.length;
  const size = bodies.length; // highest object id + 1
  out += `xref\n0 ${size}\n`;
  out += '0000000000 65535 f \n';
  for (let id = 1; id < size; id++) {
    out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer << /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(out, 'utf8');
}

// --- tests ---

describe('extractText (bytes → text)', () => {
  it('decodes text/* as UTF-8 plain', async () => {
    await expect(
      extractText({ buffer: Buffer.from('résumé text', 'utf8'), mimeType: 'text/plain' })
    ).resolves.toEqual({
      text: 'résumé text',
      extractor: 'plain',
    });
  });

  it('decodes application/json as plain', async () => {
    await expect(
      extractText({ buffer: Buffer.from('{"a":1}'), mimeType: 'application/json' })
    ).resolves.toEqual({
      text: '{"a":1}',
      extractor: 'plain',
    });
  });

  it('extracts pdf page text in page order', async () => {
    const pdf = buildPdf(['First page words.', 'Second page words.']);
    const result = await extractText({ buffer: pdf, mimeType: 'application/pdf' });
    expect(result.extractor).toBe('pdf');
    expect(result.text).toContain('First page words.');
    expect(result.text).toContain('Second page words.');
    expect(result.text.indexOf('First page words.')).toBeLessThan(
      result.text.indexOf('Second page words.')
    );
  });

  it('extracts docx paragraphs joined by newlines, runs concatenated', async () => {
    const docx = buildZip([
      ['[Content_Types].xml', '<Types/>'],
      ['word/document.xml', DOCX_XML],
    ]);
    const result = await extractText({
      buffer: docx,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    expect(result.extractor).toBe('docx');
    expect(result.text).toBe('Hello\nHello again\nA & B <tag>');
  });

  it('is deterministic for identical bytes', async () => {
    const pdf = buildPdf(['Same bytes.']);
    const a = await extractText({ buffer: pdf, mimeType: 'application/pdf' });
    const b = await extractText({ buffer: pdf, mimeType: 'application/pdf' });
    expect(b).toEqual(a);
  });

  it('rejects unextractable mimes with the typed skip code', async () => {
    await expect(
      extractText({ buffer: Buffer.from('BIN'), mimeType: 'application/octet-stream' })
    ).rejects.toThrow(expect.objectContaining({ code: 'unextractableText' }));
    await expect(
      extractText({ buffer: Buffer.from('\x89PNG'), mimeType: 'image/png' })
    ).rejects.toThrow(expect.objectContaining({ code: 'unextractableText' }));
  });
});
