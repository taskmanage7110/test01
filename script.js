(() => {
  "use strict";

  const sourceNovel = document.querySelector(".novel");
  if (!sourceNovel) {
    console.error("`.novel` が見つかりません。");
    return;
  }

  // =========================
  // 1) 元本文を材料として保持
  // =========================
  const sourceItems = Array.from(sourceNovel.childNodes)
    .filter((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return (node.textContent ?? "").trim() !== "";
      }
      return node.nodeType === Node.ELEMENT_NODE;
    })
    .map((node) => normalizeSourceNode(node));

  function normalizeSourceNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const p = document.createElement("p");
      p.textContent = (node.textContent ?? "").trim();
      return {
        type: "text-element",
        template: p.cloneNode(false),
        text: p.textContent ?? "",
      };
    }

    const el = /** @type {HTMLElement} */ (node);
    const hasNestedElements = el.querySelector("*") !== null;

    if (!hasNestedElements) {
      return {
        type: "text-element",
        template: /** @type {HTMLElement} */ (el.cloneNode(false)),
        text: el.textContent ?? "",
      };
    }

    return {
      type: "complex-element",
      template: /** @type {HTMLElement} */ (el.cloneNode(true)),
    };
  }

  // =========================
  // 2) HTMLを触らずUIをJSで追加
  // =========================
  const shell = document.createElement("section");
  shell.className = "pb-reader-shell";

  const controls = document.createElement("div");
  controls.className = "pb-reader-controls";

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.textContent = "前へ";

  const info = document.createElement("div");
  info.className = "pb-reader-info";
  info.innerHTML = `<span class="pb-page-now">1</span> / <span class="pb-page-total">1</span>`;

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.textContent = "次へ";

  controls.append(prevBtn, info, nextBtn);

  const viewport = document.createElement("div");
  viewport.className = "pb-viewport";

  const currentLayer = document.createElement("article");
  currentLayer.className = "pb-page pb-page-current";

  const incomingLayer = document.createElement("article");
  incomingLayer.className = "pb-page pb-page-incoming";

  viewport.append(currentLayer, incomingLayer);
  shell.append(controls, viewport);
  sourceNovel.parentNode.insertBefore(shell, sourceNovel);

  // 元本文は分割元として残しつつ非表示
  sourceNovel.style.display = "none";

  // =========================
  // 3) CSSもJSで注入
  // =========================
  const style = document.createElement("style");
  style.textContent = `
    .pb-reader-shell {
      margin: 16px 0;
    }

    .pb-reader-controls {
      writing-mode: horizontal-tb;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-bottom: 14px;
    }

    .pb-reader-controls button {
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.06);
      color: inherit;
      border-radius: 10px;
      padding: 10px 16px;
      cursor: pointer;
      font: inherit;
    }

    .pb-reader-controls button:disabled {
      opacity: 0.45;
      cursor: default;
    }

    .pb-reader-info {
      min-width: 88px;
      text-align: center;
      writing-mode: horizontal-tb;
    }

    .pb-viewport {
      width: 100%;
      height: min(78vh, 980px);
      min-height: 360px;
      position: relative;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 18px;
      background: rgba(255,255,255,0.03);
    }

    .pb-page,
    .pb-measure {
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      padding: 24px;
      overflow: hidden;
      writing-mode: vertical-rl;
      text-orientation: mixed;
      direction: rtl;
      line-height: 2.1;
      font-size: 18px;
      letter-spacing: 0.03em;
      background: rgba(255,255,255,0.02);
    }

    .pb-page {
      position: absolute;
      inset: 0;
      will-change: transform, opacity;
      backface-visibility: hidden;
    }

    .pb-page p,
    .pb-measure p {
      margin: 0 0 0 1.35em;
      text-indent: 1em;
    }

    .pb-page .center,
    .pb-measure .center {
      text-indent: 0;
      text-align: center;
    }

    .pb-page-incoming {
      display: none;
      transform: translateX(100%);
      opacity: 0.98;
    }

    .pb-viewport.is-animating-next .pb-page-current {
      transition: transform 280ms ease, opacity 280ms ease;
      transform: translateX(-18%);
      opacity: 0.45;
    }

    .pb-viewport.is-animating-next .pb-page-incoming {
      display: block;
      transition: transform 280ms ease;
      transform: translateX(0);
    }

    .pb-viewport.is-animating-prev .pb-page-current {
      transition: transform 280ms ease, opacity 280ms ease;
      transform: translateX(18%);
      opacity: 0.45;
    }

    .pb-viewport.is-animating-prev .pb-page-incoming {
      display: block;
      transform: translateX(-100%);
      transition: transform 280ms ease;
      transform: translateX(0);
    }

    .pb-hidden-layer {
      position: fixed;
      left: -999999px;
      top: 0;
      visibility: hidden;
      pointer-events: none;
      contain: strict;
    }

    @media (max-width: 640px) {
      .pb-page,
      .pb-measure {
        padding: 16px;
        font-size: 16px;
      }

      .pb-viewport {
        height: 72vh;
      }
    }
  `;
  document.head.appendChild(style);

  // =========================
  // 4) 状態
  // =========================
  const state = {
    currentPage: null,     // { startCursor, endCursor, nodes }
    nextPage: null,        // 遅延生成キャッシュ
    history: [],           // 前ページ用
    isAnimating: false,
    repaginateTimer: null,
  };

  // カーソル: { index, offset }
  // index: sourceItems の何番目から読むか
  // offset: text-element 内の何文字目から読むか
  function makeCursor(index = 0, offset = 0) {
    return { index, offset };
  }

  function isEndCursor(cursor) {
    return cursor.index >= sourceItems.length;
  }

  function cloneCursor(cursor) {
    return { index: cursor.index, offset: cursor.offset };
  }

  function cursorEquals(a, b) {
    return a.index === b.index && a.offset === b.offset;
  }

  function getNowEl() {
    return shell.querySelector(".pb-page-now");
  }

  function getTotalEl() {
    return shell.querySelector(".pb-page-total");
  }

  // =========================
  // 5) 測定用ページ
  // =========================
  function createMeasureBox() {
    const layer = document.createElement("div");
    layer.className = "pb-hidden-layer";

    const box = document.createElement("article");
    box.className = "pb-measure";

    const rect = viewport.getBoundingClientRect();
    box.style.width = `${Math.floor(rect.width)}px`;
    box.style.height = `${Math.floor(rect.height)}px`;

    layer.appendChild(box);
    document.body.appendChild(layer);

    return {
      box,
      destroy() {
        layer.remove();
      },
    };
  }

  function overflowed(el) {
    return el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;
  }

  function clearAndFillMeasure(measureBox, nodes) {
    measureBox.innerHTML = "";
    for (const n of nodes) {
      measureBox.appendChild(n.cloneNode(true));
    }
  }

  function appendIfFits(measureBox, currentNodes, candidateNode) {
    clearAndFillMeasure(measureBox, currentNodes);
    measureBox.appendChild(candidateNode.cloneNode(true));
    return !overflowed(measureBox);
  }

  function createTextNodeFromItem(item, startOffset, endOffset = null) {
    const el = /** @type {HTMLElement} */ (item.template.cloneNode(false));
    const full = item.text ?? "";
    const text = endOffset == null ? full.slice(startOffset) : full.slice(startOffset, endOffset);
    el.textContent = text;
    return el;
  }

  function countFitChars(item, startOffset, measureBox, currentNodes) {
    const text = item.text ?? "";
    const maxLen = text.length - startOffset;

    let low = 0;
    let high = maxLen;
    let best = 0;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const candidate = createTextNodeFromItem(item, startOffset, startOffset + mid);
      const fits = appendIfFits(measureBox, currentNodes, candidate);

      if (fits) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return best;
  }

  // =========================
  // 6) 「現在カーソルから1ページだけ」生成
  // =========================
  function generatePageFromCursor(startCursor) {
    const cursor = cloneCursor(startCursor);
    const currentNodes = [];

    const { box: measureBox, destroy } = createMeasureBox();

    while (cursor.index < sourceItems.length) {
      const item = sourceItems[cursor.index];

      if (item.type === "complex-element") {
        const node = item.template.cloneNode(true);

        if (appendIfFits(measureBox, currentNodes, node)) {
          currentNodes.push(node);
          cursor.index += 1;
          cursor.offset = 0;
          continue;
        }

        if (currentNodes.length === 0) {
          // 1ページに収まらない複雑要素は最小実装ではそのまま置く
          currentNodes.push(node);
          cursor.index += 1;
          cursor.offset = 0;
        }

        break;
      }

      // text-element
      const text = item.text ?? "";
      const startOffset = cursor.offset;

      // すでに末尾なら次へ
      if (startOffset >= text.length) {
        cursor.index += 1;
        cursor.offset = 0;
        continue;
      }

      const fullNode = createTextNodeFromItem(item, startOffset);

      if (appendIfFits(measureBox, currentNodes, fullNode)) {
        currentNodes.push(fullNode);
        cursor.index += 1;
        cursor.offset = 0;
        continue;
      }

      const fitCount = countFitChars(item, startOffset, measureBox, currentNodes);

      if (fitCount > 0) {
        const partialNode = createTextNodeFromItem(item, startOffset, startOffset + fitCount);
        currentNodes.push(partialNode);
        cursor.offset = startOffset + fitCount;
      }

      break;
    }

    destroy();

    return {
      startCursor: cloneCursor(startCursor),
      endCursor: cloneCursor(cursor),
      nodes: currentNodes.map((n) => n.cloneNode(true)),
    };
  }

  // =========================
  // 7) 描画 / ページ数表示
  // =========================
  function renderNodes(layer, nodes) {
    layer.innerHTML = "";
    for (const n of nodes) {
      layer.appendChild(n.cloneNode(true));
    }
  }

  function approximatePageNumber() {
    return state.history.length + 1;
  }

  function updateInfo() {
    getNowEl().textContent = String(approximatePageNumber());
    getTotalEl().textContent = state.nextPage || (state.currentPage && isEndCursor(state.currentPage.endCursor))
      ? "?"
      : "?";

    prevBtn.disabled = state.history.length === 0 || state.isAnimating;
    nextBtn.disabled = !!(state.currentPage && isEndCursor(state.currentPage.endCursor)) || state.isAnimating;
  }

  // =========================
  // 8) 遅延で次ページを生成
  // =========================
  function scheduleNextPageWarmup() {
    if (!state.currentPage) return;
    if (isEndCursor(state.currentPage.endCursor)) {
      state.nextPage = null;
      updateInfo();
      return;
    }
    if (state.nextPage && cursorEquals(state.nextPage.startCursor, state.currentPage.endCursor)) {
      updateInfo();
      return;
    }

    const job = () => {
      if (!state.currentPage) return;
      state.nextPage = generatePageFromCursor(state.currentPage.endCursor);
      updateInfo();
    };

    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(job, { timeout: 120 });
    } else {
      setTimeout(job, 0);
    }
  }

  // =========================
  // 9) 初期化
  // =========================
  function initialize() {
    state.history = [];
    state.nextPage = null;
    state.currentPage = generatePageFromCursor(makeCursor(0, 0));
    renderNodes(currentLayer, state.currentPage.nodes);
    incomingLayer.innerHTML = "";
    incomingLayer.style.display = "none";
    incomingLayer.style.transform = "translateX(100%)";
    updateInfo();
    scheduleNextPageWarmup();
  }

  // =========================
  // 10) 次ページへ（右からスライドイン）
  // =========================
  function goNext() {
    if (state.isAnimating || !state.currentPage) return;
    if (isEndCursor(state.currentPage.endCursor)) return;

    const targetPage = state.nextPage ?? generatePageFromCursor(state.currentPage.endCursor);
    if (!targetPage || targetPage.nodes.length === 0) return;

    state.isAnimating = true;
    updateInfo();

    renderNodes(incomingLayer, targetPage.nodes);
    incomingLayer.style.display = "block";
    incomingLayer.style.transform = "translateX(100%)";

    // reflow
    void incomingLayer.offsetWidth;

    viewport.classList.remove("is-animating-prev");
    viewport.classList.add("is-animating-next");

    const done = () => {
      viewport.classList.remove("is-animating-next");
      incomingLayer.removeEventListener("transitionend", done);

      // 履歴に現在ページを保存
      state.history.push({
        startCursor: cloneCursor(state.currentPage.startCursor),
        endCursor: cloneCursor(state.currentPage.endCursor),
        nodes: state.currentPage.nodes.map((n) => n.cloneNode(true)),
      });

      // current を次ページへ更新
      state.currentPage = {
        startCursor: cloneCursor(targetPage.startCursor),
        endCursor: cloneCursor(targetPage.endCursor),
        nodes: targetPage.nodes.map((n) => n.cloneNode(true)),
      };

      renderNodes(currentLayer, state.currentPage.nodes);

      incomingLayer.innerHTML = "";
      incomingLayer.style.display = "none";
      incomingLayer.style.transform = "translateX(100%)";

      state.nextPage = null;
      state.isAnimating = false;
      updateInfo();
      scheduleNextPageWarmup();
    };

    incomingLayer.addEventListener("transitionend", done, { once: true });
  }

  // =========================
  // 11) 前ページへ（履歴から復元）
  // =========================
  function goPrev() {
    if (state.isAnimating) return;
    if (state.history.length === 0) return;

    const prevPage = state.history[state.history.length - 1];
    if (!prevPage) return;

    state.isAnimating = true;
    updateInfo();

    renderNodes(incomingLayer, prevPage.nodes);
    incomingLayer.style.display = "block";
    incomingLayer.style.transform = "translateX(-100%)";

    // reflow
    void incomingLayer.offsetWidth;

    viewport.classList.remove("is-animating-next");
    viewport.classList.add("is-animating-prev");

    const done = () => {
      viewport.classList.remove("is-animating-prev");
      incomingLayer.removeEventListener("transitionend", done);

      state.currentPage = state.history.pop();

      renderNodes(currentLayer, state.currentPage.nodes);

      incomingLayer.innerHTML = "";
      incomingLayer.style.display = "none";
      incomingLayer.style.transform = "translateX(100%)";

      state.nextPage = null;
      state.isAnimating = false;
      updateInfo();
      scheduleNextPageWarmup();
    };

    incomingLayer.addEventListener("transitionend", done, { once: true });
  }

  // =========================
  // 12) イベント
  // =========================
  nextBtn.addEventListener("click", goNext);
  prevBtn.addEventListener("click", goPrev);

  viewport.addEventListener("click", (e) => {
    if (state.isAnimating) return;
    const rect = viewport.getBoundingClientRect();
    const x = e.clientX - rect.left;

    // 右綴じ: 左半分で次へ / 右半分で前へ
    if (x < rect.width / 2) {
      goNext();
    } else {
      goPrev();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (state.isAnimating) return;
    if (e.key === "ArrowLeft") {
      goNext();
    } else if (e.key === "ArrowRight") {
      goPrev();
    }
  });

  window.addEventListener("resize", () => {
    clearTimeout(state.repaginateTimer);
    state.repaginateTimer = setTimeout(() => {
      initialize();
    }, 120);
  });

  window.addEventListener("load", initialize);
})();
