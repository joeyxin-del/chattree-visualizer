import { useEffect, useRef, useCallback } from 'react';
import { useChatTreeStore } from '../store/chatTreeStore';
import type { ChatNode, WSMessage, ChatMessageRequest } from '../types';

const LAST_SESSION_STORAGE_KEY = 'tree-visualizer-last-session';

export type SessionListItem = {
  session_key: string;
  updated_at: number;
  node_count: number;
  preview: string;
};

export type SessionSnapshot = {
  session_key: string;
  nodes: Record<string, ChatNode>;
  root_nodes: string[];
  has_pdf?: boolean;
  pdf_display_name?: string | null;
};

export interface WebSocketHandlers {
  /** 新节点写入 store 之后调用（用于跟流到最新用户/助手） */
  onNodeCreated?: (node: ChatNode) => void;
  /** 节点标记为 completed 且 store 已更新之后调用 */
  onNodeCompleted?: (nodeId: string) => void;
}

/** Dev: direct to backend (Vite WS proxy is unreliable on some setups). Prod: set VITE_API_BASE or same-origin /api. */
const DEV_HTTP_BACKEND = (
  import.meta.env.VITE_DEV_BACKEND || 'http://127.0.0.1:8000'
).replace(/\/$/, '');

export function getApiBase(): string {
  const base = import.meta.env.VITE_API_BASE;
  if (base !== undefined && String(base).trim() !== '') {
    return String(base).replace(/\/$/, '');
  }
  if (import.meta.env.DEV) {
    return DEV_HTTP_BACKEND;
  }
  return '';
}

function getWsBase(): string {
  const base = import.meta.env.VITE_API_BASE;
  if (base !== undefined && String(base).trim() !== '') {
    return String(base).replace(/^http/, 'ws').replace(/\/$/, '');
  }
  if (import.meta.env.DEV) {
    return DEV_HTTP_BACKEND.replace(/^http/, 'ws');
  }
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}`;
  }
  return 'ws://127.0.0.1:8000';
}

export function joinUrl(base: string, path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (!base) return p;
  return `${base.replace(/\/$/, '')}${p}`;
}

export function useWebSocket(sessionKey: string | null, handlers?: WebSocketHandlers) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef(handlers);
  const closingVoluntarilyRef = useRef(false);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!sessionKey) return;

    closingVoluntarilyRef.current = false;
    const url = joinUrl(getWsBase(), `/ws/${sessionKey}`);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (import.meta.env.DEV) {
        console.debug('[ws] open', url);
      }
    };

    ws.onmessage = (event) => {
      const message: WSMessage = JSON.parse(event.data);
      const { addNode, updateNode } = useChatTreeStore.getState();

      switch (message.type) {
        case 'node_created':
          if (message.node) {
            addNode(message.node);
            handlersRef.current?.onNodeCreated?.(message.node);
          }
          break;

        case 'node_streaming':
          if (message.node_id && message.content !== undefined) {
            updateNode(message.node_id, { content: message.content });
          }
          break;

        case 'node_completed':
          if (message.node_id && message.content !== undefined) {
            updateNode(message.node_id, {
              content: message.content,
              status: 'completed'
            });
            handlersRef.current?.onNodeCompleted?.(message.node_id);
          }
          break;

        case 'node_error':
          if (message.node_id) {
            updateNode(message.node_id, {
              content: message.error || 'Error occurred',
              status: 'aborted'
            });
            handlersRef.current?.onNodeCompleted?.(message.node_id);
          }
          break;
      }
    };

    /** 浏览器在 onerror 里几乎不给出原因，以 onclose 的 code 为准。 */
    ws.onerror = () => {
      if (closingVoluntarilyRef.current) return;
    };

    ws.onclose = (ev) => {
      if (closingVoluntarilyRef.current) return;
      if (import.meta.env.DEV) {
        console.debug('[ws] close', 'code=', ev.code, ev.reason || '', url);
      }
      if (ev.code === 1000) return;
      console.warn(
        '[ws] 与后端长连接已关闭（code=' + ev.code + '）。未启动 / 已退出后端时常见。请开 :8000：项目根目录运行 start-all.cmd 或 start-backend.cmd。',
        url
      );
    };

    return () => {
      closingVoluntarilyRef.current = true;
      ws.close();
    };
  }, [sessionKey]);

  const sendMessage = useCallback((message: ChatMessageRequest) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { sendMessage };
}

export async function createSession(): Promise<string> {
  const url = joinUrl(getApiBase(), '/api/sessions');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`createSession failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  return data.session_key;
}

export async function listSessions(): Promise<SessionListItem[]> {
  const url = joinUrl(getApiBase(), '/api/sessions');
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`listSessions failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  return data.sessions ?? [];
}

export async function fetchSessionSnapshot(
  sessionKey: string
): Promise<SessionSnapshot> {
  const url = joinUrl(
    getApiBase(),
    `/api/sessions/${encodeURIComponent(sessionKey)}`
  );
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`fetchSession failed: ${response.status} ${text}`);
  }
  return response.json();
}

export async function uploadSessionPdf(
  sessionKey: string,
  file: File
): Promise<SessionSnapshot> {
  const form = new FormData();
  form.append('file', file);
  const url = joinUrl(
    getApiBase(),
    `/api/sessions/${encodeURIComponent(sessionKey)}/pdf`
  );
  const response = await fetch(url, { method: 'POST', body: form });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`uploadSessionPdf failed: ${response.status} ${text}`);
  }
  return response.json();
}

export async function inferSessionChapters(
  sessionKey: string
): Promise<SessionSnapshot> {
  const url = joinUrl(
    getApiBase(),
    `/api/sessions/${encodeURIComponent(sessionKey)}/chapters/infer`
  );
  const response = await fetch(url, { method: 'POST' });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`inferSessionChapters failed: ${response.status} ${text}`);
  }
  return response.json();
}

export function sessionPdfUrl(sessionKey: string): string {
  return joinUrl(
    getApiBase(),
    `/api/sessions/${encodeURIComponent(sessionKey)}/pdf`
  );
}

export function rememberSessionKey(sessionKey: string) {
  try {
    localStorage.setItem(LAST_SESSION_STORAGE_KEY, sessionKey);
  } catch {
    /* ignore */
  }
}

export function getStoredSessionKey(): string | null {
  try {
    return localStorage.getItem(LAST_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}
