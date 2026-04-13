#!/usr/bin/env node
// 浏览器真机测试：用 Playwright 打开真实页面，模拟快速开始流程
// 重点验证：UI 不黑屏，每个阶段都有可见内容

const { chromium } = require('playwright');

const TARGET_URL = 'https://moria.github.io/nightclub-clocktower/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (msg) => console.log(`[Browser] ${msg}`);

let passed = 0, failed = 0;
function check(ok, msg) {
  if (ok) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

async function tryClick(page, selector, timeout = 1000) {
  try {
    const el = page.locator(selector).first();
    if (await el.isVisible({ timeout })) { await el.click(); return true; }
  } catch (e) {}
  return false;
}

async function getActiveView(page) {
  return page.evaluate(() => {
    const active = document.querySelector('.view.active');
    return active ? { id: active.id, text: active.textContent.trim().substring(0, 100) } : null;
  });
}

async function runBrowserTest(targetTotal) {
  log(`\n${'═'.repeat(60)}`);
  log(`  🌐 浏览器测试: ${targetTotal}人局 (1真人 + ${targetTotal - 1}个AI补位)`);
  log(`${'═'.repeat(60)}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push(text);
    if (text.includes('[Engine]')) process.stdout.write(`  📋 ${text}\n`);
  });

  const pageErrors = [];
  page.on('pageerror', err => {
    pageErrors.push(err.message);
    console.log(`  ⚠️ 页面错误: ${err.message}`);
  });

  try {
    // 1. 打开页面
    log('  [1] 打开页面...');
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
    // 清除 localStorage 防止恢复旧状态
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    check(true, '页面加载完成');

    // 2. 创建房间
    log('  [2] 创建房间...');
    await page.locator('#input-name').fill('🧪测试员');
    await page.click('#btn-create');
    await page.waitForSelector('#view-room.active, #room-code-display', { timeout: 15000 });
    await sleep(1500);
    const roomCode = await page.locator('#room-code-display').textContent().catch(() => '');
    check(!!roomCode, `房间创建成功, 码: ${roomCode}`);

    // 3. 选人数
    log('  [3] 选人数...');
    await page.waitForSelector('#player-count-options', { timeout: 10000 });
    await sleep(500);
    const clicked = await page.evaluate((n) => {
      const btns = document.querySelectorAll('#player-count-options button');
      for (const btn of btns) {
        if (btn.textContent.includes(String(n))) { btn.click(); return true; }
      }
      return false;
    }, targetTotal);
    check(clicked, `选择 ${targetTotal} 人`);
    await sleep(500);

    // 4. 快速开始
    log('  [4] 快速开始...');
    await page.click('#btn-quick-start');

    // 5. === 关键验证：角色揭示 ===
    log('  [5] 验证角色揭示...');
    await sleep(2000); // 等 WS 回程 + 渲染
    let view = await getActiveView(page);
    log(`    当前视图: ${view?.id} — "${view?.text?.substring(0, 60)}"`);

    // 检查 view-reveal 有内容（不是空白）
    const revealContent = await page.evaluate(() => {
      const el = document.querySelector('#reveal-content');
      return el ? el.textContent.trim() : '';
    });
    check(revealContent.length > 10, `角色揭示有内容 (${revealContent.length}字): "${revealContent.substring(0, 50)}..."`);

    // 检查不是黑屏：有可见文字元素
    const hasVisibleText = await page.evaluate(() => {
      const active = document.querySelector('.view.active');
      if (!active) return false;
      const text = active.textContent.trim();
      return text.length > 5;
    });
    check(hasVisibleText, '当前视图有可见文字（不是黑屏）');

    // 6. === 等待进入夜晚，验证约会 UI ===
    log('  [6] 验证夜晚UI...');
    for (let i = 0; i < 30; i++) {
      if (consoleLogs.some(l => l.includes('第') && l.includes('夜'))) break;
      await sleep(500);
    }
    await sleep(2000); // 等渲染

    const nightContent = await page.evaluate(() => {
      const el = document.querySelector('#night-content');
      return el ? el.textContent.trim() : '';
    });
    log(`    夜晚内容: "${nightContent.substring(0, 80)}"`);
    check(nightContent.length > 5, `夜晚视图有内容 (${nightContent.length}字)`);

    // 7. 自动交互走完游戏
    log('  [7] 游戏进行中...');
    const maxSeconds = targetTotal >= 10 ? 360 : 240;
    let phasesSeenWithContent = new Set();

    for (let i = 0; i < maxSeconds; i++) {
      if (consoleLogs.some(l => l.includes('游戏结束'))) break;

      if (i % 1 === 0) { // 每秒尝试交互
        // 记录当前视图状态
        const v = await getActiveView(page);
        if (v && v.text.length > 5) phasesSeenWithContent.add(v.id);

        // 约会：不约
        await tryClick(page, 'button:has-text("今晚不约")');
        // 夜间行动：选第一个目标
        const targetClicked = await tryClick(page, '.target-btn');
        if (targetClicked) {
          await sleep(300);
          await tryClick(page, '#btn-confirm-action');
          await tryClick(page, 'button:has-text("确认")');
        }
        // 夜间情报
        await tryClick(page, 'button:has-text("知道了")');
        // 投票
        await tryClick(page, 'button:has-text("处决")');
        await tryClick(page, 'button:has-text("反对")');
      }
      await sleep(1000);
    }

    const gameOver = consoleLogs.some(l => l.includes('游戏结束'));
    check(gameOver, '游戏正常结束');

    // 8. 验证游戏结束 UI
    await sleep(1000);
    const endContent = await page.evaluate(() => {
      const el = document.querySelector('#end-content');
      return el ? el.textContent.trim() : '';
    });
    check(endContent.length > 10, `结束画面有内容 (${endContent.length}字): "${endContent.substring(0, 50)}..."`);

    log(`    有内容的视图: ${[...phasesSeenWithContent].join(', ')}`);

    // 页面错误
    const criticalErrors = pageErrors.filter(e =>
      !e.includes('ResizeObserver') && !e.includes('Non-Error') && !e.includes('Script error')
    );
    check(criticalErrors.length === 0,
      criticalErrors.length === 0 ? '无页面错误' : `页面错误: ${criticalErrors[0]}`);

  } catch (e) {
    console.log(`  ❌ 测试异常: ${e.message}`);
    failed++;
  } finally {
    await browser.close();
  }

  return { passed, failed };
}

async function main() {
  log('\n🌐 夜店钟楼 — 浏览器真机测试（含UI验证）');
  log('━'.repeat(60));

  const args = process.argv.slice(2);
  const sizes = args.filter(a => !isNaN(a)).map(Number);
  const testSizes = sizes.length > 0 ? sizes : [5, 7];

  let totalPassed = 0, totalFailed = 0;

  for (const size of testSizes) {
    const result = await runBrowserTest(size);
    totalPassed += result.passed;
    totalFailed += result.failed;
  }

  log(`\n${'━'.repeat(60)}`);
  log(`🏁 总结: ${totalPassed} passed, ${totalFailed} failed`);
  log(`${'━'.repeat(60)}`);

  process.exit(totalFailed > 0 ? 1 : 0);
}

main();
