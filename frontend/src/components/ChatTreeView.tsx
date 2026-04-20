import { useState, useCallback, useEffect, useMemo } from 'react';
import { useChatTreeStore } from '../store/chatTreeStore';
import { useWebSocket, createSession } from '../hooks/useWebSocket';
import { BranchVisualizer } from './BranchVisualizer';
import { ChatView } from './ChatView';
import { Button } from './ui/button';
import type { ChatNode } from '../types';
import { Send, Sparkles } from 'lucide-react';

export function ChatTreeView() {
  const { nodes, rootNodes, sessionKey, setSessionKey } = useChatTreeStore();
  const { sendMessage } = useWebSocket(sessionKey);
  const [inputMessage, setInputMessage] = useState('');
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);

  // 初始化会话（开发环境走 Vite 代理 /api -> :8000，需先启动后端）
  useEffect(() => {
    if (!sessionKey) {
      createSession()
        .then(setSessionKey)
        .catch((err) => {
          console.error(
            'Failed to create session. Is the backend running on port 8000? (e.g. start-backend.cmd)',
            err
          );
        });
    }
  }, [sessionKey, setSessionKey]);

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

    sendMessage({
      type: 'chat',
      parent_node_id: currentNodeId,
      message: inputMessage,
    });

    setInputMessage('');
  }, [inputMessage, currentNodeId, sendMessage]);

  // 切换到某个节点
  const handleNodeClick = useCallback((nodeId: string) => {
    setCurrentNodeId(nodeId);
  }, []);

  // 创建新分支
  const handleCreateBranch = useCallback((nodeId: string) => {
    setCurrentNodeId(nodeId);
    // 用户可以在输入框输入新消息来创建分支
  }, []);

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
          <div className="text-xs text-muted-foreground">
            {nodes.size} 个节点 · {rootNodes.length} 个根分支
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：分支可视化 */}
        <BranchVisualizer
          nodes={nodes}
          rootNodes={rootNodes}
          currentBranchPath={currentBranchPath}
          onNodeClick={handleNodeClick}
        />

        {/* 中间：对话视图 */}
        <div className="flex-1 flex flex-col">
          <ChatView
            messages={currentMessages}
            onCreateBranch={handleCreateBranch}
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
                💡 提示：选中消息文字右键可创建新分支
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
