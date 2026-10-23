import assert from 'node:assert/strict';
import {
  buildLeetCodeEvidenceContext,
  normalizeEvidenceList,
  sanitizeDiscussionText,
  stripHtml,
  type LeetCodeCandidate,
} from './leetcodeEnrichmentService.js';

assert.deepEqual(
  normalizeEvidenceList(' arrays, Graphs, arrays, dynamic programming ', { maxItems: 5, maxLength: 30 }),
  ['arrays', 'Graphs', 'dynamic programming']
);

assert.deepEqual(
  normalizeEvidenceList('Use a map\nAim for O(n)\n', { splitPattern: /\n/ }),
  ['Use a map', 'Aim for O(n)']
);

assert.equal(stripHtml('<p>Two &lt; values&nbsp;here</p>'), 'Two < values here');

const sanitized = sanitizeDiscussionText('# Approach\nUse a map.\n```python\nprint("secret")\n```\nhttps://example.com');
assert.match(sanitized, /Use a map/);
assert.match(sanitized, /\[code omitted\]/);
assert.doesNotMatch(sanitized, /print\("secret"\)/);
assert.doesNotMatch(sanitized, /example\.com/);

const candidate: LeetCodeCandidate = {
  questionFrontendId: '1',
  title: 'Two Sum',
  titleSlug: 'two-sum',
  difficulty: 'Easy',
  content: '<p>Find two values.</p>',
  contentText: 'Find two values.',
  hints: ['Use additional space.'],
  topicTags: [{ name: 'Hash Table', slug: 'hash-table' }],
  url: 'https://leetcode.com/problems/two-sum/'
};

const context = buildLeetCodeEvidenceContext(candidate, [{
  id: 10,
  title: 'One-pass map',
  excerpt: 'Track complements in a map.',
  voteCount: 42,
  creationDate: 1,
  tags: ['Hash Table'],
  url: 'https://leetcode.com/problems/two-sum/solutions/10/'
}]);

assert.match(context, /Two Sum/);
assert.match(context, /Use additional space/);
assert.match(context, /Track complements/);

console.log('LeetCode enrichment service unit tests passed.');
