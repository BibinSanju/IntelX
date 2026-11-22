const express = require('express');
const { exec } = require('child_process');
const fs = require('fs').promises;
const fsSync = require('fs');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json({ limit: '2mb' }));

// ---------------------------------------------------------------------------
// Configuration & isolation
// ---------------------------------------------------------------------------
const EXECUTOR_TOKEN = (process.env.EXECUTOR_TOKEN || '').trim();
if (!EXECUTOR_TOKEN) {
    if (process.env.NODE_ENV === 'production') {
        console.error('EXECUTOR_TOKEN must be set in production. Refusing to start an unauthenticated executor.');
        process.exit(1);
    }
    console.warn('[Executor] EXECUTOR_TOKEN not set: endpoints are unauthenticated (development only).');
}

// With SANDBOX_ISOLATION=uid (the Docker image sets it) every run compiles and executes under its own
// throwaway, unprivileged UID. The code cannot touch the server process, its environment, /app, or
// other runs, and every process it spawned (e.g. fork bombs) is killed when the run ends.
const UID_ISOLATION = process.env.SANDBOX_ISOLATION === 'uid';
if (UID_ISOLATION && (typeof process.getuid !== 'function' || process.getuid() !== 0)) {
    console.error('SANDBOX_ISOLATION=uid requires the executor to start as root (it drops privileges per run).');
    process.exit(1);
}
if (!UID_ISOLATION && process.env.NODE_ENV === 'production') {
    console.error('SANDBOX_ISOLATION=uid must be enabled in production.');
    process.exit(1);
}
const UID_BASE = 20000;
const UID_RANGE = 10000;
const uidsInUse = new Set();

function allocateUid() {
    for (let i = 0; i < 100; i++) {
        const uid = UID_BASE + crypto.randomInt(UID_RANGE);
        if (!uidsInUse.has(uid)) {
            uidsInUse.add(uid);
            return uid;
        }
    }
    throw new Error('No free sandbox UID');
}

// Run directories live under a root-owned, non-listable parent so runs cannot discover each other.
const TEMP_ROOT = path.join(__dirname, 'temp');
fsSync.mkdirSync(TEMP_ROOT, { recursive: true });
try { fsSync.chmodSync(TEMP_ROOT, 0o711); } catch {}

const MAX_CODE_LENGTH = 100 * 1024;
const MAX_TEST_CASES = 50;
const RUN_TIME_LIMIT_SEC = 2;
const RUN_MEMORY_KB = 256 * 1024;

