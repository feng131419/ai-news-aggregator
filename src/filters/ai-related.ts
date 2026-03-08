import { CONFIG } from '../config.js';
import { hasMojibakeNoise } from '../utils/text.js';
import type { ArchiveItem } from '../types.js';

// ==========================================
// 🚀 顶级私人信源白名单 (VIP 绿色通道)
// 这些来源的文章将无视所有 AI/科技 的过滤规则，100% 被系统收录并触发后续翻译。
// 必须全部小写。
// ==========================================
const TOP_SOURCES_WHITELIST = [
  // 1. PM-International 官方监控 (请根据实际 RSS 抓取到的 source 或 url 特征修改)
  'pm-international',
  'pm international',
  'pminternational',

  // 2. 商业哲学与单人创业
  'balajis',
  'naval',
  'nav.al',
  'dan koe',
  'thedankoe',
  'paul graham',
  'paulgraham',
  'david perell',
  'perell',

  // 3. 思维模型与系统思考
  'farnam street',
  'fs.blog',
  'tiago forte',
  'fortelabs',
  'scott young',
  'scotthyoung',
  'kevin kelly',
  'thetechnium',

  // 4. 前沿AI与科技
  'one useful thing',
  'ethan mollick',

  // 5. 生命科学与极致健康
  'foundmyfitness',
  'bryan johnson',
  'protocol',
  'peter attia',
  'peterattiamd',

  // 6. 播客与视频源
  'alex hormozi',
  'ali abdaal',
  'huberman lab',
  'hubermanlab'
];

/**
 * 检查字符串是否包含关键词数组中的任意一个
 */
function containsAnyKeyword(haystack: string, keywords: string[]): boolean {
  const h = haystack.toLowerCase();
  return keywords.some((k) => h.includes(k));
}

/**
 * 核心内容过滤器：决定一条资讯是丢弃还是保留
 */
export function isAiRelated(record: ArchiveItem): boolean {
  // ----------------------------------------------------------------
  // 🟢 第 1 步：VIP 通道检测 (你的顶级信源和 PM 监控)
  // 将 source, site_name, url 拼成一个大字符串，只要命中白名单，直接放行
  // ----------------------------------------------------------------
  const sourceIdentifier = `${record.source || ''} ${record.site_name || ''} ${record.url || ''}`.toLowerCase();
  
  for (const keyword of TOP_SOURCES_WHITELIST) {
    if (sourceIdentifier.includes(keyword)) {
      // 命中私人智库或监控目标，直接通过！
      return true; 
    }
  }

  // ----------------------------------------------------------------
  // 🟡 第 2 步：常规站点的兜底过滤 (原项目自带的 AI 过滤逻辑)
  // 如果不是白名单里的来源，则继续按照原来的规则审查它是否真的属于 AI/科技 新闻
  // ----------------------------------------------------------------
  const siteId = (record.site_id || '').toLowerCase();
  const title = record.title || '';
  const source = record.source || '';
  const siteName = record.site_name || '';
  const url = record.url || '';
  
  // 将标题、来源、链接等拼接，用于全文关键字扫描
  const text = `${title} ${source} ${siteName} ${url}`.toLowerCase();

  // 针对特定站点的特殊过滤规则 (保留原作者的逻辑)
  if (siteId === 'zeli') {
    return source.toLowerCase().includes('24h') || source.includes('24h最热');
  }

  if (siteId === 'tophub') {
    const sourceL = source.toLowerCase();
    // 过滤乱码
    if (hasMojibakeNoise(source) || hasMojibakeNoise(title)) {
      return false;
    }
    // 拦截明确拉黑的来源
    if (containsAnyKeyword(sourceL, CONFIG.filter.tophubBlockKeywords)) {
      return false;
    }
    // 必须包含允许的来源
    if (!containsAnyKeyword(sourceL, CONFIG.filter.tophubAllowKeywords)) {
      return false;
    }
  }

  // 某些纯 AI 站点，无条件放行
  if (['aibase', 'aihot', 'aihubtoday'].includes(siteId)) {
    return true;
  }

  // ----------------------------------------------------------------
  // 🔴 第 3 步：关键词硬核匹配
  // ----------------------------------------------------------------
  const hasAi =
    containsAnyKeyword(text, CONFIG.filter.aiKeywords) ||
    CONFIG.filter.enSignalPattern.test(text);
    
  const hasTech = containsAnyKeyword(text, CONFIG.filter.techKeywords);

  // 如果既不是 AI 也不是 Tech，丢弃
  if (!hasAi && !hasTech) {
    return false;
  }

  // 过滤掉包含商业推广噪音的内容 (除非它明确提到了 AI)
  if (containsAnyKeyword(text, CONFIG.filter.commerceNoiseKeywords) && !hasAi) {
    return false;
  }

  // 过滤掉一般性噪音词汇 (除非它明确提到了 AI)
  if (containsAnyKeyword(text, CONFIG.filter.noiseKeywords) && !hasAi) {
    return false;
  }

  // 通过层层审查，放行
  return true;
}