/**
 * Full-screen page at /library/:id — shows the same QuestionDetailView used by
 * the drawer, but on a wider canvas with a proper breadcrumb header. Edit /
 * delete dialogs hang off the page level (no scrolling issues inside a Sheet).
 */

import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Edit3, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HomeButton } from "@/components/home-button";
import { QuestionDetailView } from "@/components/library/question-detail-view";
import { QuestionFormDialog } from "@/components/question-panel/question-form-dialog";
import { ConfirmDeleteDialog } from "@/components/question-panel/confirm-delete-dialog";
import { useQAStore } from "@/hooks/use-qa-store";
import type { Question } from "@/types";

export function QuestionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { questions, deleteQuestion, newConversation, setSelectionForConv, setRightTab } =
    useQAStore();

  const question = useMemo(
    () => questions.find((q) => q.id === id) ?? null,
    [questions, id],
  );

  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Question | null>(null);

  if (!question) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="text-sm font-medium">题目不存在</div>
        <div className="text-xs text-muted-foreground">
          可能已被删除，或 URL 拼写错误。
        </div>
        <div className="inline-flex items-center gap-2">
          <HomeButton />
          <Link
            to="/library"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted"
          >
            <ArrowLeft className="h-3 w-3" /> 返回题库
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header ------------------------------------------------------------ */}
      <div className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 gap-y-2 border-b border-border bg-card px-4">
        <div className="flex min-w-0 items-center gap-3">
          <HomeButton />
          <span className="text-border">/</span>
          <Link
            to="/library"
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            题库
          </Link>
          <span className="text-border">/</span>
          <h1 className="truncate text-sm font-semibold">{question.title}</h1>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <Button
            size="sm"
            variant="default"
            className="gap-1"
            onClick={() => {
              // 与题库列表「去首页答题」同源:建/切到新会话,把题塞进它的 selection,
              // 落到「当前任务」tab,再跳首页(在首页点「批量运行」开始作答)。
              const convId = newConversation();
              setSelectionForConv(convId, [question.id]);
              setRightTab("current");
              navigate("/");
            }}
          >
            去首页答题 <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1"
            onClick={() => setFormOpen(true)}
          >
            <Edit3 className="h-3.5 w-3.5" /> 编辑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 text-destructive hover:text-destructive"
            onClick={() => setDeleting(question)}
          >
            <Trash2 className="h-3.5 w-3.5" /> 删除
          </Button>
        </div>
      </div>

      {/* Body -------------------------------------------------------------- */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="mx-auto max-w-3xl">
          <QuestionDetailView question={question} hideActions />
        </div>
      </ScrollArea>

      {/* Dialogs ----------------------------------------------------------- */}
      <QuestionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        question={question}
      />
      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title={deleting ? `删除题目「${deleting.title}」？` : "确认删除？"}
        description="此操作不可撤销，删除后页面将返回题库。"
        onConfirm={() => {
          if (deleting) {
            deleteQuestion(deleting.id);
            setDeleting(null);
            navigate("/library");
          }
        }}
      />
    </div>
  );
}
