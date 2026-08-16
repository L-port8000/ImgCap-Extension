const SCRIPT_FILES = [
  "content/extractor-core.js",
  "content/handlers/default.js",
  "content/handlers/site-handlers.js",
  "content/index.js",
];

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}_` +
    `${Math.floor(1000 + Math.random() * 9000)}`
  );
}

function sanitizeDomain(url) {
  try {
    const u = new URL(url);
    const host = u.hostname || (u.protocol === "file:" ? "local_file" : "unknown");
    return host.replace(/[\\/*?:"<>|.]/g, "_");
  } catch {
    return "unknown";
  }
}

// 各フレーム(メイン+iframe)の面積だけを軽量に調べる。
// allFrames:trueで注入すると、クロスオリジンiframeも「そのフレーム自身の
// 実行コンテキスト」で動くため、SOPに邪魔されずに中身へアクセスできる。
async function probeFrameAreas(tabId) {
  try {
    return await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => ({
        isTop: window === window.top,
        area: window.innerWidth * window.innerHeight,
        href: location.href,
      }),
    });
  } catch (e) {
    return [];
  }
}

// メインフレーム + 一番大きいiframe(1つだけ)の結果をマージする。
// 小さい広告iframe等は最初から対象に含めないので、無駄なスクロールも走らない。
function mergeFrameResults(frameResults, bestIframeFrameId) {
  const valid = frameResults.filter((r) => r && r.result);
  const topEntry = valid.find((r) => r.result.isTop);
  const iframeEntry = bestIframeFrameId != null
    ? valid.find((r) => r.frameId === bestIframeFrameId)
    : undefined;

  const merged = topEntry
    ? { ...topEntry.result }
    : { images: [], urls: [], log: [], handler: "default" };

  const warnings = [];
  if (topEntry?.result?.handler === "error") {
    warnings.push(...(topEntry.result.log || []).filter((l) => l.startsWith("[frame error]")));
  }

  if (iframeEntry) {
    const best = iframeEntry.result;
    merged.images = [...(merged.images || []), ...(best.images || [])];
    merged.urls = [...new Set([...(merged.urls || []), ...(best.urls || [])])];
    merged.log = [
      ...(merged.log || []),
      "",
      `--- iframe内で最大のフレームを検出・統合 (${best.pageUrl}, area=${Math.round(best.frameArea || 0)}px²) ---`,
      ...(best.log || []),
    ];
    if (best.handler === "error") {
      warnings.push(...(best.log || []).filter((l) => l.startsWith("[frame error]")));
    }
  }

  merged.count = merged.images?.length || 0;
  // フレーム内部で例外が起きていた場合、ポップアップ側に見える形で警告として残す
  // (今までは内部で握りつぶされて「0枚成功」に見えていた)
  if (warnings.length) merged.warning = warnings.join(" / ");
  return merged;
}

async function injectAndRun(tabId, options) {
  const frameChoice = options.frameChoice || "auto";

  // 「ページ本体のみ」が明示的に選ばれた場合は、iframeの検出・処理を一切行わない
  if (frameChoice === "top") {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: SCRIPT_FILES });
    const frameResults = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: async (opts) => window.ImgCapRun(opts),
      args: [options],
    });
    return mergeFrameResults(frameResults, null);
  }

  // 特定のiframeが手動で選ばれた場合は、自動判定をせずそのフレームを直接対象にする
  if (frameChoice.startsWith("frame:")) {
    const explicitFrameId = Number(frameChoice.slice(6));
    const targetFrameIds = [0, explicitFrameId].filter((v, i, a) => a.indexOf(v) === i);
    await chrome.scripting.executeScript({ target: { tabId, frameIds: targetFrameIds }, files: SCRIPT_FILES });
    const frameResults = await chrome.scripting.executeScript({
      target: { tabId, frameIds: targetFrameIds },
      func: async (opts) => window.ImgCapRun(opts),
      args: [options],
    });
    return mergeFrameResults(frameResults, explicitFrameId);
  }

  // フェーズ1: 全フレームの面積を軽く調べ、最大のiframeを1つだけ選ぶ(自動判定)
  const areaResults = await probeFrameAreas(tabId);
  const valid = areaResults.filter((r) => r && r.result);
  const topFrame = valid.find((r) => r.result.isTop);
  const subFrames = valid
    .filter((r) => !r.result.isTop && r.result.area > 4000) // 極小(広告等)は除外
    .sort((a, b) => b.result.area - a.result.area);
  const bestIframe = subFrames[0];

  const targetFrameIds = [];
  if (topFrame) targetFrameIds.push(topFrame.frameId);
  if (bestIframe) targetFrameIds.push(bestIframe.frameId);

  // フレームIDの特定に失敗した場合は従来通りメインフレームのみにフォールバック
  const target = targetFrameIds.length ? { tabId, frameIds: targetFrameIds } : { tabId };

  // フェーズ2: 選ばれたフレームだけに本処理を注入して実行
  await chrome.scripting.executeScript({ target, files: SCRIPT_FILES });

  const frameResults = await chrome.scripting.executeScript({
    target,
    func: async (opts) => window.ImgCapRun(opts),
    args: [options],
  });

  return mergeFrameResults(frameResults, bestIframe?.frameId);
}

// === ZIP utilities (store method) ===
// セッションID -> { images, baseFolder, detailLog, saveStamp } の一時キャッシュ。
// プレビュー画面の「ZIP保存」ボタンが押されるまでフル解像度データを保持しておく。
// Service Workerが再起動すると失われる点に注意(プレビュータブ側でキープアライブ用の
// portを繋ぎっぱなしにすることで、通常の利用時間内はこれを避けている)。
const sessionImageCache = new Map();

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[i] = c;
}

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  let offset = 0;
  const centralEntries = [];

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = file.data;
    const crc = crc32(data);

    const local = new ArrayBuffer(30 + nameBytes.length);
    const lv = new DataView(local);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    new Uint8Array(local).set(nameBytes, 30);

    chunks.push(new Uint8Array(local));
    chunks.push(data);
    const localSize = local.byteLength + data.length;

    const central = new ArrayBuffer(46 + nameBytes.length);
    const cv = new DataView(central);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    new Uint8Array(central).set(nameBytes, 46);

    centralEntries.push(new Uint8Array(central));
    offset += localSize;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const e of centralEntries) {
    chunks.push(e);
    centralSize += e.length;
  }

  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralStart, true);
  ev.setUint16(20, 0, true);
  chunks.push(new Uint8Array(eocd));

  const totalSize = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(totalSize);
  let pos = 0;
  for (const chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}

function bufferToDataUrl(buffer, mimeType) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function dataUrlToBuffer(dataUrl) {
  const [, b64] = dataUrl.split(",", 2);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// === Thumbnail / Preview ===
async function createThumbnailDataUrl(buffer, maxDimension = 800) {
  const blob = new Blob([buffer]);
  const bitmap = await createImageBitmap(blob);
  let { width, height } = bitmap;
  if (width > maxDimension || height > maxDimension) {
    const ratio = Math.min(maxDimension / width, maxDimension / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  const jpegBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.75 });
  const buf = await jpegBlob.arrayBuffer();
  return bufferToDataUrl(buf, "image/jpeg");
}

async function openPreview(entries, pageUrl, sessionId) {
  const data = { entries, pageUrl };
  try {
    await chrome.storage.session.set({ [`preview_${sessionId}`]: data });
  } catch (e) {
    console.warn("storage.session write failed, entries may be truncated:", e.message);
    const truncated = { entries: entries.slice(0, 50), pageUrl };
    await chrome.storage.session.set({ [`preview_${sessionId}`]: truncated }).catch(() => {});
  }
  const url = chrome.runtime.getURL(`preview/preview.html?session=${sessionId}`);
  const tab = await chrome.tabs.create({ url, active: false });
  setTimeout(() => {
    chrome.storage.session.remove(`preview_${sessionId}`).catch(() => {});
  }, 180000);
  return tab;
}

// === Background image fetching (no CORS) ===
async function getImageDimensions(arrayBuffer) {
  const blob = new Blob([arrayBuffer]);
  const bitmap = await createImageBitmap(blob);
  return { width: bitmap.width, height: bitmap.height };
}

async function backgroundFetchImageBuffer(url, referer) {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "Accept-Language": "ja,en;q=0.9",
  };
  if (referer) headers["Referer"] = referer;

  const res = await fetch(url, { headers, credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text")) throw new Error("Not an image");

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength < 100) throw new Error("Too small");

  const dims = await getImageDimensions(buffer);
  const mimeType = ct || "image/jpeg";

  const pathPart = new URL(res.url).pathname;
  let filename = pathPart.split("/").pop()?.split("?")[0] || "image";
  if (!filename.includes(".")) {
    const ext = (mimeType.split("/")[1] || "jpg").replace("jpeg", "jpg");
    filename += `.${ext}`;
  }

  return { buffer: new Uint8Array(buffer), mimeType, width: dims.width, height: dims.height, filename, url, finalUrl: res.url };
}

async function backgroundCollectImageBuffers(urls, minSize, maxConcurrent, referer) {
  const results = [];
  const queue = [...urls];
  const workers = Array.from({ length: Math.min(maxConcurrent, queue.length || 1) }, async () => {
    while (queue.length) {
      const url = queue.shift();
      try {
        const img = await backgroundFetchImageBuffer(url, referer);
        if (img.width >= minSize || img.height >= minSize) {
          results.push({
            buffer: img.buffer,
            mimeType: img.mimeType,
            filename: img.filename,
            originalIdx: urls.indexOf(url),
            log: `URL抽出: ${img.filename} | size=${img.width}x${img.height} | source=${img.url} | final=${img.finalUrl}`,
          });
        }
      } catch {
        /* skip */
      }
    }
  });
  await Promise.all(workers);
  results.sort((a, b) => a.originalIdx - b.originalIdx);
  const used = new Set();
  return results.map((item, i) => {
    let filename = `${String(i + 1).padStart(3, "0")}_${item.filename.replace(/^.*[/\\]/, "")}`;
    const stem = filename.replace(/\.[^.]+$/, "");
    const ext = filename.match(/\.[^.]+$/)?.[0] || ".jpg";
    let n = 2;
    while (used.has(filename.toLowerCase())) {
      filename = `${stem}_${n}${ext}`;
      n++;
    }
    used.add(filename.toLowerCase());
    return { ...item, filename, log: item.log.replace(/^URL抽出: \S+/, `URL抽出: ${filename}`) };
  });
}

// Service Worker内ではURL.createObjectURLが使えないため(MV3の既知の制限)、
// Blobを経由せずdata:URL(base64)に変換してchrome.downloads.downloadへ渡す。
function uint8ArrayToDataUrl(bytes, mimeType) {
  const CHUNK = 0x8000; // 32768バイトずつ処理(1バイトずつの文字列結合より高速で、スタックオーバーフローも回避できる)
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

async function createAndDownloadZip(images, baseFolder, detailLog, saveStamp) {
  const zipFiles = [];
  for (const img of images) {
    zipFiles.push({ name: `${baseFolder}/${img.filename}`, data: img.buffer });
  }
  if (detailLog.length) {
    zipFiles.push({
      name: `${baseFolder}/extraction_log.txt`,
      data: new TextEncoder().encode(detailLog.join("\n")),
    });
  }
  const zipData = createZip(zipFiles);
  const dataUrl = uint8ArrayToDataUrl(zipData, "application/zip");
  const zipFilename = `ImgCap_${saveStamp}.zip`;
  await chrome.downloads.download({ url: dataUrl, filename: zipFilename, saveAs: false });
  return zipFilename;
}

async function processTab(tabId, pageUrl, options) {
  const domain = sanitizeDomain(pageUrl);
  const folderSuffix = `${domain}_${Math.floor(100 + Math.random() * 900)}`;
  const baseFolder = `ImgCap/${options.saveStamp}/${folderSuffix}`;

  const result = await injectAndRun(tabId, {
    minSize: options.minSize,
    maxWorkers: options.maxWorkers,
    useCanvas: options.useCanvas,
    useBlob: options.useBlob,
    useScreenshot: options.useScreenshot,
    frameChoice: options.frameChoice,
    pageUrl,
  });

  if (!result || (!result.images && !result.urls)) {
    throw new Error("抽出結果が空です");
  }

  const dataImages = result.images || [];
  const detailLog = [...(result.log || [])];
  const allImages = [];

  // Convert content-script data URLs to buffers
  for (const img of dataImages) {
    const buf = dataUrlToBuffer(img.dataUrl);
    const mimeType = img.dataUrl.split(";")[0].split(":")[1] || "image/png";
    allImages.push({ buffer: buf, mimeType, filename: img.filename });
  }

  // Fetch URL images in background (no CORS)
  if (result.urls?.length) {
    const urlImages = await backgroundCollectImageBuffers(
      result.urls,
      options.minSize,
      options.maxWorkers,
      pageUrl
    );
    for (const ui of urlImages) {
      allImages.push({ buffer: ui.buffer, mimeType: ui.mimeType, filename: ui.filename });
    }
    detailLog.push(...urlImages.map((i) => i.log));
  }

  // Build preview entries (thumbnails)
  const previewEntries = [];
  const MAX_PREVIEW = 200;

  for (let i = 0; i < Math.min(allImages.length, MAX_PREVIEW); i++) {
    const img = allImages[i];
    const thumb = await createThumbnailDataUrl(img.buffer);
    previewEntries.push({ thumb, filename: img.filename, dims: "" });
  }

  // Open preview (stores thumbnails in chrome.storage.session, opens extension page)
  const sessionId = String(Date.now()) + "_" + Math.random().toString(36).slice(2, 8);

  // ZIP保存ボタンが押されるまで、フル解像度データをメモリにキャッシュしておく
  sessionImageCache.set(sessionId, {
    images: allImages,
    baseFolder,
    detailLog,
    saveStamp: options.saveStamp,
  });

  const previewTab = await openPreview(previewEntries, pageUrl, sessionId).catch(() => null);

  // プレビュータブが閉じられたらキャッシュも破棄する
  if (previewTab?.id) {
    const watchedTabId = previewTab.id;
    const onRemoved = (closedId) => {
      if (closedId === watchedTabId) {
        sessionImageCache.delete(sessionId);
        chrome.tabs.onRemoved.removeListener(onRemoved);
      }
    };
    chrome.tabs.onRemoved.addListener(onRemoved);
  }
  // タブを閉じ忘れた場合の保険として、一定時間後にも破棄する
  setTimeout(() => sessionImageCache.delete(sessionId), 30 * 60 * 1000);

  return {
    url: pageUrl,
    handler: result.handler,
    count: allImages.length,
    folder: baseFolder,
    warning: result.warning,
  };
}

async function waitForTabLoad(tabId, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") {
      await new Promise((r) => setTimeout(r, 1500));
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

// プレビュー画面が開いている間、Service Workerがアイドルタイムアウトで
// 停止しないようにするためのキープアライブ用ポート。
// (portへのメッセージ受信自体がアイドルタイマーをリセットする)
chrome.runtime.onConnect.addListener((port) => {
  if (!port.name?.startsWith("imgcap-preview")) return;
  port.onMessage.addListener(() => {
    /* ping受信のみ。何もしなくてよい */
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_PREVIEW_DATA") {
    chrome.storage.session.get(`preview_${message.sessionId}`).then((stored) => {
      const data = stored[`preview_${message.sessionId}`];
      sendResponse(data || null);
    }).catch(() => sendResponse(null));
    return true;
  }

  if (message.type === "LIST_FRAMES") {
    (async () => {
      const areaResults = await probeFrameAreas(message.tabId);
      const valid = areaResults.filter((r) => r && r.result);
      const topEntry = valid.find((r) => r.result.isTop);
      const subFrames = valid
        .filter((r) => !r.result.isTop && r.result.area > 50) // 一覧表示用なので閾値は緩め
        .sort((a, b) => b.result.area - a.result.area)
        .map((r) => ({ frameId: r.frameId, area: r.result.area, href: r.result.href }));
      sendResponse({
        top: topEntry ? { area: topEntry.result.area, href: topEntry.result.href } : null,
        subFrames,
      });
    })();
    return true;
  }

  if (message.type === "SAVE_ZIP") {
    (async () => {
      const cached = sessionImageCache.get(message.sessionId);
      if (!cached) {
        sendResponse({
          ok: false,
          error: "画像データが見つかりません(時間切れ、またはブラウザ再起動の可能性があります)。お手数ですが再抽出してください。",
        });
        return;
      }
      try {
        const zipFilename = await createAndDownloadZip(
          cached.images,
          cached.baseFolder,
          cached.detailLog,
          cached.saveStamp
        );
        sendResponse({ ok: true, zipFilename, count: cached.images.length });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e) });
      }
    })();
    return true;
  }

  if (message.type !== "EXTRACT") return false;

  (async () => {
    const options = {
      minSize: message.minSize ?? 0,
      maxWorkers: message.maxWorkers ?? 6,
      useCanvas: !!message.useCanvas,
      useBlob: !!message.useBlob,
      useScreenshot: !!message.useScreenshot,
      frameChoice: message.frameChoice || "auto",
      saveStamp: nowStamp(),
    };

    const results = [];
    const urls = message.urls?.length ? message.urls : [message.pageUrl];

    for (const url of urls) {
      let tabId = message.tabId;
      let createdTab = null;

      try {
        if (message.useCurrentTab && tabId && urls.length === 1) {
          const tab = await chrome.tabs.get(tabId);
          await processTab(tabId, tab.url, options).then((r) => results.push(r));
          continue;
        }

        createdTab = await chrome.tabs.create({ url, active: false });
        tabId = createdTab.id;
        await waitForTabLoad(tabId);
        const r = await processTab(tabId, url, options);
        results.push(r);
      } catch (e) {
        let errorMsg = e.message || String(e);
        if (url.startsWith("file://") && /cannot access|permission|host/i.test(errorMsg)) {
          errorMsg += " ※ file:// を扱うには chrome://extensions でこの拡張機能の「ファイルのURLへのアクセスを許可する」を有効にしてください。";
        }
        results.push({ url, error: errorMsg, count: 0 });
      } finally {
        if (createdTab?.id) {
          try {
            await chrome.tabs.remove(createdTab.id);
          } catch {
            /* ignore */
          }
        }
      }
    }

    const total = results.reduce((s, r) => s + (r.count || 0), 0);
    sendResponse({ ok: true, results, total, saveStamp: options.saveStamp });
  })().catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));

  return true;
});
