import { describe, it, expect } from "vitest";
import { goalValidator } from "./goalValidator.js";
import { validateGoal } from "./goal-validator.js";

// ---------------------------------------------------------------------------
// goalValidator (boolean) — greetings
// ---------------------------------------------------------------------------
describe("goalValidator — greetings (rejected)", () => {
  it("rejects plain English greetings", () => {
    expect(goalValidator("hi")).toBe(false);
    expect(goalValidator("hello")).toBe(false);
    expect(goalValidator("hey")).toBe(false);
    expect(goalValidator("yo")).toBe(false);
    expect(goalValidator("sup")).toBe(false);
    expect(goalValidator("howdy")).toBe(false);
    expect(goalValidator("greetings")).toBe(false);
  });

  it("rejects CJK greetings", () => {
    expect(goalValidator("你好")).toBe(false);
    expect(goalValidator("嗨")).toBe(false);
    expect(goalValidator("哈喽")).toBe(false);
  });

  it("rejects closings and thanks", () => {
    expect(goalValidator("thanks")).toBe(false);
    expect(goalValidator("thank you")).toBe(false);
    expect(goalValidator("thx")).toBe(false);
    expect(goalValidator("ty")).toBe(false);
    expect(goalValidator("bye")).toBe(false);
    expect(goalValidator("goodbye")).toBe(false);
    expect(goalValidator("see ya")).toBe(false);
    expect(goalValidator("cya")).toBe(false);
    expect(goalValidator("再见")).toBe(false);
    expect(goalValidator("谢谢")).toBe(false);
  });

  it("rejects greetings with trailing whitespace", () => {
    expect(goalValidator("  hello  ")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(goalValidator("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// goalValidator — questions / identity (rejected)
// ---------------------------------------------------------------------------
describe("goalValidator — questions without file path (rejected)", () => {
  it("rejects identity questions", () => {
    expect(goalValidator("who are you")).toBe(false);
    expect(goalValidator("what are you")).toBe(false);
    expect(goalValidator("what's your name")).toBe(false);
    expect(goalValidator("what is your name")).toBe(false);
    expect(goalValidator("你是谁")).toBe(false);
    expect(goalValidator("你叫什么")).toBe(false);
  });

  it("rejects off-topic questions", () => {
    expect(goalValidator("what's the weather")).toBe(false);
    expect(goalValidator("tell me a joke")).toBe(false);
    expect(goalValidator("how are you")).toBe(false);
    expect(goalValidator("what's up")).toBe(false);
    expect(goalValidator("whats up")).toBe(false);
  });

  it("rejects questions that lack a file path even if they sound technical", () => {
    // No file extension or src/ prefix → rejected
    expect(goalValidator("how does the parser work")).toBe(false);
    expect(goalValidator("explain the architecture")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// goalValidator — valid coding goals (accepted)
// ---------------------------------------------------------------------------
describe("goalValidator — valid coding goals (accepted)", () => {
  it("accepts goals naming a .ts file", () => {
    expect(goalValidator("add a helper to src/utils.ts")).toBe(true);
    expect(goalValidator("fix the bug in parser.ts")).toBe(true);
  });

  it("accepts goals naming a .js file", () => {
    expect(goalValidator("update config.js")).toBe(true);
    expect(goalValidator("refactor index.js to use ESM")).toBe(true);
  });

  it("accepts goals naming a .py file", () => {
    expect(goalValidator("add type hints to main.py")).toBe(true);
    expect(goalValidator("fix the import in utils.py")).toBe(true);
  });

  it("accepts goals with a src/ path prefix", () => {
    expect(goalValidator("add error handling to src/core/engine")).toBe(true);
    expect(goalValidator("rename src/lib/old to src/lib/new")).toBe(true);
  });

  it("accepts mixed goals — greeting + file path", () => {
    expect(goalValidator("hello, please update src/config.js")).toBe(true);
    expect(goalValidator("hey can you fix src/app.ts")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateGoal (rich result) — greetings (rejected)
// ---------------------------------------------------------------------------
describe("validateGoal — greetings (rejected)", () => {
  it("rejects plain English greetings", () => {
    expect(validateGoal("hi")).toEqual({
      valid: false,
      reason: expect.stringContaining("conversational"),
    });
    expect(validateGoal("hello")).toEqual({
      valid: false,
      reason: expect.stringContaining("conversational"),
    });
    expect(validateGoal("hey")).toEqual({
      valid: false,
      reason: expect.stringContaining("conversational"),
    });
    expect(validateGoal("howdy")).toEqual({
      valid: false,
      reason: expect.stringContaining("conversational"),
    });
  });

  it("rejects CJK greetings", () => {
    expect(validateGoal("你好")).toEqual({
      valid: false,
      reason: expect.stringContaining("conversational"),
    });
    expect(validateGoal("嗨")).toEqual({
      valid: false,
      reason: expect.stringContaining("conversational"),
    });
  });

  it("rejects closings and thanks", () => {
    expect(validateGoal("thanks")).toEqual({
      valid: false,
      reason: expect.stringContaining("conversational"),
    });
    expect(validateGoal("thank you")).toEqual({
      valid: false,
      reason: expect.stringContaining("conversational"),
    });
    expect(validateGoal("bye")).toEqual({
      valid: false,
      reason: expect.stringContaining("conversational"),
    });
    expect(validateGoal("再见")).toEqual({
      valid: false,
      reason: expect.stringContaining("conversational"),
    });
    expect(validateGoal("谢谢")).toEqual({
      valid: false,
      reason: expect.stringContaining("conversational"),
    });
  });

  it("rejects empty string", () => {
    expect(validateGoal("")).toEqual({
      valid: false,
      reason: expect.stringContaining("empty"),
    });
  });
});

// ---------------------------------------------------------------------------
// validateGoal — informational questions (rejected)
// ---------------------------------------------------------------------------
describe("validateGoal — informational questions (rejected)", () => {
  it("rejects English informational questions", () => {
    expect(validateGoal("what can you do")).toEqual({
      valid: false,
      reason: expect.stringContaining("informational question"),
    });
    expect(validateGoal("how does the parser work")).toEqual({
      valid: false,
      reason: expect.stringContaining("informational question"),
    });
    expect(validateGoal("why does the build fail")).toEqual({
      valid: false,
      reason: expect.stringContaining("informational question"),
    });
    expect(validateGoal("explain the architecture")).toEqual({
      valid: false,
      reason: expect.stringContaining("informational question"),
    });
    expect(validateGoal("what is a monorepo")).toEqual({
      valid: false,
      reason: expect.stringContaining("informational question"),
    });
    expect(validateGoal("how long will this take")).toEqual({
      valid: false,
      reason: expect.stringContaining("informational question"),
    });
  });

  it("rejects CJK informational questions", () => {
    expect(validateGoal("你能做什么")).toEqual({
      valid: false,
      reason: expect.stringContaining("informational question"),
    });
    expect(validateGoal("为什么构建失败了")).toEqual({
      valid: false,
      reason: expect.stringContaining("informational question"),
    });
    expect(validateGoal("怎么做单元测试")).toEqual({
      valid: false,
      reason: expect.stringContaining("informational question"),
    });
    expect(validateGoal("请问这个项目是什么")).toEqual({
      valid: false,
      reason: expect.stringContaining("informational question"),
    });
  });
});

// ---------------------------------------------------------------------------
// validateGoal — valid coding goals (accepted)
// ---------------------------------------------------------------------------
describe("validateGoal — valid coding goals (accepted)", () => {
  it("accepts goals with a clear action verb", () => {
    expect(validateGoal("add a login page")).toEqual({ valid: true });
    expect(validateGoal("fix the parsing bug")).toEqual({ valid: true });
    expect(validateGoal("refactor the auth module")).toEqual({ valid: true });
    expect(validateGoal("remove unused imports")).toEqual({ valid: true });
    expect(validateGoal("update the README")).toEqual({ valid: true });
    expect(validateGoal("create a new component")).toEqual({ valid: true });
    expect(validateGoal("delete the deprecated endpoint")).toEqual({ valid: true });
    expect(validateGoal("rename the config file")).toEqual({ valid: true });
    expect(validateGoal("move the utility to lib")).toEqual({ valid: true });
    expect(validateGoal("optimize the query performance")).toEqual({ valid: true });
    expect(validateGoal("test the error handler")).toEqual({ valid: true });
    expect(validateGoal("lint all files")).toEqual({ valid: true });
    expect(validateGoal("format the codebase")).toEqual({ valid: true });
    expect(validateGoal("migrate to ESM")).toEqual({ valid: true });
    expect(validateGoal("port the CLI to Rust")).toEqual({ valid: true });
    expect(validateGoal("debug the memory leak")).toEqual({ valid: true });
    expect(validateGoal("generate API types")).toEqual({ valid: true });
    expect(validateGoal("scaffold the plugin system")).toEqual({ valid: true });
    expect(validateGoal("configure the linter")).toEqual({ valid: true });
    expect(validateGoal("cleanup dead code")).toEqual({ valid: true });
    expect(validateGoal("dedupe shared utilities")).toEqual({ valid: true });
  });

  it("accepts CJK goals with action verbs", () => {
    expect(validateGoal("添加登录页面")).toEqual({ valid: true });
    expect(validateGoal("修复解析器中的 bug")).toEqual({ valid: true });
    expect(validateGoal("重构认证模块")).toEqual({ valid: true });
    expect(validateGoal("删除未使用的导入")).toEqual({ valid: true });
    expect(validateGoal("更新配置文件")).toEqual({ valid: true });
    expect(validateGoal("创建新组件")).toEqual({ valid: true });
    expect(validateGoal("构建项目")).toEqual({ valid: true });
    expect(validateGoal("测试错误处理")).toEqual({ valid: true });
    expect(validateGoal("配置 ESLint")).toEqual({ valid: true });
  });

  it("accepts mixed goals — greeting + action verb", () => {
    expect(validateGoal("hi, can you fix the bug?")).toEqual({ valid: true });
    expect(validateGoal("hello please add a login page")).toEqual({ valid: true });
    expect(validateGoal("你好，请修复这个 bug")).toEqual({ valid: true });
  });

  it("accepts mixed goals — question + action verb", () => {
    expect(validateGoal("how do I add a file?")).toEqual({ valid: true });
    expect(validateGoal("can you explain how to fix the parser?")).toEqual({ valid: true });
    expect(validateGoal("如何添加一个新的 API 端点")).toEqual({ valid: true });
  });

  it("accepts goals without a file path when an action verb is present", () => {
    // validateGoal uses action-verb guard, not file-path requirement
    expect(validateGoal("add error handling to the server")).toEqual({ valid: true });
    expect(validateGoal("refactor the database layer")).toEqual({ valid: true });
  });
});
