(async () => {
  const params = new URLSearchParams(location.search);
  const sessionId = params.get("session");
  if (!sessionId) {
    document.getElementById("gallery").innerHTML = '<div class="error">セッションIDがありません</div>';
    return;
  }

  // Service Workerがアイドルタイムアウトで停止しないよう、開いている間ポートを繋ぎっぱなしにする
  try {
    const port = chrome.runtime.connect({ name: `imgcap-preview-${sessionId}` });
    setInterval(() => {
      try {
        port.postMessage({ type: "ping" });
      } catch {
        /* ポートが切れていたら何もしない */
      }
    }, 20000);
  } catch {
    /* 接続できなくても致命的ではないので無視 */
  }

  const key = `preview_${sessionId}`;
  let data;
  try {
    const stored = await chrome.storage.session.get(key);
    data = stored[key];
  } catch {
    // fallback
  }

  if (!data) {
    // Try requesting from background in case service worker is still alive
    try {
      data = await chrome.runtime.sendMessage({ type: "GET_PREVIEW_DATA", sessionId });
    } catch {}
  }

  if (!data || !data.entries?.length) {
    document.getElementById("gallery").innerHTML = '<div class="error">プレビューデータが見つかりません。再抽出してください。</div>';
    return;
  }

  document.getElementById("count").textContent = `${data.entries.length} images`;
  document.getElementById("src").textContent = data.pageUrl || "";

  const gallery = document.getElementById("gallery");
  for (let i = 0; i < data.entries.length; i++) {
    const e = data.entries[i];
    const fig = document.createElement("figure");
    const img = document.createElement("img");
    img.src = e.thumb;
    img.alt = e.filename;
    img.loading = "lazy";
    fig.appendChild(img);
    const cap = document.createElement("figcaption");
    cap.textContent = `${String(i + 1).padStart(3, "0")} ${e.filename}`;
    fig.appendChild(cap);
    gallery.appendChild(fig);
  }

  // Clean up thumbnail storage after rendering (フル画像のキャッシュは背景側に別途保持されている)
  try {
    await chrome.storage.session.remove(key);
  } catch {}

  // ZIP保存ボタン
  const saveBtn = document.getElementById("saveZipBtn");
  const saveStatus = document.getElementById("saveStatus");
  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    saveStatus.className = "save-status";
    saveStatus.textContent = "保存中...";
    try {
      const res = await chrome.runtime.sendMessage({ type: "SAVE_ZIP", sessionId });
      if (!res?.ok) {
        throw new Error(res?.error || "不明なエラー");
      }
      saveStatus.textContent = `保存しました: ${res.zipFilename} (${res.count} 枚)`;
    } catch (e) {
      saveStatus.className = "save-status error";
      saveStatus.textContent = `保存失敗: ${e.message || e}`;
    } finally {
      saveBtn.disabled = false;
    }
  });
})();
