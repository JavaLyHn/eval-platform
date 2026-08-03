import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Opt {
  value: string;
  label: string;
}

export function MultiSelectFilter({
  allLabel,
  options,
  selected,
  onChange,
  className,
}: {
  allLabel: string;
  options: Opt[];
  selected: string[];
  onChange: (next: string[]) => void;
  className?: string;
}) {
  const selLabels = options.filter((o) => selected.includes(o.value)).map((o) => o.label);
  const text = selLabels.length === 0 ? allLabel : selLabels.join("、");
  const toggle = (v: string) =>
    onChange(
      selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v],
    );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-8 justify-between gap-1 text-xs font-normal", className)}
        >
          <span className="truncate">{text}</span>
          {selLabels.length > 0 && (
            <span className="ml-0.5 shrink-0 rounded bg-secondary px-1 text-[10px] tabular-nums text-foreground/70">
              {selLabels.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[200px] p-1">
        <ul className="space-y-0.5">
          {options.map((o) => {
            const checked = selected.includes(o.value);
            return (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => toggle(o.value)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors hover:bg-secondary",
                    checked && "text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border",
                      checked
                        ? "border-foreground bg-foreground text-background"
                        : "border-border",
                    )}
                  >
                    {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className="flex-1 truncate text-left">{o.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {selected.length > 0 && (
          <div className="mt-1 border-t border-border pt-1">
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full rounded-sm px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              清除
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
