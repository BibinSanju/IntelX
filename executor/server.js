const express = require('express');
const { exec, execSync } = require('child_process');
const fs = require('fs').promises;
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));

// Helper to run a shell command with promise and timeout
function runCommand(command, options = {}) {
    return new Promise((resolve, reject) => {
        exec(command, { timeout: 2000, maxBuffer: 10 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
            if (error) {
                if (error.killed) {
                    return resolve({ success: false, timedOut: true, stdout: stdout || '', stderr: 'Execution Timed Out (Limit: 2.0s)' });
                }
                return resolve({ success: false, timedOut: false, stdout: stdout || '', stderr: stderr || error.message });
            }
            resolve({ success: true, timedOut: false, stdout: stdout || '', stderr: stderr || '' });
        });
    });
}

// Single execution endpoint (backward compatibility)
app.post('/execute', async (req, res) => {
    const { language, code, input } = req.body;
    const runId = crypto.randomBytes(8).toString('hex');
    const runDir = path.join(__dirname, 'temp', runId);
    await fs.mkdir(runDir, { recursive: true });

    const inputPath = path.join(runDir, 'input.in');
    await fs.writeFile(inputPath, input || '');

    let command = '';
    let filePath = '';

    try {
        if (language === 'javascript') {
            filePath = path.join(runDir, 'script.js');
            await fs.writeFile(filePath, code);
            command = `node ${filePath} < ${inputPath}`;
        } else if (language === 'python') {
            filePath = path.join(runDir, 'solution.py');
            await fs.writeFile(filePath, code);
            command = `python3 ${filePath} < ${inputPath}`;
        } else if (language === 'c') {
            filePath = path.join(runDir, 'code.c');
            const outPath = path.join(runDir, 'code.out');
            await fs.writeFile(filePath, code);
            command = `gcc ${filePath} -O2 -o ${outPath} && ${outPath} < ${inputPath}`;
        } else if (language === 'cpp') {
            filePath = path.join(runDir, 'solution.cpp');
            const outPath = path.join(runDir, 'solution.out');
            await fs.writeFile(filePath, code);
            command = `g++ ${filePath} -O3 -std=c++20 -o ${outPath} && ${outPath} < ${inputPath}`;
        } else if (language === 'java') {
            filePath = path.join(runDir, 'Main.java');
            const javaCode = code.replace(/public\s+class\s+\w+/g, 'public class Main');
            await fs.writeFile(filePath, javaCode);
            command = `javac ${filePath} && java -cp ${runDir} Main < ${inputPath}`;
        } else {
            return res.status(400).json({ error: "Unsupported language" });
        }

        const result = await runCommand(command);
        if (!result.success) {
            return res.json({ status: "error", output: result.stderr || "Execution Error" });
        }
        res.json({ status: "success", output: result.stdout });

    } catch (err) {
        res.status(500).json({ error: "Server error during execution: " + err.message });
    } finally {
        // Clean up temp run directory
        await fs.rm(runDir, { recursive: true, force: true }).catch(() => {});
    }
});

