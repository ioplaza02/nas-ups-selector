// 公式対応表に載っているのに、data/ups-specs.json（容量・運転時間の手作業データ）に無いUPSを探す。
// 見つかった場合は一覧を missing-specs.txt に書き出す（ワークフローがIssueで知らせる）。
// 画面は容量データが無くても「対応」として表示できるので、データ更新は止めない。

import fs from "node:fs";

const compat = JSON.parse(fs.readFileSync("data/ups-compat.json", "utf8"));
const specs = JSON.parse(fs.readFileSync("data/ups-specs.json", "utf8"));
const have = new Set(specs.ups.map((u) => u.model));
Object.keys(specs.seriesAliases || {}).forEach((k) => have.add(k));

const missing = new Map();
compat.entries.filter((e) => e.kind === "ups" && !have.has(e.model)).forEach((e) => {
  if (!missing.has(e.model)) missing.set(e.model, { maker: e.maker, label: e.label });
});

if (missing.size === 0) {
  console.log("容量データの不足はありません。");
  if (fs.existsSync("missing-specs.txt")) fs.unlinkSync("missing-specs.txt");
} else {
  const lines = [...missing].map(([model, v]) => `- ${model}（${v.maker}／公式表の表記：${v.label}）`);
  console.log("容量データが無いUPS:\n" + lines.join("\n"));
  fs.writeFileSync("missing-specs.txt", lines.join("\n") + "\n");
}

const noPower = Object.entries(compat.nasPower || {}).filter(([, v]) => v.maxW == null).map(([k]) => k);
if (noPower.length) console.log(`消費電力を読み取れなかったNASシリーズ（仮の目安で表示）: ${noPower.length}件\n  ${noPower.join(", ")}`);
