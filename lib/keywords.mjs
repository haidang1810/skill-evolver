// Simple TF-IDF keyword extraction from correction/follow-up messages
// No external dependencies — pure implementation

// Common English stop words to filter out
const STOP_WORDS = new Set([
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it', 'its',
  'they', 'them', 'their', 'this', 'that', 'these', 'those', 'is', 'am',
  'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do',
  'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can',
  'shall', 'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'not', 'no', 'so',
  'if', 'then', 'than', 'too', 'very', 'just', 'about', 'also', 'of', 'in',
  'on', 'at', 'to', 'for', 'with', 'from', 'by', 'as', 'into', 'like',
  'through', 'after', 'before', 'between', 'out', 'up', 'down', 'here',
  'there', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both',
  'few', 'more', 'most', 'some', 'any', 'such', 'only', 'own', 'same',
  'what', 'which', 'who', 'whom',
]);

/**
 * Tokenize text into lowercase words, filtering stop words and short tokens.
 */
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Extract top keywords from an array of messages using TF-IDF.
 * @param {string[]} messages - Array of correction/follow-up message texts
 * @param {number} topN - Number of top keywords to return
 * @returns {{ keyword: string, count: number, score: number, pct: number }[]}
 */
export function extractKeywords(messages, topN = 10) {
  if (!messages || messages.length === 0) return [];

  const totalDocs = messages.length;

  // Term frequency across all docs
  const globalTf = new Map();
  // Document frequency (how many docs contain the term)
  const df = new Map();

  for (const msg of messages) {
    const tokens = tokenize(msg);
    const seen = new Set();

    for (const token of tokens) {
      globalTf.set(token, (globalTf.get(token) || 0) + 1);
      if (!seen.has(token)) {
        df.set(token, (df.get(token) || 0) + 1);
        seen.add(token);
      }
    }
  }

  // Calculate TF-IDF scores
  const scored = [];
  for (const [term, tf] of globalTf) {
    const idf = Math.log(totalDocs / (df.get(term) || 1));
    // For very small corpora, boost terms that appear in multiple docs
    const multiDocBoost = (df.get(term) || 0) > 1 ? 1.5 : 1.0;
    scored.push({ keyword: term, count: tf, score: tf * idf * multiDocBoost });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topN);

  // Calculate percentages relative to total messages
  for (const item of top) {
    item.pct = Math.round((item.count / totalDocs) * 100);
  }

  return top;
}

/**
 * Group similar keywords into clusters using prefix matching.
 * E.g., "security", "secure", "secrets" → "security/secure/secrets"
 * @param {{ keyword: string, count: number, pct: number }[]} keywords
 * @returns {{ cluster: string, count: number, pct: number }[]}
 */
export function clusterKeywords(keywords) {
  if (keywords.length === 0) return [];

  const clusters = [];
  const used = new Set();

  for (let i = 0; i < keywords.length; i++) {
    if (used.has(i)) continue;

    const group = [keywords[i].keyword];
    let totalCount = keywords[i].count;
    let maxPct = keywords[i].pct;
    used.add(i);

    // Find similar keywords (share 4+ char prefix)
    for (let j = i + 1; j < keywords.length; j++) {
      if (used.has(j)) continue;
      if (sharePrefix(keywords[i].keyword, keywords[j].keyword, 4)) {
        group.push(keywords[j].keyword);
        totalCount += keywords[j].count;
        maxPct = Math.max(maxPct, keywords[j].pct);
        used.add(j);
      }
    }

    clusters.push({
      cluster: group.join('/'),
      count: totalCount,
      pct: maxPct,
    });
  }

  clusters.sort((a, b) => b.count - a.count);
  return clusters;
}

function sharePrefix(a, b, minLen) {
  const len = Math.min(a.length, b.length, minLen);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return false;
  }
  return len >= minLen;
}
