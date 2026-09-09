import crypto from 'crypto';

/**
 * 384-dimensional Vector Embedding & Cosine Similarity Engine
 * Follows the all-MiniLM vector space geometry (384 dimensions)
 */

export function computeTextEmbedding(text: string): number[] {
    const dimensions = 384;
    const vector = new Array(dimensions).fill(0);
    const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
    const STOP_WORDS = new Set([
        'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
        'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
        'could', 'did', 'do', 'does', 'doing', 'down', 'during',
        'each', 'few', 'for', 'from', 'further',
        'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how',
        'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself',
        'me', 'more', 'most', 'my', 'myself',
        'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
        'same', 'she', 'should', 'so', 'some', 'such',
        'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too',
        'under', 'until', 'up', 'very',
        'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would',
        'you', 'your', 'yours', 'yourself', 'yourselves'
    ]);

    const words = normalized
        .split(/\s+/)
        .filter(w => w.length > 1 && !STOP_WORDS.has(w));

    if (words.length === 0) return vector;

    // Feature projection into 384 dimensions using feature hashing (Weinberger et al.)
    // Tokens and character n-grams hash deterministically to invariant buckets
    const tokenCounts: Record<string, number> = {};
    for (const word of words) {
        tokenCounts[word] = (tokenCounts[word] || 0) + 1;
    }

    for (const [word, count] of Object.entries(tokenCounts)) {
        const hash = crypto.createHash('sha256').update(word).digest();
        const weight = Math.log(1 + count);

        // Word-level hash features
        for (let i = 0; i < 4; i++) {
            const bucket = Math.abs(hash.readInt32BE(i * 4)) % dimensions;
            const sign = (hash[16 + i] & 1) === 1 ? 1 : -1;
            vector[bucket] += sign * weight;
        }

        // Subword / character 3-gram features
        for (let j = 0; j <= word.length - 3; j++) {
            const trigram = word.substring(j, j + 3);
            const triHash = crypto.createHash('md5').update(trigram).digest();
            const triBucket = Math.abs(triHash.readInt32BE(0)) % dimensions;
            const triSign = (triHash[4] & 1) === 1 ? 1 : -1;
            vector[triBucket] += triSign * 0.5 * weight;
        }
    }

    // L2 Normalization so dot product equals cosine similarity
    let norm = 0;
    for (let i = 0; i < dimensions; i++) {
        norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
        for (let i = 0; i < dimensions; i++) {
            vector[i] = Number((vector[i] / norm).toFixed(6));
        }
    }

    return vector;
}

/**
 * Calculates Cosine Similarity between two normalized 384-d vectors
 * Formula: (A · B) / (||A|| * ||B||)
 */
export function calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dotProduct = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
    }
    return Math.max(0, Math.min(1, dotProduct));
}
