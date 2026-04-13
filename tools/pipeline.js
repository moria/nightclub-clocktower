#!/usr/bin/env node
// nightclub-clocktower automated dev pipeline
// Usage: node tools/pipeline.js [--test-only] [--msg "..."] [--skip-deploy-check] [--fast]

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const flagVal = (name) => { const i = args.indexOf(name); return i !== -1 && i + 1 < args.length ? args[i + 1] : null; };

const testOnly = flag('--test-only');
const fast = flag('--fast');
const skipDeployCheck = flag('--skip-deploy-check');
const commitMsg = flagVal('--msg') || 'pipeline: automated commit';

const pipelineStart = Date.now();
let localServer = null;

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

function log(msg) { console.log(`[PIPELINE] ${msg}`); }

function runProc(cmd, args, opts = {}) {
  const timeout = opts.timeout || 180000;
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd: ROOT, stdio: 'pipe' });
    let stdout = '', stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; if (opts.onStdout) opts.onStdout(d.toString()); });
    proc.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => { proc.kill('SIGTERM'); reject(new Error(`Timeout after ${timeout / 1000}s`)); }, timeout);
    proc.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    if (opts.returnProc) opts.returnProc(proc);
  });
}

function last20(text) {
  const lines = text.trim().split('\n');
  return lines.slice(-20).join('\n');
}

// Phase 1: Start local server
async function phase1() {
  log('Phase 1/5: Local server...');
  // Kill any stale server on port 8080
  try { require('child_process').execSync("lsof -ti :8080 | xargs kill -9 2>/dev/null", { stdio: 'ignore' }); } catch (e) {}
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['tools/local-server.js', '--port', '8080'], { cwd: ROOT, stdio: 'pipe' });
    localServer = proc;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error('Local server did not start within 10s')); }
    }, 10000);
    proc.stdout.on('data', (d) => {
      if (!settled && d.toString().includes('LOCAL SERVER READY')) {
        settled = true; clearTimeout(timer); resolve();
      }
    });
    proc.stderr.on('data', (d) => {
      if (!settled && d.toString().includes('LOCAL SERVER READY')) {
        settled = true; clearTimeout(timer); resolve();
      }
    });
    proc.on('close', (code) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`Server exited with code ${code}`)); }
    });
    proc.on('error', (err) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(err); }
    });
  });
}

// Phase 2: Run tests
async function phase2() {
  log('Phase 2/5: Tests...');
  const results = [];

  async function runTest(name, cmd, args, timeout) {
    const start = Date.now();
    try {
      const r = await runProc(cmd, args, { timeout });
      const duration = Date.now() - start;
      const pass = r.code === 0;
      results.push({ name, pass, duration, stdout: r.stdout, stderr: r.stderr });
    } catch (err) {
      results.push({ name, pass: false, duration: Date.now() - start, stdout: '', stderr: err.message });
    }
  }

  const tasks = [];
  // Always run e2e and browser-test
  tasks.push(runTest('e2e-test', 'node', ['tools/e2e-test.js'], 180000));
  tasks.push(runTest('browser-test', 'node', ['tools/browser-test.js', '--url', 'http://localhost:8080', '5'], 180000));

  if (!fast) {
    tasks.push(runTest('multi-test --fill', 'node', ['tools/multi-test.js', '--fill', '5', '7'], 300000));
  }

  await Promise.all(tasks);
  return results;
}

// Phase 3: Evaluate
function phase3(results) {
  for (const r of results) {
    const tag = r.pass ? 'PASS' : 'FAIL';
    const pad = '.'.repeat(Math.max(1, 22 - r.name.length));
    console.log(`  ${r.name} ${pad} ${tag} (${fmtDuration(r.duration)})`);
  }
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    log('Phase 3/5: FAILED');
    for (const f of failed) {
      console.log(`\n--- ${f.name} (last 20 lines) ---`);
      const output = (f.stdout + '\n' + f.stderr).trim();
      console.log(last20(output));
    }
    return false;
  }
  log('Phase 3/5: All passed \u2705');
  return true;
}

// Phase 4: Commit + Push
async function phase4() {
  log('Phase 4/5: Commit + Push...');
  const addPaths = ['js/', 'tools/', 'css/', 'index.html'];
  await runProc('git', ['add', ...addPaths]);

  const fullMsg = [
    commitMsg,
    '',
    'Generated with [Claude Code](https://claude.ai/code)',
    'via [Happy](https://happy.engineering)',
    '',
    'Co-Authored-By: Claude <noreply@anthropic.com>',
    'Co-Authored-By: Happy <yesreply@happy.engineering>',
  ].join('\n');

  const commitResult = await runProc('git', ['commit', '-m', fullMsg]);
  if (commitResult.code !== 0) {
    // Nothing to commit is acceptable
    if (commitResult.stdout.includes('nothing to commit') || commitResult.stderr.includes('nothing to commit')) {
      log('Phase 4/5: Nothing to commit');
      return null;
    }
    throw new Error('Commit failed:\n' + commitResult.stderr);
  }

  // Extract short hash
  const hashResult = await runProc('git', ['rev-parse', '--short', 'HEAD']);
  const hash = hashResult.stdout.trim();

  const pushResult = await runProc('git', ['push', 'origin', 'main'], { timeout: 60000 });
  if (pushResult.code !== 0) throw new Error('Push failed:\n' + pushResult.stderr);

  log(`Phase 4/5: Committed ${hash}, pushed`);
  return hash;
}

// Phase 5: Deploy verification
async function phase5() {
  log('Phase 5/5: Deploy verification...');
  log('Waiting 35s for GitHub Pages deploy...');
  await new Promise((r) => setTimeout(r, 35000));

  const r = await runProc('node', ['tools/browser-test.js', '5'], { timeout: 180000 });
  if (r.code === 0) {
    log('Phase 5/5: Deploy verified \u2705');
  } else {
    log('Phase 5/5: Deploy verification FAILED');
    console.log(last20((r.stdout + '\n' + r.stderr).trim()));
    throw new Error('Deploy verification failed');
  }
}

// Main
async function main() {
  const totalPhases = testOnly ? 3 : (skipDeployCheck ? 4 : 5);
  log('\u2550'.repeat(30));

  try {
    // Phase 1
    await phase1();
    log('Phase 1/5: Local server... OK');

    // Phase 2
    const results = await phase2();

    // Phase 3
    const allPassed = phase3(results);
    if (!allPassed) process.exit(1);

    // Phase 4
    if (!testOnly) {
      await phase4();
    }

    // Phase 5
    if (!testOnly && !skipDeployCheck) {
      await phase5();
    }

    log(`DONE in ${fmtDuration(Date.now() - pipelineStart)}`);
    process.exit(0);
  } catch (err) {
    log(`FATAL: ${err.message}`);
    process.exit(1);
  } finally {
    if (localServer) {
      localServer.kill('SIGTERM');
    }
  }
}

main();
