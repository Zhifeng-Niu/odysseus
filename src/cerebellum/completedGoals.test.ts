import { describe, it, expect, beforeEach } from "vitest";
import {
  isCompleted,
  markCompleted,
  clearCompletedGoals,
  getCompletedGoals,
} from "./completedGoals.js";

beforeEach(() => {
  clearCompletedGoals();
});

// ---------------------------------------------------------------------------
// markCompleted
// ---------------------------------------------------------------------------
describe("markCompleted", () => {
  it("stores a goal and makes it retrievable", () => {
    markCompleted("add login page", "done");
    const goals = getCompletedGoals();
    expect(goals).toHaveLength(1);
    expect(goals[0]!.description).toBe("add login page");
    expect(goals[0]!.outcome).toBe("done");
    expect(goals[0]!.completedAt).toBeTypeOf("number");
  });

  it("overwrites a previous entry for the same description", () => {
    markCompleted("fix bug", "first attempt");
    markCompleted("fix bug", "second attempt");
    const goals = getCompletedGoals();
    expect(goals).toHaveLength(1);
    expect(goals[0]!.outcome).toBe("second attempt");
  });
});

// ---------------------------------------------------------------------------
// isCompleted – empty map
// ---------------------------------------------------------------------------
describe("isCompleted – empty map", () => {
  it("returns false when no goals have been recorded", () => {
    expect(isCompleted("anything")).toBe(false);
  });

  it("returns false for an empty string when the map is empty", () => {
    expect(isCompleted("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isCompleted – exact match
// ---------------------------------------------------------------------------
describe("isCompleted – exact match", () => {
  it("returns true for an exact description that was marked completed", () => {
    markCompleted("add login page", "done");
    expect(isCompleted("add login page")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isCompleted – substring matching
// ---------------------------------------------------------------------------
describe("isCompleted – substring matching", () => {
  beforeEach(() => {
    // Seed a long description so every test in this block has data.
    markCompleted(
      "implement user authentication with OAuth2 and JWT tokens",
      "auth module complete",
    );
  });

  it("matches when the query is a substring of a stored description", () => {
    expect(isCompleted("OAuth2")).toBe(true);
    expect(isCompleted("JWT tokens")).toBe(true);
    expect(isCompleted("authentication")).toBe(true);
  });

  it("matches when a stored description is a substring of the query", () => {
    expect(
      isCompleted(
        "implement user authentication with OAuth2 and JWT tokens for the mobile app",
      ),
    ).toBe(true);
  });

  it("does not match when there is no substring relationship", () => {
    expect(isCompleted("delete database")).toBe(false);
    expect(isCompleted("payment gateway")).toBe(false);
  });

  it("matches a single character that appears in a stored description", () => {
    expect(isCompleted("O")).toBe(true);
  });

  it("does not match a single character absent from all stored descriptions", () => {
    expect(isCompleted("Z")).toBe(false);
  });

  it("produces a false positive when an unrelated query is a substring of a stored description", () => {
    // "user" is a substring of the seeded
    // "implement user authentication with OAuth2 and JWT tokens", so the
    // substring matcher reports it as completed even though "user" is a
    // semantically different (and far less specific) goal. This documents
    // the known false-positive weakness of substring matching.
    expect(isCompleted("user")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isCompleted – case sensitivity
// ---------------------------------------------------------------------------
describe("isCompleted – case sensitivity", () => {
  beforeEach(() => {
    markCompleted("Fix the Login Bug", "patched");
  });

  it("returns true for an exact case match", () => {
    expect(isCompleted("Fix the Login Bug")).toBe(true);
  });

  it("returns false when case differs (query has different casing)", () => {
    expect(isCompleted("fix the login bug")).toBe(false);
    expect(isCompleted("FIX THE LOGIN BUG")).toBe(false);
    expect(isCompleted("Fix The Login Bug")).toBe(false);
  });

  it("returns false for a case-different substring", () => {
    expect(isCompleted("login")).toBe(false);
    expect(isCompleted("LOGIN")).toBe(false);
  });

  it("returns true for a case-exact substring", () => {
    expect(isCompleted("Login")).toBe(true);
    expect(isCompleted("Fix")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isCompleted – empty-string edge cases
// ---------------------------------------------------------------------------
describe("isCompleted – empty string handling", () => {
  it("returns false for empty string even when goals exist", () => {
    markCompleted("something", "done");
    expect(isCompleted("")).toBe(false);
  });

  it("returns false for whitespace-only string", () => {
    markCompleted("something", "done");
    expect(isCompleted("   ")).toBe(false);
  });
});
