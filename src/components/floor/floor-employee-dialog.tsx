import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FloorChecklistPanel } from "./floor-checklist-panel";
import { FloorReport } from "./floor-report";

export function FloorEmployeeDialog({
  employeeId,
  employeeName,
  initialTab = "checklist",
  open,
  onOpenChange,
}: {
  employeeId: string;
  employeeName: string;
  initialTab?: "checklist" | "report";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [tab, setTab] = useState<"checklist" | "report">(initialTab);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] w-[min(720px,94vw)] flex-col">
        <DialogHeader>
          <DialogTitle className="text-[14px]">
            {employeeName} · 保下限
          </DialogTitle>
        </DialogHeader>
        <div className="flex gap-1">
          {(["checklist", "report"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[12px]",
                tab === t
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "checklist" ? "下限清单" : "保下限报告"}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">
          {tab === "checklist" ? (
            <FloorChecklistPanel employeeId={employeeId} />
          ) : (
            <FloorReport employeeId={employeeId} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
