import { describe, expect, it } from "vitest";
import { mdToHtml } from "./md-to-html";

describe("mdToHtml", () => {
  it("段落 + 加粗 + 斜体 + 行内代码", () => {
    const h = mdToHtml("我注意到 **12,000 USD**,但 *附件* 是 `14,000 USD`。");
    expect(h).toContain("<strong>12,000 USD</strong>");
    expect(h).toContain("<em>附件</em>");
    expect(h).toContain("<code>14,000 USD</code>");
    expect(h.startsWith("<p>")).toBe(true);
  });

  it("普通数字不会被误当行内代码", () => {
    const h = mdToHtml("这里有 5 个项目和 100 条记录。");
    expect(h).not.toContain("<code>");
    expect(h).toContain("5 个项目");
  });

  it("有序 / 无序列表", () => {
    expect(mdToHtml("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(mdToHtml("1. 金额确认\n2. 账户归属")).toBe(
      "<ol><li>金额确认</li><li>账户归属</li></ol>",
    );
  });

  it("标题 / 引用 / 分隔线", () => {
    expect(mdToHtml("## 标题")).toBe("<h2>标题</h2>");
    expect(mdToHtml("> 引用")).toBe("<blockquote>引用</blockquote>");
    expect(mdToHtml("---")).toBe("<hr>");
  });

  it("围栏代码块整体转义、不套行内格式", () => {
    const h = mdToHtml("```\n<a> **x**\n```");
    expect(h).toBe("<pre><code>&lt;a&gt; **x**</code></pre>");
  });

  it("转义 HTML,杜绝注入", () => {
    const h = mdToHtml("<script>alert(1)</script>");
    expect(h).toContain("&lt;script&gt;");
    expect(h).not.toContain("<script>");
  });

  it("链接仅允许 http(s)/mailto", () => {
    expect(mdToHtml("[x](https://a.com)")).toContain('href="https://a.com"');
    expect(mdToHtml("[x](javascript:alert(1))")).not.toContain("<a ");
  });

  it("表格", () => {
    const h = mdToHtml("| 指标 | 值 |\n| --- | --- |\n| 完成率 | 92% |");
    expect(h).toContain("<table>");
    expect(h).toContain("<th>指标</th>");
    expect(h).toContain("<td>完成率</td>");
  });

  it("空输入 → 空串", () => {
    expect(mdToHtml("")).toBe("");
    expect(mdToHtml("   \n  ")).toBe("");
  });
});
