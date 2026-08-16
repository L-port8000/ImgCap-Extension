const $ = (id) => document.getElementById(id);

async function loadSettings() {
  const stored = await chrome.storage.local.get([
    "minSize", "maxWorkers", "useCanvas", "useBlob", "useScreenshot", "useCurrentTab",
  ]);
  if (stored.minSize !== undefined) $("minSize").value = stored.minSize;
  if (stored.maxWorkers !== undefined) $("maxWorkers").value = stored.maxWorkers;
  if (stored.useCanvas !== undefined) $("useCanvas").checked = stored.useCanvas;
  if (stored.useBlob !== undefined) $("useBlob").checked = stored.useBlob;
  if (stored.useScreenshot !== undefined) $("useScreenshot").checked = stored.useScreenshot;
  if (stored.useCurrentTab !== undefined) $("useCurrentTab").checked = stored.useCurrentTab;
}

async function saveSettings() {
  await chrome.storage.local.set({
    minSize: Number($("minSize").value) || 0,
    maxWorkers: Number($("maxWorkers").value) || 6,
    useCanvas: $("useCanvas").checked,
    useBlob: $("useBlob").checked,
    useScreenshot: $("useScreenshot").checked,
    useCurrentTab: $("useCurrentTab").checked,
  });
}

function setStatus(text, kind = "") {
  const el = $("status");
  el.textContent = text;
  el.className = `status ${kind}`.trim();
}

function showLog(lines) {
  const el = $("log");
  if (!lines?.length) {
    el.classList.add("hidden");
    return;
  }
  el.textContent = lines.join("\n");
  el.classList.remove("hidden");
}

function truncate(str, n) {
  if (!str) return "";
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

// 「現在のタブから取得」がオンのとき、そのタブ内のフレーム構成(本体+iframe)を
// 調べて、対象を手動で選べるようにする。iframeが無ければ選択UIは表示しない。
async function detectFrames() {
  const wrap = $("frameSelectWrap");
  const select = $("frameSelect");
  select.innerHTML = "";
  wrap.classList.add("hidden");

  if (!$("useCurrentTab").checked) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isSupportedTabUrl = tab?.url?.startsWith("http") || tab?.url?.startsWith("file://");
  if (!tab?.id || !isSupportedTabUrl) return;

  let frames;
  try {
    frames = await chrome.runtime.sendMessage({ type: "LIST_FRAMES", tabId: tab.id });
  } catch {
    frames = null;
  }
  if (!frames?.subFrames?.length) return; // iframeが無ければ何もしない

  const addOption = (value, label) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  };

  addOption("auto", "自動選択(一番大きいiframeを自動判定)");
  addOption("top", `ページ本体のみ: ${truncate(frames.top?.href || tab.url, 50)}`);
  frames.subFrames.forEach((f, i) => {
    addOption(`frame:${f.frameId}`, `iframe ${i + 1}: ${truncate(f.href, 50)} (${Math.round(f.area)}px²)`);
  });

  select.value = "auto";
  wrap.classList.remove("hidden");
}

async function getTargetUrls(useCurrentTab) {
  const raw = $("urlList").value.trim();
  const fromText = raw
    ? raw.split(",").map((u) => u.trim()).filter(Boolean)
    : [];

  if (fromText.length) return { urls: fromText, useCurrentTab: false };

  if (!useCurrentTab) {
    throw new Error("URL を入力するか、「現在のタブから取得」をオンにしてください。");
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isSupportedTabUrl = tab?.url?.startsWith("http") || tab?.url?.startsWith("file://");
  if (!tab?.id || !isSupportedTabUrl) {
    throw new Error("有効な Web ページ、または file:// のページのタブを開いてから実行してください。");
  }
  return { urls: [tab.url], useCurrentTab: true, tabId: tab.id };
}

$("useCurrentTab").addEventListener("change", () => {
  detectFrames().catch(() => {});
});

$("startBtn").addEventListener("click", async () => {
  const btn = $("startBtn");
  btn.disabled = true;
  setStatus("処理中...");
  showLog([]);

  try {
    await saveSettings();
    const useCurrentTab = $("useCurrentTab").checked;
    const { urls, tabId } = await getTargetUrls(useCurrentTab);

    const frameChoice =
      useCurrentTab && urls.length === 1 && !$("frameSelectWrap").classList.contains("hidden")
        ? $("frameSelect").value
        : "auto";

    const response = await chrome.runtime.sendMessage({
      type: "EXTRACT",
      urls,
      tabId,
      useCurrentTab: useCurrentTab && urls.length === 1,
      minSize: Number($("minSize").value) || 0,
      maxWorkers: Number($("maxWorkers").value) || 6,
      useCanvas: $("useCanvas").checked,
      useBlob: $("useBlob").checked,
      useScreenshot: $("useScreenshot").checked,
      frameChoice,
    });

    if (!response?.ok) {
      throw new Error(response?.error || "不明なエラー");
    }

    const lines = response.results.map((r) => {
      if (r.error) return `[失敗] ${r.url}\n  ${r.error}`;
      const warn = r.warning ? `\n  ⚠ ${r.warning}` : "";
      return `[OK] ${r.url}\n  ${r.count} 枚 (${r.handler})${warn}`;
    });

    setStatus(`完了！ ${response.total} 枚をプレビュー表示`, "success");
    showLog([
      "プレビューを新しいタブで開きました。ZIP保存はプレビュー画面上部のボタンから行ってください。",
      "",
      ...lines,
    ]);
  } catch (e) {
    setStatus(e.message || String(e), "error");
  } finally {
    btn.disabled = false;
  }
});

loadSettings().then(() => detectFrames().catch(() => {}));
