// LAN DISK用 UPSセレクター：公式「ランディスク対応UPS一覧」のスクレイパー。
//
// 取得元: https://www.iodata.jp/pio/io/nas/landisk/ups.htm
// 出力先: data/ups-compat.json
//
// NAS/DASセレクターと同じく外部ライブラリなし（Node.js標準のfetchのみ）。
// 公式ページは「メーカー × OS世代 × NASシリーズ列」の大きな表が18個あるので、
// 表を1マスずつの格子（グリッド）に展開してから「NASシリーズ × UPS型番 → 対応状況」の
// 1行1組み合わせのデータに変換する。
//
// 動作確認用に、保存したHTMLを読み込むこともできる：
//   node scripts/scrape-ups.mjs --file ups.htm
//
// 開発時の教訓（NASセレクターより）：
//  ・文字列の一致は表記ゆれに弱いので、記号は全角/半角どちらも受け付ける
//  ・「最初に見つかったもの」で判定せず、HTMLの構造（区画のid・表の行と列）で判定する

import fs from "node:fs";

const SOURCE_URL = "https://www.iodata.jp/pio/io/nas/landisk/ups.htm";
const OUT_PATH = "data/ups-compat.json";
const USER_AGENT = "NasSelectorBot/1.0 (+https://ioplaza02.github.io/)";

// 区画のid → OSとメーカー。公式ページの id 属性（wssSE / linuxOMRON など）で判定する。
const BLOCK_DEFS = {
  wssSE: { os: "windows", maker: "apc" },
  wssOMRON: { os: "windows", maker: "omron" },
  wssFuji: { os: "windows", maker: "fuji" },
  wssEATON: { os: "windows", maker: "eaton" },
  linuxSE: { os: "linux", maker: "apc" },
  linuxOMRON: { os: "linux", maker: "omron" },
  linuxFUJI: { os: "linux", maker: "fuji" },
  linuxFuji: { os: "linux", maker: "fuji" },
  linuxEATON: { os: "linux", maker: "eaton" },
  linuxEaton: { os: "linux", maker: "eaton" }
};

const MAKER_NAMES = {
  apc: "シュナイダーエレクトリック（APC）",
  omron: "OMRON（オムロン）",
  fuji: "富士電機",
  eaton: "EATON（イートン）"
};

// 公式ページのHTMLが崩れていて、型番が表の外にはみ出している行の手当て（2026-10-16確認）。
// 「ES 550 USB」「ES 750 USB」の型番（BE550M1-JP／BE750M2-JP）が表の外に出てしまっている。
const ROW_LABEL_ALIASES = {
  "ES 550 USB": "BE550M1-JP",
  "ES 750 USB": "BE750M2-JP"
};

// ---------- 小さな道具 ----------

// 公式ページのリンクは「/product/nas/...」のようなサイト内の書き方になっているため、
// 必ず完全なURL（https://www.iodata.jp/...）に直してから使う。
// （2026-10-20修正：これを忘れていて、NASの仕様ページが取れず消費電力が7シリーズ分しか入っていなかった。
//   ブラウザで保存したHTMLでは完全なURLに変わっていたため、手元の試験では気づけなかった）
function absUrl(href) {
  try { return new URL(href, SOURCE_URL).href; } catch (e) { return href; }
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&times;/g, "×")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

// 全角数字→半角（「◯※１」のような表記ゆれ対策）
function toHalfDigits(s) {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

function stripTags(html) {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/[\s　]+/g, " ")
    .trim();
}

function attr(attrs, name) {
  const m = attrs.match(new RegExp(`${name}\\s*=\\s*["']?([^"'\\s>]+)`, "i"));
  return m ? m[1] : null;
}

// 「※1、※2」「※１」などから注記番号を取り出す
function noteRefs(text) {
  const refs = [];
  const re = /※\s*(\d+)/g;
  let m;
  while ((m = re.exec(toHalfDigits(text)))) refs.push(m[1]);
  return refs;
}

