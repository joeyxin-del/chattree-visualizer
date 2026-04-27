// 节点类型定义
export type ChatNodeKind = 'doc_root' | 'chapter' | undefined;

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
  node_kind?: ChatNodeKind;
  document_title?: string;
  chapter_order?: number;
  page_start?: number;
  page_end?: number;
  source_page?: number;
  quote_excerpt?: string;
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
  /** 阅读器内划选，附于用户消息前（后端写入 quote_excerpt） */
  quote_excerpt?: string;
  source_page?: number;
}
