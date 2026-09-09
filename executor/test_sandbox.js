const assert = require('assert');

async function testSandbox() {
    console.log('🧪 Running Executor Sandbox Integration Tests...');
    const PORT = process.env.PORT || 8080;
    const url = `http://localhost:${PORT}/validate`;

    // Test 1: Passing Python Solution
    console.log('Test 1: Valid Python Solution with Standard I/O...');
    const passPayload = {
        language: 'python',
        code: "import sys\ndata = sys.stdin.read().split()\nif data:\n    print(int(data[0]) + int(data[1]))\n",
        testCases: [
            { input: "2 3\n", expectedOutput: "5" },
            { input: "10 20\n", expectedOutput: "30" },
            { input: "-5 5\n", expectedOutput: "0" }
        ]
    };

    const res1 = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(passPayload)
    });
    const data1 = await res1.json();
    assert.strictEqual(data1.allPassed, true, `Valid code should pass. Output: ${JSON.stringify(data1)}`);
    assert.strictEqual(data1.passedCount, 3, 'All 3 test cases should pass');
    console.log('✅ Test 1 Passed: 3/3 Test Cases Verified');

    // Test 2: Failing Python Solution (Wrong Answer)
    console.log('Test 2: Buggy Solution (Wrong Answer)...');
    const failPayload = {
        language: 'python',
        code: "print('wrong')\n",
        testCases: [
            { input: "2 3\n", expectedOutput: "5" }
        ]
    };

    const res2 = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(failPayload)
    });
    const data2 = await res2.json();
    assert.strictEqual(data2.allPassed, false, 'Buggy code must not pass');
    assert.strictEqual(data2.passedCount, 0);
    console.log('✅ Test 2 Passed: Wrong Answer Detected');

    // Test 3: Infinite Loop Timeout (2.0s Limit Enforcement)
    console.log('Test 3: Infinite Loop Timeout Enforcement (2.0s limit)...');
    const timeoutPayload = {
        language: 'python',
        code: "while True:\n    pass\n",
        testCases: [
            { input: "1\n", expectedOutput: "1" }
        ]
    };

    const start = Date.now();
    const res3 = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(timeoutPayload)
    });
    const duration = Date.now() - start;
    const data3 = await res3.json();
    assert.strictEqual(data3.allPassed, false);
    assert(duration >= 1900 && duration <= 3500, `Execution took ${duration}ms, expected ~2000ms`);
    console.log(`✅ Test 3 Passed: Timed out accurately in ${duration}ms`);

    console.log('🎉 All Sandbox Integration Tests Passed Successfully!');
}

testSandbox().catch((err) => {
    console.error('❌ Sandbox Test Failed:', err);
    process.exit(1);
});