function stripNoteMarks(text) {
  return toHalfDigits(text).replace(/※\s*\d+/g, "").replace(/[、,]\s*$/g, "").replace(/\s+/g, " ").trim();
}

// ---------- 表 → 格子 ----------

function parseTable(tableHtml) {
  const rows = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr;
  while ((tr = trRe.exec(tableHtml))) {
    const cells = [];
    const cellRe = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let c;
    while ((c = cellRe.exec(tr[1]))) {
      const inner = c[3];
      const links = [];
      const aRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let a;
      while ((a = aRe.exec(inner))) links.push({ href: absUrl(decodeEntities(a[1])), text: stripTags(a[2]) });
      cells.push({
        rowspan: parseInt(attr(c[2], "rowspan") || "1", 10) || 1,
        colspan: parseInt(attr(c[2], "colspan") || "1", 10) || 1,
        text: stripTags(inner),
        // <br>で区切られた行ごとのテキスト（NASシリーズ名の一覧で使う）
        lines: decodeEntities(inner)
          .split(/<br\s*\/?>/i)
          .map((x) => stripTags(x))
          .filter(Boolean),
        narsus: /ups_narsus/i.test(inner),
        links
      });
    }
    rows.push(cells);
  }

  // rowspan/colspanを展開して、全マスに「元のセル」を割り当てる
  const grid = [];
  let cellId = 0;
  rows.forEach((cells, r) => {
    grid[r] = grid[r] || [];
    let col = 0;
    cells.forEach((cell) => {
      while (grid[r][col]) col++;
      const origin = { ...cell, id: cellId++, row: r, col };
      for (let i = 0; i < cell.rowspan; i++) {
        grid[r + i] = grid[r + i] || [];
        for (let j = 0; j < cell.colspan; j++) grid[r + i][col + j] = origin;
      }
      col += cell.colspan;
    });
  });
  const width = Math.max(0, ...grid.map((r) => r.length));
  return grid.map((r) => Array.from({ length: width }, (_, i) => r[i] || null));
}

// ---------- 対応記号の読み取り ----------

function readStatus(text) {
  const t = text.replace(/\s/g, "");
  if (!t) return null;
  if (/^[◯○〇]/.test(t)) return "ok";
  if (/^[×✕xX]/.test(t)) return "ng";
  if (/^[－\-ー―‐]/.test(t)) return "untested";
  if (/確認中/.test(t)) return "checking";
  return null;
}

const NAS_CODE_RE = /^(?:HDL|APS|APX|IPHL|HDLM|HDLH)[0-9A-Z\-\/]*$/i;

function nasCodesFromCell(cell) {
  const codes = [];
  cell.lines.forEach((line) => {
    line.split(/\s+/).forEach((tok) => {
      const t = tok.trim();
      if (t && NAS_CODE_RE.test(t) && t.includes("-")) codes.push(t.toUpperCase());
    });
  });
  return codes.map((code) => {
    const link = cell.links.find((l) => l.text.toUpperCase() === code);
    return { code, url: link ? link.href : null };
  });
}

// ---------- 1つの表を「組み合わせ」の配列にする ----------

