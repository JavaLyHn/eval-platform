/**
 * Right-side slide-in panel that previews a question without leaving the
 * library list. Header carries:
 *   - "去首页答题" — primary action, always visible (no scroll required)
 *   - "⤢" — expand to /library/:id full page
 */

import { ArrowRight, Maximize2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { QuestionDetailView } from "./question-detail-view";
import { useQAStore } from "@/hooks/use-qa-store";
import type { Question } from "@/types";

interface Props {
  question: Question | null;
  onClose: () => void;
  onExpand: (id: string) => void;
  onEdit: (q: Question) => void;
  onDelete: (q: Question) => void;
}

export function QuestionDetailSheet({
  question,
  onClose,
  onExpand,
  onEdit,
  onDelete,
}: Props) {
  const navigate = useNavigate();
  const { newConversation, setSelectionForConv, setRightTab } = useQAStore();
  const open = !!question;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent className="p-0" hideClose>
        {question && (
          <>
            <SheetHeader className="flex-col items-stretch gap-2 pr-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate">{question.title}</SheetTitle>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="放大到全屏"
                  onClick={() => onExpand(question.id)}
                  title="全屏查看"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="关闭"
                  onClick={onClose}
                  title="关闭"
                  className="text-muted-foreground"
                >
                  <span aria-hidden>✕</span>
                </Button>
              </div>
              <Button
                size="sm"
                className="w-full gap-1"
                onClick={() => {
                  // 与题库列表「去首页答题」同源:建/切到新会话,把题塞进它的 selection,
                  // 落到「当前任务」tab,再跳首页(在首页点「批量运行」开始作答)。
                  const convId = newConversation();
                  setSelectionForConv(convId, [question.id]);
                  setRightTab("current");
                  onClose();
                  navigate("/");
                }}
              >
                去首页答题 <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </SheetHeader>
            <ScrollArea className="flex-1 min-h-0">
              <QuestionDetailView
                question={question}
                onEdit={onEdit}
                onDelete={onDelete}
                onStartInWorkspace={onClose}
                hidePrimaryAction
              />
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
