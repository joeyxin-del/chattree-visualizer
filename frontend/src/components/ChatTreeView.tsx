import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useChatTreeStore } from '../store/chatTreeStore';
import {
  useWebSocket,
  createSession,
  listSessions,
  fetchSessionSnapshot,
  rememberSessionKey,
  getStoredSessionKey,
  type SessionListItem,
} from '../hooks/useWebSocket';
import { BranchVisualizer } from './BranchVisualizer';
import { ChatView } from './ChatView';
import { Button } from './ui/button';
import type { ChatNode } from '../types';
import { History, Plus, Send, Sparkles } from 'lucide-react';

function formatSessionTime(ts: number) {
  try {
    return new Date(ts * 1000).toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function ChatTreeView() {
  const {
    nodes,
    rootNodes,
    sessionKey,
    setSessionKey,
    hydrateSession,
    clearNodes,
  } = useChatTreeStore();

  /** 为 true 时：新消息/流式完成后自动切到最新用户或助手节点（类似 ChatGPT）；点击左侧分支后为 false */
  const followLatestRef = useRef(true);
  const [inputMessage, setInputMessage] = useState('');
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const pendingBranchRef = useRef<{ parentId: string; since: number; firstMessage: string } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<SessionListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const wsHandlers = useMemo(
    () => ({
      onNodeCreated: (node: ChatNode) => {
        if (!followLatestRef.current) return;
        if (node.role === 'user' || node.role === 'assistant') {
          setCurrentNodeId(node.id);
        }
      },
      onNodeCompleted: (nodeId: string) => {
        if (!followLatestRef.current) return;
        const n = useChatTreeStore.getState().nodes.get(nodeId);
        if (n?.role === 'assistant') {
          setCurrentNodeId(nodeId);
        }
      },
    }),
    [setCurrentNodeId]
  );

  const { sendMessage } = useWebSocket(sessionKey, wsHandlers);

  const loadHistoryList = useCallback(async () => {
    setHistoryLoading(true);
    try {
      setHistoryItems(await listSessions());
    } catch (err) {
      console.error('加载历史会话失败', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (historyOpen) loadHistoryList();
  }, [historyOpen, loadHistoryList]);

  // 初始化：优先恢复 localStorage 中的会话，否则新建（数据由后端 JSON 持久化）
  useEffect(() => {
    if (sessionKey) return;
    let cancelled = false;
    (async () => {
      const stored = getStoredSessionKey();
      if (stored) {
        try {
          const snap = await fetchSessionSnapshot(stored);
          if (cancelled) return;
          hydrateSession(snap.nodes, snap.root_nodes);
          setSessionKey(snap.session_key);
          rememberSessionKey(snap.session_key);
          return;
        } catch {
          /* 本地记录的会话可能已被删或后端未就绪，回落为新建 */
        }
      }
      try {
        const key = await createSession();
        if (cancelled) return;
        clearNodes();
        setSessionKey(key);
        rememberSessionKey(key);
      } catch (err) {
        console.error(
          '无法创建会话。后端是否在 :8000 运行？（可运行 start-backend.cmd）',
          err
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionKey, setSessionKey, hydrateSession, clearNodes]);

  const handleNewChat = useCallback(async () => {
    try {
      const key = await createSession();
      clearNodes();
      setSessionKey(key);
      rememberSessionKey(key);
      setCurrentNodeId(null);
      followLatestRef.current = true;
      setHistoryOpen(false);
    } catch (err) {
      console.error('新建会话失败', err);
    }
  }, [clearNodes, setSessionKey]);

  const handleOpenHistorySession = useCallback(
    async (key: string) => {
      try {
        const snap = await fetchSessionSnapshot(key);
        hydrateSession(snap.nodes, snap.root_nodes);
        setSessionKey(snap.session_key);
        rememberSessionKey(snap.session_key);
        setCurrentNodeId(null);
        followLatestRef.current = true;
        setHistoryOpen(false);
      } catch (err) {
        console.error('打开会话失败', err);
      }
    },
    [hydrateSession, setSessionKey]
  );

  // 获取当前分支路径
  const currentBranchPath = useMemo(() => {
    if (!currentNodeId) return [];

    const path: string[] = [];
    let nodeId: string | null = currentNodeId;

    while (nodeId) {
      path.unshift(nodeId);
      const node = nodes.get(nodeId);
      nodeId = node?.parent_id || null;
    }

    return path;
  }, [currentNodeId, nodes]);

  // 获取当前分支的消息列表
  const currentMessages = useMemo(() => {
    return currentBranchPath.map(id => nodes.get(id)).filter(Boolean) as ChatNode[];
  }, [currentBranchPath, nodes]);

  // 发送消息
  const handleSendMessage = useCallback(() => {
    if (!inputMessage.trim()) return;

    followLatestRef.current = true;
    sendMessage({
      type: 'chat',
      parent_node_id: currentNodeId,
      message: inputMessage,
    });

    setInputMessage('');
  }, [inputMessage, currentNodeId, sendMessage]);

  // 切换到某个节点
  const handleNodeClick = useCallback((nodeId: string) => {
    followLatestRef.current = false;
    setCurrentNodeId(nodeId);
  }, []);

  // 从某条消息分叉：发送首条用户消息并带上分支标签（左侧缩略图展示）
  const handleSubmitBranchFromMessage = useCallback(
    (parentNodeId: string, message: string, branchLabel?: string) => {
      followLatestRef.current = true;
      pendingBranchRef.current = {
        parentId: parentNodeId,
        since: Date.now() / 1000 - 0.05,
        firstMessage: message,
      };
      sendMessage({
        type: 'chat',
        parent_node_id: parentNodeId,
        message,
        branch_label: branchLabel?.trim() || undefined,
      });
    },
    [sendMessage]
  );

  // 新分支的用户节点到达后，切换到该分支以便继续对话并刷新左侧树
  useEffect(() => {
    const p = pendingBranchRef.current;
    if (!p) return;
    const candidates = Array.from(nodes.values()).filter(
      (n) =>
        n.parent_id === p.parentId &&
        n.role === 'user' &&
        n.content === p.firstMessage &&
        n.timestamp >= p.since - 2
    );
    if (candidates.length === 0) return;
    const newest = candidates.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
    setCurrentNodeId(newest.id);
    pendingBranchRef.current = null;
  }, [nodes]);

  // 自动选择最新的叶子节点
  useEffect(() => {
    if (!currentNodeId && nodes.size > 0) {
      // 找到最新的叶子节点
      const allNodes = Array.from(nodes.values());
      const leafNodes = allNodes.filter(node => !node.children || node.children.length === 0);
      if (leafNodes.length > 0) {
        const latestLeaf = leafNodes.reduce((latest, node) =>
          node.timestamp > latest.timestamp ? node : latest
        );
        setCurrentNodeId(latestLeaf.id);
      }
    }
  }, [nodes, currentNodeId]);

  return (
    <div className="w-full h-screen flex flex-col">
      {/* Header */}
      <div className="bg-card border-b px-6 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">
                ChatTree Visualizer
              </h1>
              <p className="text-xs text-muted-foreground">
                多分支对话可视化工具
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative z-50">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setHistoryOpen((o) => !o)}
              >
                <History className="w-4 h-4" />
                历史
              </Button>
              {historyOpen ? (
                <div className="absolute right-0 top-full mt-2 w-[min(100vw-2rem,22rem)] rounded-xl border bg-card shadow-lg">
                  <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                    已保存的会话
                  </div>
                  <div className="max-h-72 overflow-y-auto p-1">
                    {historyLoading ? (
                      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                        加载中…
                      </p>
                    ) : historyItems.length === 0 ? (
                      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                        暂无记录
                      </p>
                    ) : (
                      historyItems.map((item) => (
                        <button
                          key={item.session_key}
                          type="button"
                          onClick={() => handleOpenHistorySession(item.session_key)}
                          className={`flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                            item.session_key === sessionKey ? 'bg-muted/80' : ''
                          }`}
                        >
                          <span className="line-clamp-2 text-foreground">
                            {item.preview || '（空会话）'}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {formatSessionTime(item.updated_at)} · {item.node_count}{' '}
                            个节点
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            <Button
              type="button"
              variant="default"
              size="sm"
              className="gap-1.5"
              onClick={handleNewChat}
            >
              <Plus className="w-4 h-4" />
              新对话
            </Button>
            <div className="text-xs text-muted-foreground whitespace-nowrap">
              {nodes.size} 节点 · {rootNodes.length} 根
            </div>
          </div>
        </div>
      </div>
      {historyOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 cursor-default bg-black/20"
          aria-label="关闭历史列表"
          onClick={() => setHistoryOpen(false)}
        />
      ) : null}

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：分支可视化 */}
        <BranchVisualizer
          nodes={nodes}
          rootNodes={rootNodes}
          currentBranchPath={currentBranchPath}
          onNodeClick={handleNodeClick}
        />

        {/* 中间：对话视图（min-h-0 让子项可收缩，聊天区才能出现纵向滚动） */}
        <div className="flex min-h-0 flex-1 flex-col">
          <ChatView
            messages={currentMessages}
            onSubmitBranchFromMessage={handleSubmitBranchFromMessage}
          />

          {/* 输入框 */}
          <div className="border-t bg-card/50 backdrop-blur-sm p-4">
            <div className="max-w-4xl mx-auto">
              <div className="flex gap-3 items-end">
                <div className="flex-1 relative">
                  <textarea
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
                    className="w-full p-4 pr-12 border rounded-2xl bg-background
                             focus:ring-2 focus:ring-primary focus:border-transparent
                             resize-none transition-all min-h-[56px] max-h-[200px]"
                    rows={1}
                    style={{
                      height: 'auto',
                      minHeight: '56px',
                    }}
                  />
                </div>
                <Button
                  onClick={handleSendMessage}
                  disabled={!inputMessage.trim()}
                  size="lg"
                  className="h-14 px-6 rounded-2xl"
                >
                  <Send className="w-5 h-5" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2 text-center">
                💡 将鼠标移到某条用户或助手消息上，在气泡下点击「新建分支」
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
