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

interface VisualNode {
  id: string;
  x: number;
  y: number;
  color: string;
  node: ChatNode;
  branchIndex: number;
}

export function BranchVisualizer({ nodes, rootNodes, currentBranchPath, onNodeClick }: BranchVisualizerProps) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // 计算可视化节点位置
  const visualNodes = useMemo(() => {
    const result: VisualNode[] = [];
    const branchColors = [
      'hsl(221.2 83.2% 53.3%)',  // primary
      'hsl(142.1 76.2% 36.3%)',  // green
      'hsl(24.6 95% 53.1%)',     // orange
      'hsl(346.8 77.2% 49.8%)',  // red
      'hsl(262.1 83.3% 57.8%)',  // purple
      'hsl(280.4 89.1% 64.9%)',  // pink
    ];
    let yOffset = 30;

    const processNode = (nodeId: string, branchIndex: number, xOffset: number) => {
      const node = nodes.get(nodeId);
      if (!node) return;

      result.push({
        id: nodeId,
        x: xOffset,
        y: yOffset,
        color: branchColors[branchIndex % branchColors.length],
        node,
        branchIndex,
      });

      yOffset += 50;

      // 处理子节点
      if (node.children && node.children.length > 0) {
        node.children.forEach((childId, index) => {
          const newBranchIndex = index === 0 ? branchIndex : branchIndex + index;
          const newXOffset = index === 0 ? xOffset : xOffset + (index * 40);
          processNode(childId, newBranchIndex, newXOffset);
        });
      }
    };

    rootNodes.forEach((rootId, index) => {
      processNode(rootId, index, 60 + index * 40);
    });

    return result;
  }, [nodes, rootNodes]);

  return (
    <TooltipProvider>
      <div className="relative w-72 h-full bg-card border-r flex flex-col">
        <div className="p-4 border-b bg-muted/30">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">分支视图</h2>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {visualNodes.length} 个节点
          </p>
        </div>

        <div className="flex-1 relative overflow-hidden">
          <svg className="w-full h-full">
            {/* 绘制连接线 */}
            {visualNodes.map((vNode) => {
              const node = vNode.node;
              if (node.children && node.children.length > 0) {
                return node.children.map((childId) => {
                  const childVNode = visualNodes.find((v) => v.id === childId);
                  if (!childVNode) return null;

                  const isInPath = currentBranchPath.includes(vNode.id) && currentBranchPath.includes(childId);

                  return (
                    <line
                      key={`${vNode.id}-${childId}`}
                      x1={vNode.x}
                      y1={vNode.y}
                      x2={childVNode.x}
                      y2={childVNode.y}
                      stroke={isInPath ? vNode.color : 'hsl(var(--muted-foreground))'}
                      strokeWidth={isInPath ? 3 : 2}
                      opacity={isInPath ? 0.8 : 0.3}
                      className="transition-all"
                    />
                  );
                });
              }
              return null;
            })}

            {/* 绘制节点 */}
            {visualNodes.map((vNode) => {
              const isInCurrentPath = currentBranchPath.includes(vNode.id);
              const isHovered = hoveredNode === vNode.id;
              const isCurrent = currentBranchPath[currentBranchPath.length - 1] === vNode.id;

              return (
                <Tooltip key={vNode.id}>
                  <TooltipTrigger asChild>
                    <g
                      className="cursor-pointer transition-all"
                      onMouseEnter={() => setHoveredNode(vNode.id)}
                      onMouseLeave={() => setHoveredNode(null)}
                      onClick={() => onNodeClick(vNode.id)}
                    >
                      {/* 外圈高亮 */}
                      {isCurrent && (
                        <circle
                          cx={vNode.x}
                          cy={vNode.y}
                          r={12}
                          fill="none"
                          stroke={vNode.color}
                          strokeWidth={2}
                          opacity={0.5}
                          className="animate-pulse"
                        />
                      )}

                      {/* 主圆点 */}
                      <circle
                        cx={vNode.x}
                        cy={vNode.y}
                        r={isHovered ? 9 : 7}
                        fill={vNode.color}
                        stroke={isInCurrentPath ? 'hsl(var(--background))' : 'none'}
                        strokeWidth={isInCurrentPath ? 3 : 0}
                        opacity={isInCurrentPath ? 1 : 0.6}
                        className="transition-all"
                      />

                      {/* 角色标识 */}
                      <text
                        x={vNode.x}
                        y={vNode.y + 1}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="text-[8px] fill-white font-bold pointer-events-none"
                      >
                        {vNode.node.role === 'user' ? 'U' : 'A'}
                      </text>
                    </g>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs">
                    <div className="space-y-1">
                      <div className="text-xs font-semibold">
                        {vNode.node.role === 'user' ? '👤 用户' : '🤖 助手'}
                      </div>
                      <div className="text-xs line-clamp-3">
                        {vNode.node.content || '(生成中...)'}
                      </div>
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
