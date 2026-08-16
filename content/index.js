(() => {
  const HANDLER_MAP = {
    "pixiv.net": "pixiv",
    "rawlazy.io": "rawlazy",
  };

  function resolveHandler(pageUrl) {
    try {
      const host = new URL(pageUrl).hostname.toLowerCase();
      for (const [domain, name] of Object.entries(HANDLER_MAP)) {
        if (host === domain || host.endsWith("." + domain)) return name;
      }
    } catch {
      /* ignore */
    }
    return "default";
  }

  window.ImgCapRun = async (options) => {
    // 各フレーム自身のURLを常に使う(iframe内でも相対パス解決やハンドラ判定が
    // そのフレーム基準で正しく行われるようにするため)
    const pageUrl = location.href;
    const isTop = window === window.top;
    const frameArea = window.innerWidth * window.innerHeight;

    try {
      const handlerName = resolveHandler(pageUrl);
      const handler = window.ImgCapHandlers?.[handlerName] || window.ImgCapHandlers?.default;
      if (!handler) throw new Error("Handler not loaded");
      const result = await handler({ ...options, pageUrl });
      return { ...result, handler: handlerName, isTop, frameArea, pageUrl };
    } catch (e) {
      // このフレームの処理が失敗しても他フレームの結果は活かせるよう、
      // 例外を投げずにエラー情報を含めて返す
      return {
        images: [],
        urls: [],
        count: 0,
        log: [`[frame error] ${pageUrl}: ${e?.message || e}`],
        handler: "error",
        isTop,
        frameArea,
        pageUrl,
      };
    }
  };
})();
