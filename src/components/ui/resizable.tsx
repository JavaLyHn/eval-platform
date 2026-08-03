import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type PanelGroupProps,
  type PanelProps,
  type PanelResizeHandleProps,
} from "react-resizable-panels";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Thin shadcn-style wrappers around react-resizable-panels.
 * Vertical drag bar with a hover/focus highlight and an optional grip handle.
 */

export function ResizablePanelGroup({
  className,
  ...props
}: PanelGroupProps) {
  return (
    <PanelGroup
      className={cn(
        "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
        className,
      )}
      {...props}
    />
  );
}

export function ResizablePanel(props: PanelProps) {
  return <Panel {...props} />;
}

interface HandleProps extends PanelResizeHandleProps {
  withHandle?: boolean;
}

export function ResizableHandle({
  className,
  withHandle,
  ...props
}: HandleProps) {
  return (
    <PanelResizeHandle
      className={cn(
        // 4px wide hit zone, but only 1px of visible color so the chrome stays slim
        "group relative flex w-px shrink-0 items-center justify-center bg-border",
        "transition-colors hover:bg-foreground/30 data-[resize-handle-active]:bg-foreground/50",
        "after:absolute after:inset-y-0 after:-left-1.5 after:-right-1.5 after:content-['']",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full",
        "data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:-top-1.5 data-[panel-group-direction=vertical]:after:-bottom-1.5 data-[panel-group-direction=vertical]:after:right-0",
        className,
      )}
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-7 w-3 items-center justify-center rounded-sm border border-border bg-card opacity-0 transition-opacity group-hover:opacity-100 data-[resize-handle-active]:opacity-100">
          <GripVertical className="h-2.5 w-2.5 text-muted-foreground" />
        </div>
      )}
    </PanelResizeHandle>
  );
}
