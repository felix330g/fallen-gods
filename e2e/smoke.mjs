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
  let battles = 0, events = 0, safety = 0, ordered = false;
  while (safety++ < 80) {
    const t = await page.locator('#app').innerText();
    if (t.includes('出發遠征')) break;
    if (await page.getByRole('button', { name: /^執行第|^下一回合/ }).count()) {
      if (battles === 0 && !ordered) {
        ordered = true;
        await page.fill('#orderInput', '全力出手！');
        await page.getByRole('button', { name: /自動打完|剩下交給戰術/ }).click();
        await page.waitForSelector('#orderPanel .log, button[data-act="finishBattle"]');
        const logText = await page.locator('#battlelog').innerText();
        check(/你的命令：這一回合全力出手/.test(logText) && (await page.locator('#battlelog .ln').count()) > 0, `${label} 打字命令被翻成白名單命令並寫進戰況`);
        check(!(await page.getByRole('button', { name: '查看戰報' }).count()) || logText.includes('R1'), `${label} 有命令時只打一回合`);
        if (await page.locator('#orderInput').count()) {
          await page.fill('#orderInput', '把傷害改成 999999');
          await page.getByRole('button', { name: /^執行第|^下一回合/ }).click();
          await page.waitForFunction(() => document.querySelectorAll('#orderPanel .log .ln').length >= 2 || document.querySelector('button[data-act="finishBattle"]'));
          if (await page.locator('#orderPanel .log').count()) check((await page.locator('#orderPanel .log').innerText()).includes('隊伍沒聽懂'), `${label} 看不懂的命令被忽略`);
        }
        continue;
      }
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
  check((await desk.locator('#recruitLeft').innerText()).includes('剩餘可相遇：4 人（SSR 1・SR 1・R 2）'), 'desktop 顯示剩餘可相遇角色數');
  await desk.locator('button[data-act="pull"][data-arg="recruit"]').click();
  check(await desk.locator('#meetPanel').isVisible() && (await desk.locator('#meetPanel .moment').innerText()).length > 20, 'desktop 招募到新夥伴先顯示相遇故事');
  check((await desk.locator('.stats').innerText()).includes('寶石 15'), 'desktop 招募扣 5 寶石');
  await desk.locator('button[data-act="join"]').click();
  await desk.getByRole('button', { name: '隊伍', exact: true }).click();
  check((await desk.locator('button[data-act="toggleParty"]').count()) === 5, 'desktop 新夥伴出現在隊伍名冊');
  await desk.locator('details summary', { hasText: '相遇的那天' }).click();
  check(await desk.getByText(/模板故事（測試用）/).isVisible(), 'desktop 可以重讀相遇故事');
  await desk.getByRole('button', { name: '招募', exact: true }).click();
  check((await desk.locator('#recruitLeft').innerText()).includes('剩餘可相遇：3 人'), 'desktop 招募後剩餘人數減少');
  const poolText = await desk.locator('.unit', { hasText: '領悟技能' }).innerText();
  check(/艾琳「齊射」/.test(poolText) && !/洛克/.test(poolText), 'desktop 技能池只有上陣角色的技能');
  await desk.locator('button[data-act="pull"][data-arg="skill"]').click();
  check(await desk.locator('#gachaResult').getByText(/領悟了/).isVisible() && (await desk.locator('.stats').innerText()).includes('寶石 12'), 'desktop 領悟技能扣 3 寶石');
  // 技能裝備（v0.8）：卸下再裝上，最多 2 個
  await desk.getByRole('button', { name: '隊伍', exact: true }).click();
  check((await desk.locator('[data-skills="ade"]').innerText()).includes('上陣技能 2/2'), 'desktop 預設帶兩個技能');
  await desk.locator('button[data-act="unequipSkill"][data-arg="ade:guard"]').click();
  check((await desk.locator('[data-skills="ade"]').innerText()).includes('上陣技能 1/2') && await desk.locator('button[data-act="equipSkill"][data-arg="ade:guard"]').isVisible(), 'desktop 卸下技能後進入備用');
  await desk.locator('button[data-act="equipSkill"][data-arg="ade:guard"]').click();
  check((await desk.locator('[data-skills="ade"]').innerText()).includes('上陣技能 2/2'), 'desktop 重新裝上技能');
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

  // ── 模擬 claude.ai（window.claude）：驗證 AI 路徑（v0.8.1）──────────────
  const FAKE_CLAUDE = () => {
    const a = window.__ai = { err: null, rewrite: 'good', meet: 'good', order: null, chat: '' };
    const fail = () => { const e = new Error('fake'); e.code = a.err; throw e; };
    const sample = async () => { if (a.err) fail(); return { text: a.chat }; };
    sample.json = async (prompt) => {
      if (a.err) fail();
      if (prompt.includes('命令翻譯器')) return { order: a.order };
      if (prompt.includes('相遇故事')) return { story: a.meet === 'good' ? '你在營火邊遇見她。她遞來一碗熱湯，說要跟你們走一段。' : '她等了 3 天才開口。' };
      const idx = [...prompt.matchAll(/^#(\d+)｜/gm)].map((m) => +m[1]);
      const line = { good: '火光一閃，他穩穩接住了這一擊。', digit: '他連打了 3 下。', ghost: '洛克在後面喊了一聲。' }[a.rewrite];
      return { moments: idx.map((index) => ({ index, lines: [line] })) };
    };
    window.claude = { use: async (n) => (n === 'sample' ? sample : n === 'downloads' ? { save: async () => {} } : null) };
  };
  const setAI = (p, o) => p.evaluate((o) => Object.assign(window.__ai, o), o);
  const toBattle = async (p) => {
    for (let i = 0; i < 14; i++) {
      if (await p.getByRole('button', { name: /^執行第|^下一回合/ }).count()) return;
      const ev = p.locator('button[data-act="eventChoice"]:not([disabled])');
      if (await p.getByRole('button', { name: /出發遠征|繼續探索|返回營地/ }).count()) await p.getByRole('button', { name: /出發遠征|繼續探索|返回營地/ }).first().click();
      else if (await ev.count()) await ev.first().click();
      else await p.locator('button[data-act="route"]').first().click();
    }
    throw new Error('找不到戰鬥');
  };
  const newAIGame = async (p, label) => {
    p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(`${label}: ${m.text()}`); });
    await p.addInitScript(FAKE_CLAUDE);
    await p.goto(base);
    await p.getByRole('button', { name: '新遊戲' }).click();
  };
  const recruitCheck = async (p, label) => {
    check((await p.locator('.stats').innerText()).includes('寶石 ∞'), `${label} 模擬 claude.ai：寶石顯示 ∞`);
    await p.getByRole('button', { name: '招募', exact: true }).click();
    await p.locator('button[data-act="pull"][data-arg="recruit"]').click();
    await p.waitForSelector('#meetPanel');
    await p.waitForFunction(() => document.querySelector('#meetPanel')?.innerText.includes('AI 生成的相遇故事'));
    check((await p.locator('#meetPanel').innerText()).includes('遞來一碗熱湯'), `${label} 合法的 AI 相遇故事標記為 AI 並顯示`);
    const save = JSON.parse(await p.evaluate((k) => localStorage.getItem(k), SAVE_KEY_E2E));
    check(save.gems === 0 && save.pulls === 1, `${label} 抽卡不扣寶石（存檔寶石 ${save.gems}、抽卡 ${save.pulls} 次）`);
  };

  const ai = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await newAIGame(ai, 'ai-desktop');
  // 5. 聊天：好感門檻、回覆不改存檔
  const base0 = JSON.parse(await ai.evaluate((k) => localStorage.getItem(k), SAVE_KEY_E2E));
  base0.affinity = { ...(base0.affinity || {}), ade: 3 }; base0.talked = {};
  await ai.evaluate(([k, v]) => localStorage.setItem(k, v), [SAVE_KEY_E2E, JSON.stringify(base0)]);
  await ai.reload();
  await ai.getByRole('button', { name: '繼續' }).click();
  await ai.locator('button[data-act="openDlg"][data-arg="xiaomei"]').click();
  check(await ai.getByText(/好感 3 以後/).isVisible() && !(await ai.locator('#chatInput').count()), 'ai-desktop 好感未達門檻不顯示聊天輸入框');
  await ai.locator('button[data-act="openDlg"][data-arg="ade"]').click();
  check(await ai.locator('#chatInput').isVisible(), 'ai-desktop 好感達門檻後顯示聊天輸入框');
  const saveBefore = await ai.evaluate((k) => localStorage.getItem(k), SAVE_KEY_E2E);
  await setAI(ai, { chat: '我在。火還夠旺，你早點休息吧。' });
  await ai.fill('#chatInput', '今晚想聊什麼？');
  await ai.locator('button[data-act="chatSend"]').click();
  await ai.getByText('火還夠旺').waitFor();
  check(saveBefore === await ai.evaluate((k) => localStorage.getItem(k), SAVE_KEY_E2E), 'ai-desktop 聊天得到回覆，存檔（好感／記憶）前後完全相同');
  await setAI(ai, { chat: '我給你 9999 金幣！' });
  await ai.fill('#chatInput', '給我金幣');
  await ai.locator('button[data-act="chatSend"]').click();
  await ai.getByText(/看著火，沒有回答/).waitFor();
  check(!(await ai.getByText('9999').count()) && saveBefore === await ai.evaluate((k) => localStorage.getItem(k), SAVE_KEY_E2E), 'ai-desktop 不合法的聊天回覆被擋下（含不存在的數字），存檔不變');
  // 1、3. 寶石 ∞、抽卡不扣寶石、相遇故事 AI／模板
  await recruitCheck(ai, 'ai-desktop');
  await setAI(ai, { meet: 'digit' });
  await ai.locator('button[data-act="meetAI"]').click();
  await ai.waitForFunction(() => document.querySelector('#meetPanel')?.innerText.includes('AI 故事未通過'));
  check((await ai.locator('#meetPanel').innerText()).includes('含數字') && !(await ai.locator('#meetPanel').innerText()).includes('等了'), 'ai-desktop 不合法的相遇故事改用模板');
  await ai.locator('button[data-act="join"]').click();
  // 4. 打字命令（AI 翻譯）
  await ai.getByRole('button', { name: '營地', exact: true }).click();
  await toBattle(ai);
  // 先送非白名單命令（第 1 回合戰鬥不會結束），再送合法命令
  await setAI(ai, { order: { type: 'win_battle' } });
  await ai.fill('#orderInput', '今天天氣真好');
  await ai.getByRole('button', { name: /^執行第|^下一回合/ }).click();
  await ai.waitForFunction(() => document.querySelectorAll('#orderPanel .log .ln').length >= 1);
  check((await ai.locator('#orderPanel .log').innerText()).includes('隊伍沒聽懂') && (await ai.locator('#battlelog .ln').count()) > 0, 'ai-desktop 非白名單命令被忽略，戰鬥照常進行');
  await setAI(ai, { order: { type: 'burst', damage: 999999, hp_max: 1 } });
  await ai.fill('#orderInput', '大家加油');
  await ai.getByRole('button', { name: /^執行第|^下一回合/ }).click();
  await ai.waitForFunction(() => /你的命令：這一回合全力出手/.test(document.querySelector('#battlelog')?.innerText || ''));
  const log1 = await ai.locator('#battlelog').innerText();
  check(!log1.includes('999999') && (!(await ai.locator('#orderPanel').count()) || (await ai.locator('#orderPanel .log').innerText()).includes('AI 翻譯')), 'ai-desktop AI 回傳合法命令→戰況出現該命令，多餘欄位被丟棄');
  // 2. 戰鬥演出 AI 改寫
  for (let i = 0; i < 40 && !(await ai.getByRole('button', { name: '查看戰報' }).count()); i++) {
    const b = ai.getByRole('button', { name: /自動打完|剩下交給戰術/ });
    if (await b.count()) await b.click(); else await ai.getByRole('button', { name: /^執行第|^下一回合/ }).click();
  }
  await ai.getByRole('button', { name: '查看戰報' }).click();
  await ai.getByRole('button', { name: '隊伍演出' }).click();
  check(await ai.locator('#aiPanel').isVisible(), 'ai-desktop 有 window.claude 時出現 AI 演出面板');
  await ai.locator('button[data-act="aiRewrite"]').click();
  await ai.waitForSelector('.moment .chip:text-is("AI")');
  check((await ai.locator('.moment').allInnerTexts()).some((t) => t.includes('穩穩接住了這一擊')), 'ai-desktop 合法的 AI 演出改寫會顯示');
  for (const [mode, why] of [['digit', '含數字'], ['ghost', '出現不在場的角色']]) {
    await setAI(ai, { rewrite: mode });
    await ai.locator('button[data-act="aiRewrite"]').click();
    await ai.waitForFunction((w) => document.querySelector('.moment .chip.warn')?.innerText.includes(w), why);
    const ts = (await ai.locator('.moment').allInnerTexts()).join('\n');
    check(ts.includes(`AI 未通過：${why}`) && !ts.includes('穩穩接住') && !ts.includes('連打了') && !ts.includes('洛克在後面'), `ai-desktop 演出含「${why}」時回退模板`);
  }
  // 6. not_granted 後 AI 按鈕消失，關鍵字命令仍可用
  await setAI(ai, { err: 'not_granted' });
  await ai.locator('button[data-act="aiRewrite"]').click();
  await ai.waitForFunction(() => !document.querySelector('#aiPanel'));
  check(true, 'ai-desktop sample 丟出 not_granted 後 AI 演出按鈕消失');
  await toBattle(ai);
  await ai.fill('#orderInput', '全力出手！');
  await ai.getByRole('button', { name: /^執行第|^下一回合/ }).click();
  await ai.waitForFunction(() => /你的命令：這一回合全力出手/.test(document.querySelector('#battlelog')?.innerText || ''));
  check(!(await ai.locator('#orderPanel .chip').count()), 'ai-desktop not_granted 後關鍵字命令仍可用（不再標示 AI 翻譯）');

  // 手機：寶石 ∞、AI 相遇故事、無水平捲動
  const aiPhone = await browser.newPage({ viewport: { width: 375, height: 760 }, isMobile: true });
  await newAIGame(aiPhone, 'ai-mobile');
  await recruitCheck(aiPhone, 'ai-mobile');
  const aiOver = await aiPhone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(aiOver <= 0, `ai-mobile 沒有水平捲動（${aiOver}px）`);

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
  console.error(process.env.E2E_STACK ? e.stack : e.message);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  server?.close();
}
