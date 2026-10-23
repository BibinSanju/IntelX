import assert from 'node:assert/strict';
import {
  ProviderHttpError,
  ProviderKeyPool,
  loadProviderKeys,
  loadProviderLimits,
  type ProviderPoolLimits,
} from './providerKeyPool.js';

assert.deepEqual(
  loadProviderKeys('google', {
    GOOGLE_API_KEYS: '["google-a", "google-b", "google-a"]',
    GEMINI_API_KEY: 'google-c',
  } as NodeJS.ProcessEnv),
  ['google-a', 'google-b', 'google-c'],
);
assert.equal(loadProviderLimits('google', {} as NodeJS.ProcessEnv).quotaScope, 'per-project');
assert.equal(loadProviderLimits('google', { GOOGLE_QUOTA_SCOPE: 'shared' } as NodeJS.ProcessEnv).quotaScope, 'shared');
assert.equal(loadProviderLimits('groq', {} as NodeJS.ProcessEnv).quotaScope, 'per-organization');
assert.equal(loadProviderLimits('groq', { GROQ_QUOTA_SCOPE: 'shared' } as NodeJS.ProcessEnv).quotaScope, 'shared');
assert.equal(loadProviderLimits('google', {} as NodeJS.ProcessEnv).maxAttempts, 20);
assert.equal(loadProviderLimits('groq', {} as NodeJS.ProcessEnv).maxAttempts, 20);
assert.deepEqual(
  {
    rpm: loadProviderLimits('google', {} as NodeJS.ProcessEnv).requestsPerMinute,
    tpm: loadProviderLimits('google', {} as NodeJS.ProcessEnv).tokensPerMinute,
    rpd: loadProviderLimits('google', {} as NodeJS.ProcessEnv).requestsPerDay,
  },
  { rpm: 4, tpm: 225_000, rpd: 18 },
);
assert.deepEqual(
  loadProviderKeys('groq', { GROQ_API_KEYS: 'groq-a;groq-b\ngroq-c' } as NodeJS.ProcessEnv),
  ['groq-a', 'groq-b', 'groq-c'],
);

const limits: ProviderPoolLimits = {
  quotaScope: 'shared',
  requestsPerMinute: 100,
  tokensPerMinute: 100_000,
  requestsPerDay: 1_000,
  tokensPerDay: 1_000_000,
  concurrency: 1,
  maxAttempts: 4,
  maxQueueWaitMs: 500,
  baseCooldownMs: 10,
  minuteWindowMs: 30,
  dayWindowMs: 100,
};

const rotatingPool = new ProviderKeyPool('google', ['secret-a', 'secret-b'], limits);
const attempted: string[] = [];
const rotationStarted = Date.now();
const rotatedResult = await rotatingPool.execute(async key => {
  attempted.push(key);
  if (key === 'secret-a') {
    throw new ProviderHttpError('rate limited', 429, { 'retry-after': '0.01' });
  }
  return 'ok';
});
assert.equal(rotatedResult, 'ok');
assert.deepEqual(attempted, ['secret-a', 'secret-b']);
assert.ok(Date.now() - rotationStarted >= 10, '429 must cool the aggregate provider before rotation');
assert.doesNotMatch(JSON.stringify(rotatingPool.snapshot()), /secret-a|secret-b/);

const authPool = new ProviderKeyPool('groq', ['bad-key', 'good-key'], limits);
const authResult = await authPool.execute(async key => {
  if (key === 'bad-key') throw new ProviderHttpError('unauthorized', 401);
  return 'healthy';
});
assert.equal(authResult, 'healthy');
assert.equal(authPool.snapshot().disabledKeys, 1);

const pacedPool = new ProviderKeyPool('google', ['paced-key-a', 'paced-key-b'], {
  ...limits,
  requestsPerMinute: 1,
  maxQueueWaitMs: 250,
});
const started = Date.now();
const pacedKeys: string[] = [];
await pacedPool.execute(async key => { pacedKeys.push(key); return 'first'; });
await pacedPool.execute(async key => { pacedKeys.push(key); return 'second'; });
assert.ok(Date.now() - started >= 25, 'second request should wait for the rolling request window');
assert.deepEqual(pacedKeys, ['paced-key-a', 'paced-key-b'], 'aggregate pacing must apply even while keys rotate');

const separateProjectsPool = new ProviderKeyPool('google', ['project-a-key', 'project-b-key'], {
  ...limits,
  quotaScope: 'per-project',
  requestsPerMinute: 1,
  minuteWindowMs: 100,
});
const separateKeys: string[] = [];
await separateProjectsPool.execute(async key => { separateKeys.push(key); return 'first'; });
await separateProjectsPool.execute(async key => { separateKeys.push(key); return 'second'; });
assert.deepEqual(separateKeys, ['project-a-key', 'project-b-key']);

const perProjectRotationPool = new ProviderKeyPool('google', ['limited-project', 'healthy-project'], {
  ...limits,
  quotaScope: 'per-project',
});
const perProjectAttempts: string[] = [];
const perProjectResult = await perProjectRotationPool.execute(async key => {
  perProjectAttempts.push(key);
  if (key === 'limited-project') throw new ProviderHttpError('project rate limited', 429, { 'retry-after': '1' });
  return 'continued';
});
assert.equal(perProjectResult, 'continued');
assert.deepEqual(perProjectAttempts, ['limited-project', 'healthy-project']);
assert.equal(perProjectRotationPool.snapshot().providerCooldownMs, 0, 'one project must not cool the whole Google pool');

const twentyProjectKeys = Array.from({ length: 20 }, (_, index) => `project-${index + 1}-key`);
const twentyProjectPool = new ProviderKeyPool('google', twentyProjectKeys, {
  ...limits,
  quotaScope: 'per-project',
  maxAttempts: 20,
});
const visitedProjects: string[] = [];
const twentiethProjectResult = await twentyProjectPool.execute(async key => {
  visitedProjects.push(key);
  if (key !== 'project-20-key') throw new ProviderHttpError('project rate limited', 429);
  return 'twentieth-project-healthy';
});
assert.equal(twentiethProjectResult, 'twentieth-project-healthy');
assert.deepEqual(visitedProjects, twentyProjectKeys, 'a request can rotate across all 20 independent projects');

const twentyPersonalGroqKeys = Array.from({ length: 20 }, (_, index) => `personal-groq-${index + 1}`);
const twentyOrganizationPool = new ProviderKeyPool('groq', twentyPersonalGroqKeys, {
  ...limits,
  quotaScope: 'per-organization',
  maxAttempts: 20,
});
const visitedOrganizations: string[] = [];
const twentiethOrganizationResult = await twentyOrganizationPool.execute(async key => {
  visitedOrganizations.push(key);
  if (key !== 'personal-groq-20') throw new ProviderHttpError('organization rate limited', 429);
  return 'twentieth-organization-healthy';
});
assert.equal(twentiethOrganizationResult, 'twentieth-organization-healthy');
assert.deepEqual(visitedOrganizations, twentyPersonalGroqKeys, 'a request can rotate across all 20 personal organizations');
assert.equal(twentyOrganizationPool.snapshot().providerCooldownMs, 0);

console.log('Provider key pool unit tests passed.');
