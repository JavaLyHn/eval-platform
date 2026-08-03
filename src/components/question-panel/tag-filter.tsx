import { Check, Tag as TagIcon, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface TagFilterProps {
  allTags: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}

export function TagFilter({ allTags, selected, onChange }: TagFilterProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () =>
      allTags.filter((t) =>
        t.toLowerCase().includes(query.toLowerCase()),
      ),
    [allTags, query],
  );

  const toggle = (tag: string) => {
    if (selected.includes(tag)) {
      onChange(selected.filter((t) => t !== tag));
    } else {
      onChange([...selected, tag]);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2.5 text-xs"
        >
          <TagIcon className="h-3 w-3" />
          标签
          {selected.length > 0 && (
            <Badge variant="default" className="h-4 px-1 text-[10px] tabular-nums">
              {selected.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="border-b border-border p-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索标签..."
            className="h-7 text-xs"
          />
        </div>
        <ScrollArea className="max-h-64">
          <ul className="p-1">
            {filtered.length === 0 && (
              <li className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                没有匹配的标签
              </li>
            )}
            {filtered.map((tag) => {
              const checked = selected.includes(tag);
              return (
                <li key={tag}>
                  <button
                    type="button"
                    onClick={() => toggle(tag)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors hover:bg-secondary",
                      checked && "text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border",
                        checked
                          ? "border-foreground bg-foreground text-background"
                          : "border-border",
                      )}
                    >
                      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                    <span className="flex-1 truncate text-left">{tag}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
        {selected.length > 0 && (
          <div className="flex items-center justify-between border-t border-border p-2">
            <span className="text-[11px] text-muted-foreground">
              已选 {selected.length} 个
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px]"
              onClick={() => onChange([])}
            >
              <X className="h-3 w-3" /> 清除
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
