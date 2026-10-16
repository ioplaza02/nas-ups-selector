(() => {
  "use strict";

  // ---------- 簡易パスワード（GitHub Pagesの静的配信なので、本物のセキュリティではない） ----------
  const SITE_PASSWORD = "ups2026";
  const STORAGE_KEY = "ups-selector-auth";

  const gate = document.getElementById("password-gate");
  const appRoot = document.getElementById("app-root");
  const form = document.getElementById("password-form");
  const pwInput = document.getElementById("password-input");
  const pwToggle = document.getElementById("password-toggle");
  const pwError = document.getElementById("password-error");

  function storageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 保存できなくても動かす */ } }

  function unlock() {
    gate.hidden = true;
    appRoot.hidden = false;
    initApp();
  }
  if (storageGet(STORAGE_KEY) === "1") unlock();
  else pwInput.focus();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (pwInput.value === SITE_PASSWORD) {
      storageSet(STORAGE_KEY, "1");
      pwError.hidden = true;
      unlock();
    } else {
      pwError.hidden = false;
    }
  });
  pwToggle.addEventListener("click", () => {
    pwInput.type = pwInput.type === "password" ? "text" : "password";
  });

  // ---------- ここから本体 ----------

  function initApp() {

  const NAS_DATA_URL = "https://ioplaza02.github.io/nas-selector/data/products.json";
  const COMPAT_URL = "data/ups-compat.json";
  const SPECS_URL = "data/ups-specs.json";
  const GUIDES_URL = "data/nas-guides.json";

  const MAKER_LABEL = { apc: "APC（シュナイダーエレクトリック）", omron: "オムロン", fuji: "富士電機", eaton: "EATON" };
  const MAKER_SHORT = { apc: "APC", omron: "オムロン", fuji: "富士電機", eaton: "EATON" };
  const MAKER_ORDER = ["apc", "omron", "fuji", "eaton"];
  // Windows版LAN DISKで連動させるときの要点（公式対応表の注記を要約。2026-10-16確認）
  const WINDOWS_SUMMARY = {
    apc: "管理ソフト「PowerChute」は<strong>別売</strong>です。UPSとは別にご購入ください。USBでつなぐ場合は接続用ケーブル（AP98117J）、ネットワーク経由で連動させる場合はネットワークマネジメントカードも別途必要です。",
    omron: "<strong>UPSに付属</strong>の管理ソフトウェア（PowerAttendant など）を使います。",
    fuji: "富士電機の管理ソフトウェア（PowerUX など）を使います。",
    eaton: "<strong>UPSに付属</strong>の管理ソフトウェアを使います。LAN経由で接続する場合は、別売のネットワークマネジメントカードが必要です。"
  };
  const STATUS_RANK = { ok: 3, checking: 2, untested: 1, ng: 0 };
  const STATUS_LABEL = { ok: "対応", checking: "確認中", untested: "未検証", ng: "非対応" };
  const FORM_LABEL = { tower: "据え置き", rack: "19インチラック", "tower-rack": "据え置き・ラック兼用" };

  // UPSにいっしょにつなぐ機器の目安（I-O DATA製品の仕様に記載の標準的な消費電力をもとに切り上げ。2026-10-16確認）
  //  バックアップ用HDD：HDJA-UTN/LDB 8〜10W(typ)、HDW-UTN 19W(typ)、HD4-UTN 25〜39W(typ)
  //  スイッチングハブ：ETG-ESH08UM 2.4W、ETG-ESH16LM 8W、ETG-ESH24LM 12W、BSH-XG08 20W(typ)
  //  ルーター：一般的なWi-Fiルーターで15〜20W程度
  const DEVICE_PRESETS = [
    { id: "hdd1", label: "バックアップ用HDD（1ドライブ）", watt: 10, hint: "HDJA-UTN/LDBなど" },
    { id: "hdd2", label: "バックアップ用HDD（2ドライブ）", watt: 20, hint: "HDW-UTNなど" },
    { id: "hdd4", label: "バックアップ用HDD（4ドライブ）", watt: 40, hint: "HD4-UTNなど" },
    { id: "hub8", label: "スイッチングハブ（8ポート）", watt: 5, hint: "ETG-ESH08UMなど" },
    { id: "hub24", label: "スイッチングハブ（16〜24ポート）", watt: 15, hint: "ETG-ESH24LMなど" },
    { id: "hub10g", label: "10ギガ対応スイッチングハブ", watt: 20, hint: "BSH-XG08など" },
    { id: "router", label: "ルーター", watt: 20, hint: "一般的なWi-Fiルーター" },
    { id: "custom", label: "その他の機器", watt: 30, hint: "消費電力を入力してください" }
  ];
  const MINUTE_OPTIONS = [5, 10, 15, 20];
  const DEFAULT_MINUTES = 10;
  const LOAD_LIMIT = 0.8;   // UPSの出力容量の8割までを「余裕あり」とする
  const AGING_MARGIN = 1.3; // バッテリーは使ううちに持ちが落ちるので、目安時間に3割の余裕があるものを「余裕あり」とする

  const el = (s) => document.querySelector(s);
  const modelInput = el("#model-input");
  const suggestBox = el("#model-suggest");
  const emptyState = el("#empty-state");
  const nasView = el("#nas-view");
  const upsView = el("#ups-view");
  const updatedAtEl = el("#updated-at");

  let compat = null;
  let specs = new Map();
  let seriesAliases = {};
  let guides = [];
  let nasProducts = [];
  let byNas = new Map();
  let byUps = new Map();
  let nasCodes = [];
  let searchItems = [];
  let highlighted = -1;

  // 画面の状態（URLにも保存する）
  const state = {
    mode: null,        // "nas" | "ups"
    nasCode: null,     // 公式表上のシリーズ名（例 HDL4-LXU）
    nasSku: null,      // 入力された型番（例 HDL4-LX04U）
    upsModel: null,
    devices: [],       // [{key, presetId, label, watt, count, isNas}]
    minutes: DEFAULT_MINUTES
  };

  // ---------- データ読み込み ----------

  const loadJson = (url) => fetch(url, { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error(url);
    return r.json();
  });

  Promise.all([loadJson(COMPAT_URL), loadJson(SPECS_URL), loadJson(GUIDES_URL)])
    .then(([c, s, g]) => {
      compat = c;
      s.ups.forEach((u) => specs.set(u.model, u));
      seriesAliases = s.seriesAliases || {};
      guides = g.linux || [];
      buildIndexes();
      renderUpdatedAt();
      buildSearchItems();
      // NASセレクターの商品データ（画像・正式名・容量別型番）。取れなくても動くようにする
      return loadJson(NAS_DATA_URL)
        .then((n) => { nasProducts = n.products || []; })
        .catch(() => { nasProducts = []; })
        .then(() => { buildSearchItems(); applyStateFromUrl(); if (browseIsOpen()) renderBrowse(); });
    })
    .catch(() => {
      updatedAtEl.textContent = "データの読み込みに失敗しました。時間をおいて再度お試しください。";
    });

  function buildIndexes() {
    byNas = new Map();
    byUps = new Map();
    compat.entries.forEach((e) => {
      if (!byNas.has(e.nas)) byNas.set(e.nas, []);
      byNas.get(e.nas).push(e);
      if (e.kind === "ups") {
        if (!byUps.has(e.model)) byUps.set(e.model, []);
        byUps.get(e.model).push(e);
      }
    });
    nasCodes = [...byNas.keys()];
  }

  function renderUpdatedAt() {
    el("#source-date").textContent = compat.sourceDate ? `公式ページ ${compat.sourceDate}現在の内容` : "";
    if (!compat.updatedAt) return;
    const d = new Date(compat.updatedAt);
    const days = (Date.now() - d.getTime()) / 86400000;
    updatedAtEl.textContent = `データ最終更新日：${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日` +
      (days > 40 ? "（40日以上更新されていません。最新情報は公式サイトでご確認ください）" : "");
    updatedAtEl.classList.toggle("info-footer__updated--stale", days > 40);
  }

  // ---------- 型番 → 公式表のシリーズ名 ----------
  //
  // 型番には容量の数字が入る（HDL4-LX04U → シリーズ HDL4-LXU、HDL2-Z25SI3B16B → HDL2-Z25SI3BB）。
  // 先頭一致で探すと「HDL4-LX04U → HDL4-LX」のように別シリーズ（ラック版など）に取り違えるため、
  // 容量の数字のかたまりを1つ取り除いた形が公式表のシリーズ名と完全一致するかで判定する。
  // 「HDL2-HB02/02」「HDL2-XA2B/TM5」のようなセット品は「/」より前で判定する。

  function resolveSeries(sku) {
    const set = new Set(nasCodes);
    const tryOne = (raw) => {
      const s = raw.toUpperCase().trim();
      if (set.has(s)) return s;
      const dash = s.indexOf("-");
      const runs = [];
      const re = /\d+/g;
      let m;
      while ((m = re.exec(s))) if (m.index > dash) runs.push([m.index, m[0].length]);
      for (let i = runs.length - 1; i >= 0; i--) {
        const [idx, len] = runs[i];
        const cand = s.slice(0, idx) + s.slice(idx + len);
        for (const v of [cand, cand.replace(/-UB$/, "B-U")]) if (set.has(v)) return v;
      }
      return null;
    };
    return tryOne(sku) || (sku.includes("/") ? tryOne(sku.split("/")[0]) : null);
  }

  // ---------- 検索候補 ----------

  const normalize = (s) => String(s || "").toUpperCase().replace(/[\s\-‐－ー/]/g, "");

  function buildSearchItems() {
    const items = [];
    const coveredCodes = new Set();
    nasProducts.forEach((p) => {
      (p.variants || []).forEach((v) => {
        if (!v.sku) return;
        const code = resolveSeries(v.sku);
        if (code) coveredCodes.add(code);
        items.push({ type: "nas", key: v.sku.toUpperCase(), label: v.sku, sub: seriesLabel(p), code, product: p, variant: v,
          discontinued: (v.status || p.status) === "生産終了" });
      });
    });
    // NASセレクターに載っていない旧機種は、公式表のシリーズ名で探せるようにする
    nasCodes.forEach((code) => {
      if (coveredCodes.has(code)) return;
      const os = byNas.get(code)[0].os;
      items.push({ type: "nas", key: code, label: code, sub: `${code}シリーズ（${os === "windows" ? "Windows" : "Linux"}・旧機種を含む）`, code, product: null, variant: null });
    });
    [...byUps.keys()].forEach((model) => {
      const sp = specs.get(model);
      items.push({ type: "ups", key: model, label: model, sub: sp ? `${MAKER_LABEL[sp.maker]}　${sp.name}` : "UPS" });
    });
    searchItems = items;
  }

  function findMatches(q) {
    const n = normalize(q);
    if (!n) return [];
    const hits = searchItems.filter((it) => normalize(it.key).includes(n));
    // 完全一致 → 現行の型番（NASセレクターに載っているもの）→ 旧機種のシリーズ名・生産終了品 → UPS の順。
    // それぞれの中では前方一致を先に
    const score = (it) => {
      const k = normalize(it.key);
      if (k === n) return 0;
      const group = it.type === "ups" ? 3 : (!it.product || it.discontinued) ? 2 : 1;
      return group * 10 + (k.startsWith(n) ? 0 : 1);
    };
    return hits.sort((a, b) => score(a) - score(b) || a.key.localeCompare(b.key));
  }

  modelInput.addEventListener("input", () => {
    const q = modelInput.value.trim();
    if (!q) {
      suggestBox.hidden = true;
      showEmpty();
      return;
    }
    if (!compat) return;
    const all = findMatches(q);
    const shown = all.slice(0, 30);
    suggestBox.innerHTML = "";
    highlighted = -1;
    if (shown.length === 0) {
      suggestBox.innerHTML = `<p class="search__suggest-note">「${esc(q)}」に一致する型番が見つかりません。型番の一部だけでも検索できます。</p>`;
      suggestBox.hidden = false;
      return;
    }
    shown.forEach((it) => {
      const btn = document.createElement("button");
      btn.type = "button";
      // LAN DISKの型番は型番だけを大きく出す（「LAN DISK」の文字は付けない）。UPSの型番にだけ小さな印を付けて区別する
      btn.className = it.type === "ups" ? "sg sg--ups" : "sg";
      btn.innerHTML = `<span class="sg-label">${esc(it.label)}${it.type === "ups" ? `<span class="sg-kind">UPS</span>` : ""}</span>` +
        (it.sub ? `<span class="sg-sub">${esc(it.sub)}</span>` : "");
      btn.addEventListener("click", () => choose(it));
      suggestBox.appendChild(btn);
    });
    if (all.length > shown.length) {
      const p = document.createElement("p");
      p.className = "search__suggest-note";
      p.textContent = `ほか${all.length - shown.length}件。もう少し文字を入れると絞り込めます`;
      suggestBox.appendChild(p);
    }
    suggestBox.hidden = false;
    const exact = all.find((it) => normalize(it.key) === normalize(q));
    if (exact && all.filter((it) => normalize(it.key) === normalize(q)).length === 1) choose(exact, true);
  });

  modelInput.addEventListener("keydown", (e) => {
    if (suggestBox.hidden) return;
    const btns = [...suggestBox.querySelectorAll("button")];
    if (!btns.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); highlighted = (highlighted + 1) % btns.length; }
    else if (e.key === "ArrowUp") { e.preventDefault(); highlighted = (highlighted - 1 + btns.length) % btns.length; }
    else if (e.key === "Enter") { if (highlighted >= 0) { e.preventDefault(); btns[highlighted].click(); } return; }
    else if (e.key === "Escape") { suggestBox.hidden = true; return; }
    else return;
    btns.forEach((b, i) => b.classList.toggle("search__suggest-btn--active", i === highlighted));
    btns[highlighted].scrollIntoView({ block: "nearest" });
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".search")) suggestBox.hidden = true; });

  function choose(it, keepOpen) {
    if (!keepOpen) {
      modelInput.value = it.label;
      suggestBox.hidden = true;
    }
    if (it.type === "ups") selectUps(it.key);
    else selectNas(it);
  }

  function showEmpty() {
    state.mode = null;
    emptyState.hidden = false;
    nasView.hidden = true;
    upsView.hidden = true;
  }

  // 「LAN DISK（HDL4-LXシリーズ）」→「HDL4-LXシリーズ」
  function seriesLabel(p) {
    const m = String(p.name || "").match(/（([^）]+)）/);
    return m ? m[1] : (p.name || p.series || "");
  }

  // ---------- 一覧から機種を選ぶ（カーテンのように下りてくるパネル。ISSセレクターと同じ） ----------
  //
  // NASセレクターのシリーズ一覧（画像・シリーズ名・容量別の型番）をそのまま使う。
  // 表示するのは、①生産終了でない ②公式UPS対応表に載っている（＝UPSを表示できる）型番だけ。
  // 容量ボタンを押すと、検索欄で型番を選んだときと同じ selectNas() を呼ぶ。

  const browseToggle = el("#browse-toggle");
  const browsePanel = el("#browse-panel");
  const browseFilters = el("#browse-filters");
  const browseGrid = el("#browse-grid");
  const browseCount = el("#browse-count");
  const browseFilterState = { os: "all", install: "all", bay: "all" };
  const BROWSE_FILTER_DEFS = [
    { key: "os", label: "OS", options: [
      { value: "all", label: "すべて" }, { value: "Linux OS", label: "Linux" }, { value: "Windows OS", label: "Windows" }] },
    { key: "install", label: "置き方", options: [
      { value: "all", label: "すべて" }, { value: "BOXタイプ", label: "BOX（据え置き）" }, { value: "ラックマウントタイプ", label: "ラックマウント" }] },
    { key: "bay", label: "ドライブ数", options: null } // 実データから自動で作る
  ];

  function browseIsOpen() { return browsePanel.classList.contains("browse-panel--open"); }
  function setBrowseOpen(open) {
    browsePanel.classList.toggle("browse-panel--open", open);
    browseToggle.setAttribute("aria-expanded", open ? "true" : "false");
    browseToggle.classList.toggle("browse-toggle--open", open);
    if (open) { suggestBox.hidden = true; renderBrowse(); }
  }
  browseToggle.addEventListener("click", () => setBrowseOpen(!browseIsOpen()));
  el("#browse-close").addEventListener("click", () => setBrowseOpen(false));
  el("#browse-open-inline").addEventListener("click", () => {
    setBrowseOpen(true);
    browsePanel.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  const bayNumber = (bay) => Number((String(bay || "").match(/(\d+)/) || [])[1] || 0);

  function browseableSeries() {
    if (!compat) return null;
    return nasProducts
      .filter((p) => p.status !== "生産終了")
      .map((p) => ({ p, variants: (p.variants || []).filter((v) => v.sku && v.status !== "生産終了" && resolveSeries(v.sku)) }))
      .filter((x) => x.variants.length > 0);
  }

  function renderBrowse() {
    const all = browseableSeries();
    if (!all || all.length === 0) {
      browseFilters.innerHTML = "";
      browseCount.textContent = "";
      browseGrid.innerHTML = `<p class="browse-loading">${!all ? "機種の一覧を読み込んでいます…" : "機種の一覧を読み込めませんでした。お手数ですが、上の検索欄に型番を入力してください。"}</p>`;
      return;
    }
    const bays = [...new Set(all.map((x) => x.p.bay).filter(Boolean))].sort((a, b) => bayNumber(a) - bayNumber(b));
    browseFilters.innerHTML = BROWSE_FILTER_DEFS.map((def) => {
      const opts = def.options || [{ value: "all", label: "すべて" }, ...bays.map((b) => ({ value: b, label: b }))];
      return `<div class="browse-filter-row"><span class="browse-filter-row__label">${def.label}</span>${opts.map((o) =>
        `<button type="button" class="browse-pill${browseFilterState[def.key] === o.value ? " browse-pill--on" : ""}" data-key="${def.key}" data-value="${escAttr(o.value)}">${esc(o.label)}</button>`).join("")}</div>`;
    }).join("");

    const list = all
      .filter((x) => browseFilterState.os === "all" || x.p.os === browseFilterState.os)
      .filter((x) => browseFilterState.install === "all" || x.p.install === browseFilterState.install)
      .filter((x) => browseFilterState.bay === "all" || x.p.bay === browseFilterState.bay)
      .sort((a, b) => String(a.p.os).localeCompare(String(b.p.os)) || bayNumber(a.p.bay) - bayNumber(b.p.bay) ||
        seriesLabel(a.p).localeCompare(seriesLabel(b.p)));
    browseCount.textContent = `${list.length}シリーズ`;
    if (!list.length) {
      browseGrid.innerHTML = `<p class="browse-loading">この組み合わせの機種はありません。条件を「すべて」に戻してみてください。</p>`;
      return;
    }
    browseGrid.innerHTML = list.map(({ p, variants }, i) => `
      <div class="browse-card" style="animation-delay:${Math.min(i, 12) * 30}ms">
        <div class="browse-card__image">${p.imageUrl ? `<img src="${escAttr(p.imageUrl)}" alt="" loading="lazy" onerror="this.remove()">` : ""}</div>
        <p class="browse-card__name">${esc(seriesLabel(p))}</p>
        <p class="browse-card__meta">${esc([p.os && p.os.replace(" OS", ""), p.install && p.install.replace("タイプ", ""), p.bay].filter(Boolean).join("・"))}</p>
        <p class="browse-card__cap-label">容量を選ぶ</p>
        <div class="browse-card__caps">${variants.map((v) => `<button type="button" class="cap-btn" data-sku="${escAttr(v.sku)}" title="${escAttr(v.sku)}">
          <span class="cap-btn__tb">${v.capacityTB != null ? esc(v.capacityTB + "TB") : esc(v.sku)}</span><span class="cap-btn__sku">${esc(v.sku)}</span></button>`).join("")}</div>
      </div>`).join("");
  }

  browseFilters.addEventListener("click", (e) => {
    const b = e.target.closest(".browse-pill");
    if (!b) return;
    browseFilterState[b.dataset.key] = b.dataset.value;
    renderBrowse();
  });
  browseGrid.addEventListener("click", (e) => {
    const b = e.target.closest(".cap-btn");
    if (!b) return;
    const it = searchItems.find((x) => x.type === "nas" && x.key === b.dataset.sku.toUpperCase());
    if (!it) return;
    modelInput.value = it.label;
    suggestBox.hidden = true;
    selectNas(it);
    setBrowseOpen(false);
    // パネルが閉じるアニメーション（0.3秒）でページの高さが変わるため、閉じ終わってから結果の位置へスクロールする
    setTimeout(() => nasView.scrollIntoView({ behavior: "smooth", block: "start" }), 350);
  });

  // ---------- LAN DISKから探す ----------

  let currentNas = null; // { code, sku, product, os, entries }

  function selectNas(it, fromUrl) {
    const code = it.code;
    emptyState.hidden = true;
    upsView.hidden = true;
    nasView.hidden = false;
    state.mode = "nas";
    state.nasSku = it.label;
    state.nasCode = code;

    const img = el("#nas-image");
    const p = it.product;
    img.onerror = () => { img.hidden = true; };
    if (p && p.imageUrl) { img.src = p.imageUrl; img.alt = it.label; img.hidden = false; } else img.hidden = true;
    el("#nas-model").textContent = it.label;

    if (!code) {
      currentNas = null;
      el("#nas-desc").textContent = p ? p.name : "";
      el("#nas-os").textContent = "";
      el("#load-panel").hidden = true;
      el("#setup-panel").hidden = true;
      el("#pdf-btn").hidden = true;
      el("#result-count").textContent = "";
      el("#ups-results").innerHTML = `<div class="no-match">この機種は、I-O DATA公式の<a href="https://www.iodata.jp/pio/io/nas/landisk/ups.htm" target="_blank" rel="noopener noreferrer">ランディスク対応UPS一覧</a>に掲載されていません。UPSとの組み合わせについては、販売店またはI-O DATAへお問い合わせください。</div>`;
      updateUrl();
      return;
    }

    const entries = byNas.get(code);
    const os = entries[0].os;
    currentNas = { code, sku: it.label, product: p, os, entries };
    el("#nas-desc").textContent = (p ? p.name + "　" : "") + `公式UPS対応表のシリーズ：${code}`;
    const osEl = el("#nas-os");
    osEl.textContent = os === "windows" ? "Windows OS搭載" : "Linux（オリジナルOS）";
    osEl.className = `os-badge os-badge--${os}`;
    el("#load-panel").hidden = false;
    el("#setup-panel").hidden = false;
    el("#pdf-btn").hidden = false;

    if (!fromUrl) {
      state.minutes = DEFAULT_MINUTES;
      state.devices = defaultDevices();
    }
    ensureNasDevice();
    renderLoadRows();
    renderMinuteBtns();
    renderSetup();
    renderUpsResults();
    updateUrl();
  }

  // LAN DISK本体の消費電力：仕様ページの最大消費電力。取れていない機種はベイ数からの仮の目安
  function nasWatt() {
    const pw = compat.nasPower && compat.nasPower[currentNas.code];
    if (pw && pw.maxW) return { watt: pw.maxW, source: "spec", specUrl: pw.specUrl, typW: pw.typW };
    const bays = Number((currentNas.code.match(/^HDL(\d)/) || [])[1]) || (currentNas.code.startsWith("HDL-") ? 2 : 2);
    const guess = { 1: 30, 2: 70, 4: 120, 6: 150 }[bays] || 120;
    return { watt: guess, source: "guess", specUrl: pw ? pw.specUrl : null };
  }

  function defaultDevices() {
    return [{ key: "nas", isNas: true, label: "", watt: null, count: 1 },
            { key: "d1", presetId: "hdd1", label: presetById("hdd1").label, watt: presetById("hdd1").watt, count: 1 }];
  }
  function presetById(id) { return DEVICE_PRESETS.find((d) => d.id === id); }

  function ensureNasDevice() {
    let nas = state.devices.find((d) => d.isNas);
    if (!nas) { nas = { key: "nas", isNas: true, count: 1 }; state.devices.unshift(nas); }
    const w = nasWatt();
    nas.label = `LAN DISK本体（${currentNas.sku}）`;
    if (nas.watt == null || nas.autoWatt) { nas.watt = w.watt; nas.autoWatt = true; }
    nas.wattInfo = w;
  }

  const loadRows = el("#load-rows");

  function renderLoadRows() {
    loadRows.innerHTML = state.devices.map((d) => {
      const preset = d.presetId ? presetById(d.presetId) : null;
      const hint = d.isNas
        ? (d.wattInfo.source === "spec"
            ? `仕様の最大消費電力（<a href="${escAttr(d.wattInfo.specUrl)}" target="_blank" rel="noopener noreferrer">仕様ページ</a>）`
            : `仕様の値を取得できていないため、仮の目安です。商品の仕様ページの「消費電力」を入力してください`)
        : esc(preset ? preset.hint : "");
      return `<div class="load-row${d.isNas ? " load-row--nas" : ""}" data-key="${d.key}">
        <div class="load-row__name">
          ${d.presetId === "custom"
            ? `<input type="text" class="load-row__label-input" value="${escAttr(d.label)}" aria-label="機器の名前">`
            : `<span>${esc(d.label)}</span>`}
          <span class="load-row__hint">${hint}</span>
        </div>
        <label class="load-row__watt"><input type="number" min="0" step="1" value="${d.watt ?? ""}" aria-label="消費電力（W）"> W</label>
        ${d.isNas ? `<span class="load-row__count load-row__count--fixed">1台</span>` : `
        <div class="load-row__count">
          <button type="button" data-act="minus" aria-label="1台減らす">−</button>
          <span>${d.count}台</span>
          <button type="button" data-act="plus" aria-label="1台増やす">＋</button>
        </div>
        <button type="button" class="load-row__remove" data-act="remove" aria-label="この機器を外す">×</button>`}
      </div>`;
    }).join("");
    updateTotal();
  }

  loadRows.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const row = btn.closest(".load-row");
    const d = state.devices.find((x) => x.key === row.dataset.key);
    if (!d) return;
    if (btn.dataset.act === "plus") d.count = Math.min(20, d.count + 1);
    if (btn.dataset.act === "minus") d.count = Math.max(1, d.count - 1);
    if (btn.dataset.act === "remove") state.devices = state.devices.filter((x) => x !== d);
    renderLoadRows();
    afterLoadChange();
  });
  loadRows.addEventListener("input", (e) => {
    const row = e.target.closest(".load-row");
    if (!row) return;
    const d = state.devices.find((x) => x.key === row.dataset.key);
    if (!d) return;
    if (e.target.type === "number") {
      const v = parseFloat(e.target.value);
      d.watt = isFinite(v) && v >= 0 ? v : 0;
      if (d.isNas) d.autoWatt = false;
    } else {
      d.label = e.target.value;
    }
    updateTotal();
    afterLoadChange(true);
  });

  const picker = el("#device-picker");
  el("#add-device-btn").addEventListener("click", () => {
    picker.hidden = !picker.hidden;
    picker.innerHTML = DEVICE_PRESETS.map((p) =>
      `<button type="button" class="picker-btn" data-id="${p.id}">${esc(p.label)}<span>約${p.watt}W</span></button>`).join("");
  });
  picker.addEventListener("click", (e) => {
    const b = e.target.closest(".picker-btn");
    if (!b) return;
    const p = presetById(b.dataset.id);
    const same = p.id !== "custom" && state.devices.find((d) => d.presetId === p.id);
    if (same) same.count++;
    else state.devices.push({ key: "d" + Date.now(), presetId: p.id, label: p.id === "custom" ? "" : p.label, watt: p.watt, count: 1 });
    picker.hidden = true;
    renderLoadRows();
    afterLoadChange();
  });

  function totalWatt() {
    return state.devices.reduce((s, d) => s + (Number(d.watt) || 0) * (d.count || 1), 0);
  }
  function updateTotal() {
    const tw = el("#total-watt");
    const next = String(Math.round(totalWatt()));
    if (tw.textContent !== next) {
      tw.textContent = next;
      // 数字が変わったことが目で分かるよう、軽く弾ませる
      const box = tw.parentElement;
      box.classList.remove("load-total__value--pop");
      void box.offsetWidth;
      box.classList.add("load-total__value--pop");
    }
    const parts = state.devices.map((x) => `${shortLabel(x)} ${fmt(Number(x.watt) || 0, 1)}W${x.count > 1 ? `×${x.count}台` : ""}`);
    el("#total-formula").textContent = `${parts.join(" ＋ ")} ＝ ${fmt(totalWatt(), 1)}W`;
    el("#plug-count").textContent = `UPSのコンセントに挿すプラグ：${plugCount()}本`;
  }

  function renderMinuteBtns() {
    el("#minute-btns").innerHTML = MINUTE_OPTIONS.map((m) =>
      `<button type="button" class="minute-btn${m === state.minutes ? " minute-btn--on" : ""}" data-min="${m}">${m}分${m === DEFAULT_MINUTES ? "<small>おすすめ</small>" : ""}</button>`).join("");
    el("#load-why").innerHTML =
      `<strong>なぜ「${state.minutes}分」？</strong>　停電してもすぐに電源が切れるわけではなく、UPSのバッテリーで動いている間に、LAN DISKが自動で安全にシャットダウンします。` +
      `LAN DISKは停電を検知してから設定した時間（数分）待ってからシャットダウンを始め、終わるまでにも時間がかかります。` +
      `この「待ち時間＋シャットダウンにかかる時間」に余裕を持たせるため、<strong>10分以上</strong>もつ容量をおすすめしています。` +
      `<br>また、UPSのバッテリーは使ううちに少しずつ持ちが落ちていきます。そのため、新品時の目安で<strong>${Math.round(state.minutes * AGING_MARGIN)}分以上（3割の余裕）</strong>もつものを「余裕あり」としています。`;
  }
  el("#minute-btns").addEventListener("click", (e) => {
    const b = e.target.closest(".minute-btn");
    if (!b) return;
    state.minutes = Number(b.dataset.min);
    renderMinuteBtns();
    afterLoadChange();
  });

  let loadTimer = null;
  function afterLoadChange(debounce) {
    clearTimeout(loadTimer);
    const run = () => { renderUpsResults(); updateUrl(); };
    if (debounce) loadTimer = setTimeout(run, 250); else run();
  }

  // ---------- 停電時の運転時間の目安 ----------
  //
  // メーカーが公表している「負荷（W）ごとのバックアップ時間（分）」の表を、
  // 両対数（log-log）で直線補間する。表の範囲外は、端の2点の傾きで延長する。
  // 出力容量（W）を超える場合は「容量オーバー」。

  // 計算の途中経過も返す（画面の「計算式を見る」でそのまま見せるため）
  //   メーカー表の2点（W1でt1分、W2でt2分）から、
  //   k = log(t1 ÷ t2) ÷ log(W2 ÷ W1)   … 消費電力が増えたときに時間がどれだけ縮むかの度合い
  //   もつ時間 ≒ t1 × (W1 ÷ 合計W)^k
  //   （これは両対数グラフ上で2点を直線で結ぶのと同じ計算）
  function runtimeDetail(sp, watt) {
    if (!sp || !sp.runtime || !sp.runtime.length || watt <= 0) return null;
    if (watt > sp.watt) return { t: 0, mode: "over" };
    const pts = sp.runtime;
    if (pts.length === 1) {
      const [w1, t1] = pts[0];
      return { t: Math.min(t1 * (w1 / watt), 600), mode: "single", w1, t1, k: 1 };
    }
    let i = pts.findIndex((p) => p[0] >= watt);
    let mode = "between";
    if (i === -1) { i = pts.length - 1; mode = "above"; }   // 公表値のいちばん重い点より重い：最後の2点で延長
    else if (i === 0) { i = 1; mode = "below"; }            // 公表値のいちばん軽い点より軽い：最初の2点で延長
    else if (pts[i][0] === watt) mode = "exact";
    const [w1, t1] = pts[i - 1];
    const [w2, t2] = pts[i];
    const k = Math.log(t1 / t2) / Math.log(w2 / w1);
    const raw = t1 * Math.pow(w1 / watt, k);
    return { t: Math.min(raw, 600), capped: raw > 600, mode, w1, t1, w2, t2, k };
  }
  function runtimeAt(sp, watt) {
    const d = runtimeDetail(sp, watt);
    return d ? d.t : null;
  }

  // つなぐ機器の台数（＝UPSのコンセントに挿すプラグの数）
  function plugCount() {
    return state.devices.reduce((s, d) => s + (d.count || 1), 0);
  }

  function judge(sp, watt, need) {
    if (!sp) return { level: "unknown" };
    const load = watt / sp.watt;
    const detail = runtimeDetail(sp, watt);
    const rt = detail ? detail.t : 0;
    const plugs = plugCount();
    const backup = sp.outlets ? sp.outlets.backup : null;
    const outletShort = backup != null && plugs > backup;
    let level;
    if (watt > sp.watt) level = "over";
    else if (rt >= need * AGING_MARGIN && load <= LOAD_LIMIT) level = "good";
    else if (rt >= need) level = "tight";
    else level = "short";
    if (outletShort && (level === "good" || level === "tight")) level = "outlet";
    return { level, load, rt, detail, plugs, backup, need, watt };
  }

  function needsSpecialOutlet(sp) {
    return !!(sp && sp.caution && /(200V|専用コンセント|電気工事)/.test(sp.caution));
  }

  // ---------- 絞り込み ----------

  const sidebar = el("#sidebar");
  // スマホ幅では絞り込みを折りたたんでおき、「絞り込み」を押すと開く
  const sidebarTitle = el(".sidebar__title");
  if (window.matchMedia("(max-width: 860px)").matches) sidebar.classList.add("sidebar--collapsed");
  sidebarTitle.addEventListener("click", () => sidebar.classList.toggle("sidebar--collapsed"));
  el("#filter-reset").addEventListener("click", () => {
    sidebar.querySelectorAll('input[name="maker"], input[name="form"]').forEach((c) => { c.checked = true; });
    el("#f-sine").checked = false;
    el("#f-narsus").checked = false;
    el("#f-100v").checked = true;
    el("#f-untested").checked = false;
    el("#f-discontinued").checked = false;
    sidebar.dispatchEvent(new Event("change"));
  });
  sidebar.addEventListener("change", () => {
    if (state.mode === "nas" && currentNas) renderUpsResults();
    if (state.mode === "ups") renderUpsView();
  });

  function filters() {
    const makers = [...sidebar.querySelectorAll('input[name="maker"]:checked')].map((x) => x.value);
    const forms = [...sidebar.querySelectorAll('input[name="form"]:checked')].map((x) => x.value);
    return {
      makers, forms,
      sine: el("#f-sine").checked,
      narsus: el("#f-narsus").checked,
      only100v: el("#f-100v").checked,
      untested: el("#f-untested").checked,
      discontinued: el("#f-discontinued").checked
    };
  }

  function formMatches(sp, forms) {
    if (!sp) return true;
    if (sp.form === "tower") return forms.includes("floor");
    if (sp.form === "rack") return forms.includes("rack");
    return forms.includes("floor") || forms.includes("rack");
  }

  // ---------- このNASで使えるUPSの一覧 ----------

  // 同じ組み合わせが複数の表に載っている場合はまとめる（状況は良い方、注記は全部）
  function upsRowsForNas() {
    const map = new Map();
    currentNas.entries.filter((e) => e.kind === "ups").forEach((e) => {
      const models = seriesAliases[e.model] || [e.model];
      models.forEach((model) => {
        const key = e.maker + "|" + model;
        const prev = map.get(key);
        if (!prev) {
          map.set(key, { model, tableModel: e.model, label: e.label, maker: e.maker, block: e.block, status: e.status,
            narsus: e.narsus, notes: new Set(e.notes), osLabel: e.osLabel });
        } else {
          if (STATUS_RANK[e.status] > STATUS_RANK[prev.status]) prev.status = e.status;
          prev.narsus = prev.narsus || e.narsus;
          e.notes.forEach((n) => prev.notes.add(n));
        }
      });
    });
    return [...map.values()].map((r) => ({ ...r, spec: specs.get(r.model) }));
  }

  function renderUpsResults() {
    const f = filters();
    const need = state.minutes;
    const watt = totalWatt();
    const all = upsRowsForNas();
    let hiddenByFilter = 0;

    const visible = all.filter((r) => {
      const sp = r.spec;
      const pass = f.makers.includes(r.maker) && formMatches(sp, f.forms) &&
        (!f.sine || (sp && /正弦波/.test(sp.waveform || "") && !/近似|疑似/.test(sp.waveform || ""))) &&
        (!f.narsus || r.narsus) &&
        (!f.only100v || !needsSpecialOutlet(sp)) &&
        (f.discontinued || !sp || sp.salesStatus !== "販売終了");
      if (!pass && r.status !== "ng") hiddenByFilter++;
      return pass;
    });
    visible.forEach((r) => { r.j = judge(r.spec, watt, need); });

    const ok = visible.filter((r) => r.status === "ok");
    const fits = ok.filter((r) => r.j.level === "good" || r.j.level === "tight")
      .sort((a, b) => (a.j.level === "good" ? 0 : 1) - (b.j.level === "good" ? 0 : 1) || a.spec.watt - b.spec.watt);
    const notEnough = ok.filter((r) => ["short", "over", "outlet", "unknown"].includes(r.j.level))
      .sort((a, b) => (b.spec ? b.spec.watt : 0) - (a.spec ? a.spec.watt : 0));
    const pending = visible.filter((r) => r.status === "untested" || r.status === "checking");
    const ng = all.filter((r) => r.status === "ng").sort((a, b) => a.model.localeCompare(b.model));

    // メーカーごとに、条件を満たす中でいちばん小さい（＝お手頃になりやすい）容量に印を付ける
    const bestKeys = new Set();
    MAKER_ORDER.forEach((mk) => {
      const first = fits.find((r) => r.maker === mk && r.j.level === "good" && r.spec.salesStatus !== "販売終了");
      if (first) bestKeys.add(first.maker + "|" + first.model);
    });

    const okCount = all.filter((r) => r.status === "ok").length;
    el("#result-count").textContent =
      `公式に「対応」となっているUPS ${okCount}機種のうち、条件に合うもの ${fits.length}機種` +
      (hiddenByFilter ? `（絞り込みで${hiddenByFilter}機種を非表示）` : "");

    // まず「メーカーごとのちょうどいい容量」を見せ、残りは折りたたむ（候補が多すぎると選べないため）
    let picks = fits.filter((r) => bestKeys.has(r.maker + "|" + r.model));
    if (!picks.length) picks = fits.slice(0, 4);
    const others = fits.filter((r) => !picks.includes(r));

    let html = "";
    html += `<section class="result-group">
      <h4 class="result-group__title result-group__title--good">おすすめ：停電時に${need}分以上もつUPS<span>合計 約${Math.round(watt)}Wの場合／メーカーごとに、条件を満たすいちばん小さい容量を表示</span></h4>`;
    html += fits.length
      ? `<div class="ups-grid">${picks.map((r) => upsCard(r, bestKeys.has(r.maker + "|" + r.model))).join("")}</div>`
      : `<div class="no-match">条件に合うUPSがありません。つなぐ機器を減らすか、左の絞り込み条件（メーカー・設置方法・コンセント）をゆるめてみてください。</div>`;
    html += `</section>`;
    if (others.length) {
      html += `<details class="result-group result-group--fold">
        <summary class="result-group__title">そのほかの条件を満たすUPS（${others.length}機種）</summary>
        <p class="result-group__lead">より長い時間もたせたい場合や、設置場所・メーカーのご希望がある場合はこちらからお選びください（容量の小さい順）。</p>
        <div class="ups-grid">${others.map((r) => upsCard(r, false)).join("")}</div></details>`;
    }

    if (notEnough.length) {
      html += `<details class="result-group result-group--fold">
        <summary class="result-group__title result-group__title--warn">このLAN DISKに対応しているが、この使い方では容量・時間・コンセントが足りないUPS（${notEnough.length}機種）</summary>
        <p class="result-group__lead">LAN DISKとの組み合わせとしては対応していますが、今のつなぐ機器では、停電時に${need}分もたない、容量をオーバーする、または停電時も電気が来るコンセントの口数が足りない見込みです。</p>
        <div class="ups-grid">${notEnough.map((r) => upsCard(r, false)).join("")}</div></details>`;
    }
    if (f.untested && pending.length) {
      html += `<section class="result-group">
        <h4 class="result-group__title result-group__title--pending">公式表で「未検証」「確認中」のUPS（${pending.length}機種）</h4>
        <p class="result-group__lead">I-O DATAで動作を確認していない組み合わせです。連動シャットダウンが正しく動く保証はありません。</p>
        <div class="ups-grid">${pending.map((r) => { r.j = judge(r.spec, watt, need); return upsCard(r, false); }).join("")}</div></section>`;
    }
    if (ng.length) {
      html += `<details class="result-group result-group--fold">
        <summary class="result-group__title result-group__title--ng">このLAN DISKでは使えないUPS（公式表で「×」：${ng.length}機種）</summary>
        <ul class="ng-list">${ng.map((r) => `<li><span class="mono">${esc(r.model)}</span>　${esc(r.spec ? r.spec.name : r.label)}</li>`).join("")}</ul></details>`;
    }
    el("#ups-results").innerHTML = html;
    renderPrintHeader(fits);
  }

  function upsCard(r, best) {
    const sp = r.spec;
    const j = r.j || { level: "unknown" };
    const notesHtml = noteTexts(r.block, [...r.notes]).map((t) => `<li>${t}</li>`).join("");
    const discontinued = sp && sp.salesStatus === "販売終了";
    let meter = "";
    if (sp && j.level !== "unknown") {
      const pct = Math.min(100, Math.round(j.load * 100));
      const rtText = j.level === "over" ? "容量オーバー" : `約${formatMin(j.rt)}`;
      const verdict = {
        good: "余裕あり",
        tight: j.load > LOAD_LIMIT ? "容量ぎりぎり（使用率が8割を超えています）" : "時間ぎりぎり（バッテリーが劣化すると足りなくなるおそれ）",
        short: `${state.minutes}分もたない見込み`,
        over: "容量オーバー",
        outlet: `コンセントが足りません（停電時も電気が来る口 ${j.backup}口／つなぐ機器 ${j.plugs}台）`
      }[j.level];
      meter = `<div class="meter meter--${j.level}">
        <div class="meter__row"><span>停電時にもつ時間（目安）</span><strong>${rtText}</strong></div>
        <div class="meter__row"><span>出力容量に対する使用率</span><strong>${Math.round(j.load * 100)}%</strong></div>
        <div class="meter__bar"><span style="width:${pct}%"></span><i style="left:${LOAD_LIMIT * 100}%"></i></div>
        <p class="meter__verdict">${verdict}</p>
      </div>`;
    }
    return `<article class="ups-card${best ? " ups-card--best" : ""}${discontinued ? " ups-card--old" : ""}">
      ${best ? `<p class="ups-card__ribbon">${MAKER_SHORT[r.maker]}でちょうどいい容量</p>` : ""}
      <div class="ups-card__head">
        <p class="ups-card__maker">${esc(MAKER_LABEL[r.maker])}</p>
        <h5 class="ups-card__model">${esc(r.model)}</h5>
        <p class="ups-card__name">${esc(sp ? sp.name : r.label)}</p>
        <div class="ups-card__badges">
          <span class="badge badge--status-${r.status}">${STATUS_LABEL[r.status]}</span>
          ${r.narsus ? `<span class="badge badge--narsus">NarSuS対応</span>` : ""}
          ${discontinued ? `<span class="badge badge--old">販売終了</span>` : ""}
        </div>
      </div>
      ${meter}
      ${sp ? `<dl class="spec-list">
        <div><dt>出力容量</dt><dd>${sp.va}VA／${sp.watt}W</dd></div>
        <div><dt>設置</dt><dd>${FORM_LABEL[sp.form] || "－"}${sp.rackU ? `（${sp.rackU}U）` : ""}</dd></div>
        <div><dt>給電方式</dt><dd>${esc(sp.topology || "－")}</dd></div>
        <div><dt>停電時の波形</dt><dd>${esc(sp.waveform || "－")}</dd></div>
        <div class="spec-list__full"><dt>コンセント</dt><dd>${outletText(sp)}</dd></div>
      </dl>` : `<p class="ups-card__nospec">このUPSの容量データがないため、運転時間は計算していません。</p>`}
      ${sp && sp.outlets && sp.outlets.surgeOnly ? `<p class="ups-card__caution">⚠ ${sp.outlets.backup + sp.outlets.surgeOnly}口のうち${sp.outlets.surgeOnly}口は「雷サージ保護のみ」で、停電時は電気が来ません。LAN DISKは必ず「バッテリーバックアップ」側の口に挿してください。</p>` : ""}
      ${sp && sp.caution ? `<p class="ups-card__caution">⚠ ${esc(sp.caution)}</p>` : ""}
      ${sp && j.detail ? calcHtml(r, j) : ""}
      ${notesHtml ? `<details class="ups-card__notes"><summary>公式対応表の注記</summary><ul>${notesHtml}</ul></details>` : ""}
      ${sp && sp.url ? `<a class="ups-card__link" href="${escAttr(sp.url)}" target="_blank" rel="noopener noreferrer">メーカーの商品ページ ↗</a>` : ""}
    </article>`;
  }

  // 計算式の中で使う短い機器名
  function shortLabel(d) {
    if (d.isNas) return "LAN DISK";
    const id = d.presetId || "";
    if (id.startsWith("hdd")) return "バックアップHDD";
    if (id.startsWith("hub")) return "ハブ";
    if (id === "router") return "ルーター";
    return (d.label || "その他").slice(0, 10);
  }

  function outletText(sp) {
    const o = sp.outlets;
    if (!o || o.backup == null) return o && o.note ? esc(o.note) : "－";
    return `停電時も給電 <strong>${o.backup}口</strong>` + (o.surgeOnly ? `＋サージ保護のみ ${o.surgeOnly}口` : "") +
      (o.type ? `<span class="spec-list__sub">${esc(o.type)}</span>` : "");
  }

  // 「計算式を見る」：このUPSで、なぜその時間・判定になるのかを式で見せる
  const fmt = (n, d = 0) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString("ja-JP");
  function calcHtml(r, j) {
    const sp = r.spec;
    const d = j.detail;
    const parts = state.devices.map((x) => `${shortLabel(x)} ${fmt(x.watt || 0, 1)}W${x.count > 1 ? `×${x.count}台` : ""}`);
    const step1 = `${parts.join(" ＋ ")} ＝ <strong>${fmt(j.watt, 1)}W</strong>`;
    const step2 = `${fmt(j.watt, 1)}W ÷ ${sp.watt}W（このUPSの出力容量）＝ <strong>${fmt(j.load * 100)}%</strong>` +
      (j.load <= LOAD_LIMIT ? `　→ 8割（80%）以内 ✓` : j.load <= 1 ? `　→ 8割を超えています` : `　→ 容量オーバー ✗`);
    let step3;
    if (d.mode === "over") {
      step3 = `合計がUPSの出力容量を超えるため、使えません。`;
    } else if (d.mode === "single") {
      step3 = `メーカー公表値：${d.w1}Wで${d.t1}分（公表値が1点のみのため、消費電力に反比例するとして概算）<br>
        ${d.t1}分 × （${d.w1}W ÷ ${fmt(j.watt, 1)}W）＝ <strong>約${formatMin(d.t)}</strong>`;
    } else {
      const where = { between: "合計の消費電力をはさむ2点", exact: "公表値の2点", below: "公表値のうちいちばん軽い2点（それより軽いので延長）", above: "公表値のうちいちばん重い2点（それより重いので延長）" }[d.mode];
      step3 = `メーカー公表値（${where}）：<strong>${d.w1}Wで${d.t1}分</strong>、<strong>${d.w2}Wで${d.t2}分</strong><br>
        k ＝ log(${d.t1} ÷ ${d.t2}) ÷ log(${d.w2} ÷ ${d.w1}) ＝ ${fmt(d.k, 2)}<br>
        もつ時間 ≒ ${d.t1}分 × （${d.w1}W ÷ ${fmt(j.watt, 1)}W）<sup>${fmt(d.k, 2)}</sup> ＝ <strong>約${formatMin(d.t)}</strong>` +
        (d.capped ? `（10時間を超えるため、10時間で打ち切り）` : "");
    }
    const need13 = fmt(j.need * AGING_MARGIN, 1);
    const step4 = j.level === "over" ? "容量オーバー" :
      `${formatMin(j.rt)} ${j.rt >= j.need * AGING_MARGIN ? "≧" : "＜"} ${j.need}分 × 1.3（バッテリー劣化の余裕）＝ ${need13}分`;
    const step5 = j.backup == null ? "このUPSのコンセント数のデータがありません" :
      `つなぐ機器 ${j.plugs}台 ${j.plugs <= j.backup ? "≦" : "＞"} 停電時も電気が来るコンセント ${j.backup}口 ${j.plugs <= j.backup ? "✓" : "✗"}`;
    return `<details class="calc"><summary>計算式を見る</summary>
      <ol class="calc__steps">
        <li><span class="calc__label">① つなぐ機器の合計</span>${step1}</li>
        <li><span class="calc__label">② UPSの使用率</span>${step2}</li>
        <li><span class="calc__label">③ 停電時にもつ時間</span>${step3}</li>
        <li><span class="calc__label">④ 時間の判定</span>${step4}</li>
        <li><span class="calc__label">⑤ コンセントの口数</span>${step5}</li>
      </ol>
      <p class="calc__note">k は「消費電力が増えると、もつ時間がどれだけ縮むか」の度合いです。k＝1なら消費電力が2倍で時間は半分、k が1より大きいと半分より短くなります（バッテリーは大きな電流を流すほど効率が落ちるため）。</p>
    </details>`;
  }

  function formatMin(m) {
    if (m >= 120) return `${Math.floor(m / 60)}時間以上`;
    if (m >= 60) return `${Math.floor(m / 60)}時間${Math.round(m % 60)}分`;
    return `${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}分`;
  }

  function noteTexts(blockId, nums) {
    const b = compat.blocks.find((x) => x.id === blockId);
    if (!b) return [];
    return nums.filter((n) => b.numbered[n]).map((n) => noteHtml(b.numbered[n]));
  }
  function noteHtml(note) {
    let t = esc(note.text);
    (note.links || []).forEach((l) => {
      const label = esc(l.text);
      if (label && t.includes(label)) {
        t = t.replace(label, `<a href="${escAttr(l.href)}" target="_blank" rel="noopener noreferrer">${label}</a>`);
      }
    });
    return t;
  }

  // ---------- 導入のしかた（OS別） ----------

  function renderSetup() {
    const box = el("#setup-panel");
    if (currentNas.os === "linux") {
      const g = guides.find((x) => x.series.includes(currentNas.code));
      const product = currentNas.entries.find((e) => e.nasUrl);
      const link = g
        ? `<a class="guide-btn" href="${escAttr(g.url)}" target="_blank" rel="noopener noreferrer">${esc(g.name)}のマニュアルで「UPS」の設定方法を見る ↗</a>`
        : (product ? `<a class="guide-btn" href="${escAttr(product.nasUrl)}" target="_blank" rel="noopener noreferrer">商品ページ（サポート情報・マニュアル）を見る ↗</a>` : "");
      box.innerHTML = `<h3 class="panel__title">導入のしかた（Linux系のLAN DISK）</h3>
        <ol class="setup-steps">
          <li><strong>UPSとLAN DISKをUSBケーブルでつなぎます。</strong>${compat.linuxNotice ? `<span class="setup-steps__note">${esc(compat.linuxNotice)}</span>` : ""}</li>
          <li><strong>LAN DISKの設定画面で「UPS設定」を行います。</strong>LAN DISK本体の標準機能で、停電を検知したら自動でシャットダウンするように設定できます。専用ソフトのインストールは不要です。</li>
          <li><strong>設定のしかたはマニュアルで確認できます。</strong></li>
        </ol>
        ${link}`;
    } else {
      // Windows：メーカーごとの管理ソフト（公式表の「UPS管理ソフトウェア」行）と、共通の注意
      const sw = new Map();
      currentNas.entries.filter((e) => e.kind === "software").forEach((e) => {
        const k = e.maker + "|" + e.model;
        const prev = sw.get(k);
        if (!prev || STATUS_RANK[e.status] > STATUS_RANK[prev.status]) sw.set(k, { ...e, notes: new Set(e.notes) });
        else e.notes.forEach((n) => prev.notes.add(n));
      });
      const makers = MAKER_ORDER.filter((mk) => currentNas.entries.some((e) => e.maker === mk && e.kind === "ups" && e.status === "ok"));
      const blocksHtml = makers.map((mk) => {
        const b = compat.blocks.find((x) => x.os === "windows" && x.maker === mk);
        const soft = [...sw.values()].filter((s) => s.maker === mk && (s.status === "ok" || s.status === "checking"));
        // 閉じているとき：要点の一言＋使える管理ソフトの名前（短いチップ）だけを見せる
        // 開いたとき：ソフトごとの注意と、公式対応表の注意事項をすべて見せる
        const chips = soft.map((s) => `<span class="soft-chip">${esc(s.label.replace(/[（(].*$/, ""))}${s.status === "checking" ? "（確認中）" : ""}</span>`).join("");
        const softDetail = soft.map((s) => {
          const notes = noteTexts(s.block, [...s.notes]);
          return `<li><strong>${esc(s.label)}</strong>${s.status === "checking" ? "（確認中）" : ""}${notes.map((t) => `<span class="soft-list__note">${t}</span>`).join("")}</li>`;
        }).join("");
        const general = b ? b.general.map((n) => `<li>${noteHtml(n)}</li>`).join("") : "";
        const count = soft.length + (b ? b.general.length : 0);
        const moreId = `setup-more-${mk}`;
        return `<div class="setup-maker">
          <p class="setup-maker__name">${esc(MAKER_SHORT[mk])}のUPSを使う場合</p>
          <p class="setup-maker__text">${WINDOWS_SUMMARY[mk] || ""}</p>
          ${chips ? `<p class="setup-maker__sub">このLAN DISKで使える管理ソフト</p><div class="soft-chips">${chips}</div>` : ""}
          ${count ? `<button type="button" class="setup-maker__toggle" aria-expanded="false" aria-controls="${moreId}">
              <span>ソフトごとの注意・公式の注意事項（${count}件）を見る</span><span class="setup-maker__arrow" aria-hidden="true">▾</span></button>
            <div class="setup-maker__more" id="${moreId}"><div class="setup-maker__more-inner">
              ${softDetail ? `<p class="setup-maker__sub">管理ソフトごとの注意</p><ul class="soft-list">${softDetail}</ul>` : ""}
              ${general ? `<p class="setup-maker__sub">公式対応表の注意事項</p><ul class="setup-maker__notes">${general}</ul>` : ""}
            </div></div>` : ""}
        </div>`;
      }).join("");
      box.innerHTML = `<h3 class="panel__title">導入のしかた（Windows OS搭載のLAN DISK）</h3>
        <p class="panel__lead">Windows OS搭載のLAN DISKでは、<strong>UPSメーカーの管理ソフトウェア</strong>をLAN DISKにインストールして、停電時の自動シャットダウンを設定します。使うソフトはUPSのメーカーによって異なります。</p>
        <div class="setup-makers">${blocksHtml}</div>`;
      box.querySelectorAll(".setup-maker__toggle").forEach((btn) => {
        btn.addEventListener("click", () => {
          const open = btn.getAttribute("aria-expanded") !== "true";
          btn.setAttribute("aria-expanded", open ? "true" : "false");
          btn.closest(".setup-maker").classList.toggle("setup-maker--open", open);
          btn.querySelector("span").textContent = open ? "閉じる" : btn.dataset.label;
        });
        btn.dataset.label = btn.querySelector("span").textContent;
      });
    }
  }

  // ---------- UPSから探す ----------

  function selectUps(model) {
    state.mode = "ups";
    state.upsModel = model;
    emptyState.hidden = true;
    nasView.hidden = true;
    upsView.hidden = false;
    renderUpsView();
    updateUrl();
  }

  let nameCache = null;
  function nasDisplayName(code) {
    if (!nameCache) {
      nameCache = new Map();
      nasProducts.forEach((p) => (p.variants || []).forEach((v) => {
        const c = resolveSeries(v.sku);
        if (c && !nameCache.has(c)) nameCache.set(c, p.name);
      }));
    }
    return nameCache.get(code) || null;
  }

  function renderUpsView() {
    const model = state.upsModel;
    const sp = specs.get(model);
    const rows = (byUps.get(model) || []).slice();
    // DL3115シリーズのように公式表ではシリーズ表記のもの
    Object.entries(seriesAliases).forEach(([alias, list]) => {
      if (list.includes(model)) rows.push(...(byUps.get(alias) || []));
    });
    const info = el("#ups-info");
    info.innerHTML = sp ? `
      <p class="ups-card__maker">${esc(MAKER_LABEL[sp.maker])}</p>
      <h2 class="ups-info__model">${esc(model)}</h2>
      <p class="ups-info__name">${esc(sp.name)}${sp.salesStatus === "販売終了" ? `　<span class="badge badge--old">販売終了</span>` : ""}</p>
      <dl class="spec-list spec-list--wide">
        <div><dt>出力容量</dt><dd>${sp.va}VA／${sp.watt}W</dd></div>
        <div><dt>設置</dt><dd>${FORM_LABEL[sp.form] || "－"}${sp.rackU ? `（${sp.rackU}U）` : ""}</dd></div>
        <div><dt>給電方式</dt><dd>${esc(sp.topology || "－")}</dd></div>
        <div><dt>停電時の波形</dt><dd>${esc(sp.waveform || "－")}</dd></div>
        <div><dt>コンセント</dt><dd>${outletText(sp)}</dd></div>
        <div><dt>100W使用時の目安</dt><dd>約${formatMin(runtimeAt(sp, 100))}</dd></div>
        <div><dt>200W使用時の目安</dt><dd>${sp.watt >= 200 ? "約" + formatMin(runtimeAt(sp, 200)) : "容量オーバー"}</dd></div>
      </dl>
      ${sp.caution ? `<p class="ups-card__caution">⚠ ${esc(sp.caution)}</p>` : ""}
      ${sp.url ? `<a class="ups-card__link" href="${escAttr(sp.url)}" target="_blank" rel="noopener noreferrer">メーカーの商品ページ ↗</a>` : ""}`
      : `<h2 class="ups-info__model">${esc(model)}</h2>`;

    // NASシリーズごとに、良い方の状況でまとめる
    const byCode = new Map();
    rows.forEach((e) => {
      const prev = byCode.get(e.nas);
      if (!prev || STATUS_RANK[e.status] > STATUS_RANK[prev.status]) byCode.set(e.nas, e);
    });
    const f = filters();
    const groups = [
      { status: "ok", title: "対応しているLAN DISK", cls: "good" },
      { status: "checking", title: "確認中のLAN DISK", cls: "pending", optional: true },
      { status: "untested", title: "未検証のLAN DISK", cls: "pending", optional: true },
      { status: "ng", title: "使えないLAN DISK（公式表で「×」）", cls: "ng" }
    ];
    const okCount = [...byCode.values()].filter((e) => e.status === "ok").length;
    el("#nas-count").textContent = `対応 ${okCount}シリーズ`;
    let html = "";
    groups.forEach((g) => {
      if (g.optional && !f.untested) return;
      const list = [...byCode.values()].filter((e) => e.status === g.status);
      if (!list.length) return;
      const osGroups = [["windows", "Windows OS搭載モデル"], ["linux", "Linuxベース オリジナルOSモデル"]];
      // NASセレクターに載っている（＝現在取り扱いのある）機種を先に、旧機種は折りたたむ
      const chips = (items) => `<div class="nas-chips">${items.map((e) => {
        const name = nasDisplayName(e.nas);
        return `<button type="button" class="nas-chip" data-code="${escAttr(e.nas)}"><span class="mono">${esc(e.nas)}</span>${name ? `<small>${esc(name)}</small>` : ""}</button>`;
      }).join("")}</div>`;
      html += `<section class="result-group"><h4 class="result-group__title result-group__title--${g.cls}">${g.title}（${list.length}シリーズ）</h4>`;
      osGroups.forEach(([os, label]) => {
        const items = list.filter((e) => e.os === os).sort((a, b) => a.nas.localeCompare(b.nas));
        if (!items.length) return;
        const current = items.filter((e) => nasDisplayName(e.nas));
        const older = items.filter((e) => !nasDisplayName(e.nas));
        html += `<p class="nas-chip-label">${label}</p>`;
        if (current.length) html += chips(current);
        if (older.length) {
          html += current.length
            ? `<details class="older-fold"><summary>旧機種（${older.length}シリーズ）</summary>${chips(older)}</details>`
            : chips(older);
        }
      });
      html += `</section>`;
    });
    if (!f.untested) html += `<p class="result-group__lead">「未検証」「確認中」のLAN DISKは、左の絞り込みで表示できます。</p>`;
    el("#nas-results").innerHTML = html || `<div class="no-match">公式表に掲載がありません。</div>`;
  }

  el("#nas-results").addEventListener("click", (e) => {
    const b = e.target.closest(".nas-chip");
    if (!b) return;
    const code = b.dataset.code;
    modelInput.value = code;
    selectNas({ type: "nas", label: code, code, product: null });
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // ---------- URL（共有リンク・NASセレクターからの連携） ----------
  //  ?model=HDL4-LX04         … LAN DISKの型番（NASセレクター・DASセレクターと同じ名前）
  //  &dev=hdd1x1,hub8x2,c45x1 … つなぐ機器（プリセットID×台数、c＋W数は「その他の機器」）
  //  &nasw=80                 … LAN DISK本体の消費電力を手で書き換えた場合
  //  &min=10                  … 停電後にもってほしい時間
  //  ?ups=SMT750J             … UPSから探す

  function updateUrl() {
    const params = new URLSearchParams();
    if (state.mode === "nas" && state.nasSku && !state.nasCode) {
      params.set("model", state.nasSku); // 公式表に載っていない機種：型番だけ
    } else if (state.mode === "nas" && state.nasSku) {
      params.set("model", state.nasSku);
      const nas = state.devices.find((d) => d.isNas);
      if (nas && !nas.autoWatt && isFinite(nas.watt)) params.set("nasw", String(nas.watt));
      const dev = state.devices.filter((d) => !d.isNas).map((d) =>
        d.presetId === "custom" ? `c${Math.round(d.watt)}x${d.count}` : `${d.presetId}x${d.count}`).join(",");
      params.set("dev", dev || "none");
      if (state.minutes !== DEFAULT_MINUTES) params.set("min", String(state.minutes));
    } else if (state.mode === "ups" && state.upsModel) {
      params.set("ups", state.upsModel);
    }
    const qs = params.toString();
    history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  }

  function applyStateFromUrl() {
    const p = new URLSearchParams(location.search);
    const ups = p.get("ups");
    if (ups && (byUps.has(ups.toUpperCase()) || specs.has(ups.toUpperCase()))) {
      modelInput.value = ups.toUpperCase();
      selectUps(ups.toUpperCase());
      return;
    }
    const model = p.get("model");
    if (!model) return;
    modelInput.value = model;
    const it = searchItems.find((x) => x.type === "nas" && x.key === model.toUpperCase()) ||
      { type: "nas", label: model.toUpperCase(), code: resolveSeries(model), product: null };
    const dev = p.get("dev");
    if (dev) {
      state.devices = [{ key: "nas", isNas: true, watt: null, count: 1 }];
      if (dev !== "none") {
        dev.split(",").forEach((tok, i) => {
          const m = tok.match(/^(c(\d+)|[a-z0-9]+)x(\d+)$/);
          if (!m) return;
          const count = Math.max(1, Math.min(20, Number(m[3])));
          if (m[2] !== undefined) {
            state.devices.push({ key: "u" + i, presetId: "custom", label: "その他の機器", watt: Number(m[2]), count });
          } else {
            const pr = presetById(m[1]);
            if (pr) state.devices.push({ key: "u" + i, presetId: pr.id, label: pr.label, watt: pr.watt, count });
          }
        });
      }
      const nasw = parseFloat(p.get("nasw"));
      if (isFinite(nasw)) { state.devices[0].watt = nasw; state.devices[0].autoWatt = false; }
    } else {
      state.devices = defaultDevices();
    }
    const min = Number(p.get("min"));
    state.minutes = MINUTE_OPTIONS.includes(min) ? min : DEFAULT_MINUTES;
    selectNas(it, true);
  }

  // ---------- URLのコピー・PDF保存 ----------
  // window.alert等は環境によって無効化されることがあるので使わない（NASセレクターの教訓⑤）

  function copyUrl(feedbackEl) {
    const url = location.href;
    const done = (ok) => {
      feedbackEl.textContent = ok ? "URLをコピーしました" : "コピーできませんでした。アドレスバーのURLをコピーしてください";
      feedbackEl.hidden = false;
      setTimeout(() => { feedbackEl.hidden = true; }, 2500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => done(true), () => done(fallbackCopy(url)));
    } else done(fallbackCopy(url));
  }
  function fallbackCopy(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }
  el("#share-btn").addEventListener("click", () => copyUrl(el("#share-feedback")));
  el("#share-btn-ups").addEventListener("click", () => copyUrl(el("#share-feedback-ups")));

  // PDFのファイル名：型番＋UPS＋日付8桁（NASセレクターと同じ考え方。例 HDL4-LX04_UPS_20261016.pdf）
  el("#pdf-btn").addEventListener("click", () => {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const original = document.title;
    document.title = `${(state.nasSku || "LANDISK").replace(/[\\/:*?"<>|]/g, "-")}_UPS_${ymd}`;
    // 折りたたみ部分も印刷に出す
    const closed = [...document.querySelectorAll("#ups-results details:not([open])")];
    closed.forEach((x) => x.setAttribute("open", ""));
    window.print();
    closed.forEach((x) => x.removeAttribute("open"));
    document.title = original;
  });

  function renderPrintHeader() {
    const d = new Date();
    const devices = state.devices.map((x) => `${x.label || "その他の機器"}：${Math.round(x.watt)}W${x.count > 1 ? ` × ${x.count}台` : ""}`).join("、");
    el("#print-header").innerHTML = `
      <p class="print-header__title">LAN DISK用 UPSのご提案</p>
      <p>LAN DISK：<strong>${esc(state.nasSku || "")}</strong>（公式UPS対応表のシリーズ：${esc(state.nasCode || "")}）</p>
      <p>UPSにつなぐ機器：${esc(devices)}（合計 約${Math.round(totalWatt())}W）</p>
      <p>停電後に最低限もってほしい時間：${state.minutes}分</p>
      <p class="print-header__date">作成日：${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日／対応状況はI-O DATA公式「ランディスク対応UPS一覧」（${esc(compat.sourceDate || "")}現在）に基づきます。運転時間は目安です。</p>`;
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function escAttr(s) { return esc(s); }

  } // initApp
})();
