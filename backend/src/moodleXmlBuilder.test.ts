import assert from 'assert';
import { buildMoodleCodeRunnerXml } from './moodleXmlBuilder.js';

function testMoodleXml() {
    console.log('🧪 Testing Moodle CodeRunner XML Builder...');

    const sampleQuestions = [
        {
            id: 'q1',
            title: 'Two Sum Problem',
            description: '<p>Find two numbers that sum up to target.</p>',
            category: 'DSA',
            subtopic: 'Arrays',
            difficulty: 'Easy',
            solutionCode: 'import sys\nprint("solution")',
            testCases: [
                { input: '4\n2 7 11 15\n9\n', expectedOutput: '0 1\n' },
                { input: '3\n3 2 4\n6\n', expectedOutput: '1 2\n' }
            ]
        },
        {
            id: 'q2',
            title: 'Breadth First Search on Grid',
            description: '<p>Find shortest path from top-left to bottom-right.</p>',
            category: 'DSA',
            subtopic: 'Graphs',
            difficulty: 'Medium',
            solutionCode: 'def bfs(): pass',
            testCases: [
                { input: '1\n', expectedOutput: '1\n' }
            ]
        }
    ];

    const xml = buildMoodleCodeRunnerXml(sampleQuestions);

    assert(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'Must start with XML declaration');
    assert(xml.includes('<quiz>'), 'Must contain <quiz> root tag');
    assert(xml.includes('</quiz>'), 'Must close </quiz> root tag');
    assert(xml.includes('$course$/top/DSA/Arrays'), 'Must include hierarchical category taxonomy for Arrays');
    assert(xml.includes('$course$/top/DSA/Graphs'), 'Must include hierarchical category taxonomy for Graphs');
    assert(xml.includes('<question type="coderunner">'), 'Must contain coderunner question type');
    assert(xml.includes('<![CDATA[Two Sum Problem]]>'), 'Must escape title in CDATA');
    assert(xml.includes('<coderunnertype>python3</coderunnertype>'), 'Must declare python3 coderunner type');
    assert(xml.includes('useasexample="1"'), 'First sample test case should be marked as example');

    console.log('✅ All Moodle CodeRunner XML Unit Tests Passed Successfully!');
}

testMoodleXml();
