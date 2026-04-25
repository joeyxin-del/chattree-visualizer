import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { ChatNode } from '../types';
import { getTurnPreviewText } from '../utils/turnPreview';
import { GitBranch } from 'lucide-react';
import { useChatTreeStore } from '../store/chatTreeStore';
import { fetchBranchSummary } from '../api/branchSummary';

interface BranchVisualizerProps {
  nodes: Map<string, ChatNode>;
  rootNodes: string[];
  currentBranchPath: string[];
  onNodeClick: (nodeId: string) => void;
}

/** 一轮对话：用户气泡 + 助手回复，在缩略图中合并为一个胶囊 */
interface VisualTurn {
  id: string;
  userId: string | null;
  assistantId: string | null;
  userNode: ChatNode | null;
  assistantNode: ChatNode | null;
  x: number;
  y: number;
  color: string;
  assistantColor: string;
  branchIndex: number;
}

const MUTED = 'hsl(var(--muted))';

/** 分支横轴：与 git 图类似，每个 branchIndex 一「轨」，不同分支不同列，避免多根线叠在同一条竖线上。同一分叉点 — 最年长的子节点延续当前轨（排序后 index 0），较新的兄弟依次递增 forkSerial → 列更靠右（更外侧）。 */
const LANE_X = (branchIndex: number) => 36 + branchIndex * 48;

/** 纵排：略紧凑，仍保留胶囊与连线可读性 */
const ROW_STEP = 42;
/** 首行上方预留高度，给 Summary 的竖线 + S 圈 */
const BRANCH_S_TOP_RESERVE = 28;
const ROW_TOP = 30 + BRANCH_S_TOP_RESERVE;
const ROW_BOTTOM_PAD = 46;
const EDGE_Y_INSET = 8;

function messageSortKey(n: ChatNode | undefined): number {
  if (!n) return 0;
  const ext = n as ChatNode & { created_at?: number | string };
  const ca = ext.created_at;
  if (ca !== undefined && ca !== null) {
    if (typeof ca === 'number' && Number.isFinite(ca)) return ca;
    if (typeof ca === 'string') {
      const t = Date.parse(ca);
      if (Number.isFinite(t)) return t;
    }
  }
  return n.timestamp ?? 0;
}

/** 按节点年龄排序子 id：优先可选 `created_at`（数字或 ISO），否则 `timestamp`；再按 id 字典序。 */
function sortChildIdsByAge(nodes: Map<string, ChatNode>, childIds: string[]): string[] {
  return [...childIds].sort((a, b) => {
    const ka = messageSortKey(nodes.get(a));
    const kb = messageSortKey(nodes.get(b));
    if (ka !== kb) return ka - kb;
    return a.localeCompare(b);
  });
}

/** Git Graph 式：最早子节点延续当前列，其余按年龄渐新依次占更右的列（最新分叉在最外侧）。不用当前选中路径参与排轨，避免切换查看分支时整图列序乱跳。 */
function orderForkChildren(childIds: string[], nodes: Map<string, ChatNode>): { continuation: string; others: string[] } {
  const sorted = sortChildIdsByAge(nodes, childIds);
  if (sorted.length === 0) return { continuation: '', others: [] };
  return { continuation: sorted[0], others: sorted.slice(1) };
}

function findAssistantChild(nodes: Map<string, ChatNode>, userId: string): string | null {
  const u = nodes.get(userId);
  if (!u?.children?.length) return null;
  const aid = u.children.find((cid) => nodes.get(cid)?.role === 'assistant');
  return aid ?? null;
}

function turnSortTimestamp(t: VisualTurn): number {
  return t.userNode?.timestamp ?? t.assistantNode?.timestamp ?? 0;
}