function tableToEntries(grid, ctx) {
  const entries = [];
  if (grid.length === 0) return entries;
  const head = grid[0][0];
  if (!head || !/商品型番/.test(head.text)) {
    throw new Error(`[${ctx.blockId}] 表の左上が「商品型番」ではありません（ページ構造が変わった可能性）`);
  }
  const labelCols = head.colspan; // Windows表は2列（型番＋NarSuSマーク）、Linuxは1〜2列
  const width = grid[0].length;

  // 見出し行＝左端が「商品型番」セル（rowspan）に含まれる行
  let headerRows = 0;
  while (headerRows < grid.length && grid[headerRows][0] === head) headerRows++;

  // 列ごとに OS表記 と NASシリーズ を集める
  const columns = [];
  for (let c = labelCols; c < width; c++) {
    const col = { osLabel: null, nas: [] };
    const seen = new Set();
    for (let r = 0; r < headerRows; r++) {
      const cell = grid[r][c];
      if (!cell || seen.has(cell.id)) continue;
      seen.add(cell.id);
      if (/商品型番シリーズ名/.test(cell.text)) continue;
      const codes = nasCodesFromCell(cell);
      if (codes.length > 0) {
        col.nas.push(...codes);
      } else if (cell.text && !/^[－\-ーー―]+$/.test(cell.text)) {
        col.osLabel = cell.text;
      }
    }
    columns.push(col);
  }

  let group = null;
  let groupNotes = []; // 「5P ※1」のようにグループ見出しに付いた注記は、その下の全行に効く
  for (let r = headerRows; r < grid.length; r++) {
    const row = grid[r];
    const labelCell = row[0];
    if (!labelCell || labelCell.row !== r) continue; // 前の行のrowspanの続き

    const dataCells = row.slice(labelCols);
    const isGroupRow = dataCells.every((cell) => !cell || cell === labelCell || cell.row !== r || !cell.text);
    if (isGroupRow) {
      group = stripNoteMarks(labelCell.text);
      groupNotes = noteRefs(labelCell.text);
      continue;
    }

    const rawLabel = labelCell.text;
    const labelNotes = noteRefs(rawLabel);
    const cleanLabel = stripNoteMarks(rawLabel);
    let model = null;
    const paren = cleanLabel.match(/[（(]\s*([A-Z0-9][A-Z0-9\-\/]+)\s*[）)]/i);
    if (paren) model = paren[1].toUpperCase();
    else if (ROW_LABEL_ALIASES[cleanLabel]) model = ROW_LABEL_ALIASES[cleanLabel];
    else model = cleanLabel;

    // NarSuS列（labelColsが2のとき、2列目）
    let narsus = labelCell.narsus;
    const extraNotes = [];
    for (let c = 1; c < labelCols; c++) {
      const cell = row[c];
      if (cell && cell !== labelCell && cell.row === r) {
        if (cell.narsus) narsus = true;
        extraNotes.push(...noteRefs(cell.text));
      }
    }

    const kind = /管理ソフト/.test(group || "") ? "software" : "ups";
    const label = ROW_LABEL_ALIASES[cleanLabel] ? `${cleanLabel}（${model}）` : cleanLabel;

    columns.forEach((col, i) => {
      const cell = row[labelCols + i];
      if (!cell || cell.row !== r) return;
      const status = readStatus(toHalfDigits(cell.text));
      if (!status) return;
      const notes = [...new Set([...groupNotes, ...labelNotes, ...extraNotes, ...noteRefs(cell.text)])];
      col.nas.forEach((nas) => {
        entries.push({
          block: ctx.blockId,
          os: ctx.os,
          maker: ctx.maker,
          osGeneration: ctx.osGeneration,
          osLabel: col.osLabel,
          nas: nas.code,
          nasUrl: nas.url,
          kind,
          group,
          model,
          label,
          status,
          narsus: kind === "ups" ? narsus : false,
          notes
        });
      });
    });
  }
  return entries;
}

// ---------- 区画（メーカー × OS）ごとの処理 ----------

function parseNotes(blockHtml) {
  const general = [];
  const numbered = {};
  const liRe = /<li\b[^>]*>\s*<span[^>]*class=["'][^"']*mark[^"']*["'][^>]*>([\s\S]*?)<\/span>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(blockHtml))) {
    const mark = toHalfDigits(stripTags(m[1]));
    const body = m[2];
    const links = [];
    const aRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let a;
    while ((a = aRe.exec(body))) links.push({ href: absUrl(decodeEntities(a[1])), text: stripTags(a[2]) });
    const note = { text: stripTags(body), links };
    const num = mark.match(/※\s*(\d+)/);
    if (num) numbered[num[1]] = note;
    else general.push(note);
  }
  return { general, numbered };
}

