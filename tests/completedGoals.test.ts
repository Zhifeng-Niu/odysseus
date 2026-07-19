import { describe, test, expect, beforeEach } from "vitest";
import {
  isCompleted,
  markCompleted,
  clearCompletedGoals,
  getCompletedGoals,
  type CompletedGoal,
} from "../src/cerebellum/completedGoals.js";

beforeEach(() => {
  clearCompletedGoals();
});

// ---------------------------------------------------------------------------
// CompletedGoal map (getCompletedGoals / markCompleted / clearCompletedGoals)
// ---------------------------------------------------------------------------
describe("CompletedGoal map", () => {
  test("getCompletedGoals returns an empty array when nothing is recorded", () => {
    expect(getCompletedGoals()).toEqual([]);
  });

  test("markCompleted stores an entry retrievable via getCompletedGoals", () => {
    markCompleted("add login page", "shipped");
    const goals = getCompletedGoals();
    expect(goals).toHaveLength(1);
    expect(goals[0]!.description).toBe("add login page");
    expect(goals[0]!.outcome).toBe("shipped");
  });

  test("stored entry conforms to the CompletedGoal shape", () => {
    markCompleted("refactor api", "ok");
    const goal: CompletedGoal = getCompletedGoals()[0]!;
    expect(goal).toEqual({
      description: "refactor api",
      outcome: "ok",
      completedAt: expect.any(Number),
    });
  });

  test("completedAt is set to a plausible epoch-millis timestamp", () => {
    const before = Date.now();
    markCompleted("task", "done");
    const after = Date.now();
    const ts = getCompletedGoals()[0]!.completedAt;
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  test("markCompleted overwrites a prior entry with the same description", () => {
    markCompleted("fix bug", "first attempt");
    markCompleted("fix bug", "second attempt");
    const goals = getCompletedGoals();
    expect(goals).toHaveLength(1);
    expect(goals[0]!.outcome).toBe("second attempt");
  });

  test("multiple distinct goals are all retained", () => {
    markCompleted("alpha", "a");
    markCompleted("beta", "b");
    markCompleted("gamma", "c");
    const goals = getCompletedGoals();
    expect(goals).toHaveLength(3);
    expect(goals.map((g) => g.description)).toEqual(["alpha", "beta", "gamma"]);
  });

  test("insertion order is preserved across calls", () => {
    markCompleted("first", "1");
    markCompleted("second", "2");
    markCompleted("third", "3");
    expect(getCompletedGoals().map((g) => g.description)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  test("clearCompletedGoals empties the map", () => {
    markCompleted("one", "1");
    markCompleted("two", "2");
    expect(getCompletedGoals()).toHaveLength(2);
    clearCompletedGoals();
    expect(getCompletedGoals()).toEqual([]);
    expect(isCompleted("one")).toBe(false);
  });

  test("clearCompletedGoals is a no-op on an empty map", () => {
    clearCompletedGoals();
    expect(getCompletedGoals()).toEqual([]);
  });

  test("an empty-string description is still stored as a key", () => {
    markCompleted("", "empty outcome");
    const goals = getCompletedGoals();
    expect(goals).toHaveLength(1);
    expect(goals[0]!.description).toBe("");
  });
});

// ---------------------------------------------------------------------------
// isCompleted — substring matching
// ---------------------------------------------------------------------------
describe("isCompleted substring matching", () => {
  test("returns false when the map is empty", () => {
    expect(isCompleted("anything")).toBe(false);
  });

  test("returns true for an exact match", () => {
    markCompleted("fix the login bug", "patched");
    expect(isCompleted("fix the login bug")).toBe(true);
  });

  test("returns true when the query is a substring of a stored description", () => {
    markCompleted("implement user authentication with OAuth2", "done");
    expect(isCompleted("authentication")).toBe(true);
    expect(isCompleted("OAuth2")).toBe(true);
    expect(isCompleted("user")).toBe(true);
  });

  test("returns true when a stored description is a substring of the query", () => {
    markCompleted("login bug", "patched");
    // "login bug" is contained within the longer query
    expect(isCompleted("fix the login bug on the homepage")).toBe(true);
  });

  test("returns false when there is no substring relationship", () => {
    markCompleted("fix the login bug", "patched");
    expect(isCompleted("update the readme")).toBe(false);
    expect(isCompleted("payment gateway")).toBe(false);
  });

  test("returns false for an empty string regardless of stored goals", () => {
    markCompleted("something", "done");
    expect(isCompleted("")).toBe(false);
  });

  test("returns false for an empty string when the map is empty", () => {
    expect(isCompleted("")).toBe(false);
  });

  test("returns false for a whitespace-only string", () => {
    markCompleted("something", "done");
    expect(isCompleted("   ")).toBe(false);
  });

  test("matches a single character that appears in a stored description", () => {
    markCompleted("OAuth2", "done");
    expect(isCompleted("O")).toBe(true);
    expect(isCompleted("2")).toBe(true);
  });

  test("does not match a single character absent from all stored descriptions", () => {
    markCompleted("OAuth2", "done");
    expect(isCompleted("Z")).toBe(false);
  });

  test("matches when a stored goal is a single character and a substring of the query", () => {
    markCompleted("x", "done");
    expect(isCompleted("the x factor")).toBe(true);
  });

  test("matches against any of several stored goals", () => {
    markCompleted("add feature X", "done");
    markCompleted("add feature Y", "done");
    expect(isCompleted("feature X")).toBe(true);
    expect(isCompleted("feature Y")).toBe(true);
    expect(isCompleted("feature Z")).toBe(false);
  });

  test("matching is case-sensitive (different casing does not match)", () => {
    markCompleted("Fix Login Bug", "patched");
    expect(isCompleted("fix login bug")).toBe(false);
    expect(isCompleted("FIX LOGIN BUG")).toBe(false);
    expect(isCompleted("Fix The Login Bug")).toBe(false);
  });

  test("matching is case-sensitive (case-exact substring matches)", () => {
    markCompleted("Fix Login Bug", "patched");
    expect(isCompleted("Login")).toBe(true);
    expect(isCompleted("Fix")).toBe(true);
    expect(isCompleted("Bug")).toBe(true);
  });

  test("matching is case-sensitive (case-different substring does not match)", () => {
    markCompleted("Fix Login Bug", "patched");
    expect(isCompleted("login")).toBe(false);
    expect(isCompleted("LOGIN")).toBe(false);
    expect(isCompleted("bug")).toBe(false);
  });

  test("the first matching stored key short-circuits to true", () => {
    markCompleted("alpha", "done");
    markCompleted("beta", "done");
    markCompleted("gamma", "done");
    expect(isCompleted("beta")).toBe(true);
  });

  test("a stored empty-string key matches any non-empty query", () => {
    // isCompleted short-circuits on an empty query (returns false), but a
    // stored empty key still satisfies `needle.includes(key)` for any
    // non-empty needle, since every string contains the empty string.
    markCompleted("", "empty outcome");
    expect(isCompleted("")).toBe(false);
    expect(isCompleted("nonempty")).toBe(true);
    expect(isCompleted("anything at all")).toBe(true);
  });
});
