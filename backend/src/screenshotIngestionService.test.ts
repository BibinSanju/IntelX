import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { authorizeFaculty } from './facultyAuth.js';
import {
  buildScreenshotExternalId,
  detectScreenshotMime,
  extractQuestionFromScreenshots,
  parseScreenshotExtraction,
  redactScreenshotIdentity,
} from './screenshotIngestionService.js';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
assert.equal(detectScreenshotMime(png), 'image/png');
assert.equal(detectScreenshotMime(Buffer.from('not an image')), null);

assert.equal(
  redactScreenshotIdentity('Posted by: Visible Name\nu/example said @other_user hello'),
  '[identity removed]\n[redacted user] said [redacted user] hello',
);

const parsed = parseScreenshotExtraction(JSON.stringify({
  transcript: 'Interview question from u/student: find the shortest path in a weighted graph.',
  detectedPlatform: 'Reddit',
  visibleTags: ['Graphs'],
  visibleHints: ['Non-negative edge weights'],
  warnings: [],
}));
assert.doesNotMatch(parsed.transcript, /u\/student/);
assert.equal(parsed.detectedPlatform, 'Reddit');

const firstId = buildScreenshotExternalId([{ data: png, mimeType: 'image/png' }]);
const secondId = buildScreenshotExternalId([{ data: png, mimeType: 'image/png' }]);
assert.equal(firstId, secondId);
assert.match(firstId, /^screenshot:[a-f0-9]{64}$/);

let requestBody = '';
const mockFetch: typeof fetch = async (_input, init) => {
  requestBody = String(init?.body || '');
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({
      transcript: 'A student was asked to reverse a linked list and explain the time complexity.',
      detectedPlatform: 'Reddit',
      visibleTags: ['Linked List'],
      visibleHints: ['Use three pointers'],
      warnings: ['One line was unclear'],
    }) }] } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const result = await extractQuestionFromScreenshots(
  [{ data: png, mimeType: 'image/png' }],
  { apiKey: 'test-key', model: 'gemini-test', fetchImpl: mockFetch },
);
assert.equal(result.extraction.detectedPlatform, 'Reddit');
const sent = JSON.parse(requestBody);
assert.equal(sent.contents[0].parts[1].inlineData.mimeType, 'image/png');
assert.equal(sent.contents[0].parts[1].inlineData.data, png.toString('base64'));
assert.match(sent.contents[0].parts[0].text, /omit usernames/);

const secret = 'test-secret';
const facultyToken = jwt.sign({ id: 'faculty-1', role: 'FACULTY' }, secret);
const studentToken = jwt.sign({ id: 'student-1', role: 'STUDENT' }, secret);
assert.deepEqual(authorizeFaculty(`Bearer ${facultyToken}`, secret), { ok: true, userId: 'faculty-1' });
const deniedStudent = authorizeFaculty(`Bearer ${studentToken}`, secret);
const deniedMissing = authorizeFaculty(undefined, secret);
assert.equal(deniedStudent.ok ? 200 : deniedStudent.status, 403);
assert.equal(deniedMissing.ok ? 200 : deniedMissing.status, 401);

console.log('Screenshot ingestion service unit tests passed.');
