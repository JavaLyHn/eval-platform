import { describe, it, expect } from "vitest";
import { newapiProvider } from "./newapi";

describe("newapiProvider", () => {
  it("是 llm 类、id/label 正确", () => {
    expect(newapiProvider.id).toBe("newapi");
    expect(newapiProvider.label).toBe("NewAPI");
    expect(newapiProvider.kind).toBe("llm");
  });

  it("暴露 baseUrl / apiKey / model 三个必填项", () => {
    const required = newapiProvider.configSchema
      .filter((f) => f.required)
      .map((f) => f.key)
      .sort();
    expect(required).toEqual(["apiKey", "baseUrl", "model"]);
  });

  it("createClient 复用 OpenAI 兼容客户端,modelVersion = 配置的模型", () => {
    const client = newapiProvider.createClient({
      baseUrl: "https://gw.example.com",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
    });
    expect(client.modelVersion).toBe("gpt-4o-mini");
    expect(typeof client.ping).toBe("function");
    expect(typeof client.sendMessage).toBe("function");
  });
});
