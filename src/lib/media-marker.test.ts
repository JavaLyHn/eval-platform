import { describe, expect, it } from "vitest";
import { stripMediaMarkers } from "./media-marker";

describe("stripMediaMarkers", () => {
  it("去掉末尾的 MEDIA: 绝对路径行(含前面的空行)", () => {
    const text =
      "README 文件已生成。\n\nMEDIA:/home/ec2-user/.gateway/profiles/dex/sandboxes/docker/default/workspace/outbound/README.md";
    expect(stripMediaMarkers(text)).toBe("README 文件已生成。");
  });

  it("保留 MEDIA 行前的正文多行", () => {
    const text =
      "PDF 文件已生成完成!\n文件名为: welcome.pdf\n\nMEDIA:/home/ec2-user/.gateway/.../welcome.pdf";
    expect(stripMediaMarkers(text)).toBe(
      "PDF 文件已生成完成!\n文件名为: welcome.pdf",
    );
  });

  it("去掉多条 MEDIA 行并折叠空行", () => {
    const text = "生成了两个文件:\n\nMEDIA:/a/b.md\nMEDIA:/a/c.pdf\n\n完成。";
    expect(stripMediaMarkers(text)).toBe("生成了两个文件:\n\n完成。");
  });

  it("MEDIA: URL 形式也去掉", () => {
    const text = "见附件。\nMEDIA:https://x/report.pdf";
    expect(stripMediaMarkers(text)).toBe("见附件。");
  });

  it("行内(非整行)出现 MEDIA: 不误删", () => {
    const text = "路径是 MEDIA:/a/b 这样的格式";
    expect(stripMediaMarkers(text)).toBe(text);
  });

  it("正常以 MEDIA: 起头但后面不是路径/URL 的句子不误删", () => {
    const text = "MEDIA: 是我们的媒体团队缩写";
    expect(stripMediaMarkers(text)).toBe(text);
  });

  it("无 MEDIA 标记 → 原样返回", () => {
    const text = "普通回复,没有任何标记。";
    expect(stripMediaMarkers(text)).toBe(text);
  });

  it("前导缩进 / 冒号后空格 / 行尾 \\r 也能匹配", () => {
    const text = "好了。\n  MEDIA:  /a/b.md  \r";
    expect(stripMediaMarkers(text)).toBe("好了。");
  });

  it("空串 → 原样", () => {
    expect(stripMediaMarkers("")).toBe("");
  });
});
