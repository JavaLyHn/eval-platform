import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText } from "lucide-react";

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQAStore } from "@/hooks/use-qa-store";
import { composeSkillReportMeta, defaultSkillReportTitle, type SkillReportConfig } from "@/lib/skill-report";
import type { SkillOptDoneFrame } from "@/lib/skillopt-client";

export function SaveSkillReportDialog({
  open,
  onOpenChange,
  frame,
  logs,
  config,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  frame: SkillOptDoneFrame;
  logs: string[];
  config: SkillReportConfig;
}) {
  const { addSkillReport } = useQAStore();
  const navigate = useNavigate();
  const meta = composeSkillReportMeta(config, frame.summary);
  const [title, setTitle] = useState(() => defaultSkillReportTitle(meta, new Date().toISOString()));
  useEffect(() => {
    if (open) setTitle(defaultSkillReportTitle(composeSkillReportMeta(config, frame.summary), new Date().toISOString()));
  }, [open, config, frame]);

  const save = () => {
    const id = addSkillReport({ title, meta, frame, logs });
    onOpenChange(false);
    navigate(`/skill-reports/${encodeURIComponent(id)}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-1.5">
            <FileText className="h-4 w-4" /> 保存为评测报告
          </DialogTitle>
          <DialogDescription>
            把这一轮 Skill 评测(配置 / 效果对比 / 优化过程 / 逐题)存成只读报告,进「评测报告」列表。
          </DialogDescription>
        </DialogHeader>
        <label className="block space-y-1.5">
          <span className="text-[12px] text-muted-foreground">报告标题</span>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="报告标题" />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={save} disabled={!title.trim()}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
