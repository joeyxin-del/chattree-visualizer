import { useState, useRef, useEffect } from 'react';
import type { ChatNode } from '../types';
import { ScrollArea } from './ui/scroll-area';
import { User, Bot } from 'lucide-react';

interface ChatViewProps {
  messages: ChatNode[];
  onCreateBranch: (nodeId: string) => void;
}

export function ChatView({ messages, onCreateBranch }: ChatViewProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodeId: string;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleContextMenu = (e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        nodeId,
      });
    }
  };

  const handleCreateBranch = () => {
    if (contextMenu) {
      onCreateBranch(contextMenu.nodeId);
      setContextMenu(null);
    }
  };

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  return (
    <div className="flex-1 flex flex-col bg-gradient-to-b from-background to-muted/20">
      {/* 消息列表 */}
      <ScrollArea className="flex-1 px-4 py-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[60vh] text-muted-foreground">
              <Bot className="w-16 h-16 mb-4 opacity-20" />
              <p className="text-lg">开始新对话或选择一个分支</p>
              <p className="text-sm mt-2">选中文字右键可创建新分支</p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                onContextMenu={(e) => handleContextMenu(e, msg.id)}
              >
                {/* 头像 */}
                <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground'
                }`}>
                  {msg.role === 'user' ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                </div>

                {/* 消息内容 */}
                <div className={`flex-1 max-w-3xl ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                  <div className={`inline-block px-4 py-3 rounded-2xl shadow-sm ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-tr-sm'
                      : 'bg-card text-card-foreground border rounded-tl-sm'
                  }`}>
                    <div className="whitespace-pre-wrap select-text text-sm leading-relaxed">
                      {msg.content || (
                        <span className="italic opacity-50 flex items-center gap-2">
                          <span className="inline-block w-2 h-2 bg-current rounded-full animate-pulse"></span>
                          生成中...
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 px-2">
                    {new Date(msg.timestamp * 1000).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className="fixed bg-popover text-popover-foreground border rounded-lg shadow-lg py-1 z-50 min-w-[180px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={handleCreateBranch}
            className="w-full px-4 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            🌿 从这里创建新分支
          </button>
        </div>
      )}
    </div>
  );
}
