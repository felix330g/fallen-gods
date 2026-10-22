// 瀏覽器端對端測試：啟動靜態伺服器 → 新遊戲 → 營火談話 → 跑完整遠征 → 檢查戰報、研究室、存檔
// 用法：node e2e/smoke.mjs [--dist] [網址]（不給網址就自己開本地伺服器；--dist 測打包後的單檔）
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const args = process.argv.slice(2);
const DIST = args.includes('--dist');
const ROOT = new URL(DIST ? '../dist/' : '..', import.meta.url).pathname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
let server, base = args.find((a) => /^https?:/.test(a));
if (!base) {
  server = createServer(async (req, res) => {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
    try { const buf = await readFile(join(ROOT, p)); res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(buf); }
    catch { res.writeHead(404); res.end('not found'); }
  }).listen(0);
  base = `http://127.0.0.1:${server.address().port}/`;
}
const launch = { headless: true };
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launch);
const errors = [];
let ok = 0;
const check = (cond, msg) => { if (!cond) throw new Error('E2E 失敗：' + msg); ok++; console.log('  ✓', msg); };

async function play(page, label) {
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(`${label}: ${m.text()}`); });
  await page.goto(base);
  await page.getByRole('button', { name: '新遊戲' }).click();
  check(await page.getByRole('button', { name: '出發遠征' }).isVisible(), `${label} 進入營地`);
  check(await page.getByText(/v0\.5\.\d/).isVisible(), `${label} 顯示版本 v0.5`);
  // 營火談話：受限選單，聊完當天鎖住
  await page.locator('button[data-act="talk"][data-arg="ade:past"]').click();
  check(await page.locator('#talkResult').isVisible(), `${label} 營火談話有回應`);
  check(await page.locator('button[data-act="talk"][data-arg="ade:recent"]').isDisabled(), `${label} 同一天不能再找同一人聊`);
  await page.getByRole('button', { name: '出發遠征' }).click();
  let battles = 0, events = 0, safety = 0;
  while (safety++ < 60) {
    const t = await page.locator('#app').innerText();
    if (t.includes('出發遠征')) break;
    if (await page.getByRole('button', { name: /^執行第|^下一回合/ }).count()) {
      if (battles === 0 && label === 'desktop') await page.getByRole('button', { name: /^執行第|^下一回合/ }).click();
      await page.getByRole('button', { name: /自動打完|剩下交給戰術/ }).click();
      continue;
    }
    if (await page.getByRole('button', { name: '查看戰報' }).count()) {
      await page.getByRole('button', { name: '查看戰報' }).click();
      battles++;
      if (battles === 1) {
        check(await page.getByText('有效傷害').first().isVisible(), `${label} 結算頁顯示`);
        await page.getByRole('button', { name: '戰報', exact: true }).click();
        check((await page.locator('.log .ln').count()) > 3, `${label} 簡易戰報有內容`);
        await page.getByRole('button', { name: '切換到詳細' }).click();
        check(await page.getByText(/命中率 \d+%/).first().isVisible(), `${label} 詳細戰報顯示判定`);
        await page.getByRole('button', { name: '統計與狀態' }).click();
        check(await page.locator('svg polyline').count() > 0, `${label} HP 曲線`);
        await page.locator('table button.link').first().click();
        check(await page.getByText(/只顯示 \d+ 個來源事件/).isVisible(), `${label} 統計數字可點回來源事件`);
        await page.getByRole('button', { name: '隊伍演出' }).click();
      }
      await page.getByRole('button', { name: /繼續探索|返回營地/ }).click();
      continue;
    }
    if (await page.locator('button[data-act="eventChoice"]:not([disabled])').count()) {
      await page.locator('button[data-act="eventChoice"]:not([disabled])').first().click(); events++; continue;
    }
    if (await page.locator('button[data-act="route"]').count()) {
      const pot = page.locator('button[data-act="potion"]:not([disabled])');
      if (await pot.count()) {
        const bars = await page.locator('.unit .small.muted').allInnerTexts();
        if (bars.some((b) => { const m = b.match(/(\d+)\/(\d+)/); return m && +m[1] < +m[2] * 0.4; })) { await pot.first().click(); continue; }
      }
      await page.locator('button[data-act="route"]').first().click();
      continue;
    }
    throw new Error('卡住了：' + t.slice(0, 300));
  }
  check(battles >= 3, `${label} 完成遠征（${battles} 場戰鬥、${events} 次奇遇）`);
  return battles;
}

