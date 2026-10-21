(() => {
  const { ImgCapCore: C } = window;
  window.ImgCapHandlers = window.ImgCapHandlers || {};

  window.ImgCapHandlers.default = async (options) => {
    const { minSize, useCanvas, useBlob, useScreenshot, pageUrl } = options;
    const detailLog = [];
    const images = [];
    await C.waitForPageLoad();
    await C.smartScroll();
    const foundUrls = [];
    const seen = new Set();
    const add = (u) => {
      if (!u || !C.isSupportedUrl(u) || seen.has(u)) return;
      seen.add(u);
      foundUrls.push(u);
    };
    for (const u of C.collectUrlsFromDOM(pageUrl)) add(u);
    for (const u of C.collectUrlsFromPerformance()) add(u);
    if (useCanvas) images.push(...C.extractCanvasImages(minSize));
    if (useBlob) images.push(...(await C.extractBlobImages(minSize)));
    if (useScreenshot) images.push(...(await C.screenshotVisibleImages(minSize)));
    detailLog.push(...images.filter((i) => i.log).map((i) => i.log));
    const canvasCount = images.filter((i) => i.filename?.startsWith("canvas_")).length;
    const blobCount = images.filter((i) => i.filename?.startsWith("blob_")).length;
    const ssCount = images.filter((i) => i.filename?.startsWith("screenshot_")).length;
    return {
      images: images.map(({ type, dataUrl, filename }) => ({ type, dataUrl, filename })),
      urls: foundUrls,
      log: [
        `URL: ${pageUrl}`,
        "メイン方式: URL抽出ダウンロード",
        `URL抽出候補: ${foundUrls.length}件 / Canvas: ${canvasCount}枚 / Blob: ${blobCount}枚 / Screenshot: ${ssCount}枚`,
        "",
        "詳細:",
        ...detailLog,
      ],
      count: images.length,
    };
  };
})();
