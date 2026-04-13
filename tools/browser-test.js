#!/usr/bin/env node
// 浏览器真机测试：用 Playwright 打开真实页面，模拟快速开始流程
// 测试 1真人创建房间 → 选人数 → 快速开始 → 自动补AI → 走完整局

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
    check(true, '页面加载完成');

    // 2. 输入昵称 + 创建房间
    log('  [2] 创建房间...');
    await page.locator('#input-name').fill('🧪测试员');
    await page.click('#btn-create');

    // 等房间大厅出现
    await page.waitForSelector('#view-room.active, #room-code-display', { timeout: 15000 });
    await sleep(1500);
    const roomCode = await page.locator('#room-code-display').textContent().catch(() => '');
    check(!!roomCode, `房间创建成功, 码: ${roomCode}`);

    // 3. 等待人数选择器
    log('  [3] 选人数...');
    await page.waitForSelector('#player-count-options', { timeout: 10000 });
    await sleep(500);

    // 点对应人数按钮
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
    const quickBtnText = await page.locator('#btn-quick-start').textContent();
    log(`    按钮文字: ${quickBtnText.trim()}`);
    check(quickBtnText.includes('快速开始'), '快速开始按钮可见');
    await page.click('#btn-quick-start');

    // 5. 等角色分配
    log('  [5] 等待引擎启动...');
    for (let i = 0; i < 60; i++) {
      if (consoleLogs.some(l => l.includes('分配角色'))) break;
      await sleep(500);
    }
    check(consoleLogs.some(l => l.includes('分配角色')), '角色分配完成');
    check(consoleLogs.some(l => l.includes('补') && l.includes('AI')), '自动补AI');

    // 6. 跑完游戏（自动交互）
    log('  [6] 游戏进行中，自动交互...');
    const maxSeconds = targetTotal >= 10 ? 300 : 180;
    for (let i = 0; i < maxSeconds; i++) {
      if (consoleLogs.some(l => l.includes('游戏结束'))) break;

      // 每2秒尝试一轮交互
      if (i % 2 === 0) {
        // 约会：点"今晚不约"
        await tryClick(page, 'button:has-text("今晚不约")');
        // 夜间行动：选第一个目标
        const targetClicked = await tryClick(page, '.player-select-btn, .night-target, #night-content .btn-ghost');
        if (targetClicked) {
          await sleep(200);
          await tryClick(page, 'button:has-text("确认")');
        }
        // 投票：处决
        await tryClick(page, 'button:has-text("处决")');
        // 夜间情报：知道了
        await tryClick(page, 'button:has-text("知道了"), button:has-text("继续")');
      }
      await sleep(1000);
    }

    const gameOver = consoleLogs.some(l => l.includes('游戏结束'));
    check(gameOver, '游戏正常结束');

    // 胜负
    const winLog = consoleLogs.find(l => l.includes('游戏结束'));
    if (winLog) log(`  🏆 ${winLog}`);

    // 页面错误（忽略无害的）
    const criticalErrors = pageErrors.filter(e =>
      !e.includes('ResizeObserver') && !e.includes('Non-Error') && !e.includes('Script error')
    );
    check(criticalErrors.length === 0,
      criticalErrors.length === 0 ? '无页面错误' : `页面错误: ${criticalErrors[0]}`);

    // Engine 关键日志
    log('\n  📊 引擎关键日志:');
    consoleLogs.filter(l => l.includes('[Engine]')).forEach(l => log(`    ${l}`));

  } catch (e) {
    console.log(`  ❌ 测试异常: ${e.message}`);
    failed++;
  } finally {
    await browser.close();
  }

  return { passed, failed };
}

async function main() {
  log('\n🌐 夜店钟楼 — 浏览器真机测试');
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