/** 按「离根几轮」算深度，再按深度+时间排 y，避免 DFS 先走完主链导致侧枝被挤到最底下、离父节点很远 */
function assignYByDepthAndTime(turns: VisualTurn[]): VisualTurn[] {
  if (turns.length === 0) return turns;
  const byNode = new Map<string, VisualTurn>();
  for (const t of turns) {
    if (t.userId) byNode.set(t.userId, t);
    if (t.assistantId) byNode.set(t.assistantId, t);
  }
  /** 对话链只跟「上一轮」走：有用户节点时只看 user.parent_id；勿用 assistant.parent_id 兜底（常指向同轮用户，会 map 回自己导致爆栈） */
  const parentTurn = (t: VisualTurn): VisualTurn | null => {
    const pid =
      t.userNode != null ? t.userNode.parent_id : (t.assistantNode?.parent_id ?? null);
    if (!pid) return null;
    const p = byNode.get(pid) ?? null;
    if (!p || p.id === t.id) return null;
    return p;
  };
  const depthMemo = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (t: VisualTurn): number => {
    if (depthMemo.has(t.id)) return depthMemo.get(t.id)!;
    if (visiting.has(t.id)) {
      depthMemo.set(t.id, 0);
      return 0;
    }
    visiting.add(t.id);
    const p = parentTurn(t);
    const d = p !== null ? depthOf(p) + 1 : 0;
    visiting.delete(t.id);
    depthMemo.set(t.id, d);
    return d;
  };
  for (const t of turns) depthOf(t);

  const sorted = [...turns].sort((a, b) => {
    const da = depthMemo.get(a.id)!;
    const db = depthMemo.get(b.id)!;
    if (da !== db) return da - db;
    const ta = turnSortTimestamp(a);
    const tb = turnSortTimestamp(b);
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });

  return sorted.map((t, i) => ({ ...t, y: ROW_TOP + i * ROW_STEP }));
}

function buildNodeIdsForBranch(turns: VisualTurn[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const t of turns) {
    if (t.userId && t.userNode) {
      if (!seen.has(t.userId)) {
        seen.add(t.userId);
        ids.push(t.userId);
      }
    }
    if (t.assistantId && t.assistantNode) {
      if (!seen.has(t.assistantId)) {
        seen.add(t.assistantId);
        ids.push(t.assistantId);
      }
    }
  }
  return ids;
}

interface BranchHoverTip {
  id: string;
  text: string;
  left: number;
  top: number;
}

