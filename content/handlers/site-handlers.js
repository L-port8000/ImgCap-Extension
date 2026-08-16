(() => {
  const { ImgCapCore: C } = window;

  window.ImgCapHandlers = window.ImgCapHandlers || {};

  const PIXIV_REFERER = "https://www.pixiv.net/";
  const LOAD_BUTTON_SELECTORS = [
    "button.load-button",
    "button.read-button",
    "button[class*='load']",
    "button[class*='read']",
    "a[class*='load']",
    "a[class*='read']",
  ];
  const LOAD_WAIT_TIMEOUT = 30000;
  const POST_CLICK_SLEEP = 3000;

  function extractIllustId(url) {
    let m = url.match(/\/artworks\/(\d+)/);
    if (m) return m[1];
    m = url.match(/[?&]illust_id=(\d+)/);
    return m ? m[1] : null;
  }

  function pixivMasterToOriginal(masterUrl) {
    const cleaned = masterUrl.replace(/_(master|square|custom|small)\d*/g, "");
    const originalBase = cleaned.replace(
      /i\.pximg\.net\/(img-master|img-inf|img-zip-ugoira|c\/\d+x\d+[^/]*\/img-master)/,
      "i.pximg.net/img-original"
    );
    const baseNoExt = originalBase.replace(/\.(jpe?g|png|webp|gif)$/i, "");
    return [".jpg", ".png", ".webp"].map((ext) => baseNoExt + ext);
  }

  async function pixivFetchViaApi(illustId) {
    const api = `https://www.pixiv.net/ajax/illust/${illustId}/pages?lang=ja`;
    try {
      const r = await fetch(api, { credentials: "include", headers: { Referer: PIXIV_REFERER } });
      if (!r.ok) return [];
      const data = await r.json();
      if (data.error) return [];
      return (data.body || []).map((p) => p.urls?.original).filter(Boolean);
    } catch {
      return [];
    }
  }

  async function openPixivAllPages() {
    const buttons = Array.from(document.querySelectorAll("button, a")).filter((el) =>
      /すべて見る|Show all/i.test(el.textContent || "")
    );
    for (const button of buttons) {
      try {
        button.scrollIntoView({ block: "center" });
        await C.sleep(500);
        button.click();
        await C.sleep(1500);
        return true;
      } catch {
        /* continue */
      }
    }
    return false;
  }

  window.ImgCapHandlers.pixiv = async (options) => {
    const { minSize, useCanvas, useBlob, useScreenshot, pageUrl } = options;
    const detailLog = [];
    const images = [];

    await C.waitForPageLoad();
    await openPixivAllPages();
    await C.smartScroll();

    const illustId = extractIllustId(pageUrl);
    let pixivOriginalUrls = [];
    if (illustId) {
      pixivOriginalUrls = await pixivFetchViaApi(illustId);
    }

    const screenshotImages = await C.screenshotImagesTopToBottom(minSize, "image", [
      "/img-master/img/",
      "/img-original/img/",
      "/img-zip-ugoira/",
    ]);
    images.push(...screenshotImages);
    detailLog.push(...screenshotImages.map((i) => i.log));

    const foundUrls = [];
    const seen = new Set();
    const add = (u) => {
      if (!u || !C.isSupportedUrl(u) || seen.has(u)) return;
      seen.add(u);
      foundUrls.push(u);
    };

    for (const u of pixivOriginalUrls) add(u);

    document.querySelectorAll("img, a").forEach((tag) => {
      const list = [];
      if (tag.tagName === "IMG") {
        const src = tag.getAttribute("src") || tag.getAttribute("data-src");
        if (src) list.push(new URL(src, pageUrl).href);
      } else if (tag.href) {
        list.push(new URL(tag.href, pageUrl).href);
      }
      for (const u of list) {
        if (u.includes("i.pximg.net") && u.includes("master")) {
          for (const cand of pixivMasterToOriginal(u)) add(cand);
        } else {
          add(u);
        }
      }
    });

    for (const u of C.collectUrlsFromPerformance()) {
      if (u.includes("i.pximg.net") && u.includes("master")) {
        for (const cand of pixivMasterToOriginal(u)) add(cand);
      } else {
        add(u);
      }
    }

    if (useCanvas) {
      const c = C.extractCanvasImages(minSize);
      images.push(...c);
      detailLog.push(...c.map((i) => i.log));
    }
    if (useBlob) {
      const b = await C.extractBlobImages(minSize);
      images.push(...b);
      detailLog.push(...b.map((i) => i.log));
    }
    if (useScreenshot) {
      const s = await C.screenshotVisibleImages(minSize);
      images.push(...s);
      detailLog.push(...s.map((i) => i.log));
    }

    const canvasCount = images.filter((i) => i.filename?.startsWith("canvas_")).length;
    const blobCount = images.filter((i) => i.filename?.startsWith("blob_")).length;
    const optSsCount = images.filter((i) => i.filename?.startsWith("screenshot_")).length;

    return {
      images: images.map(({ type, dataUrl, filename }) => ({ type, dataUrl, filename })),
      urls: screenshotImages.length === 0 ? foundUrls : [],
      log: [
        `URL: ${pageUrl}`,
        `メイン方式: ${screenshotImages.length ? "スクリーンショット順次" : "URL抽出ダウンロード"} / スクリーンショット順次: ${screenshotImages.length}枚 / URL抽出候補: ${screenshotImages.length === 0 ? foundUrls.length : "スキップ"}件 / Canvas: ${canvasCount}枚 / Blob: ${blobCount}枚 / 追加Screenshot: ${optSsCount}枚`,
        "保存名: 001_image.png から上から順に連番",
        "",
        "詳細:",
        ...detailLog,
      ],
      count: images.length,
    };
  };

  // rawlazy shares load-button logic — registered under rawlazy key
  async function findAndClickLoadButton() {
    const vpH = window.innerHeight;
    const vpW = window.innerWidth;
    const cxMin = vpW * 0.2;
    const cxMax = vpW * 0.8;
    const cyMin = vpH * 0.2;
    const cyMax = vpH * 0.8;

    const xpathSelectors = [
      "//button[contains(., 'Load')]",
      "//button[contains(., 'Read')]",
      "//button[contains(., '読み込')]",
      "//button[contains(., '読む')]",
      "//a[contains(., 'Load')]",
      "//a[contains(., 'Read')]",
    ];

    const tryClick = (elements, checkCenter) => {
      for (const elem of elements) {
        if (!elem.offsetParent && elem.tagName !== "BODY") continue;
        try {
          const r = elem.getBoundingClientRect();
          if (checkCenter) {
            const vx = r.left + r.width / 2;
            const vy = r.top + r.height / 2;
            if (vx < cxMin || vx > cxMax || vy < cyMin || vy > cyMax) continue;
          }
          elem.scrollIntoView({ block: "center" });
          elem.click();
          return true;
        } catch {
          /* continue */
        }
      }
      return false;
    };

    for (const sel of LOAD_BUTTON_SELECTORS) {
      if (tryClick(Array.from(document.querySelectorAll(sel)), true)) return true;
    }
    for (const xp of xpathSelectors) {
      const snap = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      const els = [];
      for (let i = 0; i < snap.snapshotLength; i++) els.push(snap.snapshotItem(i));
      if (tryClick(els, true)) return true;
    }
    for (const sel of LOAD_BUTTON_SELECTORS) {
      if (tryClick(Array.from(document.querySelectorAll(sel)), false)) return true;
    }
    return false;
  }

  async function waitForImagesToLoad(timeout = LOAD_WAIT_TIMEOUT) {
    const deadline = Date.now() + timeout;
    let prev = -1;
    while (Date.now() < deadline) {
      const count = Array.from(document.querySelectorAll("img")).filter(
        (img) => img.naturalWidth > 0 && img.naturalHeight > 0
      ).length;
      if (count === prev && count > 0) return count;
      prev = count;
      await C.sleep(1500);
    }
    return Array.from(document.querySelectorAll("img")).filter((img) => img.naturalWidth > 0).length;
  }

  window.ImgCapHandlers.rawlazy = async (options) => {
    const { minSize, useCanvas, useBlob, useScreenshot, pageUrl } = options;
    const detailLog = [];
    const images = [];

    await C.waitForPageLoad();

    const clicked = await findAndClickLoadButton();
    if (clicked) {
      await C.sleep(POST_CLICK_SLEEP);
      await waitForImagesToLoad();
    }

    await C.smartScroll();

    const screenshotImages = await C.screenshotImagesTopToBottom(minSize, "image", [], true);
    images.push(...screenshotImages);
    detailLog.push(...screenshotImages.map((i) => i.log));

    const foundUrls = [];
    const seen = new Set();
    const add = (u) => {
      if (!u || !C.isSupportedUrl(u) || seen.has(u)) return;
      seen.add(u);
      foundUrls.push(u);
    };

    document.querySelectorAll("img, a").forEach((tag) => {
      if (tag.tagName === "IMG") {
        const src =
          tag.getAttribute("src") || tag.getAttribute("data-src") || tag.getAttribute("data-lazy-src");
        if (src) add(new URL(src, pageUrl).href);
      } else if (tag.href && /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(tag.href)) {
        add(new URL(tag.href, pageUrl).href);
      }
    });
    for (const u of C.collectUrlsFromPerformance()) add(u);

    if (useCanvas) {
      const c = C.extractCanvasImages(minSize);
      images.push(...c);
      detailLog.push(...c.map((i) => i.log));
    }
    if (useBlob) {
      const b = await C.extractBlobImages(minSize);
      images.push(...b);
      detailLog.push(...b.map((i) => i.log));
    }
    if (useScreenshot) {
      const s = await C.screenshotVisibleImages(minSize);
      images.push(...s);
      detailLog.push(...s.map((i) => i.log));
    }

    const canvasCount = images.filter((i) => i.filename?.startsWith("canvas_")).length;
    const blobCount = images.filter((i) => i.filename?.startsWith("blob_")).length;
    const optSsCount = images.filter((i) => i.filename?.startsWith("screenshot_")).length;

    return {
      images: images.map(({ type, dataUrl, filename }) => ({ type, dataUrl, filename })),
      urls: screenshotImages.length === 0 ? foundUrls : [],
      log: [
        `URL: ${pageUrl}`,
        `メイン方式: ${screenshotImages.length ? "スクリーンショット順次" : "URL抽出ダウンロード"} / スクリーンショット順次: ${screenshotImages.length}枚 / URL抽出候補: ${screenshotImages.length === 0 ? foundUrls.length : "スキップ"}件 / Canvas: ${canvasCount}枚 / Blob: ${blobCount}枚 / 追加Screenshot: ${optSsCount}枚`,
        "保存名: 001_image.png から上から順に連番",
        "",
        "詳細:",
        ...detailLog,
      ],
      count: images.length,
    };
  };
})();