function parsePage(html) {
  const sourceDate = (html.match(/(\d{4}年\d{1,2}月\d{1,2}日)現在/) || [])[1] || null;
  const linuxNotice = (html.match(/<p[^>]*>\s*(ランディスクとUPSは[^<]*)<\/p>/) || [])[1];

  // 区画の開始位置を集める
  const starts = [];
  const blockRe = /<div\b[^>]*class=["'][^"']*clmRoundBlock[^"']*["'][^>]*id=["']([^"']+)["'][^>]*>/gi;
  let b;
  while ((b = blockRe.exec(html))) starts.push({ id: b[1], index: b.index });
  if (starts.length === 0) throw new Error("区画（clmRoundBlock）が見つかりません。ページ構造が変わった可能性があります");

  // 最後の区画の終わり：旧商品の案内（h2/h3）の手前まで
  const tailMatch = html.slice(starts[starts.length - 1].index).search(/<h[23]\b[^>]*>[^<]*旧商品/);
  const endOfLast = tailMatch >= 0 ? starts[starts.length - 1].index + tailMatch : html.length;

  const blocks = [];
  const entries = [];
  starts.forEach((s, i) => {
    const def = BLOCK_DEFS[s.id];
    if (!def) {
      console.warn(`未知の区画を読み飛ばしました: ${s.id}`);
      return;
    }
    const end = i + 1 < starts.length ? starts[i + 1].index : endOfLast;
    const blockHtml = html.slice(s.index, end);

    const tableRe = /<table\b[\s\S]*?<\/table>/gi;
    let t;
    let tableCount = 0;
    while ((t = tableRe.exec(blockHtml))) {
      const before = blockHtml.slice(0, t.index);
      const h4s = [...before.matchAll(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi)];
      // 同じ区画で直前に出てきたh4（OS世代）。目次などの誤検知を避けるため「最後の」h4を使う
      const osGeneration = h4s.length ? stripTags(h4s[h4s.length - 1][1]) : null;
      const grid = parseTable(t[0]);
      const rows = tableToEntries(grid, { blockId: s.id, osGeneration, ...def });
      entries.push(...rows);
      tableCount++;
    }

    const notes = parseNotes(blockHtml.replace(/<table\b[\s\S]*?<\/table>/gi, ""));
    blocks.push({ id: s.id, ...def, makerName: MAKER_NAMES[def.maker], tableCount, ...notes });
  });

  return { sourceDate, linuxNotice: linuxNotice ? stripTags(linuxNotice) : null, blocks, entries };
}

// ---------- NASの消費電力（各シリーズの仕様ページから） ----------
//
// 仕様ページの「消費電力」行は「73W（Max）、55W（Typ）」「71W（最大）、33W（TYP）」のように書かれている
// （2026-10-16に7機種で確認）。Max/最大 と Typ を両方拾う。
// 消費電力の文言は目次や注記にも出ることがあるので、出現箇所をすべて試し、
// 値が読み取れた最初の行を採用する（教訓③：最初の出現だけで判定しない）。

