'use strict';

// textChunking — the pure segmentation ladder behind the embed pipeline
// (vectorMath.md §4.3; the chunk-pool ladder of collections-platform.md §4.3).
// Budget VALUES are caller-supplied; this module owns only the segmentation.

const HEADING_RE = /^#{1,6}[ \t]/;

/**
 * Paragraph/heading segmentation: blank-line-separated paragraphs; a
 * heading-style line forms its own segment boundary. Whitespace-only gaps
 * vanish; segments are trimmed. Intra-paragraph line breaks stay inside one
 * segment.
 */
function splitSegments(text) {
  const out = [];
  for (const block of String(text).split(/\n[ \t\r]*\n+/)) {
    let cur = [];
    const flush = () => {
      const joined = cur.join('\n').trim();
      if (joined) out.push(joined);
      cur = [];
    };
    for (const line of block.split('\n')) {
      if (HEADING_RE.test(line)) {
        flush();
        const heading = line.trim();
        if (heading) out.push(heading);
      } else {
        cur.push(line);
      }
    }
    flush();
  }
  return out;
}

/**
 * Fixed-size char windows with a shorter tail — the ladder fallback.
 */
function charWindows(text, maxChars) {
  const out = [];
  for (let i = 0; i < text.length; i += maxChars) {
    out.push(text.slice(i, i + maxChars));
  }
  return out;
}

/**
 * The chunk-pool ladder: paragraph/heading segmentation first; a segment
 * longer than maxChunkChars falls back to char windows; when more chunks
 * than chunkBudget remain, a uniform-stride sample of exactly chunkBudget
 * chunks is returned (first and last chunk always included) and
 * `sampled: true` is reported.
 */
function chunkPool(text, { maxChunkChars, chunkBudget }) {
  const chunks = [];
  for (const segment of splitSegments(text)) {
    if (segment.length <= maxChunkChars) {
      chunks.push(segment);
    } else {
      chunks.push(...charWindows(segment, maxChunkChars));
    }
  }
  if (chunks.length <= chunkBudget) {
    return { chunks, sampled: false };
  }
  const budget = Math.max(1, chunkBudget);
  const sampled = [];
  if (budget === 1) {
    sampled.push(chunks[0]);
  } else {
    for (let j = 0; j < budget; j++) {
      const idx = Math.round((j * (chunks.length - 1)) / (budget - 1));
      sampled.push(chunks[idx]);
    }
  }
  return { chunks: sampled, sampled: true };
}

module.exports = { splitSegments, charWindows, chunkPool };
