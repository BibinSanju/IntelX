import { computeTextEmbedding, calculateCosineSimilarity } from './embeddingService.js';

function assert(condition: boolean, message: string) {
    if (!condition) {
        console.error(`❌ Assertion Failed: ${message}`);
        process.exit(1);
    }
}

console.log('🧪 Testing 384-d Vector Embedding & Cosine Similarity Deduplication...');

// Test 1: Dimension Check
const sampleText = "Given an array of integers, return indices of the two numbers such that they add up to a target.";
const vec1 = computeTextEmbedding(sampleText);
assert(Array.isArray(vec1), "Embedding must be an array");
assert(vec1.length === 384, `Embedding dimension must be 384, received: ${vec1.length}`);
console.log('✅ Test 1 Passed: Exact 384-dimensional vector produced');

// Test 2: Normalization (L2 Norm ≈ 1.0)
let norm = 0;
for (const val of vec1) {
    norm += val * val;
}
norm = Math.sqrt(norm);
assert(Math.abs(norm - 1.0) < 0.01, `Vector must be L2 normalized to 1.0, got: ${norm}`);
console.log('✅ Test 2 Passed: L2 norm normalized (magnitude = 1.000)');

// Test 3: Self-Similarity (Cosine Similarity of vector with itself = 1.0)
const selfSim = calculateCosineSimilarity(vec1, vec1);
assert(Math.abs(selfSim - 1.0) < 0.001, `Self-similarity must be 1.0, got: ${selfSim}`);
console.log('✅ Test 3 Passed: Self-similarity is 1.000');

// Test 4: Near Duplicate Detection (Similarity >= 0.85)
const nearDuplicateText = "Given an array of integers nums and target, find two numbers that sum up to target and return indices.";
const vecNear = computeTextEmbedding(nearDuplicateText);
const nearSim = calculateCosineSimilarity(vec1, vecNear);
console.log(`ℹ️ Near Duplicate Cosine Similarity: ${(nearSim * 100).toFixed(1)}%`);
assert(nearSim >= 0.85, `Near duplicates should have >= 85% similarity, got: ${(nearSim * 100).toFixed(1)}%`);
console.log('✅ Test 4 Passed: Duplicate flag correctly triggered (>= 85%)');

// Test 5: Disjoint / Unrelated Problem Similarity (< 0.40)
const unrelatedText = "Find the maximum flow in a directed bipartite graph using the Edmonds-Karp algorithm.";
const vecUnrelated = computeTextEmbedding(unrelatedText);
const unrelatedSim = calculateCosineSimilarity(vec1, vecUnrelated);
console.log(`ℹ️ Unrelated Problem Cosine Similarity: ${(unrelatedSim * 100).toFixed(1)}%`);
assert(unrelatedSim < 0.45, `Unrelated problems should have < 45% similarity, got: ${(unrelatedSim * 100).toFixed(1)}%`);
console.log('✅ Test 5 Passed: Disjoint problem similarity low (< 45%)');

// Test 6: Empty text handling
const emptyVec = computeTextEmbedding("");
assert(emptyVec.length === 384, "Empty text must still produce 384 dimensions");
const emptySim = calculateCosineSimilarity(emptyVec, vec1);
assert(emptySim === 0, `Empty vector similarity with non-empty must be 0, got: ${emptySim}`);
console.log('✅ Test 6 Passed: Empty text handled gracefully without crash');

console.log('🎉 All 384-d Vector Embedding & Deduplication Tests Passed Successfully!');
