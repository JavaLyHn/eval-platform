import { useNavigate } from "react-router-dom";
import { Maximize2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { QuestionDetailView } from "@/components/library/question-detail-view";
import type { Question } from "@/types";

/** 列表行「可点预览」的通用样式:光标 + hover 底色 + 键盘焦点环。 */
export const CLICKABLE_ROW =
  "cursor-pointer hover:bg-muted/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-inset";

/**
 * 只读题目预览抽屉:各处列表(判分过程 / 结果 / 发版门红线明细…)点某题弹出。
 * 复用题库的 QuestionDetailView,但 hideActions 隐藏编辑/删除,仅提供「全屏查看」跳题库详情。
 */
export function QuestionPreviewSheet({
  question,
  onClose,
}: {
  question: Question | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  return (
    <Sheet open={!!question} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="p-0" hideClose>
        {question && (
          <>
            <SheetHeader className="flex-row items-start gap-2 pr-3">
              <SheetTitle className="min-w-0 flex-1 truncate">{question.title}</SheetTitle>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="全屏查看"
                title="在题库中全屏查看"
                onClick={() => {
                  onClose();
                  navigate(`/library/${question.id}`);
                }}
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="关闭"
                title="关闭"
                className="text-muted-foreground"
                onClick={onClose}
              >
                <span aria-hidden>✕</span>
              </Button>
            </SheetHeader>
            <ScrollArea className="flex-1 min-h-0">
              <QuestionDetailView question={question} hideActions />
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