function safeEqual(a, b) {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// Shared-secret authentication for everything except /health
app.use((req, res, next) => {
    if (req.path === '/health' || !EXECUTOR_TOKEN) return next();
    const provided = req.get('X-Executor-Token') || '';
    if (!provided || !safeEqual(provided, EXECUTOR_TOKEN)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
});

/**
 * Wrap an untrusted command with resource limits, a hard wall-clock kill, and (when configured)
 * a privilege drop to the run's own UID.
 */
function sandboxed(cmd, run, { timeSec, memKb, stdinPath } = {}) {
    const limits = [`-t ${timeSec + 1}`, '-f 16384'];
    if (memKb) limits.push(`-v ${memKb}`);
    if (run.uid) limits.push('-u 128'); // per-run process cap (fork bombs); the UID is unique to this run
    // setpriv (not runuser/su) so PAM does not reset the rlimits set above
    const runAs = run.uid ? `setpriv --reuid=${run.uid} --regid=${run.uid} --clear-groups -- ` : '';
    const stdin = stdinPath ? ` < "${stdinPath}"` : ' < /dev/null';
    // Limits apply only inside the subshell, so the reaper below is not blocked by the process cap.
    const program = `( ulimit ${limits.join(' ')}; exec ${runAs}timeout -s KILL ${timeSec} ${cmd}${stdin} )`;
    if (!run.uid) return program;
    // Reap anything the program left behind (e.g. fork bombs) before this shell exits; otherwise
    // orphans would keep stdout open and stall the request.
    return `${program}; rc=$?; ${reaperCommand(run.uid)}; exit $rc`;
}

/** Freeze, then kill, every process owned by the run's UID (`kill -1` as that UID touches nothing else). */
function reaperCommand(uid) {
    return `setpriv --reuid=${uid} --regid=${uid} --clear-groups -- bash -c 'for i in 1 2 3; do kill -STOP -1; done; kill -KILL -1' 2>/dev/null`;
}

// Helper to run a shell command with promise and timeout
function runCommand(command, timeSec) {
    return new Promise((resolve) => {
        exec(command, { shell: '/bin/bash', timeout: (timeSec + 2) * 1000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                // 124 = `timeout` expired, 137 = SIGKILL, 152 = SIGXCPU from the CPU rlimit
                if (error.killed || error.code === 124 || error.code === 137 || error.code === 152) {
                    return resolve({ success: false, timedOut: true, stdout: stdout || '', stderr: `Execution Timed Out (Limit: ${timeSec.toFixed(1)}s)` });
                }
                return resolve({ success: false, timedOut: false, stdout: stdout || '', stderr: stderr || error.message });
            }
            resolve({ success: true, timedOut: false, stdout: stdout || '', stderr: stderr || '' });
        });
    });
}

async function createRun() {
    const dir = path.join(TEMP_ROOT, crypto.randomBytes(16).toString('hex'));
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const uid = UID_ISOLATION ? allocateUid() : null;
    if (uid) await fs.chown(dir, uid, uid);
    return { dir, uid };
}

/** Kill everything the run's UID left behind, then delete its directory. */
async function cleanupRun(run) {
    if (run.uid) {
        // Backstop in case a command was interrupted before its own reaper ran
        await runCommand(`${reaperCommand(run.uid)}; true`, 3).catch(() => {});
        uidsInUse.delete(run.uid);
    }
    await fs.rm(run.dir, { recursive: true, force: true }).catch(() => {});
}

/**
 * Writes the source, compiles it (as the run's UID) and returns the command to run it.
 * Returns { runCmd, memKb } on success, { compileError } on failure, or { unsupported: true }.
 */
async function prepareProgram(language, code, run) {
    const runDir = run.dir;
    if (language === 'python') {
        const file = path.join(runDir, 'solution.py');
        await fs.writeFile(file, code);
        const check = await runCommand(sandboxed(`python3 -m py_compile "${file}"`, run, { timeSec: 5 }), 5);
        if (!check.success) return { compileError: check.stderr || 'Python syntax error' };
        return { runCmd: `python3 "${file}"`, memKb: RUN_MEMORY_KB };
    }
    if (language === 'c' || language === 'cpp') {
        const isC = language === 'c';
        const file = path.join(runDir, isC ? 'code.c' : 'solution.cpp');
        const bin = path.join(runDir, isC ? 'code.out' : 'solution.out');
        await fs.writeFile(file, code);
        const compiler = isC ? `gcc "${file}" -O2 -o "${bin}"` : `g++ "${file}" -O2 -std=c++20 -o "${bin}"`;
        const res = await runCommand(sandboxed(compiler, run, { timeSec: 15 }), 15);
        if (!res.success) return { compileError: res.stderr || 'Compilation failed' };
        return { runCmd: `"${bin}"`, memKb: RUN_MEMORY_KB };
    }
    if (language === 'java') {
        const file = path.join(runDir, 'Main.java');
        await fs.writeFile(file, code.replace(/public\s+class\s+\w+/g, 'public class Main'));
        const res = await runCommand(sandboxed(`javac -J-Xmx256m "${file}"`, run, { timeSec: 15 }), 15);
        if (!res.success) return { compileError: res.stderr || 'Java compilation failed' };
        // JVM reserves large virtual memory, so cap the heap instead of using ulimit -v
        return { runCmd: `java -Xmx128m -XX:+UseSerialGC -cp "${runDir}" Main`, memKb: null };
    }
    if (language === 'javascript') {
        const file = path.join(runDir, 'script.js');
        await fs.writeFile(file, code);
        // V8 reserves large virtual memory, so cap the heap instead of using ulimit -v
        return { runCmd: `node --max-old-space-size=128 "${file}"`, memKb: null };
    }
    return { unsupported: true };
}

function validatePayload(language, code) {
    if (typeof language !== 'string') return 'Missing language';
    if (typeof code !== 'string' || !code) return 'Missing solution code';
    if (code.length > MAX_CODE_LENGTH) return 'Code exceeds 100 KB limit';
    return null;
}

// Security Inspection: Block dangerous modules, system calls, and fork bombs
function checkMaliciousCode(language, code) {
    if (!code || typeof code !== 'string') return null;

    // Universal blocked patterns
    const universalPatterns = [
        /(?:fork\s*\(|forkbomb|:\(\)\s*\{\s*:\|:&\s*\};:)/i,
        /(?:rm\s+-rf|\/dev\/urandom|\/dev\/zero)/i
    ];
    for (const pat of universalPatterns) {
        if (pat.test(code)) return 'Malicious fork or destruction pattern detected';
    }

    if (language === 'python') {
        const pyForbidden = [
            /\bimport\s+(?:os|subprocess|shutil|socket|pty|commands|multiprocessing|threading|ctypes)\b/,
            /\bfrom\s+(?:os|subprocess|shutil|socket|pty|commands|multiprocessing|threading|ctypes)\b/,
            /\b(?:open\s*\(|file\s*\()/,
            /\b(?:eval\s*\(|exec\s*\(|__import__)/,
            /\bos\.(?:system|popen|spawn|kill|remove|unlink|rmdir)/,
            /\bsys\.(?:exit|modules|setrecursionlimit\s*\(\s*9999999)/
        ];
        for (const pat of pyForbidden) {
            if (pat.test(code)) return `Unauthorized system module or function detected in Python script`;
        }
    } else if (language === 'javascript') {
        const jsForbidden = [
            /\b(?:child_process|fs|cluster|worker_threads|net|http|https|dgram)\b/,
            /\bprocess\.(?:exit|kill|abort|env)/,
            /\beval\s*\(/
        ];
        for (const pat of jsForbidden) {
            if (pat.test(code)) return `Unauthorized system module detected in JavaScript script`;
        }
    } else if (language === 'cpp' || language === 'c') {
        const cppForbidden = [
            /#\s*include\s*<sys\//,
            /#\s*include\s*<unistd\.h>/,
            /#\s*include\s*<windows\.h>/,
            /\b(?:system|fork|exec|popen|kill)\s*\(/
        ];
        for (const pat of cppForbidden) {
            if (pat.test(code)) return `Unauthorized system call detected in C/C++ script`;
        }
    } else if (language === 'java') {
        const javaForbidden = [
            /\b(?:Runtime\.getRuntime|ProcessBuilder|java\.io\.File|java\.net\.)/,
            /\bSystem\.exit/
        ];
        for (const pat of javaForbidden) {
            if (pat.test(code)) return `Unauthorized system class detected in Java script`;
        }
    }
    return null;
}

// Single execution endpoint (backward compatibility)
app.post('/execute', async (req, res) => {
    const { language, code, input } = req.body || {};
    const payloadError = validatePayload(language, code);
    if (payloadError) {
        return res.status(400).json({ status: "error", output: payloadError });
    }
    const secError = checkMaliciousCode(language, code);
    if (secError) {
        return res.status(403).json({ status: "error", output: `Security violation: ${secError}` });
    }

    const run = await createRun();
    const runDir = run.dir;
    try {
        const program = await prepareProgram(language, code, run);
        if (program.unsupported) {
            return res.status(400).json({ error: "Unsupported language" });
        }
        if (program.compileError) {
            return res.json({ status: "error", output: program.compileError });
        }

        const inputPath = path.join(runDir, 'input.in');
        await fs.writeFile(inputPath, typeof input === 'string' ? input : '');

        const result = await runCommand(
            sandboxed(program.runCmd, run, { timeSec: RUN_TIME_LIMIT_SEC, memKb: program.memKb, stdinPath: inputPath }),
            RUN_TIME_LIMIT_SEC
        );
        if (!result.success) {
            return res.json({ status: "error", output: result.stderr || "Execution Error" });
        }
        res.json({ status: "success", output: result.stdout });
    } catch (err) {
        res.status(500).json({ error: "Server error during execution: " + err.message });
    } finally {
        await cleanupRun(run);
    }
});

// Batch validation endpoint for the automated pipeline
// Runs solution against all test cases with a 256MB memory cap and 2.0s limit per case
app.post('/validate', async (req, res) => {
    const { language = 'python', code, testCases = [] } = req.body || {};

    const payloadError = validatePayload(language, code);
    if (payloadError) {
        return res.status(400).json({ allPassed: false, error: payloadError });
    }
    if (!Array.isArray(testCases) || testCases.length === 0) {
        return res.status(400).json({ allPassed: false, error: "Missing test cases" });
    }
    if (testCases.length > MAX_TEST_CASES) {
        return res.status(400).json({ allPassed: false, error: `Too many test cases (max ${MAX_TEST_CASES})` });
    }

    const secError = checkMaliciousCode(language, code);
    if (secError) {
        return res.status(403).json({
            allPassed: false,
            stage: 'security',
            error: `Security violation: ${secError}`,
            passedCount: 0,
            totalCount: testCases.length,
            results: []
        });
    }

    const run = await createRun();
    const runDir = run.dir;

    try {
        const startTime = Date.now();

        // 1. Compilation Phase (if necessary)
        const program = await prepareProgram(language, code, run);
        if (program.unsupported) {
            return res.status(400).json({ allPassed: false, error: `Unsupported language: ${language}` });
        }
        if (program.compileError) {
            return res.json({
                allPassed: false,
                stage: 'compilation',
                error: program.compileError,
                passedCount: 0,
                totalCount: testCases.length,
                results: []
            });
        }

        // 2. Test Cases Execution Phase
        const results = [];
        let allPassed = true;
        let passedCount = 0;

        for (let i = 0; i < testCases.length; i++) {
            const tc = testCases[i] || {};
            let inputStr = typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input ?? '');
            inputStr = inputStr.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t');

            const rawExpected = tc.expectedOutput ?? tc.output ?? '';
            let expectedStr = (typeof rawExpected === 'string' ? rawExpected : JSON.stringify(rawExpected)).trim();
            expectedStr = expectedStr.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t');

            const inputPath = path.join(runDir, `tc_${i}.in`);
            await fs.writeFile(inputPath, inputStr);

            const caseStartTime = Date.now();
            const execRes = await runCommand(
                sandboxed(program.runCmd, run, { timeSec: RUN_TIME_LIMIT_SEC, memKb: program.memKb, stdinPath: inputPath }),
                RUN_TIME_LIMIT_SEC
            );
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
        await cleanupRun(run);
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'IntelX-Execution-Sandbox',
        languages: ['python', 'cpp', 'java', 'c', 'javascript'],
        limits: {
            memory: '256MB',
            timeoutSeconds: 2.0
        }
    });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Executor running on port ${PORT}`));
