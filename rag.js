import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Extract character n-grams with word boundaries (equivalent to scikit-learn char_wb).
 * Splits text into words, pads each word with space, and generates n-grams from minN to maxN.
 */
function extractCharWbNgrams(text, minN = 3, maxN = 5) {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const ngrams = [];
  for (const word of words) {
    const padded = ` ${word} `;
    for (let n = minN; n <= maxN; n++) {
      if (padded.length < n) continue;
      for (let i = 0; i <= padded.length - n; i++) {
        ngrams.push(padded.slice(i, i + n));
      }
    }
  }
  return ngrams;
}

function resolveKnowledgeFolder(folder) {
  if (folder && fs.existsSync(folder)) return folder;
  const cwdFolder = path.join(process.cwd(), "knowledge");
  if (fs.existsSync(cwdFolder)) return cwdFolder;
  const dirFolder = path.join(__dirname, "knowledge");
  if (fs.existsSync(dirFolder)) return dirFolder;
  return folder || dirFolder;
}

export class Retriever {
  constructor(folder = null) {
    const targetFolder = resolveKnowledgeFolder(folder);
    this.chunks = []; // { source, title, text }
    this.vocab = new Map(); // ngram -> index
    this.idf = [];
    this.docVectors = [];

    if (!fs.existsSync(targetFolder)) {
      console.warn("Knowledge folder not found:", targetFolder);
      return;
    }

    const files = fs.readdirSync(targetFolder).filter(f => f.endsWith(".md") || f.endsWith(".txt")).sort();

    for (const file of files) {
      const fullPath = path.join(targetFolder, file);
      const raw = fs.readFileSync(fullPath, "utf-8");
      // Split on "\n## " or beginning of file with "## "
      const parts = raw.split(/\n(?=## )/);
      for (const p of parts) {
        const trimmed = p.trim();
        if (trimmed.length < 40) continue;
        const firstLine = trimmed.split("\n")[0] || "";
        const title = firstLine.replace(/^#+\s*/, "").trim();
        this.chunks.push({
          source: file,
          title,
          text: trimmed,
        });
      }
    }

    this._buildIndex();
  }

  _buildIndex() {
    if (this.chunks.length === 0) return;

    const N = this.chunks.length;
    const docTermFreqs = [];
    const docFreq = new Map();

    for (let i = 0; i < N; i++) {
      const ngrams = extractCharWbNgrams(this.chunks[i].text);
      const tfMap = new Map();
      for (const ng of ngrams) {
        tfMap.set(ng, (tfMap.get(ng) || 0) + 1);
      }
      docTermFreqs.push(tfMap);

      for (const ng of tfMap.keys()) {
        docFreq.set(ng, (docFreq.get(ng) || 0) + 1);
      }
    }

    // Build vocabulary
    let idx = 0;
    for (const [ng] of docFreq.entries()) {
      this.vocab.set(ng, idx++);
    }

    // Compute smoothed IDF: log((1 + N) / (1 + df)) + 1
    this.idf = new Float64Array(this.vocab.size);
    for (const [ng, i] of this.vocab.entries()) {
      const df = docFreq.get(ng) || 0;
      this.idf[i] = Math.log((1 + N) / (1 + df)) + 1.0;
    }

    // Build TF-IDF vectors for documents with sublinear TF & L2 normalization
    this.docVectors = docTermFreqs.map(tfMap => this._vectorize(tfMap));
  }

  _vectorize(tfMap) {
    const vec = new Map();
    let normSq = 0;

    for (const [term, count] of tfMap.entries()) {
      const idx = this.vocab.get(term);
      if (idx !== undefined) {
        // sublinear tf: 1 + log(tf)
        const tf = 1 + Math.log(count);
        const weight = tf * this.idf[idx];
        vec.set(idx, weight);
        normSq += weight * weight;
      }
    }

    const norm = Math.sqrt(normSq);
    if (norm > 0) {
      for (const [idx, weight] of vec.entries()) {
        vec.set(idx, weight / norm);
      }
    }

    return vec;
  }

  _vectorizeQuery(query) {
    const ngrams = extractCharWbNgrams(query);
    const tfMap = new Map();
    for (const ng of ngrams) {
      tfMap.set(ng, (tfMap.get(ng) || 0) + 1);
    }
    return this._vectorize(tfMap);
  }

  search(query, k = 3, minScore = 0.06) {
    if (!query || !query.trim() || this.docVectors.length === 0) {
      return [];
    }

    const qVec = this._vectorizeQuery(query);
    if (qVec.size === 0) {
      return [];
    }

    const results = [];
    for (let i = 0; i < this.docVectors.length; i++) {
      const dVec = this.docVectors[i];
      let sim = 0;

      // Cosine similarity of normalized vectors is the dot product
      for (const [termIdx, qWeight] of qVec.entries()) {
        const dWeight = dVec.get(termIdx);
        if (dWeight !== undefined) {
          sim += qWeight * dWeight;
        }
      }

      if (sim >= minScore) {
        results.push({
          source: this.chunks[i].source,
          title: this.chunks[i].title,
          text: this.chunks[i].text,
          score: sim,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }
}
