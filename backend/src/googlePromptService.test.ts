import assert from 'node:assert/strict';
import {
  createGeminiProblemBrief,
  parseGeminiJson,
  resolveGoogleAiApiKey,
} from './googlePromptService.js';

assert.equal(
  resolveGoogleAiApiKey({ GOOGLE_API_KEY: 'google-key', GEMINI_API_KEY: 'gemini-key' } as NodeJS.ProcessEnv),
  'google-key',
);
assert.equal(
  resolveGoogleAiApiKey({ GEMINI_API_KEY: '"gemini-key"' } as NodeJS.ProcessEnv),
  'gemini-key',
);

const parsed = parseGeminiJson(`\`\`\`json
{
  "summary": "Find two values.",
  "normalizedProblem": "Given an array and target, return matching indices.",
  "keyRequirements": ["One pair exists"],
  "likelyTags": ["Array", "Hash Table"],
  "inferredHints": ["Track complements"],
  "searchQuery": "two sum"
}
\`\`\``);
assert.equal(parsed.searchQuery, 'two sum');
assert.equal(parsed.contentType, 'programming');
assert.deepEqual(parsed.likelyTags, ['Array', 'Hash Table']);

let requestUrl = '';
let requestHeaders: HeadersInit | undefined;
const mockFetch: typeof fetch = async (input, init) => {
  requestUrl = String(input);
  requestHeaders = init?.headers;
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(parsed) }] } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const result = await createGeminiProblemBrief(
  { rawText: '<p>Two sum</p>', studentTags: ['Array'], studentHints: ['Use O(n)'] },
  { apiKey: 'test-key', model: 'gemini-test', fetchImpl: mockFetch },
);
assert.equal(result.model, 'gemini-test');
assert.match(requestUrl, /gemini-test:generateContent$/);
assert.equal((requestHeaders as Record<string, string>)['x-goog-api-key'], 'test-key');

let theoryRequestBody = '';
const theoryFetch: typeof fetch = async (_input, init) => {
  theoryRequestBody = String(init?.body || '');
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({
      ...parsed,
      summary: 'Database normalization interview question.',
      normalizedProblem: 'Explain database normalization and normal forms.',
      searchQuery: 'database normalization normal forms',
    }) }] } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
await createGeminiProblemBrief(
  { rawText: 'What is normalization?', contentType: 'theory', studentTags: ['DBMS'] },
  { apiKey: 'test-key', model: 'gemini-test', fetchImpl: theoryFetch },
);
assert.match(theoryRequestBody, /theory interview question with reference material/);
assert.match(theoryRequestBody, /concepts a strong answer should cover/);

let autoRequestBody = '';
const autoFetch: typeof fetch = async (_input, init) => {
  autoRequestBody = String(init?.body || '');
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ ...parsed, contentType: 'theory' }) }] } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const autoResult = await createGeminiProblemBrief(
  { rawText: 'A Reddit interview recollection', contentType: 'auto' },
  { apiKey: 'test-key', model: 'gemini-test', fetchImpl: autoFetch },
);
assert.equal(autoResult.brief.contentType, 'theory');
assert.match(autoRequestBody, /First classify the underlying interview question/);

const previousPoolKeys = process.env.GOOGLE_API_KEYS;
const previousRpm = process.env.GOOGLE_RPM;
const previousBaseCooldown = process.env.PROVIDER_BASE_COOLDOWN_MS;
process.env.GOOGLE_API_KEYS = '["pool-key-a","pool-key-b"]';
process.env.GOOGLE_RPM = '100';
process.env.PROVIDER_BASE_COOLDOWN_MS = '1';
const pooledAttempts: string[] = [];
const rotatingFetch: typeof fetch = async (_input, init) => {
  const key = (init?.headers as Record<string, string>)['x-goog-api-key'];
  pooledAttempts.push(key);
  if (key === 'pool-key-a') {
    return new Response('quota reached', { status: 429, headers: { 'Retry-After': '0.01' } });
  }
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(parsed) }] } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

try {
  await createGeminiProblemBrief(
    { rawText: 'Two sum' },
    { model: 'gemini-test', fetchImpl: rotatingFetch },
  );
  assert.deepEqual(pooledAttempts, ['pool-key-a', 'pool-key-b']);
} finally {
  if (previousPoolKeys === undefined) delete process.env.GOOGLE_API_KEYS;
  else process.env.GOOGLE_API_KEYS = previousPoolKeys;
  if (previousRpm === undefined) delete process.env.GOOGLE_RPM;
  else process.env.GOOGLE_RPM = previousRpm;
  if (previousBaseCooldown === undefined) delete process.env.PROVIDER_BASE_COOLDOWN_MS;
  else process.env.PROVIDER_BASE_COOLDOWN_MS = previousBaseCooldown;
}

console.log('Google prompt service unit tests passed.');

