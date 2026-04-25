import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatNode } from '../types';
import { stripInferenceBlocksForDisplay } from '../utils/messageDisplay';
import { ScrollArea } from './ui/scroll-area';
import { Button } from './ui/button';
import { User, Bot, GitBranch, Send } from 'lucide-react';

interface ChatViewProps {
  messages: ChatNode[];
  onSubmitBranchFromMessage: (nodeId: string, message: string, branchLabel?: string) => void;
}

export function ChatView({ messages, onSubmitBranchFromMessage }: ChatViewProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [branchInputId, setBranchInputId] = useState<string | null>(null);
  const [branchInputValue, setBranchInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const branchPanelRef = useRef<HTMLDivElement>(null);
  const branchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!branchInputId) return;
    branchInputRef.current?.focus();
  }, [branchInputId]);

  useEffect(() => {
    if (!branchInputId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBranchInputId(null);
        setBranchInputValue('');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [branchInputId]);

  useEffect(() => {
    if (!branchInputId) return;
    const onDown = (e: MouseEvent) => {
      if (branchPanelRef.current && !branchPanelRef.current.contains(e.target as Node)) {
        setBranchInputId(null);
        setBranchInputValue('');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [branchInputId]);

  const handleBranchSend = useCallback(() => {
    const text = branchInputValue.trim();
    if (!branchInputId || !text) return;
    const label = text.length > 48 ? `${text.slice(0, 48)}…` : text;
    onSubmitBranchFromMessage(branchInputId, text, label);
    setBranchInputId(null);
    setBranchInputValue('');
    setHoveredId(null);
  }, [branchInputId, branchInputValue, onSubmitBranchFromMessage]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-gradient-to-b from-background to-muted/20">
      <ScrollArea className="min-h-0 flex-1 px-4 py-6" type="always">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[60vh] text-muted-foreground">
              <Bot className="w-16 h-16 mb-4 opacity-20" />
              <p className="text-lg">开始新对话或选择一个分支</p>
              <p className="text-sm mt-2">将鼠标移到某条消息上，在气泡下方新建分支</p>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              const rawContent = msg.content || '';
              const displayContent = isUser
                ? rawContent
                : stripInferenceBlocksForDisplay(rawContent);
              const showBranchBtn =
                hoveredId === msg.id && branchInputId !== msg.id;
              const showBranchInput = branchInputId === msg.id;
              const colAlign = isUser ? 'items-end' : 'items-start';

              const avatar = (
                <div
                  className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                    isUser
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-secondary-foreground'
                  }`}
                >
                  {isUser ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                </div>
              );

              const messageBody = (
                <div
                  className={`w-full max-w-full flex flex-col ${colAlign}`}
                  onMouseEnter={() => setHoveredId(msg.id)}
                  onMouseLeave={() => {
                    if (branchInputId !== msg.id) {
                      setHoveredId((h) => (h === msg.id ? null : h));
                    }
                  }}
                >
                  <div
                    className={`inline-block px-4 py-3 rounded-2xl shadow-sm ${
                      isUser
                        ? 'bg-primary text-primary-foreground rounded-tr-sm'
                        : 'bg-card text-card-foreground border rounded-tl-sm'
                    }`}
                  >
                    <div className="whitespace-pre-wrap select-text text-sm leading-relaxed">
                      {isUser ? (
                        displayContent || (
                          <span className="italic opacity-50 flex items-center gap-2">
                            <span className="inline-block w-2 h-2 bg-current rounded-full animate-pulse"></span>
                            生成中...
                          </span>
                        )
                      ) : msg.status === 'streaming' && !displayContent.trim() ? (
                        <span className="italic opacity-50 flex items-center gap-2">
                          <span className="inline-block w-2 h-2 bg-current rounded-full animate-pulse"></span>
                          生成中...
                        </span>
                      ) : (
                        displayContent || null
                      )}
                    </div>
                  </div>

                  <div
                    className={`mt-2 w-full min-h-[40px] flex flex-col ${colAlign}`}
                  >
                    {showBranchBtn && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5 shadow-sm"
                        onClick={() => {
                          setBranchInputId(msg.id);
                          setBranchInputValue('');
                        }}
                      >
                        <GitBranch className="w-3.5 h-3.5" />
                        新建分支
                      </Button>
                    )}
                    {showBranchInput && (
                      <div
                        ref={branchPanelRef}
                        className={`flex w-full max-w-md gap-2 items-center ${isUser ? 'ml-auto' : ''}`}
                      >
                        <input
                          ref={branchInputRef}
                          type="text"
                          value={branchInputValue}
                          onChange={(e) => setBranchInputValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleBranchSend();
                            }
                          }}
                          placeholder="输入新分支的首条消息…"
                          className="flex-1 min-w-0 h-9 px-3 rounded-md border border-input bg-background text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                        <Button
                          type="button"
                          size="sm"
                          className="shrink-0 gap-1"
                          disabled={!branchInputValue.trim()}
                          onClick={handleBranchSend}
                        >
                          <Send className="w-3.5 h-3.5" />
                          发送
                        </Button>
                      </div>
                    )}
                  </div>

                  <div
                    className={`text-xs text-muted-foreground mt-1 px-2 w-full ${isUser ? 'text-right' : 'text-left'}`}
                  >
                    {new Date(msg.timestamp * 1000).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
              );

              return (
                <div
                  key={msg.id}
                  className={`flex w-full gap-4 ${isUser ? 'flex-row justify-end' : 'flex-row'}`}
                >
                  {isUser ? (
                    <>
                      <div className={`flex min-w-0 max-w-3xl flex-1 flex-col ${colAlign}`}>
                        {messageBody}
                      </div>
                      {avatar}
                    </>
                  ) : (
                    <>
                      {avatar}
                      <div className={`flex min-w-0 max-w-3xl flex-1 flex-col ${colAlign}`}>
                        {messageBody}
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>
    </div>
  );
}
