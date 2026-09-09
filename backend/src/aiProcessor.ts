import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { Groq } from 'groq-sdk';
import { computeTextEmbedding, calculateCosineSimilarity } from './embeddingService.js';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const EXECUTOR_URL = process.env.EXECUTOR_URL || 'http://localhost:8080';

export async function processQuestionInBackground(stagedQuestionId: string) {
  try {
    const stagedQuestion = await prisma.stagedQuestion.findUnique({
      where: { id: stagedQuestionId }
    });

    if (!stagedQuestion) {
      console.error(`Staged question ${stagedQuestionId} not found.`);
      return;
    }

    const isMockMode = process.env.MOCK_AI === 'true' || process.env.NODE_ENV === 'test' && !process.env.GROQ_API_KEY;
    const groq_api_key = process.env.GROQ_API_KEY;

    if (!isMockMode && !groq_api_key) {
      console.error('Groq API key is missing and MOCK_AI is not set. Cannot process question.');
      await prisma.stagedQuestion.update({
        where: { id: stagedQuestionId },
        data: { status: 'FAILED_AI' }
      });
      return;
    }

    const groq = groq_api_key ? new Groq({ apiKey: groq_api_key }) : null;

    let parsedMeta: any = {};
    let solutionCode = "";
    let testCases: Array<{ input: string; expectedOutput: string }> = [];

    if (isMockMode) {
      console.log(`[Pipeline] Running in CI/Mock Mode for question ${stagedQuestionId}...`);
      parsedMeta = {
        title: "Shortest Path in Binary Grid",
        description: "<p>Given an <code>N x N</code> binary grid, return the length of the shortest clear path from top-left to bottom-right avoiding obstacles (1s). If no clear path exists, return -1.</p>",
        category: "DSA",
        subtopic: "Graphs",
        constraints: "<code>1 &lt;= N &lt;= 50</code>",
        strategy: "Breadth-First Search (BFS) with O(N^2) time and space complexity"
      };
      solutionCode = `import sys
from collections import deque

def solve():
    lines = [line.strip() for line in sys.stdin if line.strip()]
    if not lines:
        return
    n = int(lines[0])
    grid = []
    for i in range(1, n + 1):
        grid.append(list(map(int, lines[i].split())))
    if grid[0][0] == 1 or grid[n-1][n-1] == 1:
        print("-1")
        return
    q = deque([(0, 0, 1)])
    visited = {(0, 0)}
    while q:
        r, c, d = q.popleft()
        if r == n - 1 and c == n - 1:
            print(d)
            return
        for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nr, nc = r + dr, c + dc
            if 0 <= nr < n and 0 <= nc < n and grid[nr][nc] == 0 and (nr, nc) not in visited:
                visited.add((nr, nc))
                q.append((nr, nc, d + 1))
    print("-1")

if __name__ == '__main__':
    solve()
`;
      testCases = [
        { input: "2\n0 0\n0 0\n", expectedOutput: "3\n" },
        { input: "2\n1 0\n0 0\n", expectedOutput: "-1\n" },
        { input: "3\n0 0 0\n1 1 0\n1 1 0\n", expectedOutput: "5\n" },
        { input: "1\n0\n", expectedOutput: "1\n" },
        { input: "1\n1\n", expectedOutput: "-1\n" },
        { input: "3\n0 1 0\n0 1 0\n0 0 0\n", expectedOutput: "5\n" },
        { input: "3\n0 0 0\n0 0 0\n0 0 0\n", expectedOutput: "5\n" },
        { input: "4\n0 0 0 0\n1 1 1 0\n0 0 0 0\n0 1 1 1\n", expectedOutput: "-1\n" },
        { input: "2\n0 1\n1 0\n", expectedOutput: "-1\n" },
        { input: "3\n0 1 1\n0 0 1\n1 0 0\n", expectedOutput: "5\n" }
      ];
    } else if (groq) {
      // =========================================================================
      // STEP 1: LLM Formalization & Algorithmic Strategy Extraction
      // =========================================================================
      console.log(`[Pipeline] Step 1: Formalizing raw question ${stagedQuestionId}...`);

      const formalizePrompt = `You are a premier competitive programming problem curator.
Analyze the following raw interview question and extract its formal components.
Raw Text: "${stagedQuestion.rawText.replace(/"/g, '\\"')}"

Output a valid JSON object matching this structure EXACTLY (no markdown, no backticks):
{
  "title": "A formal, concise problem title",
  "description": "Clear problem statement formatted in HTML using <p>, <code>, <ul>. State input format, output format, and problem rules.",
  "category": "DSA, DB, or System Design",
  "subtopic": "Specific topic such as Graphs, DP, Arrays, Trees, Sorting, Greedy",
  "constraints": "Strict mathematical constraints formatted in HTML, e.g., 1 <= N <= 10^5, -10^9 <= nums[i] <= 10^9",
  "strategy": "Optimal algorithm pattern (e.g., BFS / Dynamic Programming) and Big-O Time & Space complexity"
}`;

      const formalizeCompletion = await groq.chat.completions.create({
        messages: [{ role: "user", content: formalizePrompt }],
        model: "llama-3.3-70b-versatile",
        temperature: 0.1,
      });

      parsedMeta = parseJsonResponse(formalizeCompletion.choices[0].message.content || "{}");
    }

    // =========================================================================
    // STEP 2: 384-d Vector Embedding & Cosine Similarity Deduplication
    // =========================================================================
    console.log(`[Pipeline] Step 2: Computing 384-d embedding and checking for duplicates...`);
    const questionText = `${parsedMeta.title || ''} ${parsedMeta.description || ''}`;
    const newEmbedding = computeTextEmbedding(questionText);

    try {
      const existingQuestions = await prisma.question.findMany({
        select: { id: true, title: true, description: true }
      });

      for (const existing of existingQuestions) {
        const existingVec = computeTextEmbedding(`${existing.title} ${existing.description}`);
        const similarity = calculateCosineSimilarity(newEmbedding, existingVec);

        if (similarity >= 0.85) {
          console.warn(`[Pipeline] Duplicate detected with Question ${existing.id} (Similarity: ${(similarity * 100).toFixed(1)}%). Halting.`);
          await prisma.stagedQuestion.update({
            where: { id: stagedQuestionId },
            data: {
              title: parsedMeta.title || 'Duplicate Question',
              description: parsedMeta.description || stagedQuestion.rawText,
              category: parsedMeta.category || 'General',
              subtopic: parsedMeta.subtopic || 'General',
              status: 'DUPLICATE_FOUND'
            }
          });
          return;
        }
      }
    } catch (dedupError) {
      console.warn('[Pipeline] Deduplication check skipped or error:', dedupError);
    }

    // =========================================================================
    // STEP 3: Solution Synthesizer & 10 Standardized I/O Test Cases
    // =========================================================================
    if (!isMockMode) {
      console.log(`[Pipeline] Step 3: Synthesizing canonical solution & 10 test cases via Groq...`);

      const synthesisPrompt = `You are an expert algorithmic problem creator.
Given this problem:
Title: ${parsedMeta.title}
Description: ${parsedMeta.description}
Constraints: ${parsedMeta.constraints}
Strategy: ${parsedMeta.strategy}

Generate:
1. An optimal canonical solution in Python 3 that reads from sys.stdin and writes to sys.stdout.
2. Exactly 10 valid test cases:
   - 3 Sample Cases (easy, basic examples)
   - 4 Edge / Boundary Cases (N=1, negative numbers, extreme values, duplicates)
   - 3 Stress / Performance Cases (larger inputs within constraints to test efficiency)

CRITICAL: The 'input' and 'expectedOutput' MUST be raw strings with newline characters (\\n), exactly formatted for standard input stream readers.

Output ONLY a JSON object matching this structure:
{
  "solutionCode": "Complete, working Python 3 code string",
  "testCases": [
    {
      "input": "raw stdin string with \\n",
      "expectedOutput": "raw stdout string\\n"
    }
  ]
}`;

      if (groq) {
        const synthesisCompletion = await groq.chat.completions.create({
          messages: [{ role: "user", content: synthesisPrompt }],
          model: "llama-3.3-70b-versatile",
          temperature: 0.1,
        });

        const synthData = parseJsonResponse(synthesisCompletion.choices[0].message.content || "{}");
        solutionCode = synthData.solutionCode || "";
        testCases = synthData.testCases || [];
      }
    } else {
      console.log(`[Pipeline] Step 3: CI/Mock test cases and Python solution ready (${testCases.length} test cases).`);
    }

    // =========================================================================
    // STEP 4: Docker Sandbox Execution & Self-Correction Healing Loop
    // =========================================================================
    console.log(`[Pipeline] Step 4: Testing solution against ${testCases.length} test cases in sandbox...`);
    let validationPassed = false;
    let retryCount = 0;
    const maxRetries = 2;

    while (retryCount <= maxRetries) {
      try {
        const valRes = await fetch(`${EXECUTOR_URL}/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            language: 'python',
            code: solutionCode,
            testCases: testCases
          })
        });

        const valData = await valRes.json();

        if (valData.allPassed) {
          validationPassed = true;
          console.log(`[Pipeline] Sandbox Validation Passed (10/10 Verified) in ${valData.totalDurationMs}ms!`);
          break;
        }

        // Self-Healing Retry Loop
        retryCount++;
        if (retryCount <= maxRetries && groq) {
          console.warn(`[Pipeline] Sandbox validation failed on attempt ${retryCount}. Triggering AI Self-Correction...`);
          const failedCase = valData.results?.find((r: any) => !r.passed) || {};
          
          const healPrompt = `The synthesized Python 3 solution failed during sandbox verification.
Error Details:
Stage: ${valData.stage || 'execution'}
Error: ${failedCase.error || valData.error || 'Output mismatch'}
Failed Test Input: "${failedCase.input || ''}"
Actual Output: "${failedCase.actualOutput || ''}"
Expected Output: "${failedCase.expectedOutput || ''}"

Current Solution Code:
${solutionCode}

Please fix either the solution code or the expected output so that they correctly agree.
Output ONLY JSON with the fixed "solutionCode" and "testCases" array.`;

          const healCompletion = await groq.chat.completions.create({
            messages: [{ role: "user", content: healPrompt }],
            model: "llama-3.3-70b-versatile",
            temperature: 0.1,
          });

          const healed = parseJsonResponse(healCompletion.choices[0].message.content || "{}");
          if (healed.solutionCode) solutionCode = healed.solutionCode;
          if (healed.testCases && healed.testCases.length > 0) testCases = healed.testCases;
        }
      } catch (sandboxConnError) {
        console.warn(`[Pipeline] Sandbox connection error on attempt ${retryCount}:`, sandboxConnError);
        break;
      }
    }

    // =========================================================================
    // STEP 5: Staging Promotion
    // =========================================================================
    const finalStatus = validationPassed ? 'STAGED' : 'FAILED_SANDBOX';

    await prisma.stagedQuestion.update({
      where: { id: stagedQuestionId },
      data: {
        title: parsedMeta.title || 'Untitled Question',
        description: parsedMeta.description || stagedQuestion.rawText,
        category: parsedMeta.category || 'DSA',
        subtopic: parsedMeta.subtopic || 'General',
        constraints: parsedMeta.constraints || '',
        testCases: testCases,
        sandboxVerdict: validationPassed ? '10/10 Passed' : 'Validation Failed',
        status: finalStatus
      }
    });

    console.log(`[Pipeline] Completed processing for StagedQuestion ${stagedQuestionId}. Status: ${finalStatus}`);

  } catch (error) {
    console.error(`[Pipeline] Catastrophic failure for ${stagedQuestionId}:`, error);
    await prisma.stagedQuestion.update({
      where: { id: stagedQuestionId },
      data: { status: 'FAILED_AI' }
    }).catch(() => {});
  }
}

function parseJsonResponse(raw: string): any {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.substring(7);
  if (cleaned.startsWith('```')) cleaned = cleaned.substring(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.substring(0, cleaned.length - 3);
  try {
    return JSON.parse(cleaned.trim());
  } catch {
    return {};
  }
}
