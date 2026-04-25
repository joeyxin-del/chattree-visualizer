import type { ChatNode } from '../types';
import { stripInferenceBlocksForDisplay } from './messageDisplay';

const DEFAULT_MAX_CHARS = 100;

/**
 * 节点悬停「梗概」：优先本轮用户问题截断，否则助手内容；有分支名时前缀 `分支名 · `。
 * 与 docs/07 中「规则/截断、无大模型时也可用」一致。
 */
export function getTurnPreviewText(
  userNode: ChatNode | null,
  assistantNode: ChatNode | null,
  maxChars: number = DEFAULT_MAX_CHARS
): string {
  const label = userNode?.branch_label?.trim();
  const user = userNode?.content?.trim() ?? '';
  const assistantRaw = assistantNode?.content ?? '';
  const assistant = stripInferenceBlocksForDisplay(assistantRaw).trim();
  const body = user ? truncateText(user, maxChars) : assistant ? truncateText(assistant, maxChars) : '';
  if (!body) {
    return '该节点尚无文本，发送消息后将显示简介';
  }
  if (label) {
    return `${label} · ${body}`;
  }
  return body;
}

function truncateText(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}
