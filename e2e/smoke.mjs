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
const VERSION = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
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
let gearSave = null; // 含背包裝備的存檔，給手機寬度檢查重用
const check = (cond, msg) => { if (!cond) throw new Error('E2E 失敗：' + msg); ok++; console.log('  ✓', msg); };

async function play(page, label) {
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(`${label}: ${m.text()}`); });
  await page.goto(base);
  await page.getByRole('button', { name: '新遊戲' }).click();
  check(await page.getByRole('button', { name: '出發遠征' }).isVisible(), `${label} 進入營地`);
  check(await page.getByText(`v${VERSION}`).first().isVisible(), `${label} 顯示版本 v${VERSION}`);
  // 營火談話：受限選單，聊完當天鎖住
  await page.locator('button[data-act="openDlg"][data-arg="ade"]').click();
  check(await page.locator('#dialogBox').isVisible(), `${label} 營火對話框打開`);
  await page.locator('button[data-act="talk"][data-arg="ade:past"]').click();
  check(await page.locator('#talkResult').isVisible(), `${label} 營火談話有回應`);
  check(await page.locator('button[data-act="talk"][data-arg="ade:recent"]').isDisabled(), `${label} 同一天不能再找同一人聊`);
  await page.getByRole('button', { name: '出發遠征' }).click();
  let battles = 0, events = 0, safety = 0;
  while (safety++ < 80) {
    const t = await page.locator('#app').innerText();
    if (t.includes('出發遠征')) break;
    if (await page.getByRole('button', { name: /^執行第|^下一回合/ }).count()) {
      if (battles === 0 && label === 'desktop') await page.getByRole('button', { name: /^執行第|^下一回合/ }).click();
      // 單步後戰鬥可能已結束（種子隨機），此時沒有自動按鈕，回到迴圈判斷
      const auto = page.getByRole('button', { name: /自動打完|剩下交給戰術/ });
      if (await auto.count()) await auto.click();
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
        const total = await page.locator('.log .ln').count();
        const skillSel = page.locator('select[data-arg="skill"]');
        const skillOpt = await skillSel.locator('option').nth(1).getAttribute('value');
        const skillText = await skillSel.locator('option').nth(1).innerText();
        await skillSel.selectOption(skillOpt);
        const skLines = await page.locator('.log .ln').allInnerTexts();
        check(skLines.length > 0 && skLines.length < total && skLines.every((t) => t.includes(skillText) || /冷卻|命中|暴擊|傷害|護盾|治療|狀態|淨化|倒下|羈絆|階段/.test(t)), `${label} 詳細戰報依技能篩選`);
        const turnTags = async () => (await page.locator('.log .ln .t').allInnerTexts()).map((t) => t.split('・')[0]);
        await skillSel.selectOption('');
        const turnSel = page.locator('select[data-arg="turn"]');
        const turnVal = await turnSel.locator('option').last().getAttribute('value');
        await turnSel.selectOption(turnVal);
        const tt = await turnTags();
        check(tt.length > 0 && tt.every((t) => t === `R${turnVal}`), `${label} 詳細戰報依回合篩選`);
        check((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, `${label} 篩選列沒有水平捲動`);
        await page.getByRole('button', { name: '清除篩選' }).click();
        check((await page.locator('.log .ln').count()) === total, `${label} 清除篩選後恢復`);
        await page.getByRole('button', { name: '統計與狀態' }).click();
        const stRows = await page.locator('#skillTable tr[data-skillrow]').count();
        check(stRows > 0, `${label} 統計頁有技能使用表`);
        const useBtn = page.locator('#skillTable tr[data-skillrow] button.link').first();
        const useN = +(await useBtn.innerText());
        await useBtn.click();
        check((await page.locator('.log .ln').count()) === useN, `${label} 點技能次數只顯示同數量事件`);
        await page.getByRole('button', { name: '統計與狀態' }).click();
        check(await page.locator('svg polyline').count() > 0, `${label} HP 曲線`);
        await page.locator('table button.link').first().click();
        check(await page.getByText(/只顯示 \d+ 個來源事件/).isVisible(), `${label} 統計數字可點回來源事件`);
        await page.getByRole('button', { name: '隊伍演出' }).click();
        check(await page.locator('#aiPanel').count() === 0, `${label} 一般網頁不顯示 AI 演出（只在 claude.ai 託管頁出現）`);
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

const SAVE_KEY_E2E = 'fallen-gods-save-v1';
try {
  const desk = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await play(desk, 'desktop');
  // 新的一天可以再聊
  check(!(await desk.locator('button[data-act="talk"][data-arg="ade:recent"]').isDisabled()), 'desktop 隔天可以再聊');
  await desk.locator('button[data-act="openDlg"][data-arg="xiaomei"]').click();
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
  // 研究確認記憶（battle_id 為 null）：寫進存檔後重新載入，記憶簿顯示「研究室」而不是「戰鬥 null」
  await desk.evaluate((key) => {
    const g = JSON.parse(localStorage.getItem(key));
    g.memories.push({ key: 'bond_confirmed:ade|xiaomei', type: 'bond_confirmed', actors: ['ade', 'xiaomei'], event_ids: [], ref_keys: [], witnesses: ['ade', 'xiaomei'], battle_id: null, day: g.day, text: 'E2E 研究確認記憶' });
    localStorage.setItem(key, JSON.stringify(g));
  }, SAVE_KEY_E2E);
  await desk.reload();
  await desk.getByRole('button', { name: '繼續' }).click();
  await desk.getByRole('button', { name: '記憶簿' }).click();
  check(await desk.getByText(/E2E 研究確認記憶/).isVisible() && await desk.getByText(/研究室・記得的人/).isVisible(), 'desktop 記憶簿顯示研究確認記憶（無戰鬥編號）');
  check(!(await desk.getByText(/戰鬥 null/).count()), 'desktop 記憶簿沒有「戰鬥 null」');
  await desk.reload();
  await desk.getByRole('button', { name: '繼續' }).click();
  check(await desk.getByText(/第 2 天/).isVisible(), 'desktop 重新整理後自動存檔可繼續');
  // 世界改變：匯入一個已擊敗 Boss 的存檔，營地顯示「餘燼回流」
  const ember = JSON.parse(exported); ember.flags.boss_defeated = true; ember.inventory = ['rusty_blade', 'rusty_blade', 'temple_mail~sturdy', 'hunter_bow~keen~precise']; gearSave = ember;
  await desk.getByRole('button', { name: '設定' }).click();
  await desk.locator('details summary').click();
  await desk.locator('#pasteSave').fill(JSON.stringify(ember));
  await desk.getByRole('button', { name: '匯入貼上的存檔' }).click();
  await desk.getByRole('button', { name: '營地', exact: true }).click();
  check(await desk.getByText('餘燼回流').first().isVisible(), 'desktop 擊敗 Boss 後地城狀態改變');
  // 詞綴裝備與分解（v0.5）
  await desk.getByRole('button', { name: '裝備', exact: true }).click();
  check(await desk.getByText('鋒利・精準的獵人長弓').isVisible() && await desk.locator('.rar-e').first().isVisible(), 'desktop 詞綴裝備顯示史詩稀有度');
  // 裝備比較與背包排序（v0.6）
  const names = () => desk.locator('.invrow .invname').allInnerTexts().then((a) => a.map((t) => t.split('\n')[0].replace(/(普通|精良|稀有|史詩).*$/, '').trim()));
  const optTexts = (row) => row.locator('select[data-change="equip"] option').allInnerTexts();
  const rowOf = (name) => desk.locator('.invrow').filter({ hasText: name });
  check((await optTexts(rowOf('生鏽短劍').first())).includes('艾琳（攻 +2）'), 'desktop 空著的部位列出全部屬性');
  await desk.locator('.invrow').first().locator('select[data-change="equip"]').selectOption('ade');
  check((await optTexts(rowOf('生鏽短劍'))).includes('阿德（相同）'), 'desktop 同裝備顯示「相同」');
  check((await optTexts(rowOf('獵人長弓'))).includes('阿德（攻 +2、速 +1、暴 +4）'), 'desktop 屬性差數字正確');
  check((await optTexts(rowOf('神殿鏈甲'))).includes('小梅（生命 +10、防 +3）'), 'desktop 防具比較（空部位）');
  check((await names()).join('|') === '生鏽短劍|堅固的神殿鏈甲|鋒利・精準的獵人長弓', 'desktop 預設為取得順序: ' + (await names()).join('|'));
  await desk.locator('select[data-change="invSort"]').selectOption('rarity');
  check((await names()).join('|') === '鋒利・精準的獵人長弓|堅固的神殿鏈甲|生鏽短劍', 'desktop 依稀有度排序');
  await desk.locator('select[data-change="invSort"]').selectOption('slot');
  check((await names()).join('|') === '生鏽短劍|鋒利・精準的獵人長弓|堅固的神殿鏈甲', 'desktop 依部位排序');
  await desk.locator('select[data-change="invSort"]').selectOption('rarity');
  // 排序後裝備與分解仍作用在正確物品
  await rowOf('神殿鏈甲').locator('select[data-change="equip"]').selectOption('airin');
  check(await desk.locator('tr', { hasText: '艾琳' }).getByText('堅固的神殿鏈甲').isVisible(), 'desktop 排序後裝備到正確物品');
  const goldBefore = +(await desk.locator('.stats span').nth(1).innerText()).match(/\d+/)[0];
  await rowOf('獵人長弓').locator('button[data-act="salvage"]').click();
  await desk.locator('button[data-act="salvageYes"]').click();
  const goldAfter = +(await desk.locator('.stats span').nth(1).innerText()).match(/\d+/)[0];
  check(await desk.getByText(/分解完成/).isVisible() && goldAfter === goldBefore + 35, `desktop 排序後分解需二次確認並得到金幣（${goldBefore}→${goldAfter}）`);
  check((await names()).join('|') === '生鏽短劍', 'desktop 分解後只剩正確的物品');
  // 招募與營火對話框（v0.7）：匯入有寶石的存檔
  const rich = JSON.parse(exported); rich.gems = 20; rich.affinity = { ...(rich.affinity || {}), ade: 3 }; rich.talked = {};
  await desk.getByRole('button', { name: '設定' }).click();
  await desk.locator('details summary').click();
  await desk.locator('#pasteSave').fill(JSON.stringify(rich));
  await desk.getByRole('button', { name: '匯入貼上的存檔' }).click();
  await desk.getByRole('button', { name: '招募', exact: true }).click();
  check(await desk.getByText(/寶石 20/).isVisible() || (await desk.locator('.stats').innerText()).includes('寶石 20'), 'desktop 頂欄顯示寶石');
  await desk.locator('button[data-act="pull"][data-arg="recruit"]').click();
  check(await desk.locator('#meetPanel').isVisible() && (await desk.locator('#meetPanel .moment').innerText()).length > 20, 'desktop 招募到新夥伴先顯示相遇故事');
  check((await desk.locator('.stats').innerText()).includes('寶石 15'), 'desktop 招募扣 5 寶石');
  await desk.locator('button[data-act="join"]').click();
  await desk.getByRole('button', { name: '隊伍', exact: true }).click();
  check((await desk.locator('button[data-act="toggleParty"]').count()) === 5, 'desktop 新夥伴出現在隊伍名冊');
  await desk.locator('details summary', { hasText: '相遇的那天' }).click();
  check(await desk.getByText(/模板故事（測試用）/).isVisible(), 'desktop 可以重讀相遇故事');
  await desk.getByRole('button', { name: '招募', exact: true }).click();
  const poolText = await desk.locator('.unit', { hasText: '領悟技能' }).innerText();
  check(/艾琳「齊射」/.test(poolText) && !/洛克/.test(poolText), 'desktop 技能池只有上陣角色的技能');
  await desk.locator('button[data-act="pull"][data-arg="skill"]').click();
  check(await desk.locator('#gachaResult').getByText(/領悟了/).isVisible() && (await desk.locator('.stats').innerText()).includes('寶石 12'), 'desktop 領悟技能扣 3 寶石');
  await desk.getByRole('button', { name: '營地', exact: true }).click();
  await desk.locator('button[data-act="openDlg"][data-arg="xiaomei"]').click();
  await desk.locator('button[data-act="talk"][data-arg="xiaomei:magic"]').click();
  check(await desk.locator('#talkResult').getByText(/小鳥/).isVisible(), 'desktop 對話框選項有回應');
  await desk.locator('button[data-act="follow"][data-arg="xiaomei:magic:tease"]').click();
  check(await desk.getByText('是鳥啦').isVisible() && await desk.locator('button[data-act="talk"][data-arg="xiaomei:past"]').isDisabled(), 'desktop 追問有回應、當天話題用完');
  check(await desk.getByText(/好感 3 以後/).isVisible(), 'desktop 好感不足時不開放打字');
  await desk.locator('button[data-act="openDlg"][data-arg="ade"]').click();
  check(await desk.getByText(/只在 claude.ai 版本提供/).isVisible() && !(await desk.locator('#chatInput').count()), 'desktop 好感夠但一般網頁沒有 AI 聊天框');
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
  await phone.getByRole('button', { name: '設定' }).click();
  await phone.locator('details summary').click();
  await phone.locator('#pasteSave').fill(JSON.stringify(gearSave));
  await phone.getByRole('button', { name: '匯入貼上的存檔' }).click();
  await phone.getByRole('button', { name: '裝備', exact: true }).click();
  await phone.locator('select[data-change="invSort"]').selectOption('rarity');
  const gearOverflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(await phone.locator('.invrow').count() === 4 && gearOverflow <= 0, `mobile 背包（含比較文字與排序）沒有水平捲動（${gearOverflow}px）`);
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
