// 节点类型定义
export interface ChatNode {
  id: string;
  parent_id: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  children: string[];
  branch_label?: string;
  timestamp: number;
  status: 'pending' | 'streaming' | 'completed' | 'aborted';
}

// WebSocket 消息类型
export interface WSMessage {
  type: 'node_created' | 'node_streaming' | 'node_completed' | 'node_error' | 'pong';
  node?: ChatNode;
  node_id?: string;
  content?: string;
  error?: string;
}

// 聊天消息请求
export interface ChatMessageRequest {
  type: 'chat';
  parent_node_id: string | null;
  message: string;
  branch_label?: string;
}