try {
  const desk = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await play(desk, 'desktop');
  // 新的一天可以再聊
  check(!(await desk.locator('button[data-act="talk"][data-arg="ade:recent"]').isDisabled()), 'desktop 隔天可以再聊');
  await desk.locator('button[data-act="talk"][data-arg="xiaomei:recent"]').click();
  check(await desk.locator('#talkResult').isVisible(), 'desktop 遠征後聊戰鬥');
  // 研究室與訓練場
  await desk.getByRole('button', { name: '研究室' }).click();
  await desk.locator('button[data-act="experiment"][data-arg="airin"]').click();
  check(await desk.getByText(/實驗結果/).isVisible(), 'desktop 訓練場對照實驗');
  await desk.getByRole('button', { name: '記憶簿' }).click();
  check(await desk.getByRole('heading', { name: '記憶簿' }).isVisible(), 'desktop 記憶簿');
  await desk.getByRole('button', { name: '設定' }).click();
  check(await desk.getByText(/seed \d+/).isVisible(), 'desktop 回報問題的版本資訊');
  await desk.getByRole('button', { name: '匯出存檔' }).click();
  const exported = await desk.locator('#exportText').inputValue();
  check(exported.startsWith('{') && JSON.parse(exported).version === 1, 'desktop 匯出存檔文字');
  await desk.getByRole('button', { name: '刪除存檔並重來' }).click();
  await desk.getByRole('button', { name: '取消' }).click();
  check(await desk.getByRole('button', { name: '刪除存檔並重來' }).isVisible(), 'desktop 刪除需要頁內二次確認（不用 confirm 對話框）');
  await desk.reload();
  await desk.getByRole('button', { name: '繼續' }).click();
  check(await desk.getByText(/第 2 天/).isVisible(), 'desktop 重新整理後自動存檔可繼續');
  // 世界改變：匯入一個已擊敗 Boss 的存檔，營地顯示「餘燼回流」
  const ember = JSON.parse(exported); ember.flags.boss_defeated = true;
  await desk.getByRole('button', { name: '設定' }).click();
  await desk.locator('details summary').click();
  await desk.locator('#pasteSave').fill(JSON.stringify(ember));
  await desk.getByRole('button', { name: '匯入貼上的存檔' }).click();
  await desk.getByRole('button', { name: '營地', exact: true }).click();
  check(await desk.getByText('餘燼回流').first().isVisible(), 'desktop 擊敗 Boss 後地城狀態改變');
  // 逐回合指揮模式
  await desk.getByRole('button', { name: '設定' }).click();
  await desk.locator('select[data-change="mode"]').selectOption('manual');
  await desk.getByRole('button', { name: '營地', exact: true }).click();
  await desk.getByRole('button', { name: '出發遠征' }).click();
  for (let i = 0; i < 6 && !(await desk.getByRole('button', { name: /^執行第/ }).count()); i++) {
    const ev = desk.locator('button[data-act="eventChoice"]:not([disabled])');
    if (await ev.count()) await ev.first().click(); else await desk.locator('button[data-act="route"]').first().click();
  }
  check(await desk.locator('.cmd select').count() > 0, 'desktop 逐回合指揮面板');
  await desk.screenshot({ path: 'e2e/shot-battle.png', fullPage: true });
  await desk.getByRole('button', { name: /^執行第/ }).click();
  check(await desk.getByText(/（玩家指令）|R1/).first().isVisible(), 'desktop 玩家指令已執行');

  const phone = await browser.newPage({ viewport: { width: 375, height: 760 }, isMobile: true });
  await play(phone, 'mobile');
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `mobile 沒有水平捲動（${overflow}px）`);
  await phone.screenshot({ path: 'e2e/shot-mobile.png', fullPage: true });
  check(errors.length === 0, '瀏覽器沒有 JS 錯誤' + (errors.length ? '：' + errors.join(' | ') : ''));
  console.log(`E2E 通過：${ok} 項`);
} catch (e) {
  console.error(e.message);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  server?.close();
}
