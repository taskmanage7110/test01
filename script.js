(() => {
  "use strict";

  const sourceNovel = document.querySelector(".novel");
  if (!sourceNovel) {
    console.error("`.novel` が見つかりません。");
    return;
  }

  const originalChildren = Array.from(sourceNovel.childNodes);

  let currentPageIndex = 0;
  let pages = [];
  let repaginateTimer = null;

  // ===== UIをJSで後付け生成（HTMLは手で編集しない） =====
  const readerShell = document.createElement("section");
  readerShell.className = "js-reader-shell";

  const controls = document.createElement("div");
  controls.className = "js-reader-controls";

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.textContent = "前へ";

  const info = document.createElement("div");
  info.className = "js-reader-info";
  info.innerHTML = `<span class="js-page-now">1</span> / <span class="js-page-total">1</span>`;

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.textContent = "次へ";

  controls.append(prevBtn, info, nextBtn);

  const viewport = document.createElement("div");
  viewport.className = "js-reader-viewport";

  const page = document.createElement("article");
  page.className = "js-reader-page";
  viewport.appendChild(page);

  readerShell.append(controls, viewport);

  // 元の本文の直前に挿入
  sourceNovel.parentNode.insertBefore(readerShell, sourceNovel);

  // 元本文は「分割元」として残しつつ非表示
  sourceNovel.style.display = "none";

  // ===== CSSもJSで注入（style.css手編集も不要） =====
  const style = document.createElement("style");
  style.textContent = `
    .js-reader-shell {
      margin-top: 16px;
      margin-bottom: 16px;
    }

    .js-reader-controls {
      writing-mode: horizontal-tb;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-bottom: 14px;
    }

    .js-reader-controls button {
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.06);
      color: inherit;
      border-radius: 10px;
      padding: 10px 16px;
      cursor: pointer;
      font: inherit;
    }

    .js-reader-controls button:disabled {
      opacity: 0.4;
      cursor: default;
    }

    .js-reader-info {
      min-width: 88px;
      text-align: center;
    }

    .js-reader-viewport {
      width: 100%;
      height: min(78vh, 980px);
      min-height: 360px;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 18px;
      overflow: hidden;
      position: relative;
      background: rgba(255,255,255,0.02);
    }

    .js-reader-page,
    .js-reader-measure {
      width: 100%;
      height: 100%;
      padding: 24px;
      overflow: hidden;
      writing-mode: vertical-rl;
      text-orientation: mixed;
      direction: rtl;
      line-height: 2.1;
      font-size: 18px;
      letter-spacing: 0.03em;
      box-sizing: border-box;
    }

    .js-reader-page p,
    .js-reader-measure p {
      margin: 0 0 0 1.35em;
      text-indent: 1em;
    }

    .js-reader-page .center,
    .js-reader-measure .center {
      text-indent: 0;
      text-align: center;
    }

    .js-reader-hidden-layer {
      position: fixed;
      left: -999999px;
      top: 0;
      visibility: hidden;
      pointer-events: none;
      contain: strict;
    }

    @media (max-width: 640px) {
      .js-reader-page,
      .js-reader-measure {
        padding: 16px;
        font-size: 16px;
      }

      .js-reader-viewport {
        height: 72vh;
      }
    }
  `;
  document.head.appendChild(style);

  function getNowEl() {
    return readerShell.querySelector(".js-page-now");
  }

  function getTotalEl() {
    return readerShell.querySelector(".js-page-total");
  }

  function createMeasureBox() {
    const layer = document.createElement("div");
    layer.className = "js-reader-hidden-layer";

    const box = document.createElement("article");
    box.className = "js-reader-measure";

    const rect = viewport.getBoundingClientRect();
    box.style.width = `${Math.floor(rect.width)}px`;
    box.style.height = `${Math.floor(rect.height)}px`;

    layer.appendChild(box);
    document.body.appendChild(layer);

    return {
      layer,
      box,
      destroy() {
        layer.remove();
      }
    };
  }

  function overflowed(el) {
    return el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;
  }

  function serializeChildren(el) {
    return Array.from(el.childNodes).map((n) => n.cloneNode(true));
  }

  function makePageFragment(nodes) {
    const frag = document.createDocumentFragment();
    nodes.forEach((n) => frag.appendChild(n.cloneNode(true)));
    return frag;
  }

  function createElementLike(el) {
    return /** @type {HTMLElement} */ (el.cloneNode(false));
  }

  function fitTextIntoElement(text, templateEl, measureBox, currentNodes) {
    let low = 0;
    let high = text.length;
    let best = 0;

    while (low <= high) {
      const mid = (low + high) >> 1;

      measureBox.innerHTML = "";
      currentNodes.forEach((n) => measureBox.appendChild(n.cloneNode(true)));

      const candidate = createElementLike(templateEl);
      candidate.textContent = text.slice(0, mid);
      measureBox.appendChild(candidate);

      if (overflowed(measureBox)) {
        high = mid - 1;
      } else {
        best = mid;
        low = mid + 1;
      }
    }

    return {
      fitText: text.slice(0, best),
      restText: text.slice(best),
    };
  }

  function splitSimpleElement(el, measureBox, currentNodes) {
    const text = el.textContent ?? "";
    const template = createElementLike(el);

    const { fitText, restText } = fitTextIntoElement(text, template, measureBox, currentNodes);

    const fitNode = fitText ? createElementLike(el) : null;
    if (fitNode) fitNode.textContent = fitText;

    const restNode = restText ? createElementLike(el) : null;
    if (restNode) restNode.textContent = restText;

    return { fitNode, restNode };
  }

  function appendToMeasureIfFits(node, measureBox, currentNodes) {
    measureBox.innerHTML = "";
    currentNodes.forEach((n) => measureBox.appendChild(n.cloneNode(true)));
    measureBox.appendChild(node.cloneNode(true));
    return !overflowed(measureBox);
  }

  function buildPages() {
    const { box: measureBox, destroy } = createMeasureBox();

    const built = [];
    let currentNodes = [];

    const sourceNodes = originalChildren.filter((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        return (n.textContent ?? "").trim() !== "";
      }
      return n.nodeType === Node.ELEMENT_NODE;
    });

    function commitPage() {
      built.push(currentNodes.map((n) => n.cloneNode(true)));
      currentNodes = [];
    }

    for (const node of sourceNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const p = document.createElement("p");
        p.textContent = (node.textContent ?? "").trim();

        if (appendToMeasureIfFits(p, measureBox, currentNodes)) {
          currentNodes.push(p.cloneNode(true));
          continue;
        }

        const { fitNode, restNode } = splitSimpleElement(p, measureBox, currentNodes);

        if (fitNode) {
          currentNodes.push(fitNode.cloneNode(true));
        }

        if (currentNodes.length) {
          commitPage();
        }

        let remaining = restNode;
        while (remaining) {
          if (appendToMeasureIfFits(remaining, measureBox, currentNodes)) {
            currentNodes.push(remaining.cloneNode(true));
            remaining = null;
          } else {
            const split = splitSimpleElement(remaining, measureBox, currentNodes);
            if (!split.fitNode) break;
            currentNodes.push(split.fitNode.cloneNode(true));
            commitPage();
            remaining = split.restNode;
          }
        }

        continue;
      }

      const el = /** @type {HTMLElement} */ (node);

      if (appendToMeasureIfFits(el, measureBox, currentNodes)) {
        currentNodes.push(el.cloneNode(true));
        continue;
      }

      const hasElementChildren = el.querySelector("*") !== null;

      // シンプルなテキスト要素なら途中分割
      if (!hasElementChildren && (el.textContent ?? "").trim() !== "") {
        const { fitNode, restNode } = splitSimpleElement(el, measureBox, currentNodes);

        if (fitNode) {
          currentNodes.push(fitNode.cloneNode(true));
        }

        if (currentNodes.length) {
          commitPage();
        }

        let remaining = restNode;
        while (remaining) {
          if (appendToMeasureIfFits(remaining, measureBox, currentNodes)) {
            currentNodes.push(remaining.cloneNode(true));
            remaining = null;
          } else {
            const split = splitSimpleElement(remaining, measureBox, currentNodes);
            if (!split.fitNode) break;
            currentNodes.push(split.fitNode.cloneNode(true));
            commitPage();
            remaining = split.restNode;
          }
        }
      } else {
        // 複雑要素は丸ごと次ページ
        if (currentNodes.length) {
          commitPage();
        }
        currentNodes.push(el.cloneNode(true));
      }
    }

    if (currentNodes.length) {
      commitPage();
    }

    destroy();

    pages = built.length ? built : [[]];
  }

  function renderPage(index) {
    currentPageIndex = Math.max(0, Math.min(index, pages.length - 1));
    page.innerHTML = "";
    page.appendChild(makePageFragment(pages[currentPageIndex]));

    getNowEl().textContent = String(currentPageIndex + 1);
    getTotalEl().textContent = String(pages.length);

    prevBtn.disabled = currentPageIndex <= 0;
    nextBtn.disabled = currentPageIndex >= pages.length - 1;
  }

  function repaginate(keepProgress = true) {
    const oldCount = pages.length || 1;
    const oldIndex = currentPageIndex;

    buildPages();

    let nextIndex = 0;
    if (keepProgress) {
      const ratio = oldCount > 1 ? oldIndex / (oldCount - 1) : 0;
      nextIndex = Math.round(ratio * Math.max(0, pages.length - 1));
    }

    renderPage(nextIndex);
  }

  prevBtn.addEventListener("click", () => renderPage(currentPageIndex - 1));
  nextBtn.addEventListener("click", () => renderPage(currentPageIndex + 1));

  viewport.addEventListener("click", (e) => {
    const rect = viewport.getBoundingClientRect();
    const x = e.clientX - rect.left;

    // 右綴じなので右側タップで戻る、左側タップで進む
    if (x < rect.width / 2) {
      renderPage(currentPageIndex + 1);
    } else {
      renderPage(currentPageIndex - 1);
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      renderPage(currentPageIndex + 1);
    } else if (e.key === "ArrowRight") {
      renderPage(currentPageIndex - 1);
    }
  });

  window.addEventListener("resize", () => {
    clearTimeout(repaginateTimer);
    repaginateTimer = setTimeout(() => repaginate(true), 120);
  });

  window.addEventListener("load", () => {
    repaginate(false);
  });
})();
