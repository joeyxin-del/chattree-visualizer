import { useMemo, useState } from 'react';
import type { ChatNode } from '../types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { GitBranch } from 'lucide-react';

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

/** 分支横轴：与 git 图类似，每个 branchIndex 一「轨」，不同分支不同列，避免多根线叠在同一条竖线上 */
const LANE_X = (branchIndex: number) => 36 + branchIndex * 48;

/** Git Graph 式：只按创建时间。最早子节点延续当前列，其余子节点按时间渐新依次占更右的列（最新分叉在最外侧）。不用当前选中路径参与排轨，避免切换查看分支时整图列序乱跳。 */
function orderForkChildren(childIds: string[], nodes: Map<string, ChatNode>): { continuation: string; others: string[] } {
  const sorted = [...childIds].sort((a, b) => {
    const ta = nodes.get(a)?.timestamp ?? 0;
    const tb = nodes.get(b)?.timestamp ?? 0;
    if (ta !== tb) return ta - tb;
    return a.localeCompare(b);
  });
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

  const rowStep = 52;
  const top = 36;
  return sorted.map((t, i) => ({ ...t, y: top + i * rowStep }));
}

export function BranchVisualizer({ nodes, rootNodes, currentBranchPath, onNodeClick }: BranchVisualizerProps) {
  const [hoveredTurn, setHoveredTurn] = useState<string | null>(null);

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
      const ta = nodes.get(a)?.timestamp ?? 0;
      const tb = nodes.get(b)?.timestamp ?? 0;
      if (ta !== tb) return ta - tb;
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
            processFromNode(continuation, branchIndex);
            for (const childId of others) {
              processFromNode(childId, forkSerial++);
            }
          }
        }

        // 从用户消息直接分叉：子节点里是另一条「用户」链，不经过当前助手子树
        const userForks = (node.children ?? [])
          .filter((cid) => cid !== assistantId && nodes.get(cid)?.role === 'user')
          .sort((a, b) => {
            const ta = nodes.get(a)?.timestamp ?? 0;
            const tb = nodes.get(b)?.timestamp ?? 0;
            if (ta !== tb) return ta - tb;
            return a.localeCompare(b);
          });
        for (const childId of userForks) {
          processFromNode(childId, forkSerial++);
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
          processFromNode(continuation, branchIndex);
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

  return (
    <TooltipProvider>
      <div className="relative w-72 h-full bg-card border-r flex flex-col min-h-0">
        <div className="p-4 border-b bg-muted/30 shrink-0">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">分支视图</h2>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{visualTurns.length} 轮对话</p>
        </div>

        <div className="flex-1 relative overflow-auto min-h-0">
          <svg
            className="w-full min-h-full"
            style={{
              minWidth: svgMinWidth,
              minHeight: Math.max(
                400,
                visualTurns.reduce((m, t) => Math.max(m, t.y), 0) + 56
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
              const w = 30;
              const h = 18;
              const rx = 9;

              return (
                <Tooltip key={t.id}>
                  <TooltipTrigger asChild>
                    <g
                      className="cursor-pointer transition-all"
                      onMouseEnter={() => setHoveredTurn(t.id)}
                      onMouseLeave={() => setHoveredTurn(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        const svg = (e.currentTarget as SVGGElement).closest('svg');
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
                      }}
                    >
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
                        />
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
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs">
                    <div className="space-y-2">
                      {t.userNode && (
                        <div>
                          <div className="text-xs font-semibold">👤 用户</div>
                          <div className="text-xs line-clamp-3 text-muted-foreground">
                            {t.userNode.content || '(空)'}
                          </div>
                        </div>
                      )}
                      {t.assistantNode && (
                        <div>
                          <div className="text-xs font-semibold">🤖 助手</div>
                          <div className="text-xs line-clamp-3 text-muted-foreground">
                            {t.assistantNode.content || '(生成中...)'}
                          </div>
                        </div>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </svg>
        </div>
      </div>
    </TooltipProvider>
  );
}

/** 缩略图父子连线：仿 git 图 — 端部多「外甩」一点，横移大时从两端弯向对侧，整体更 S、不像硬折线 */
function curvedBranchEdgePath(from: VisualTurn, to: VisualTurn): string {
  const sx = from.x;
  const sy = from.y + 10;
  const ex = to.x;
  const ey = to.y - 10;
  const dx = ex - sx;
  const dy = ey - sy;
  const h = Math.max(22, Math.min(Math.abs(dy) * 0.52, 72));
  const pullX = Math.min(44, Math.max(10, Math.abs(dx) * 0.5));
  const sign = Math.sign(dx) || 0;
  // 控制点：起点向子列方向、沿竖直多走一截；终点对称，两端都比纯竖控更「弯」
  return `M ${sx} ${sy} C ${sx + sign * pullX} ${sy + h} ${ex - sign * pullX} ${ey - h} ${ex} ${ey}`;
}

/** 粗略提亮 hsl() 字符串，用于同一分支内区分 U / A 半区 */
function lightenHsl(hsl: string, addL: number): string {
  const m = hsl.match(/hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)/i);
  if (!m) return hsl;
  const l = Math.min(65, parseFloat(m[3]) + addL);
  return `hsl(${m[1]} ${m[2]}% ${l}%)`;
}
