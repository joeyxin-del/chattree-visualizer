import type { ChatNode } from '../types';
import type { Node, Edge } from 'reactflow';

export function convertToReactFlowNodes(
  nodes: Map<string, ChatNode>,
  rootNodes: string[]
): { nodes: Node[]; edges: Edge[] } {
  const reactFlowNodes: Node[] = [];
  const reactFlowEdges: Edge[] = [];
  const positions = new Map<string, { x: number; y: number }>();

  // 计算节点位置（简单的垂直布局）
  const calculatePositions = (nodeId: string, level: number, index: number) => {
    const node = nodes.get(nodeId);
    if (!node) return;

    const x = index * 300;
    const y = level * 200;
    positions.set(nodeId, { x, y });

    node.children.forEach((childId, childIndex) => {
      calculatePositions(childId, level + 1, index + childIndex);
    });
  };

  rootNodes.forEach((rootId, index) => {
    calculatePositions(rootId, 0, index);
  });

  // 转换为 ReactFlow 节点
  nodes.forEach((node, id) => {
    const pos = positions.get(id) || { x: 0, y: 0 };

    reactFlowNodes.push({
      id,
      type: 'chatNode',
      position: pos,
      data: node,
    });

    // 创建边
    if (node.parent_id) {
      reactFlowEdges.push({
        id: `edge-${node.parent_id}-${id}`,
        source: node.parent_id,
        target: id,
        type: 'smoothstep',
        animated: node.status === 'streaming',
      });
    }
  });

  return { nodes: reactFlowNodes, edges: reactFlowEdges };
}