export function BranchVisualizer({ nodes, rootNodes, currentBranchPath, onNodeClick }: BranchVisualizerProps) {
  const sessionKey = useChatTreeStore((s) => s.sessionKey);
  const [hoveredTurn, setHoveredTurn] = useState<string | null>(null);
  const [hoverTip, setHoverTip] = useState<BranchHoverTip | null>(null);
  const tipLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const summaryAbortRef = useRef<AbortController | null>(null);
  const [summaryPanel, setSummaryPanel] = useState<
    | { state: 'idle' }
    | { state: 'loading' }
    | { state: 'ok'; text: string; branchIndex: number }
    | { state: 'err'; message: string }
  >({ state: 'idle' });

  const clearTipLeaveTimer = () => {
    if (tipLeaveTimerRef.current !== null) {
      clearTimeout(tipLeaveTimerRef.current);
      tipLeaveTimerRef.current = null;
    }
  };

  useEffect(() => () => clearTipLeaveTimer(), []);

  const visualTurns = useMemo(() => {
    const result: VisualTurn[] = [];
    const branchColors = [
      'hsl(221.2 83.2% 53.3%)',
      'hsl(142.1 76.2% 36.3%)',
      'hsl(24.6 95% 53.1%)',
      'hsl(346.8 77.2% 49.8%)',
      'hsl(262.1 83.3% 57.8%)',
      'hsl(280.4 89.1% 64.9%)',
    ];

    /** 递增分叉序号：新分配的列单调向右，与 Git Graph「新支在最外侧」一致 */
    const sortedRoots = [...rootNodes].sort((a, b) => {
      const ka = messageSortKey(nodes.get(a));
      const kb = messageSortKey(nodes.get(b));
      if (ka !== kb) return ka - kb;
      return a.localeCompare(b);
    });
    let forkSerial = sortedRoots.length;

    const processFromNode = (nodeId: string, branchIndex: number) => {
      const node = nodes.get(nodeId);
      if (!node) return;
      const x = LANE_X(branchIndex);

      if (node.role === 'user') {
        const assistantId = findAssistantChild(nodes, node.id);
        const assistantNode = assistantId ? nodes.get(assistantId) ?? null : null;
        const base = branchColors[branchIndex % branchColors.length];
        const assistantColor = assistantNode ? lightenHsl(base, 8) : MUTED;

        result.push({
          id: `turn-${node.id}`,
          userId: node.id,
          assistantId,
          userNode: node,
          assistantNode,
          x,
          y: 0,
          color: base,
          assistantColor,
          branchIndex,
        });

        if (assistantId) {
          const ast = nodes.get(assistantId);
          if (ast?.children?.length) {
            const { continuation, others } = orderForkChildren(ast.children, nodes);
            if (continuation) processFromNode(continuation, branchIndex);
            for (const childId of others) {
              processFromNode(childId, forkSerial++);
            }
          }
        }

        // 从用户消息直接分叉：与助手子叉一致，最早的用户子延续本列，其余按时间渐新收更右的轨（新支在外侧）
        const uids = (node.children ?? []).filter(
          (cid) => cid !== assistantId && nodes.get(cid)?.role === 'user'
        );
        if (uids.length) {
          const { continuation, others } = orderForkChildren(uids, nodes);
          if (continuation) processFromNode(continuation, branchIndex);
          for (const childId of others) {
            processFromNode(childId, forkSerial++);
          }
        }
        return;
      }

      // 仅有助手节点作为入口（少见）：整颗胶囊只显示右侧 A
      if (node.role === 'assistant') {
        const base = branchColors[branchIndex % branchColors.length];
        result.push({
          id: `turn-a-${node.id}`,
          userId: null,
          assistantId: node.id,
          userNode: null,
          assistantNode: node,
          x,
          y: 0,
          color: base,
          assistantColor: lightenHsl(base, 8),
          branchIndex,
        });
        if (node.children?.length) {
          const { continuation, others } = orderForkChildren(node.children, nodes);
          if (continuation) processFromNode(continuation, branchIndex);
          for (const childId of others) {
            processFromNode(childId, forkSerial++);
          }
        }
      }
    };

    sortedRoots.forEach((rootId, index) => {
      processFromNode(rootId, index);
    });

    return assignYByDepthAndTime(result);
  }, [nodes, rootNodes]);

  const svgMinWidth = useMemo(() => {
    if (visualTurns.length === 0) return 288;
    const maxX = Math.max(...visualTurns.map((t) => t.x));
    return Math.max(288, maxX + 40);
  }, [visualTurns]);

  const turnByNodeId = useMemo(() => {
    const m = new Map<string, VisualTurn>();
    for (const t of visualTurns) {
      if (t.userId) m.set(t.userId, t);
      if (t.assistantId) m.set(t.assistantId, t);
    }
    return m;
  }, [visualTurns]);

  const edges = useMemo(() => {
    const list: { from: VisualTurn; to: VisualTurn; inPath: boolean }[] = [];
    for (const to of visualTurns) {
      const parentId = to.userNode?.parent_id ?? null;
      if (!parentId) continue;
      const from = turnByNodeId.get(parentId);
      if (!from) continue;
      const pathSet = new Set(currentBranchPath);
      const edgeInPath =
        pathSet.has(parentId) &&
        (to.userId ? pathSet.has(to.userId) : false);
      list.push({ from, to, inPath: edgeInPath });
    }
    return list;
  }, [visualTurns, turnByNodeId, currentBranchPath]);

  const branchSummaryMarkers = useMemo(() => {
    const m = new Map<number, VisualTurn[]>();
    for (const t of visualTurns) {
      const arr = m.get(t.branchIndex) ?? [];
      arr.push(t);
      m.set(t.branchIndex, arr);
    }
    const out: { branchIndex: number; first: VisualTurn; nodeIds: string[] }[] = [];
    m.forEach((turns, branchIndex) => {
      if (turns.length === 0) return;
      const sorted = [...turns].sort((a, b) => a.y - b.y);
      const first = sorted[0];
      out.push({
        branchIndex,
        first,
        nodeIds: buildNodeIdsForBranch(sorted),
      });
    });
    out.sort((a, b) => a.branchIndex - b.branchIndex);
    return out;
  }, [visualTurns]);

  const onBranchSummaryClick = useCallback(
    (e: MouseEvent<SVGGElement>, branchIndex: number, nodeIds: string[]) => {
      e.stopPropagation();
      e.preventDefault();
      if (!sessionKey) {
        setSummaryPanel({ state: 'err', message: '尚未建立会话' });
        return;
      }
      if (nodeIds.length === 0) {
        setSummaryPanel({ state: 'err', message: '此分支无可用节点' });
        return;
      }
      summaryAbortRef.current?.abort();
      const ac = new AbortController();
      summaryAbortRef.current = ac;
      setSummaryPanel({ state: 'loading' });
      void (async () => {
        try {
          const text = await fetchBranchSummary(sessionKey, nodeIds, ac.signal);
          setSummaryPanel({ state: 'ok', text, branchIndex });
        } catch (err: unknown) {
          if (
            (err instanceof DOMException && err.name === 'AbortError') ||
            (err instanceof Error && err.name === 'AbortError')
          ) {
            return;
          }
          const msg = err instanceof Error ? err.message : '摘要失败';
          setSummaryPanel({ state: 'err', message: msg });
        }
      })();
    },
    [sessionKey]
  );

  return (
    <>
      <div className="relative w-72 h-full bg-card border-r flex flex-col min-h-0">
        <div className="p-4 border-b bg-muted/30 shrink-0">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">分支视图</h2>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{visualTurns.length} 轮对话</p>
          {summaryPanel.state === 'loading' && (
            <p className="text-xs text-muted-foreground mt-2">正在生成分支摘要…</p>
          )}
          {summaryPanel.state === 'ok' && (
            <div className="mt-2 max-h-36 overflow-y-auto rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs leading-relaxed text-foreground">
              <p className="m-0 mb-1 font-medium text-muted-foreground">分支摘要</p>
              <p className="m-0 whitespace-pre-wrap">{summaryPanel.text}</p>
            </div>
          )}
          {summaryPanel.state === 'err' && (
            <p className="text-xs text-destructive mt-2 break-words">{summaryPanel.message}</p>
          )}
        </div>

        <div
          className="flex-1 relative overflow-auto min-h-0"
          onScroll={() => {
            clearTipLeaveTimer();
            setHoverTip(null);
            setHoveredTurn(null);
          }}
        >
          <svg
            className="w-full min-h-full"
            style={{
              minWidth: svgMinWidth,
              minHeight: Math.max(
                400,
                visualTurns.reduce((m, t) => Math.max(m, t.y), 0) + ROW_BOTTOM_PAD
              ),
            }}
          >
            <defs>
              {visualTurns.map((t) => (
                <linearGradient key={`g-${t.id}`} id={`grad-${t.id}`} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={t.userNode ? t.color : MUTED} />
                  <stop offset="50%" stopColor={t.userNode ? t.color : MUTED} />
                  <stop offset="50%" stopColor={t.assistantNode ? t.assistantColor : MUTED} />
                  <stop offset="100%" stopColor={t.assistantNode ? t.assistantColor : MUTED} />
                </linearGradient>
              ))}
            </defs>

            {edges.map(({ from, to, inPath }) => {
              const d = curvedBranchEdgePath(from, to);
              return (
                <path
                  key={`${from.id}-${to.id}`}
                  d={d}
                  fill="none"
                  stroke={inPath ? from.color : 'hsl(var(--muted-foreground))'}
                  strokeWidth={inPath ? 3 : 2}
                  strokeLinecap="round"
                  opacity={inPath ? 0.85 : 0.35}
                  className="transition-all"
                />
              );
            })}

            {visualTurns.map((t) => {
              const pathSet = new Set(currentBranchPath);
              const inPath =
                (t.userId && pathSet.has(t.userId)) ||
                (t.assistantId && pathSet.has(t.assistantId));
              const lastId = currentBranchPath[currentBranchPath.length - 1];
              const isCurrent =
                (t.userId && lastId === t.userId) || (t.assistantId && lastId === t.assistantId);
              const isHovered = hoveredTurn === t.id;
              const previewText = getTurnPreviewText(t.userNode, t.assistantNode);
              const w = 30;
              const h = 18;
              const rx = 9;
              /** 透明命中区略大于药丸+当前外圈；梗概为 Portal 到 body，避免在 svg 里用 Radix 不弹层 */
              const hitW = w + 16;
              const hitH = h + 14;
              const hitRx = rx + 3;

              const handlePillClick = (e: MouseEvent<SVGRectElement>) => {
                e.stopPropagation();
                const svg = (e.currentTarget as SVGElement).ownerSVGElement;
                if (!svg) return;
                const pt = svg.createSVGPoint();
                pt.x = e.clientX;
                pt.y = e.clientY;
                const ctm = svg.getScreenCTM();
                if (!ctm) return;
                const p = pt.matrixTransform(ctm.inverse());
                const goLeft = p.x < t.x;
                if (goLeft && t.userId) onNodeClick(t.userId);
                else if (t.assistantId) onNodeClick(t.assistantId);
                else if (t.userId) onNodeClick(t.userId);
              };

              return (
                <g key={t.id}>
                  {isCurrent && (
                    <ellipse
                      cx={t.x}
                      cy={t.y}
                      rx={w / 2 + 6}
                      ry={h / 2 + 6}
                      fill="none"
                      stroke={t.color}
                      strokeWidth={2}
                      opacity={0.45}
                      className="animate-pulse"
                      style={{ pointerEvents: 'none' }}
                    />
                  )}

                  <g
                    transform={
                      isHovered
                        ? `translate(${t.x},${t.y}) scale(1.06) translate(${-t.x},${-t.y})`
                        : undefined
                    }
                  >
                    <rect
                      x={t.x - w / 2}
                      y={t.y - h / 2}
                      width={w}
                      height={h}
                      rx={rx}
                      ry={rx}
                      fill={`url(#grad-${t.id})`}
                      stroke={inPath ? 'hsl(var(--background))' : 'transparent'}
                      strokeWidth={inPath ? 2 : 0}
                      opacity={inPath ? 1 : 0.65}
                      style={{ pointerEvents: 'none' }}
                    />

                    <rect
                      x={t.x - hitW / 2}
                      y={t.y - hitH / 2}
                      width={hitW}
                      height={hitH}
                      rx={hitRx}
                      ry={hitRx}
                      fill="transparent"
                      className="cursor-pointer transition-all outline-none"
                      onClick={handlePillClick}
                      onPointerEnter={(e) => {
                        clearTipLeaveTimer();
                        setHoveredTurn(t.id);
                        const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
                        setHoverTip({ id: t.id, text: previewText, left: r.right + 6, top: r.top });
                      }}
                      onPointerLeave={() => {
                        setHoveredTurn(null);
                        clearTipLeaveTimer();
                        tipLeaveTimerRef.current = setTimeout(() => {
                          setHoverTip((s) => (s?.id === t.id ? null : s));
                          tipLeaveTimerRef.current = null;
                        }, 200);
                      }}
                    >
                      <title>{previewText}</title>
                    </rect>
                  </g>

                  {t.userNode && (
                    <text
                      x={t.x - 7}
                      y={t.y + 1}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="text-[9px] fill-white font-bold pointer-events-none"
                    >
                      U
                    </text>
                  )}
                  {t.userNode && t.assistantNode && (
                    <text
                      x={t.x + 7}
                      y={t.y + 1}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="text-[9px] fill-white font-bold pointer-events-none"
                    >
                      A
                    </text>
                  )}
                  {!t.userNode && t.assistantNode && (
                    <text
                      x={t.x}
                      y={t.y + 1}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="text-[9px] fill-white font-bold pointer-events-none"
                    >
                      A
                    </text>
                  )}
                </g>
              );
            })}

            {branchSummaryMarkers.map(({ branchIndex, first, nodeIds }) => {
              const pillTopY = first.y - 9;
              const r = 7;
              const cy = first.y - 20;
              const lineFromY = cy + r;
              return (
                <g key={`sum-${branchIndex}`} style={{ pointerEvents: 'all' }}>
                  <line
                    x1={first.x}
                    y1={lineFromY}
                    x2={first.x}
                    y2={pillTopY}
                    stroke="hsl(var(--muted-foreground))"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    style={{ pointerEvents: 'none' }}
                  />
                  <g
                    onClick={(e) => onBranchSummaryClick(e, branchIndex, nodeIds)}
                    className="cursor-pointer"
                    style={{ pointerEvents: 'all' }}
                  >
                    <circle
                      cx={first.x}
                      cy={cy}
                      r={r}
                      fill="hsl(var(--background))"
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth={1.5}
                    />
                    <text
                      x={first.x}
                      y={cy + 0.5}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="text-[8px] font-bold fill-[hsl(var(--muted-foreground))]"
                      style={{ pointerEvents: 'none' }}
                    >
                      S
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      {typeof document !== 'undefined' &&
        hoverTip &&
        createPortal(
          <div
            className="pointer-events-auto z-[200] max-w-[min(20rem,85vw)] rounded-md border border-border bg-popover px-3 py-2 text-xs leading-snug text-popover-foreground shadow-md"
            role="tooltip"
            style={{ position: 'fixed', left: hoverTip.left, top: hoverTip.top }}
            onPointerEnter={clearTipLeaveTimer}
            onPointerLeave={() => {
              setHoverTip(null);
            }}
          >
            <p className="m-0 line-clamp-2 text-left font-normal">{hoverTip.text}</p>
          </div>,
          document.body
        )}
    </>
  );
}

/**
 * 类 Git 图：同列 = 主竖线略弯；换列 = 从父点横甩、子点竖直切入（大半径 S，避免两端对称的「细腰」感）。
 */
function curvedBranchEdgePath(from: VisualTurn, to: VisualTurn): string {
  const sx = from.x;
  const sy = from.y + EDGE_Y_INSET;
  const ex = to.x;
  const ey = to.y - EDGE_Y_INSET;
  const dx = ex - sx;
  const dy = ey - sy;
  const sign = Math.sign(dx) || 0;
  const absX = Math.abs(dx);

  if (absX < 1) {
    const h = Math.max(20, Math.min(Math.abs(dy) * 0.52, 64));
    return `M ${sx} ${sy} C ${sx} ${sy + h} ${ex} ${ey - h} ${ex} ${ey}`;
  }

  const pull = Math.min(40, Math.max(10, absX * 0.5 + 6));
  const c1x = sx + sign * pull;
  const c1y = sy + Math.min(22, Math.max(4, Math.abs(dy) * 0.12));
  const vIn = Math.max(20, Math.min(52, Math.abs(dy) * 0.38));
  return `M ${sx} ${sy} C ${c1x} ${c1y} ${ex} ${ey - vIn} ${ex} ${ey}`;
}

/** 粗略提亮 hsl() 字符串，用于同一分支内区分 U / A 半区 */
function lightenHsl(hsl: string, addL: number): string {
  const m = hsl.match(/hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)/i);
  if (!m) return hsl;
  const l = Math.min(65, parseFloat(m[3]) + addL);
  return `hsl(${m[1]} ${m[2]}% ${l}%)`;
}
