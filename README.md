# LAN DISK用 UPSセレクター

I-O DATA公式「[ランディスク対応UPS一覧](https://www.iodata.jp/pio/io/nas/landisk/ups.htm)」をもとに、
LAN DISKで使えるUPSを4メーカー（APC・オムロン・富士電機・EATON）まとめて提案するツール。

- 公開URL（予定）：https://ioplaza02.github.io/nas-ups-selector/
- パスワード：`ups2026`（app.js の `SITE_PASSWORD`。簡易的な鍵で、本物のセキュリティではない）

## できること

- LAN DISKの型番 → 使えるUPS（公式表の ◯／未検証／確認中／× を反映）
- UPSの型番 → 使えるLAN DISK（販売中の機種を先に、旧機種は折りたたみ）
- つなぐ機器（LAN DISK＋バックアップ用HDD・ハブ等）の合計消費電力から、停電時にもつ時間の目安を計算
- OS別の導入のしかた（Linux：本体の「UPS設定」＋マニュアルへのリンク／Windows：メーカー別の管理ソフト）
- 結果のURLコピー（他社のUPSを紹介するページのため、他のセレクターと違って「PDFで保存」は置かない）

## ファイル構成

| ファイル | 中身 | 更新方法 |
|---|---|---|
| `data/ups-compat.json` | 公式対応表（組み合わせ・注記）＋各NASの消費電力 | **自動**（毎日JST 3:00） |
| `data/ups-specs.json` | UPSの容量・運転時間・販売状況 | 手作業（2026-10-16整備） |
| `data/nas-guides.json` | Linux系LAN DISKのUPS設定マニュアルへのリンク | 手作業 |
| `scripts/scrape-ups.mjs` | スクレイパー（外部ライブラリなし） | |
| `scripts/health-check-ups.mjs` | 前回比2割以上減ったら異常 → PRとIssueで知らせて止める | |
| `scripts/check-specs.mjs` | 公式表に新しいUPSが増えて容量データが無ければIssueで知らせる | |

NASの商品名・画像・容量別の型番は、NASセレクターの `data/products.json` を読み込んで使う。

## 判定の考え方

- 運転時間：メーカー公表の「負荷（W）ごとのバックアップ時間」を両対数で補間した目安
- 「余裕あり」：停電時に〔選んだ時間 × 1.3〕以上もつ（バッテリー劣化を見込む）かつ、出力容量の8割以内
- 各UPSカードの「計算式を見る」で、①合計W ②使用率 ③もつ時間 ④時間の判定 ⑤コンセント口数 を式のまま表示
  - もつ時間 ≒ t1 ×（W1 ÷ 合計W）^k、k ＝ log(t1 ÷ t2) ÷ log(W2 ÷ W1)（メーカー公表値の2点 W1→t1分、W2→t2分）
- コンセント：停電時も給電される口数（`outlets.backup`）がつなぐ機器の台数より少ないUPSは「足りない」側へ。
  サージ保護のみの口（APC ES/RS、オムロンBZなど）は停電時に給電されない旨を警告表示
- LAN DISKの消費電力は仕様ページの最大消費電力。取れない機種はベイ数からの仮の目安（画面に明記）
- 「一般的なコンセント（100V・15A）で使える」：200V専用・30A/20A専用コンセント・電気工事が必要な機種を除外

## 手動で動かすとき

```
node scripts/scrape-ups.mjs              # 公式ページ＋仕様ページから取得（初回は約5分）
node scripts/scrape-ups.mjs --no-power   # 消費電力は取りに行かない（前回分を使う）
node scripts/scrape-ups.mjs --file ups.htm --no-power   # 保存したHTMLで動作確認
```

## 開発メモ

- 公式ページのHTMLが崩れていて、Linux版APCの「ES 550 USB」「ES 750 USB」の型番（BE550M1-JP／BE750M2-JP）が
  表の外にはみ出している。スクレイパーの `ROW_LABEL_ALIASES` で手当て済み
- 型番→シリーズは先頭一致にしないこと（HDL4-LX04U が HDL4-LX に化ける）。容量の数字を除いた形で完全一致させる
- `data/nas-guides.json` の `verified: false`（HA・XA・AAX・AAXW）は推定URL。ブラウザで確認できたら true にする
