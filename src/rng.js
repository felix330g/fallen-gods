// 可序列化的決定性亂數（mulberry32）。狀態只是一個 32 位元整數，可存進存檔。
export function rngNext(state) {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// 1..n 的整數骰
export function rngInt(state, n) {
  return Math.floor(rngNext(state) * n) + 1;
}

export function rngPick(state, arr) {
  return arr[rngInt(state, arr.length) - 1];
}

// 把任意字串／數字轉成種子
export function hashSeed(...parts) {
  let h = 2166136261 >>> 0;
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
