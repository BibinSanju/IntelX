export interface MoodleQuestionData {
    id: string;
    title: string;
    description: string;
    category?: string;
    subtopic?: string;
    difficulty?: string;
    solutionCode?: string;
    testCases?: Array<{
        input: string;
        expectedOutput: string;
    }>;
}

export function buildMoodleCodeRunnerXml(questions: MoodleQuestionData[]): string {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<quiz>\n';

    // Group questions by category/taxonomy path to generate category headers
    const categoryGroups = new Map<string, MoodleQuestionData[]>();

    for (const q of questions) {
        const cat = q.category || 'General';
        const sub = q.subtopic || 'General';
        const taxPath = `$course$/top/${cat}/${sub}`;

        if (!categoryGroups.has(taxPath)) {
            categoryGroups.set(taxPath, []);
        }
        categoryGroups.get(taxPath)!.push(q);
    }

    // Output category blocks
    for (const [taxPath, group] of categoryGroups.entries()) {
        xml += `
  <!-- ========================================= -->
  <!-- Category: ${taxPath} -->
  <!-- ========================================= -->
  <question type="category">
    <category>
      <text>${escapeXml(taxPath)}</text>
    </category>
    <info format="moodle_auto_format">
      <text>Automated Placement Portal Question Bank</text>
    </info>
  </question>
`;

        for (const q of group) {
            let testcasesXml = '';
            const testCases = q.testCases || [];

            testCases.forEach((tc, idx) => {
                const inputStr = typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input);
                const outputStr = (typeof tc.expectedOutput === 'string' ? tc.expectedOutput : JSON.stringify(tc.expectedOutput)).trim();
                const isSample = idx < 3; // First 3 are sample cases visible to students

                testcasesXml += `
      <testcase testtype="0" useasexample="${isSample ? '1' : '0'}" hiderestiffail="0" mark="1.0000000">
        <testcode>
          <text><![CDATA[${inputStr}]]></text>
        </testcode>
        <expected>
          <text><![CDATA[${outputStr}]]></text>
        </expected>
      </testcase>`;
            });

            const answerBlock = q.solutionCode ? `
    <answer>
      <text><![CDATA[${q.solutionCode}]]></text>
    </answer>` : '';

            xml += `
  <question type="coderunner">
    <name>
      <text><![CDATA[${q.title}]]></text>
    </name>
    <questiontext format="html">
      <text><![CDATA[${q.description}]]></text>
    </questiontext>
    <generalfeedback format="html">
      <text><![CDATA[Difficulty: ${q.difficulty || 'Medium'} | Category: ${q.category || 'General'}]]></text>
    </generalfeedback>
    <defaultgrade>${Math.max(1, testCases.length)}.0000000</defaultgrade>
    <penalty>0.1000000</penalty>
    <hidden>0</hidden>
    <coderunnertype>python3</coderunnertype>
    <prototypetype>0</prototypetype>
    <allornothing>1</allornothing>
    <customise>0</customise>${answerBlock}
    <testcases>
${testcasesXml}
    </testcases>
  </question>
`;
        }
    }

    xml += '</quiz>\n';
    return xml;
}

function escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
}
