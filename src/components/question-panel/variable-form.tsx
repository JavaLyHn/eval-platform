import { Braces } from "lucide-react";
import { useMemo } from "react";
import { Input } from "@/components/ui/input";

export function extractVariables(prompt: string): string[] {
  const re = /\{\{\s*([\w.-]+)\s*\}\}/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) out.add(m[1]);
  return Array.from(out);
}

export function substituteVariables(
  prompt: string,
  values: Record<string, string>,
): string {
  return prompt.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, name) =>
    values[name] !== undefined && values[name] !== ""
      ? values[name]
      : `{{${name}}}`,
  );
}

interface VariableFormProps {
  variables: string[];
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}

export function VariableForm({
  variables,
  values,
  onChange,
}: VariableFormProps) {
  const filledCount = useMemo(
    () => variables.filter((v) => values[v]?.trim()).length,
    [variables, values],
  );

  if (variables.length === 0) return null;

  return (
    <section className="rounded-lg border border-accent/30 bg-accent/5">
      <div className="flex items-center gap-2 border-b border-accent/20 px-3 py-2 text-xs">
        <Braces className="h-3.5 w-3.5 text-accent" />
        <span className="font-medium text-foreground">模板变量</span>
        <span className="font-mono text-[10.5px] text-muted-foreground">
          {filledCount} / {variables.length} 已填
        </span>
      </div>
      <div className="space-y-2 p-3">
        {variables.map((name) => (
          <label
            key={name}
            className="grid grid-cols-[100px_1fr] items-center gap-2 text-[12px]"
          >
            <span className="font-mono text-muted-foreground">
              {`{{${name}}}`}
            </span>
            <Input
              value={values[name] ?? ""}
              onChange={(e) =>
                onChange({ ...values, [name]: e.target.value })
              }
              placeholder={`填入 ${name} 的值`}
              className="h-7 text-[12.5px]"
            />
          </label>
        ))}
      </div>
    </section>
  );
}
