import type { AssetId, AssetManifest } from '../types/content';

// 单个资源的最长等待时间：正式资源缺失或路径错误时不能让标题页卡住。
const PRELOAD_TIMEOUT_MS = 1200;

export class AssetLoader {
  private manifest: AssetManifest = { images: {}, audio: {} };

  async preload(manifest: AssetManifest): Promise<void> {
    this.manifest = manifest;
    const images = Object.values(manifest.images);
    await Promise.all(images.map(({ src }) => new Promise<void>((resolve) => {
      // 空 src = 这张还没交（人物类缺图就是空串，见 content/assets.ts）。
      // 不能拿它去 new Image()：空 src 在不同浏览器里会解析成"当前页面地址"，
      // 于是每个缺图都要等一次真正的网络请求失败（或被 1.2 秒超时兜住），预载白白变慢。
      if (!src) { resolve(); return; }
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };
      const timer = setTimeout(done, PRELOAD_TIMEOUT_MS);
      const img = new Image();
      img.onload = () => { clearTimeout(timer); done(); };
      img.onerror = () => { clearTimeout(timer); done(); };
      img.src = src;
    })));
  }

  url(id: AssetId): string {
    return this.manifest.images[id]?.src ?? '';
  }

  /**
   * 这个 AssetId 用的还是内置占位图吗？（也就是"美工交了没有"）
   *
   * 回退链必须问这个，不能去嗅 `src` 的前缀：交付格式允许 `.svg`，
   * 真交付的 SVG 与占位图都是 `data:image/svg...`，靠前缀判断会把真图当成占位图，
   * 于是"没交放松态就退到正常立绘"这类回退会静默失效（停在占位图上）。
   */
  isPlaceholder(id: AssetId): boolean {
    return this.manifest.images[id]?.placeholder === true;
  }

  /**
   * 这张图是不是**真透明抠图**（透明通道被实际使用）。
   *
   * 来源是 art.spec.json 的 `alpha` 字段，不是扩展名、也不是 src 前缀：
   * 交付里既有"RGBA 但其实全不透明"的 PNG（D1 那九张就是），也有真抠图，
   * 靠文件名或前缀都分不出来，只能由交付方/导入脚本显式标注。
   */
  isTransparent(id: AssetId): boolean {
    return this.manifest.images[id]?.transparent === true;
  }
}
