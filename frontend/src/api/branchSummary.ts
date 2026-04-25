import { getApiBase, joinUrl } from '../hooks/useWebSocket';

export async function fetchBranchSummary(
  sessionKey: string,
  nodeIds: string[],
  signal?: AbortSignal
): Promise<string> {
  const url = joinUrl(
    getApiBase(),
    `/api/sessions/${encodeURIComponent(sessionKey)}/summary/branch`
  );
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ node_ids: nodeIds }),
    signal,
  });
  if (!res.ok) {
    const t = await res.text();
    let detail = t;
    try {
      const j = JSON.parse(t) as { detail?: string };
      if (j.detail) detail = j.detail;
    } catch {
      /* 保持原文 */
    }
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { summary: string };
  return data.summary;
}