export function parsePower(html) {
  const re = /消費電力/g;
  let m;
  let typOnly = null;
  while ((m = re.exec(html))) {
    const rest = html.slice(m.index);
    const endTr = rest.search(/<\/tr>/i);
    const windowText = toHalfDigits(stripTags(rest.slice(0, endTr > 0 ? endTr : 600)))
      .replace(/[（]/g, "(").replace(/[）]/g, ")");
    if (/W\s*[／/]\s*GB/i.test(windowText) && !/\(\s*(?:max|最大|typ)/i.test(windowText)) continue;
    const max = windowText.match(/約?\s*(\d+(?:\.\d+)?)\s*W\s*\(\s*(?:max|最大)\s*\)/i);
    const typ = windowText.match(/約?\s*(\d+(?:\.\d+)?)\s*W\s*\(\s*typ\s*\)/i);
    if (max) return { maxW: Number(max[1]), typW: typ ? Number(typ[1]) : null, raw: windowText.slice(0, 120) };
    if (typ && !typOnly) typOnly = { maxW: null, typW: Number(typ[1]), raw: windowText.slice(0, 120) };
  }
  return typOnly;
}

function specUrlOf(productUrl) {
  // 公式ページには「.../index.htm/」のような書き間違いもあるので、末尾の index.htm(/) を取り除いてから付ける
  return absUrl(productUrl).replace(/index\.html?\/?$/i, "").replace(/\/?$/, "/") + "spec.htm";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 消費電力はほぼ変わらないので、前回取得できている機種は再利用し、
// 新しく増えた機種と取得に失敗していた機種だけ取りに行く（公式サイトへの負荷を抑えるため）。
// 毎週日曜日だけは全機種を取り直す。
async function collectNasPower(entries, previous) {
  const byCode = new Map();
  entries.forEach((e) => { if (!byCode.has(e.nas)) byCode.set(e.nas, e.nasUrl); });
  const prev = (previous && previous.nasPower) || {};
  const fullRefresh = new Date().getUTCDay() === 6; // 日本時間の日曜3:00 = UTC土曜18:00
  const result = {};
  const cacheByUrl = new Map();
  let fetched = 0;
  for (const [code, url] of byCode) {
    if (!url) continue;
    if (!fullRefresh && prev[code] && prev[code].maxW != null && /^https?:/.test(prev[code].specUrl || "")) {
      result[code] = prev[code];
      continue;
    }
    const specUrl = specUrlOf(url);
    if (!cacheByUrl.has(specUrl)) {
      let power = null;
      try {
        const res = await fetch(specUrl, { headers: { "User-Agent": USER_AGENT } });
        if (res.ok) power = parsePower(await res.text());
      } catch (e) {
        power = null;
      }
      cacheByUrl.set(specUrl, power);
      fetched++;
      await sleep(2000); // 1件ずつ2秒間隔（NASセレクターと同じ方針）
    }
    const power = cacheByUrl.get(specUrl);
    if (power) result[code] = { maxW: power.maxW, typW: power.typW, specUrl };
    else if (prev[code]) result[code] = { ...prev[code], specUrl };
    else result[code] = { maxW: null, typW: null, specUrl };
  }
  console.log(`消費電力: 仕様ページを${fetched}件取得（全${byCode.size}シリーズ${fullRefresh ? "、週1回の全件取り直し" : ""}）`);
  return result;
}

// ---------- 実行 ----------

async function loadHtml() {
  const fileArg = process.argv.indexOf("--file");
  if (fileArg >= 0) return fs.readFileSync(process.argv[fileArg + 1], "utf8");
  const res = await fetch(SOURCE_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`取得に失敗しました: HTTP ${res.status}`);
  return await res.text();
}

async function main() {
  const html = await loadHtml();
  const parsed = parsePage(html);

  const upsModels = new Set(parsed.entries.filter((e) => e.kind === "ups").map((e) => e.model));
  const nasCodes = new Set(parsed.entries.map((e) => e.nas));
  console.log(`公式ページの日付: ${parsed.sourceDate}`);
  parsed.blocks.forEach((b) => console.log(`  ${b.id}: 表${b.tableCount}個、注記${b.general.length + Object.keys(b.numbered).length}件`));
  console.log(`組み合わせ: ${parsed.entries.length}件 / UPS型番: ${upsModels.size}種 / NASシリーズ: ${nasCodes.size}種`);

  const previous = fs.existsSync(OUT_PATH) ? JSON.parse(fs.readFileSync(OUT_PATH, "utf8")) : null;
  const skipPower = process.argv.includes("--no-power");
  const nasPower = skipPower ? (previous && previous.nasPower) || {} : await collectNasPower(parsed.entries, previous);

  const out = {
    updatedAt: new Date().toISOString(),
    sourceUrl: SOURCE_URL,
    sourceDate: parsed.sourceDate,
    linuxNotice: parsed.linuxNotice,
    blocks: parsed.blocks,
    nasPower,
    entries: parsed.entries
  };
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 1) + "\n");
  console.log(`${OUT_PATH} を書き出しました。`);
}

// テストから parsePower だけを読み込めるよう、直接実行されたときだけ main() を動かす
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("scrape-ups.mjs")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
