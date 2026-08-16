// Core extraction utilities — runs in page context via chrome.scripting.executeScript
(() => {
  const ImgCapCore = {};

  ImgCapCore.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  ImgCapCore.waitForPageLoad = async (timeout = 20000) => {
    const start = Date.now();
    while (document.readyState !== "complete" && Date.now() - start < timeout) {
      await ImgCapCore.sleep(200);
    }
    await ImgCapCore.sleep(1500);
  };

  ImgCapCore.smartScroll = async (pause = 1200, maxScrolls = 30) => {
    const vOnePass = async () => {
      let step = 600;
      let pos = 0;
      for (let i = 0; i < maxScrolls; i++) {
        pos += step;
        window.scrollTo(0, pos);
        await ImgCapCore.sleep(300);
        const newH = document.body.scrollHeight;
        if (pos >= newH) {
          window.scrollTo(0, document.body.scrollHeight);
          await ImgCapCore.sleep(pause);
          if (document.body.scrollHeight === newH) break;
        }
      }
    };

    const hOnePassReverse = async (start) => {
      const step = 600;
      let pos = start;
      for (let i = 0; i < maxScrolls; i++) {
        pos -= step;
        if (pos < 0) pos = 0;
        window.scrollTo(pos, 0);
        await ImgCapCore.sleep(300);
        if (pos === 0) break;
      }
    };

    await vOnePass();
    window.scrollTo(0, 0);
    await ImgCapCore.sleep(500);
    await vOnePass();
    window.scrollTo(0, document.body.scrollHeight);
    await ImgCapCore.sleep(pause);

    const maxW = document.body.scrollWidth;
    if (maxW > window.innerWidth) {
      const step = 600;
      let pos = 0;
      for (let i = 0; i < maxScrolls; i++) {
        pos += step;
        if (pos > maxW) pos = maxW;
        window.scrollTo(pos, 0);
        await ImgCapCore.sleep(300);
        if (pos >= maxW) {
          window.scrollTo(document.body.scrollWidth, 0);
          await ImgCapCore.sleep(pause);
          break;
        }
      }
      await hOnePassReverse(pos);
      window.scrollTo(0, 0);
      await ImgCapCore.sleep(500);
      pos = 0;
      for (let i = 0; i < maxScrolls; i++) {
        pos += step;
        if (pos > maxW) pos = maxW;
        window.scrollTo(pos, 0);
        await ImgCapCore.sleep(300);
        if (pos >= maxW) {
          window.scrollTo(document.body.scrollWidth, 0);
          await ImgCapCore.sleep(pause);
          break;
        }
      }
      await hOnePassReverse(pos);
    }
  };

  ImgCapCore.extractCanvasImages = (minSize) => {
    const results = [];
    document.querySelectorAll("canvas").forEach((c, i) => {
      try {
        const w = c.width;
        const h = c.height;
        if (w < minSize && h < minSize) return;
        const dataUrl = c.toDataURL("image/png");
        if (!dataUrl.startsWith("data:image")) return;
        results.push({
          type: "dataUrl",
          dataUrl,
          filename: `canvas_${i}_${w}x${h}.png`,
          log: `Canvas: canvas_${i}_${w}x${h}.png | size=${w}x${h}`,
        });
      } catch {
        /* tainted canvas */
      }
    });
    return results;
  };

  ImgCapCore.extractBlobImages = async (minSize) => {
    const urls = new Set();
    document.querySelectorAll("img").forEach((img) => {
      if (img.src?.startsWith("blob:")) urls.add(img.src);
      if (img.currentSrc?.startsWith("blob:")) urls.add(img.currentSrc);
    });
    document.querySelectorAll("[style]").forEach((el) => {
      const bg = el.style.backgroundImage;
      const m = bg?.match(/url\(["']?(blob:[^"')]+)["']?\)/);
      if (m) urls.add(m[1]);
    });

    const results = [];
    let i = 0;
    for (const blobUrl of urls) {
      try {
        const res = await fetch(blobUrl);
        const blob = await res.blob();
        if (!blob.type.startsWith("image/")) continue;
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        const dims = await ImgCapCore.getImageDimensions(dataUrl);
        if (dims.width < minSize && dims.height < minSize) continue;
        const ext = blob.type.split("/")[1] || "png";
        const fname = `blob_${i}_${dims.width}x${dims.height}.${ext}`;
        results.push({
          type: "dataUrl",
          dataUrl,
          filename: fname,
          log: `Blob: ${fname} | size=${dims.width}x${dims.height} | source=${blobUrl}`,
        });
        i++;
      } catch {
        /* skip */
      }
    }
    return results;
  };

  ImgCapCore.getImageDimensions = (dataUrl) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = reject;
      img.src = dataUrl;
    });

  ImgCapCore.captureElementAsPng = (el) => {
    try {
      const w = el.naturalWidth || el.width;
      const h = el.naturalHeight || el.height;
      if (!w || !h) return null;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(el, 0, 0);
      return { dataUrl: canvas.toDataURL("image/png"), width: w, height: h };
    } catch {
      return null;
    }
  };

  ImgCapCore.screenshotVisibleImages = async (minSize) => {
    const results = [];
    let i = 1;
    for (const el of document.querySelectorAll("img")) {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w < minSize && h < minSize) continue;
      const cap = ImgCapCore.captureElementAsPng(el);
      if (!cap) continue;
      const fname = `screenshot_${String(i).padStart(3, "0")}_${w}x${h}.png`;
      results.push({
        type: "dataUrl",
        dataUrl: cap.dataUrl,
        filename: fname,
        log: `Screenshot: ${fname} | size=${w}x${h} | source=${el.currentSrc || el.src || ""}`,
      });
      i++;
    }
    return results;
  };

  ImgCapCore.screenshotImagesTopToBottom = async (
    minSize,
    prefix = "image",
    srcKeywords = [],
    simpleNames = true
  ) => {
    const candidates = Array.from(document.querySelectorAll("img"))
      .map((img, index) => {
        if (!img.dataset.imgcapShotId) {
          img.dataset.imgcapShotId = `imgcap_${Date.now()}_${index}_${Math.random().toString(36).slice(2)}`;
        }
        const r = img.getBoundingClientRect();
        return {
          index,
          shotId: img.dataset.imgcapShotId,
          src: img.currentSrc || img.src || "",
          x: r.left + window.scrollX,
          y: r.top + window.scrollY,
          width: Math.round(r.width),
          height: Math.round(r.height),
          naturalWidth: img.naturalWidth || 0,
          naturalHeight: img.naturalHeight || 0,
          visible: r.width > 0 && r.height > 0,
        };
      })
      .filter((item) => item.visible);

    const seen = new Set();
    const filtered = [];
    for (const item of candidates) {
      if (srcKeywords.length && !srcKeywords.some((k) => item.src.includes(k))) continue;
      const w = Math.max(item.width, item.naturalWidth);
      const h = Math.max(item.height, item.naturalHeight);
      if (w < minSize && h < minSize) continue;
      const key = `${item.src}|${item.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      filtered.push(item);
    }

    filtered.sort((a, b) => a.y - b.y || a.x - b.x || a.index - b.index);

    const results = [];
    for (let order = 1; order <= filtered.length; order++) {
      const item = filtered[order - 1];
      const el = document.querySelector(`img[data-imgcap-shot-id="${item.shotId}"]`);
      if (!el) continue;
      el.scrollIntoView({ block: "center", inline: "center" });
      await ImgCapCore.sleep(1000);
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w < minSize && h < minSize) continue;
      const cap = ImgCapCore.captureElementAsPng(el);
      if (!cap) continue;
      const fname = simpleNames
        ? `${String(order).padStart(3, "0")}_${prefix}.png`
        : `${prefix}_${String(order).padStart(3, "0")}_${w}x${h}.png`;
      results.push({
        type: "dataUrl",
        dataUrl: cap.dataUrl,
        filename: fname,
        log: `Screenshot順次: ${fname} | order=${order} | size=${w}x${h} | source=${el.currentSrc || el.src || item.src}`,
      });
    }
    return results;
  };

  // http(s):// に加えて file:// も対象URLとして扱う
  ImgCapCore.isSupportedUrl = (u) =>
    typeof u === "string" &&
    (u.startsWith("http://") || u.startsWith("https://") || u.startsWith("file://"));

  ImgCapCore.collectUrlsFromDOM = (pageUrl) => {
    const found = [];
    const seen = new Set();
    const add = (u) => {
      if (!u || !ImgCapCore.isSupportedUrl(u) || seen.has(u)) return;
      seen.add(u);
      found.push(u);
    };

    document.querySelectorAll("img, a").forEach((tag) => {
      try {
        if (tag.tagName === "IMG") {
          const src = tag.getAttribute("src") || tag.getAttribute("data-src") || tag.getAttribute("data-lazy-src");
          if (src) add(new URL(src, pageUrl).href);
        } else if (tag.href) {
          add(new URL(tag.href, pageUrl).href);
        }
      } catch (e) {
        // 不正な形式のURL(相対パス解決失敗など)は個別にスキップし、他の収集は継続する
      }
    });
    return found;
  };

  ImgCapCore.collectUrlsFromPerformance = () => {
    const found = [];
    const seen = new Set();
    for (const entry of performance.getEntriesByType("resource")) {
      const u = entry.name;
      if (!ImgCapCore.isSupportedUrl(u) || seen.has(u)) continue;
      if (/\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(u) || entry.initiatorType === "img") {
        seen.add(u);
        found.push(u);
      }
    }
    return found;
  };
  window.ImgCapCore = ImgCapCore;
})();
