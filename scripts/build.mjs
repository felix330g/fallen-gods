// 把 ES modules 打包成單一 HTML（無外部依賴），輸出：
//   dist/index.html     完整網頁（GitHub Pages、任何靜態主機、直接雙擊開啟皆可）
//   dist/fragment.html  不含 <html>/<head>/<body> 的片段（給會自動加外框的主機用）
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const ORDER = ['rng', 'data', 'engine', 'report', 'memory', 'narration', 'talk', 'game', 'ui'];
const root = new URL('..', import.meta.url);

function transform(name, src) {
  const exported = [];
  let out = src.replace(/^import \* as (\w+) from '\.\/(\w+)\.js';$/gm, (_, alias, mod) => `const ${alias} = __m.${mod};`);
  out = out.replace(/^import \{([^}]+)\} from '\.\/(\w+)\.js';$/gm, (_, names, mod) => `const {${names.replace(/(\w+) as (\w+)/g, '$1: $2')}} = __m.${mod};`);
  out = out.replace(/^export (async function|function|const|let|class) (\w+)/gm, (_, kw, id) => { exported.push(id); return `${kw} ${id}`; });
  if (/^\s*(import|export)\s/m.test(out)) throw new Error(`${name}.js 有無法處理的 import/export`);
  return `__m.${name} = (() => {\n${out}\nreturn { ${exported.join(', ')} };\n})();\n`;
}

const version = JSON.parse(await readFile(new URL('package.json', root), 'utf8')).version;
let js = "'use strict';\nconst __m = {};\n";
for (const m of ORDER) js += transform(m, await readFile(new URL(`src/${m}.js`, root), 'utf8'));
js += '__m.ui.boot();\n';
const css = await readFile(new URL('style.css', root), 'utf8');
const safeJs = js.replace(/<\/script/gi, '<\\/script');
const body = `<main id="app"><p style="padding:24px">載入中…</p></main>\n<noscript>這個遊戲需要啟用 JavaScript。</noscript>\n<script>\n${safeJs}</script>`;
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;600&family=Noto+Serif+TC:wght@700&display=swap">';
const head = `<title>眾神殞落</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${fonts}\n<meta name="description" content="回合制文字冒險 RPG 垂直切片：灰燼地窖（v${version}）">\n<style>\n${css}</style>`;
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/index.html', root), `<!doctype html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`);
await writeFile(new URL('dist/fragment.html', root), `${head}\n${body}\n`);
console.log(`dist/index.html ${(js.length / 1024).toFixed(1)} KB JS (v${version})`);
