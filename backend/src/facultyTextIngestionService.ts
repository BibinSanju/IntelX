import { createHash } from 'node:crypto';
import { normalizeEvidenceList } from './leetcodeEnrichmentService.js';

export type FacultyContentType = 'auto' | 'programming' | 'theory';

export interface NormalizedFacultyTextInput {
  rawText: string;
  title: string;
  tags: string[];
  hints: string[];
  contentType: FacultyContentType;
  sourceUrl: string | null;
  externalId: string;
  company: string;
  interviewRound: string;
}

export class FacultyTextInputError extends Error {}

function cleanText(value: unknown, maximum: number): string {
  return (typeof value === 'string' ? value : '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maximum);
}

export function normalizeFacultyTextInput(body: unknown): NormalizedFacultyTextInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new FacultyTextInputError('A JSON request body is required.');
  }
  const input = body as Record<string, unknown>;
  const description = cleanText(input.description ?? input.raw_text, 45_000);
  if (!description) {
    throw new FacultyTextInputError('description is required.');
  }

  const title = cleanText(input.title, 300);
  const notes = cleanText(input.notes, 4_000);
  const company = cleanText(input.company, 150);
  const interviewRound = cleanText(input.interview_round ?? input.round, 150);
  const requestedType = cleanText(input.content_type ?? input.contentType, 20).toLowerCase();
  const contentType: FacultyContentType = requestedType === 'programming' || requestedType === 'theory'
    ? requestedType
    : 'auto';
  const tags = normalizeEvidenceList(input.tags, { maxItems: 15, maxLength: 80 });
  const hints = normalizeEvidenceList(input.hints, {
    maxItems: 12,
    maxLength: 600,
    splitPattern: /\n/,
  });
  const sourceUrl = cleanText(input.source_url ?? input.sourceUrl, 2_000) || null;

  const rawText = [
    title ? `# ${title}` : '# Faculty interview-question description',
    `## Question recollection\n${description}`,
    notes ? `## Additional faculty context\n${notes}` : '',
    company ? `## Company context\n${company}` : '',
    interviewRound ? `## Interview round\n${interviewRound}` : '',
  ].filter(Boolean).join('\n\n').slice(0, 50_000);

  const explicitId = cleanText(input.external_id ?? input.externalId, 180);
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ title, description, notes, company, interviewRound, contentType }))
    .digest('hex');

  return {
    rawText,
    title,
    tags,
    hints,
    contentType,
    sourceUrl,
    externalId: `faculty-text:${explicitId || fingerprint}`,
    company,
    interviewRound,
  };
}
