'use strict';

// documentText — local text extraction (vectorMath.md §4.2): the embed
// pipeline's first step, turning file bytes into plain text. Pure and
// deterministic: identical bytes ⇒ identical text. No OCR.
//
// Extractors: plain text (text/*, JSON) via UTF-8 decode; PDF via
// pdfjs-dist (lazy ESM import; text layer only); docx via the ZIP
// container + word/document.xml paragraph text. Everything else throws
// `unextractableText` (worker maps it to markSkipped — aiJobService.md §2.3).

const zlib = require('zlib');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function codeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function unextractable(mimeType) {
  return codeError('unextractableText', `no local text extractor for ${mimeType}`);
}

// --- plain ---

function extractPlain(buffer) {
  return { text: buffer.toString('utf8'), extractor: 'plain' };
}

// --- pdf (pdfjs-dist, text layer) ---

let pdfjsPromise = null;

function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsPromise;
}

async function extractPdf(buffer) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useWorkerFetch: false,
  }).promise;
  const pages = [];
  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo);
    const content = await page.getTextContent();
    let pageText = '';
    for (const item of content.items) {
      pageText += item.str;
      if (item.hasEOL) pageText += '\n';
    }
    pages.push(pageText);
  }
  return { text: pages.join('\n'), extractor: 'pdf' };
}

// --- docx (ZIP container + word/document.xml) ---

function findEocd(buf) {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function readZipEntry(buf, eocd) {
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name === 'word/document.xml') {
      if (buf.readUInt32LE(localOffset) !== 0x04034b50) return null;
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(dataStart, dataStart + compressedSize);
      return method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
    }
  }
  return null;
}

const XML_ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };

function decodeXmlEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m]);
}

function extractDocx(buffer) {
  const eocd = findEocd(buffer);
  if (eocd === -1) throw codeError('unextractableText', 'docx is not a ZIP container');
  const xml = readZipEntry(buffer, eocd);
  if (xml === null) throw codeError('unextractableText', 'docx has no word/document.xml');
  const docXml = xml.toString('utf8');
  const paragraphs = [];
  const paraRe = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let paraMatch;
  while ((paraMatch = paraRe.exec(docXml)) !== null) {
    let text = '';
    const runRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    let runMatch;
    while ((runMatch = runRe.exec(paraMatch[0])) !== null) {
      text += decodeXmlEntities(runMatch[1]);
    }
    if (text) paragraphs.push(text);
  }
  return { text: paragraphs.join('\n'), extractor: 'docx' };
}
// --- dispatch ---

/**
 * bytes → plain text. `{ buffer, mimeType }` ⇒ `{ text, extractor }`.
 * Unknown mime types throw `unextractableText`.
 */
async function extractText({ buffer, mimeType }) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('text/') || mime === 'application/json') {
    return extractPlain(buffer);
  }
  if (mime === 'application/pdf') {
    return extractPdf(buffer);
  }
  if (mime === DOCX_MIME) {
    return extractDocx(buffer);
  }
  throw unextractable(mime);
}

module.exports = { extractText };
