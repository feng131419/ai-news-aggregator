import { fetchJson } from '../utils/http.js';
import { hasCjk, isMostlyEnglish } from '../utils/text.js';
import { normalizeUrl } from '../utils/url.js';
import type { ArchiveItem } from '../types.js';

const TRANSLATE_API = 'https://translate.googleapis.com/translate_a/single';

export async function translateToZhCN(text: string): Promise<string | null> {
  const s = (text || '').trim();
  if (!s) return null;

  try {
    const params = new URLSearchParams({
      client: 'gtx',
      sl: 'auto',
      tl: 'zh-CN',
      dt: 't',
      q: s,
    });

    const response = await fetchJson<unknown[]>(`${TRANSLATE_API}?${params}`, {
      timeout: 12000,
    });

    if (!Array.isArray(response) || !response.length) return null;

    const segs = response[0];
    if (!Array.isArray(segs)) return null;

    const translated = segs
      .filter((seg): seg is unknown[] => Array.isArray(seg) && seg.length > 0 && seg[0])
      .map((seg) => String(seg[0]))
      .join('')
      .trim();

    if (translated && translated !== s) {
      return translated;
    }
  } catch {
    return null;
  }

  return null;
}

export async function addBilingualFields(
  itemsAi: ArchiveItem[],
  itemsAll: ArchiveItem[],
  cache: Map<string, string>,
  maxNewTranslations: number
): Promise<{
  itemsAi: ArchiveItem[];
  itemsAll: ArchiveItem[];
  cache: Map<string, string>;
}> {
  const zhByUrl = new Map<string, string>();
  for (const it of itemsAll) {
    const title = (it.title || '').trim();
    const url = normalizeUrl(it.url || '');
    if (title && url && hasCjk(title)) {
      zhByUrl.set(url, title);
    }
  }

  let translatedNow = 0;

  const enrich = async (item: ArchiveItem, allowTranslate: boolean): Promise<ArchiveItem> => {
    const out = { ...item };
    const title = (out.title || '').trim();
    // RSS 解析出来的正文或摘要通常在 contentSnippet, content, 或 description 字段中
    // 这里做个兼容性提取
    const description = (out.description || (out as any).contentSnippet || (out as any).content || '').trim();
    const url = normalizeUrl(out.url || '');

    // 初始化标题字段
    out.title_original = title;
    out.title_en = null;
    out.title_zh = null;
    out.title_bilingual = title;
    
    // 初始化正文字段 (新增)
    out.description_original = description;
    out.description_zh = null;

    // --- 1. 处理标题翻译 ---
    if (hasCjk(title)) {
      out.title_zh = title;
    } else if (isMostlyEnglish(title)) {
      out.title_en = title;
      let zhTitle = zhByUrl.get(url) || cache.get(title) || null;

      if (!zhTitle && allowTranslate && translatedNow < maxNewTranslations) {
        const tr = await translateToZhCN(title);
        if (tr && hasCjk(tr)) {
          zhTitle = tr;
          cache.set(title, tr);
          translatedNow++;
        }
      }
      if (zhTitle) {
        out.title_zh = zhTitle;
        out.title_bilingual = `${zhTitle} / ${title}`;
      }
    }

    // --- 2. 处理正文翻译 (新增核心逻辑) ---
    if (description) {
      if (hasCjk(description)) {
        out.description_zh = description;
      } else if (isMostlyEnglish(description)) {
        // 先查缓存，避免重复翻译长文本
        let zhDesc = cache.get(description.substring(0, 100)) || null; 

        if (!zhDesc && allowTranslate && translatedNow < maxNewTranslations) {
          // Google API 有长度限制，如果正文过长，截取前 2000 个字符进行翻译
          const textToTranslate = description.length > 2000 ? description.substring(0, 2000) + '...' : description;
          const trDesc = await translateToZhCN(textToTranslate);
          
          if (trDesc && hasCjk(trDesc)) {
            zhDesc = trDesc;
            // 使用正文前100个字符作为 key 进行缓存
            cache.set(description.substring(0, 100), trDesc);
            translatedNow++; // 长文本翻译也计入额度消耗
          }
        }
        
        if (zhDesc) {
          out.description_zh = zhDesc;
        }
      }
    }

    return out;
  };

  // AI 组（也就是通过了你那个顶级信源白名单的组）允许调用 API 翻译
  const aiOut: ArchiveItem[] = [];
  for (const it of itemsAi) {
    aiOut.push(await enrich(it, true));
  }

  // All 组不调用翻译，只匹配已有的缓存
  const allOut: ArchiveItem[] = [];
  for (const it of itemsAll) {
    allOut.push(await enrich(it, false));
  }

  return { itemsAi: aiOut, itemsAll: allOut, cache };
}

export function loadTitleZhCache(data: Record<string, string>): Map<string, string> {
  const cache = new Map<string, string>();
  for (const [k, v] of Object.entries(data)) {
    if (k.trim() && v.trim()) {
      cache.set(k, v);
    }
  }
  return cache;
}

export function cacheToPojo(cache: Map<string, string>): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const [k, v] of cache) {
    obj[k] = v;
  }
  return obj;
}