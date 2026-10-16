// スクレイピング結果の健全性チェック（UPSセレクター用）。
// NAS/ISS/DASセレクターと同じ考え方：前回と比べて大きく減っていないかを確認する。
// 問題が無ければ終了コード0、問題があれば終了コード1を返す（→ワークフローがPRとIssueを作って止める）。

import fs from "node:fs";

const OLD_PATH = "data/ups-compat.previous.json";
const NEW_PATH = "data/ups-compat.json";
const DROP_THRESHOLD = 0.2; // 2割以上減ったら異常
// 公式ページの区画（Windows：APC/オムロン/富士電機/EATON、Linux：APC/オムロン/富士電機）
const MIN_BLOCKS = 7;

function load(path) {
  if (!fs.existsSync(path)) return null;
  try { return JSON.parse(fs.readFileSync(path, "utf8")); } catch (e) { return null; }
}

function counts(d) {
  if (!d || !Array.isArray(d.entries)) return null;
  return {
    entries: d.entries.length,
    ups: new Set(d.entries.filter((e) => e.kind === "ups").map((e) => e.model)).size,
    nas: new Set(d.entries.map((e) => e.nas)).size,
    blocks: (d.blocks || []).length
  };
}

const oldC = counts(load(OLD_PATH));
const newC = counts(load(NEW_PATH));
console.log("前回:", oldC ?? "不明（初回実行など）");
console.log("今回:", newC ?? "不明（読み込み失敗）");

let ng = false;
if (!newC || newC.entries === 0) {
  console.error("異常あり: 新しいデータが空か、正しく読み込めませんでした。");
  ng = true;
} else {
  if (newC.blocks < MIN_BLOCKS) {
    console.error(`異常あり: メーカー別の区画が${newC.blocks}個しか読めませんでした（通常${MIN_BLOCKS}個）。ページ構造が変わった可能性があります。`);
    ng = true;
  }
  if (oldC) {
    for (const key of ["entries", "ups", "nas"]) {
      if (oldC[key] > 0) {
        const drop = (oldC[key] - newC[key]) / oldC[key];
        if (drop > DROP_THRESHOLD) {
          console.error(`異常あり: ${key} が前回より${Math.round(drop * 100)}%減少しています（${oldC[key]} → ${newC[key]}）。`);
          ng = true;
        }
      }
    }
  }
}

if (ng) process.exit(1);
console.log("健全性チェック: 問題ありませんでした。");
process.exit(0);
