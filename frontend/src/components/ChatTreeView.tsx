import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useChatTreeStore } from '../store/chatTreeStore';
import {
  useWebSocket,
  createSession,
  listSessions,
  fetchSessionSnapshot,
  rememberSessionKey,
  getStoredSessionKey,
  clearStoredSessionKey,
  deleteSession,
  uploadSessionPdf,
  inferSessionChapters,
  sessionPdfUrl,
  type SessionListItem,
} from '../hooks/useWebSocket';
import { BranchVisualizer } from './BranchVisualizer';
import { ChatView } from './ChatView';
import { PdfReaderPanel } from './PdfReaderPanel';
import { Button } from './ui/button';
import type { ChatNode } from '../types';
import { FileUp, History, Plus, Send, Settings, Sparkles, BookMarked, BookOpen } from 'lucide-react';

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

export function ChatTreeView({ onOpenSettings }: { onOpenSettings?: () => void }) {
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
  const [historySelectedKeys, setHistorySelectedKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [historyDeleting, setHistoryDeleting] = useState(false);
  const [hasPdf, setHasPdf] = useState(false);
  const [pdfName, setPdfName] = useState<string | null>(null);
  const [pdfPanelOpen, setPdfPanelOpen] = useState(true);
  const [pdfUploading, setPdfUploading] = useState(false);
  const [inferChaptersLoading, setInferChaptersLoading] = useState(false);
  const [activeQuote, setActiveQuote] = useState<{
    excerpt: string;
    page: number;
    parentId: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  useEffect(() => {
    if (historyOpen) setHistorySelectedKeys(new Set());
  }, [historyOpen]);

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
          setHasPdf(Boolean(snap.has_pdf));
          setPdfName(snap.pdf_display_name ?? null);
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
        setHasPdf(false);
        setPdfName(null);
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
      setHasPdf(false);
      setPdfName(null);
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
        setHasPdf(Boolean(snap.has_pdf));
        setPdfName(snap.pdf_display_name ?? null);
      } catch (err) {
        console.error('打开会话失败', err);
      }
    },
    [hydrateSession, setSessionKey]
  );

  const handleDeleteSelectedSessions = useCallback(async () => {
    if (historySelectedKeys.size === 0 || historyDeleting) return;
    const n = historySelectedKeys.size;
    if (!window.confirm(`确定删除所选的 ${n} 个会话？此操作不可恢复。`)) return;

    const keys = [...historySelectedKeys];
    const cur = sessionKey;
    setHistoryDeleting(true);
    try {
      const results = await Promise.allSettled(keys.map((k) => deleteSession(k)));
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        console.error('删除会话失败', failed);
        alert(`有 ${failed.length} 项删除失败，请查看控制台。`);
      }
      await loadHistoryList();

      const curIdx = cur != null ? keys.indexOf(cur) : -1;
      const currentRemoved =
        curIdx >= 0 && results[curIdx]?.status === 'fulfilled';
      if (currentRemoved) {
        clearStoredSessionKey();
        await handleNewChat();
      }
    } finally {
      setHistorySelectedKeys(new Set());
      setHistoryDeleting(false);
    }
  }, [
    historySelectedKeys,
    historyDeleting,
    sessionKey,
    loadHistoryList,
    handleNewChat,
  ]);

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

  const hasUserMessages = useMemo(
    () => Array.from(nodes.values()).some((n) => n.role === 'user'),
    [nodes]
  );

  const showInferChaptersButton = useMemo(() => {
    const chapters = Array.from(nodes.values()).filter(
      (n) => n.node_kind === 'chapter'
    );
    if (chapters.length !== 1) return false;
    return (chapters[0].content ?? '').trim() === '全文';
  }, [nodes]);

  // 获取当前分支的消息列表
  const currentMessages = useMemo(() => {
    return currentBranchPath.map(id => nodes.get(id)).filter(Boolean) as ChatNode[];
  }, [currentBranchPath, nodes]);

  const getParentIdForPdfPage = useCallback(
    (page: number) => {
      let best: ChatNode | undefined;
      for (const n of nodes.values()) {
        if (n.node_kind === 'chapter' && n.page_start != null && n.page_end != null) {
          if (page >= n.page_start && page <= n.page_end) {
            if (!best || (n.chapter_order ?? 0) > (best.chapter_order ?? -1)) {
              best = n;
            }
          }
        }
      }
      if (best) return best.id;
      const r0 = rootNodes[0] ? nodes.get(rootNodes[0]) : undefined;
      if (r0?.node_kind === 'doc_root') return r0.id;
      return null;
    },
    [nodes, rootNodes]
  );

  const handleBeginQuoteBranch = useCallback(
    (excerpt: string, page: number) => {
      const pid = getParentIdForPdfPage(page) ?? currentNodeId;
      if (!pid) return;
      setActiveQuote({ excerpt, page, parentId: pid });
      setInputMessage('请结合以上摘录回答：\n\n');
    },
    [getParentIdForPdfPage, currentNodeId]
  );

  // 发送消息
  const handleSendMessage = useCallback(() => {
    if (!inputMessage.trim()) return;

    followLatestRef.current = true;
    const q = activeQuote;
    const parent = q?.parentId ?? currentNodeId;
    sendMessage({
      type: 'chat',
      parent_node_id: parent,
      message: inputMessage,
      quote_excerpt: q?.excerpt,
      source_page: q?.page,
    });
    setActiveQuote(null);

    setInputMessage('');
  }, [inputMessage, currentNodeId, sendMessage, activeQuote]);

  const onPdfFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f || !sessionKey) return;
      setPdfUploading(true);
      try {
        const snap = await uploadSessionPdf(sessionKey, f);
        hydrateSession(snap.nodes, snap.root_nodes);
        setHasPdf(Boolean(snap.has_pdf));
        setPdfName(snap.pdf_display_name ?? f.name);
        setPdfPanelOpen(true);
        setCurrentNodeId(null);
        followLatestRef.current = true;
      } catch (err) {
        console.error('上传 PDF 失败', err);
      } finally {
        setPdfUploading(false);
      }
    },
    [sessionKey, hydrateSession]
  );

  const onInferChapters = useCallback(async () => {
    if (!sessionKey) return;
    setInferChaptersLoading(true);
    try {
      const snap = await inferSessionChapters(sessionKey);
      hydrateSession(snap.nodes, snap.root_nodes);
      setHasPdf(Boolean(snap.has_pdf));
      setPdfName(snap.pdf_display_name ?? null);
      setCurrentNodeId(null);
      followLatestRef.current = true;
    } catch (err) {
      console.error('智能解析章节失败', err);
    } finally {
      setInferChaptersLoading(false);
    }
  }, [sessionKey, hydrateSession]);

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

  // 自动选择当前节点：有对话时跟最新一轮；仅章节树时取最后一章
  useEffect(() => {
    if (currentNodeId || nodes.size === 0) return;
    const withTurns = Array.from(nodes.values()).filter(
      (n) => n.role === 'user' || n.role === 'assistant'
    );
    if (withTurns.length > 0) {
      const latest = withTurns.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
      setCurrentNodeId(latest.id);
      return;
    }
    const chapterLeaves = Array.from(nodes.values()).filter(
      (n) => n.node_kind === 'chapter' && (!n.children || n.children.length === 0)
    );
    if (chapterLeaves.length > 0) {
      const pick = chapterLeaves.reduce((a, b) =>
        (a.chapter_order ?? 0) > (b.chapter_order ?? 0) ? a : b
      );
      setCurrentNodeId(pick.id);
      return;
    }
    const allNodes = Array.from(nodes.values());
    const leafNodes = allNodes.filter((node) => !node.children || node.children.length === 0);
    if (leafNodes.length > 0) {
      const latestLeaf = leafNodes.reduce((latest, node) =>
        node.timestamp > latest.timestamp ? node : latest
      );
      setCurrentNodeId(latestLeaf.id);
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
            {onOpenSettings ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={onOpenSettings}
              >
                <Settings className="w-4 h-4" />
                模型设置
              </Button>
            ) : null}
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
                  <div className="flex flex-col gap-2 border-b px-3 py-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      已保存的会话
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={
                          historyLoading || historyItems.length === 0 || historyDeleting
                        }
                        onClick={() =>
                          setHistorySelectedKeys(
                            new Set(historyItems.map((i) => i.session_key))
                          )
                        }
                      >
                        全选
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={
                          historyLoading || historyItems.length === 0 || historyDeleting
                        }
                        onClick={() => setHistorySelectedKeys(new Set())}
                      >
                        取消全选
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={
                          historyLoading ||
                          historySelectedKeys.size === 0 ||
                          historyDeleting
                        }
                        onClick={() => void handleDeleteSelectedSessions()}
                      >
                        {historyDeleting ? '删除中…' : '删除所选'}
                      </Button>
                    </div>
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
                        <div
                          key={item.session_key}
                          className="flex items-start gap-2 rounded-lg px-2 py-1"
                        >
                          <input
                            type="checkbox"
                            className="mt-2.5 size-4 shrink-0 rounded border-input accent-primary"
                            checked={historySelectedKeys.has(item.session_key)}
                            disabled={historyDeleting}
                            onChange={() => {
                              setHistorySelectedKeys((prev) => {
                                const next = new Set(prev);
                                if (next.has(item.session_key)) {
                                  next.delete(item.session_key);
                                } else {
                                  next.add(item.session_key);
                                }
                                return next;
                              });
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              handleOpenHistorySession(item.session_key)
                            }
                            disabled={historyDeleting}
                            className={`flex min-w-0 flex-1 flex-col gap-0.5 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50 ${
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
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,application/pdf"
              onChange={onPdfFileChange}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="gap-1.5"
              title={hasPdf ? (pdfName ? `已加载：${pdfName}` : '已加载 PDF') : '上传 PDF 生成分支'}
              disabled={!sessionKey || pdfUploading || hasPdf}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp className="w-4 h-4" />
              {pdfUploading ? '上传中…' : '上传 PDF'}
            </Button>
            {hasPdf &&
            sessionKey &&
            !hasUserMessages &&
            showInferChaptersButton ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                title="无书签时用本地规则推断章节（将替换当前章节树）"
                disabled={inferChaptersLoading}
                onClick={() => void onInferChapters()}
              >
                <BookMarked className="w-4 h-4" />
                {inferChaptersLoading ? '解析中…' : '智能解析章节'}
              </Button>
            ) : null}
            {hasPdf && sessionKey ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="inline-flex gap-1 shrink-0"
                onClick={() => setPdfPanelOpen((o) => !o)}
                title="切换右侧 PDF 阅读器（与侧栏收起条相同）"
              >
                <BookOpen className="w-4 h-4" />
                <span className="hidden sm:inline">
                  {pdfPanelOpen ? '隐藏阅读' : '打开阅读'}
                </span>
                <span className="sm:hidden">PDF</span>
              </Button>
            ) : null}
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
            <div className="text-xs text-muted-foreground whitespace-nowrap flex flex-col items-end gap-0.5">
              <span>
                {nodes.size} 节点 · {rootNodes.length} 根
              </span>
              {hasPdf ? (
                <span className="text-[10px] text-muted-foreground/90 lg:hidden">
                  宽屏可显示 PDF 侧栏
                </span>
              ) : null}
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
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
              {activeQuote ? (
                <p className="text-xs text-amber-800 dark:text-amber-200 mt-1 text-center">
                  下一条将附带第 {activeQuote.page} 页选区；发送后自动清除
                  <button
                    type="button"
                    className="ml-2 underline"
                    onClick={() => setActiveQuote(null)}
                  >
                    取消选区
                  </button>
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground mt-2 text-center">
                💡 将鼠标移到某条用户或助手消息上，在气泡下点击「新建分支」
              </p>
            </div>
          </div>
        </div>
        {hasPdf && sessionKey ? (
          <PdfReaderPanel
            open={pdfPanelOpen}
            onOpenChange={setPdfPanelOpen}
            pdfUrl={sessionPdfUrl(sessionKey)}
            onBeginQuoteBranch={handleBeginQuoteBranch}
            storageKey={sessionKey}
          />
        ) : null}
      </div>
    </div>
  );
}
