/**
 * 左侧分支缩略图中药丸：
 * - 橘色根：FILE（整份 PDF 根，非论文标题）
 * - 蓝色章：前置 §；首章且无节号、非 ABS/REF/ACK 时用 TITLE（论文题目）；其余为节号或 ABS/REF/ACK 等
 */
import type { ChatNode } from '../types';

const ACK_ALIASES = new Set([
  'acknowledgement',
  'acknowledgements',
  'acknowledgment',
  'acknowledgments',
]);

/** 去掉行首「1」「3.2」类节号后的正文（小写、压空格），用于识别 ABS/REF/ACK */
function normTailAfterOutline(raw: string): string {
  return raw
    .trim()
    .replace(/^\s*\d+(?:\.\d+)*\.?\s*/i, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** 行首阿拉伯节号：1、3.2、12.3.4（可跟句点再空格） */
function extractOutlineNumber(raw: string): string | null {
  const m = raw.trim().match(/^\s*(\d+(?:\.\d+)*)\.?(?=\s|$|[A-Za-z\u4e00-\u9fff])/);
  return m ? m[1] : null;
}

function matchSpecialPhrase(norm: string): string | null {
  if (!norm) return null;
  const lw = norm.split(/[\s:.,;—–-]+/)[0] ?? '';

  if (lw === 'abstract' || norm === 'abstract') return 'ABS';
  if (
    lw === 'references' ||
    norm === 'references' ||
    lw === 'bibliography' ||
    norm === 'bibliography'
  ) {
    return 'REF';
  }
  if (ACK_ALIASES.has(lw)) return 'ACK';
  for (const a of ACK_ALIASES) {
    if (norm === a || norm.startsWith(a + ' ')) return 'ACK';
  }
  return null;
}

function pillWidth(label: string): number {
  const n = label.length;
  return Math.min(84, Math.max(32, 26 + n * 7));
}

/** 章节药丸中间核心字（不含 §；由 structuralPillLabel 统一加 「§ 」前缀） */
function chapterCoreLabel(sn: ChatNode): string {
  const raw = (sn.content || '').trim();
  const order = sn.chapter_order ?? 0;

  if (!raw.length) {
    return '·';
  }

  const lineNorm = raw.toLowerCase().replace(/\s+/g, ' ');
  const tailNorm = normTailAfterOutline(raw);

  const spTail = matchSpecialPhrase(tailNorm);
  if (spTail) {
    return spTail;
  }

  const num = extractOutlineNumber(raw);
  if (num) {
    return num;
  }

  const spLine = matchSpecialPhrase(lineNorm);
  if (spLine) {
    return spLine;
  }

  // 第一个章节且无节号、非特殊节：视为论文标题行
  if (order === 0) {
    return 'TITLE';
  }

  const compact = raw.replace(/\s+/g, ' ').slice(0, 10);
  return compact;
}

/**
 * 文档根与章节节点在分支图上的短标签与宽度。
 */
export function structuralPillLabel(sn: ChatNode): { label: string; width: number } {
  if (sn.node_kind === 'doc_root') {
    return { label: 'FILE', width: pillWidth('FILE') };
  }
  const core = chapterCoreLabel(sn);
  const label = `§ ${core}`;
  return { label, width: pillWidth(label) };
}
