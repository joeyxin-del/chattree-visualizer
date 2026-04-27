import { create } from 'zustand';
import type { ChatNode } from '../types';

interface ChatTreeStore {
  // 状态
  nodes: Map<string, ChatNode>;
  rootNodes: string[];
  focusedNodeId: string | null;
  sessionKey: string | null;

  // 操作
  setSessionKey: (key: string) => void;
  addNode: (node: ChatNode) => void;
  updateNode: (id: string, updates: Partial<ChatNode>) => void;
  setFocus: (id: string | null) => void;
  clearNodes: () => void;
  /** 从历史或后端快照恢复整棵树（替换当前节点与根列表） */
  hydrateSession: (nodes: Record<string, ChatNode>, rootNodes: string[]) => void;

  // 查询
  getNode: (id: string) => ChatNode | undefined;
  getChildren: (id: string) => ChatNode[];
}

export const useChatTreeStore = create<ChatTreeStore>((set, get) => ({
  nodes: new Map(),
  rootNodes: [],
  focusedNodeId: null,
  sessionKey: null,

  setSessionKey: (key: string) => set({ sessionKey: key }),

  addNode: (node: ChatNode) => set((state) => {
    const newNodes = new Map(state.nodes);
    newNodes.set(node.id, node);

    const newRootNodes = [...state.rootNodes];
    if (!node.parent_id && !newRootNodes.includes(node.id)) {
      newRootNodes.push(node.id);
    }

    // 更新父节点的 children
    if (node.parent_id) {
      const parent = newNodes.get(node.parent_id);
      if (parent && !parent.children.includes(node.id)) {
        parent.children.push(node.id);
        newNodes.set(parent.id, { ...parent });
      }
    }

    return { nodes: newNodes, rootNodes: newRootNodes };
  }),

  updateNode: (id: string, updates: Partial<ChatNode>) => set((state) => {
    const newNodes = new Map(state.nodes);
    const node = newNodes.get(id);
    if (node) {
      newNodes.set(id, { ...node, ...updates });
    }
    return { nodes: newNodes };
  }),

  setFocus: (id: string | null) => set({ focusedNodeId: id }),

  clearNodes: () => set({ nodes: new Map(), rootNodes: [], focusedNodeId: null }),

  hydrateSession: (rawNodes, rootNodes) => {
    const next = new Map<string, ChatNode>();
    for (const [id, n] of Object.entries(rawNodes)) {
      next.set(id, {
        ...n,
        children: Array.isArray(n.children) ? [...n.children] : [],
      });
    }
    set({
      nodes: next,
      rootNodes: [...rootNodes],
      focusedNodeId: null,
    });
  },

  getNode: (id: string) => get().nodes.get(id),

  getChildren: (id: string) => {
    const node = get().nodes.get(id);
    if (!node) return [];
    return node.children.map(childId => get().nodes.get(childId)).filter(Boolean) as ChatNode[];
  },
}));
