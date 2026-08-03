import { useQAStore } from "@/hooks/use-qa-store";

/**
 * 是否应显示「题目 / 打分 / 结果」面板(右栏)。
 * = 选中题 / 批量选择 / 本会话运行中或完成的答题队列 / 本会话答过题 / 有产物预览。
 * 与 WorkspaceLayout 的桌面判定共用同一份逻辑,避免两处口径漂移。
 */
export function useShowRight(): boolean {
  const {
    selectedQuestion,
    selection,
    queue,
    testedInActiveConv,
    activeConversationId,
    previewFile,
  } = useQAStore();
  return (
    !!selectedQuestion ||
    selection.size > 0 ||
    ((queue.running || queue.completed.length > 0) &&
      queue.conversationId === activeConversationId) ||
    testedInActiveConv.size > 0 ||
    !!previewFile
  );
}
