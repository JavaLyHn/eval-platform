import { BarChart3, ChevronsLeft, ClipboardCheck, Eye, FileText } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useQAStore } from "@/hooks/use-qa-store";
import { cn } from "@/lib/utils";
import type { RightTab } from "@/types";

/** 右栏折叠态:仿左栏折叠 rail —— 右缘 w-12 竖条,顶部「展开」+ tab 图标(点=展开并切到该 tab)。 */
export function QuestionRail() {
  const { rightTab, setRightTab, setRightPanelCollapsed, previewFile } = useQAStore();
  const open = (tab: RightTab) => {
    setRightTab(tab);
    setRightPanelCollapsed(false);
  };
  const item =
    "inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground";

  const tabs: { tab: RightTab; label: string; icon: typeof FileText }[] = [
    { tab: "current", label: "题目", icon: FileText },
    { tab: "evaluation", label: "打分", icon: ClipboardCheck },
    { tab: "results", label: "结果", icon: BarChart3 },
    ...(previewFile
      ? [{ tab: "preview" as RightTab, label: "预览", icon: Eye }]
      : []),
  ];

  return (
    <aside className="flex h-full w-12 shrink-0 flex-col items-center gap-1 border-l border-border bg-surface/40 py-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setRightPanelCollapsed(false)}
            aria-label="展开面板"
            className={item}
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">展开「题目 / 打分 / 结果」面板</TooltipContent>
      </Tooltip>

      <div className="my-1 h-px w-6 bg-border" />

      {tabs.map(({ tab, label, icon: Icon }) => (
        <Tooltip key={tab}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => open(tab)}
              aria-label={label}
              className={cn(item, rightTab === tab && "bg-secondary text-accent")}
            >
              <Icon className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">{label}</TooltipContent>
        </Tooltip>
      ))}
    </aside>
  );
}
