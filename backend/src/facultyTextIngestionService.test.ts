import assert from 'node:assert/strict';
import {
  FacultyTextInputError,
  normalizeFacultyTextInput,
} from './facultyTextIngestionService.js';

const first = normalizeFacultyTextInput({
  title: 'Shortest path recollection',
  description: 'The candidate must find the shortest path in a weighted graph.',
  notes: 'The interviewer asked for the complexity.',
  tags: ['Graphs', 'Dijkstra', 'Graphs'],
  hints: 'Weights are non-negative\nUse a priority queue',
  content_type: 'programming',
  company: 'Example Company',
  interview_round: 'Technical round 2',
});
const second = normalizeFacultyTextInput({
  title: 'Shortest path recollection',
  description: 'The candidate must find the shortest path in a weighted graph.',
  notes: 'The interviewer asked for the complexity.',
  tags: ['Graphs'],
  content_type: 'programming',
  company: 'Example Company',
  interview_round: 'Technical round 2',
});

assert.equal(first.contentType, 'programming');
assert.deepEqual(first.tags, ['Graphs', 'Dijkstra']);
assert.deepEqual(first.hints, ['Weights are non-negative', 'Use a priority queue']);
assert.match(first.rawText, /Additional faculty context/);
assert.match(first.externalId, /^faculty-text:[a-f0-9]{64}$/);
assert.equal(first.externalId, second.externalId);

const automatic = normalizeFacultyTextInput({ description: 'Explain normalization in DBMS.', content_type: 'unexpected' });
assert.equal(automatic.contentType, 'auto');

const explicit = normalizeFacultyTextInput({
  description: 'Explain normalization in DBMS.',
  external_id: 'faculty-dbms-001',
});
assert.equal(explicit.externalId, 'faculty-text:faculty-dbms-001');

assert.throws(
  () => normalizeFacultyTextInput({ description: '   ' }),
  (error: unknown) => error instanceof FacultyTextInputError && /description is required/.test(error.message),
);

console.log('Faculty text ingestion service unit tests passed.');
