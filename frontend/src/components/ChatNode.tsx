import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import type { ChatNode } from '../types';

interface ChatNodeComponentProps {
  data: ChatNode;
  selected: boolean;
}

export const ChatNodeComponent = memo(({ data, selected }: ChatNodeComponentProps) => {
  const getRoleColor = (role: string) => {
    switch (role) {
      case 'user':
        return 'bg-blue-500';
      case 'assistant':
        return 'bg-green-500';
      case 'system':
        return 'bg-gray-500';
      default:
        return 'bg-gray-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'streaming':
        return '⏳';
      case 'completed':
        return '✓';
      case 'aborted':
        return '✗';
      default:
        return '○';
    }
  };

  return (
    <div
      className={`
        min-w-[280px] max-w-[400px] rounded-lg shadow-lg
        ${selected ? 'ring-2 ring-blue-400' : ''}
        bg-white dark:bg-gray-800
      `}
    >
      <Handle type="target" position={Position.Top} className="w-3 h-3" />

      {/* Header */}
      <div className={`${getRoleColor(data.role)} text-white px-4 py-2 rounded-t-lg flex justify-between items-center`}>
        <span className="font-semibold capitalize">{data.role}</span>
        <span className="text-lg">{getStatusIcon(data.status)}</span>
      </div>

      {/* Content */}
      <div className="p-4">
        {data.branch_label && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            📌 {data.branch_label}
          </div>
        )}
        <div className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
          {data.content || (data.status === 'streaming' ? '思考中...' : '等待中...')}
        </div>
        {data.status === 'streaming' && (
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 h-1 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
              <div className="h-full bg-blue-500 animate-pulse w-1/3"></div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 rounded-b-lg text-xs text-gray-500 dark:text-gray-400 flex justify-between">
        <span>{new Date(data.timestamp * 1000).toLocaleTimeString()}</span>
        {data.children.length > 0 && <span>🌿 {data.children.length}</span>}
      </div>

      <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
    </div>
  );
});

ChatNodeComponent.displayName = 'ChatNodeComponent';
