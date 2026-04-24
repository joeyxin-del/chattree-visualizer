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

function findAssistantChild(nodes: Map<string, ChatNode>, userId: string): string | null {
  const u = nodes.get(userId);
  if (!u?.children?.length) return null;
  const aid = u.children.find((cid) => nodes.get(cid)?.role === 'assistant');
  return aid ?? null;
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

    let yOffset = 36;
    /** 递增分叉序号，避免「用户下多叉 + 助手下多叉」时 branchIndex 算式撞车导致同色、同 x */
    let forkSerial = rootNodes.length;

    const processFromNode = (nodeId: string, branchIndex: number, xOffset: number) => {
      const node = nodes.get(nodeId);
      if (!node) return;

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
          x: xOffset,
          y: yOffset,
          color: base,
          assistantColor,
          branchIndex,
        });
        yOffset += 52;

        if (assistantId) {
          const ast = nodes.get(assistantId);
          if (ast?.children?.length) {
            ast.children.forEach((childId, index) => {
              const newBranchIndex = index === 0 ? branchIndex : forkSerial++;
              const newX = index === 0 ? xOffset : xOffset + index * 44;
              processFromNode(childId, newBranchIndex, newX);
            });
          }
        }

        // 从用户消息直接分叉：子节点里是另一条「用户」链，不经过当前助手子树
        const userForks = (node.children ?? []).filter(
          (cid) => cid !== assistantId && nodes.get(cid)?.role === 'user'
        );
        userForks.forEach((childId, i) => {
          const bi = forkSerial++;
          const newX = xOffset + (i + 1) * 44;
          processFromNode(childId, bi, newX);
        });
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
          x: xOffset,
          y: yOffset,
          color: base,
          assistantColor: lightenHsl(base, 8),
          branchIndex,
        });
        yOffset += 52;
        if (node.children?.length) {
          node.children.forEach((childId, index) => {
            const newBranchIndex = index === 0 ? branchIndex : forkSerial++;
            const newX = index === 0 ? xOffset : xOffset + index * 44;
            processFromNode(childId, newBranchIndex, newX);
          });
        }
      }
    };

    rootNodes.forEach((rootId, index) => {
      processFromNode(rootId, index, 56 + index * 48);
    });

    return result;
  }, [nodes, rootNodes]);

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

            {edges.map(({ from, to, inPath }) => (
              <line
                key={`${from.id}-${to.id}`}
                x1={from.x}
                y1={from.y + 10}
                x2={to.x}
                y2={to.y - 10}
                stroke={inPath ? from.color : 'hsl(var(--muted-foreground))'}
                strokeWidth={inPath ? 3 : 2}
                opacity={inPath ? 0.85 : 0.35}
                className="transition-all"
              />
            ))}

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

/** 粗略提亮 hsl() 字符串，用于同一分支内区分 U / A 半区 */
function lightenHsl(hsl: string, addL: number): string {
  const m = hsl.match(/hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)/i);
  if (!m) return hsl;
  const l = Math.min(65, parseFloat(m[3]) + addL);
  return `hsl(${m[1]} ${m[2]}% ${l}%)`;
}
