import { useEffect, useRef, useCallback } from 'react';
import { useChatTreeStore } from '../store/chatTreeStore';
import type { ChatNode, WSMessage, ChatMessageRequest } from '../types';

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

function getApiBase(): string {
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

function joinUrl(base: string, path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (!base) return p;
  return `${base.replace(/\/$/, '')}${p}`;
}

export function useWebSocket(sessionKey: string | null, handlers?: WebSocketHandlers) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const { addNode, updateNode } = useChatTreeStore();

  useEffect(() => {
    if (!sessionKey) return;

    const ws = new WebSocket(joinUrl(getWsBase(), `/ws/${sessionKey}`));
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      const message: WSMessage = JSON.parse(event.data);

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

    ws.onerror = () => {
      console.error(
        'WebSocket error (is backend running on :8000?):',
        ws.url,
        'readyState=',
        ws.readyState
      );
    };

    ws.onclose = (ev) => {
      console.log('WebSocket closed', ws.url, 'code=', ev.code, ev.reason || '');
    };

    return () => {
      ws.close();
    };
  }, [sessionKey, addNode, updateNode]);

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
