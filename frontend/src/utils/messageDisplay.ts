const TAG_NAMES = ['think', 'redacted_thinking', 'redacted_reasoning'] as const;

const PAIRED_BLOCKS = TAG_NAMES.map((name) => {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<\\s*${esc}\\s*>[\\s\\S]*?<\\s*\\/\\s*${esc}\\s*>`, 'gi');
});

const OPEN_TAG = new RegExp(
  `<\\s*(?:${TAG_NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*>`,
  'i'
);
const HAS_CLOSE_IN = new RegExp(
  `<\\s*\\/(?:${TAG_NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*>`,
  'i'
);

/**
 * 从展示用文本中移除模型内部推理块（think、redacted_thinking 等标签对），避免泄漏到 UI。
 * 流式输出若尚未出现闭合标签，则隐藏从起始标签到文末的片段。
 */
export function stripInferenceBlocksForDisplay(raw: string): string {
  if (!raw) return raw;
  let s = raw;
  for (const re of PAIRED_BLOCKS) {
    s = s.replace(re, '');
  }
  const openIdx = s.search(OPEN_TAG);
  if (openIdx !== -1) {
    const tail = s.slice(openIdx);
    if (!HAS_CLOSE_IN.test(tail)) {
      s = s.slice(0, openIdx);
    }
  }
  return s
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}