// Batch validation endpoint for the automated pipeline
// Runs solution against all test cases with strict 128MB RAM and 2.0s limit per case
app.post('/validate', async (req, res) => {
    const { language = 'python', code, testCases = [] } = req.body;

    if (!code) {
        return res.status(400).json({ allPassed: false, error: "Missing solution code" });
    }
    if (!Array.isArray(testCases) || testCases.length === 0) {
        return res.status(400).json({ allPassed: false, error: "Missing test cases" });
    }

    const runId = crypto.randomBytes(8).toString('hex');
    const runDir = path.join(__dirname, 'temp', runId);
    await fs.mkdir(runDir, { recursive: true });

    try {
        let runExecutable = '';
        const startTime = Date.now();

        // 1. Compilation Phase (if necessary)
        if (language === 'python') {
            const pyFile = path.join(runDir, 'solution.py');
            await fs.writeFile(pyFile, code);
            
            // Syntax pre-check
            const syntaxCheck = await runCommand(`python3 -m py_compile ${pyFile}`);
            if (!syntaxCheck.success) {
                return res.json({
                    allPassed: false,
                    stage: 'compilation',
                    error: syntaxCheck.stderr || 'Python syntax error',
                    passedCount: 0,
                    totalCount: testCases.length,
                    results: []
                });
            }
            runExecutable = `python3 ${pyFile}`;
        } else if (language === 'cpp') {
            const cppFile = path.join(runDir, 'solution.cpp');
            const binFile = path.join(runDir, 'solution.out');
            await fs.writeFile(cppFile, code);

            const compileRes = await runCommand(`g++ ${cppFile} -O3 -std=c++20 -o ${binFile}`);
            if (!compileRes.success) {
                return res.json({
                    allPassed: false,
                    stage: 'compilation',
                    error: compileRes.stderr || 'C++ compilation failed',
                    passedCount: 0,
                    totalCount: testCases.length,
                    results: []
                });
            }
            runExecutable = binFile;
        } else if (language === 'java') {
            const javaFile = path.join(runDir, 'Main.java');
            const sanitizedCode = code.replace(/public\s+class\s+\w+/g, 'public class Main');
            await fs.writeFile(javaFile, sanitizedCode);

            const compileRes = await runCommand(`javac ${javaFile}`);
            if (!compileRes.success) {
                return res.json({
                    allPassed: false,
                    stage: 'compilation',
                    error: compileRes.stderr || 'Java compilation failed',
                    passedCount: 0,
                    totalCount: testCases.length,
                    results: []
                });
            }
            runExecutable = `java -cp ${runDir} Main`;
        } else if (language === 'javascript') {
            const jsFile = path.join(runDir, 'script.js');
            await fs.writeFile(jsFile, code);
            runExecutable = `node ${jsFile}`;
        } else {
            return res.status(400).json({ allPassed: false, error: `Unsupported language: ${language}` });
        }

        // 2. Test Cases Execution Phase
        const results = [];
        let allPassed = true;
        let passedCount = 0;

        for (let i = 0; i < testCases.length; i++) {
            const tc = testCases[i];
            const inputStr = typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input);
            const expectedStr = (typeof tc.expectedOutput === 'string' ? tc.expectedOutput : JSON.stringify(tc.expectedOutput)).trim();

            const inputPath = path.join(runDir, `tc_${i}.in`);
            await fs.writeFile(inputPath, inputStr);

            const caseStartTime = Date.now();
            const execRes = await runCommand(`${runExecutable} < ${inputPath}`);
            const caseDurationMs = Date.now() - caseStartTime;

            if (execRes.timedOut) {
                allPassed = false;
                results.push({
                    testCase: i + 1,
                    passed: false,
                    error: "Time Limit Exceeded (Limit: 2.0s)",
                    actualOutput: "",
                    expectedOutput: expectedStr,
                    timeMs: caseDurationMs
                });
                break; // Halt on timeout
            }

            if (!execRes.success) {
                allPassed = false;
                results.push({
                    testCase: i + 1,
                    passed: false,
                    error: execRes.stderr || "Runtime Error",
                    actualOutput: execRes.stdout.trim(),
                    expectedOutput: expectedStr,
                    timeMs: caseDurationMs
                });
                continue;
            }

            const actualStr = execRes.stdout.trim();
            const passed = (actualStr === expectedStr);

            if (passed) {
                passedCount++;
            } else {
                allPassed = false;
            }

            results.push({
                testCase: i + 1,
                passed,
                actualOutput: actualStr,
                expectedOutput: expectedStr,
                timeMs: caseDurationMs
            });
        }

        const totalDurationMs = Date.now() - startTime;

        res.json({
            allPassed,
            passedCount,
            totalCount: testCases.length,
            stage: 'execution',
            totalDurationMs,
            results
        });

    } catch (err) {
        res.status(500).json({ allPassed: false, error: "Sandbox internal failure: " + err.message });
    } finally {
        await fs.rm(runDir, { recursive: true, force: true }).catch(() => {});
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'IntelX-Execution-Sandbox',
        languages: ['python', 'cpp', 'java', 'c', 'javascript'],
        limits: {
            memory: '128MB',
            timeoutSeconds: 2.0
        }
    });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Executor running on port ${PORT}`));
