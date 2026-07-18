import { describe, test, expect } from 'vitest';
import { createWaypoint } from '../../src/cerebellum/waypoint.js';

describe('createWaypoint', () => {
  test('creates a waypoint with defaults', () => {
    const wp = createWaypoint({ goal: 'add bash tool' });
    expect(wp.id).toMatch(/^wp_/);
    expect(wp.goal).toBe('add bash tool');
    expect(wp.strategy).toBe('engineer');
    expect(wp.status).toBe('pending');
    expect(wp.iterationsUsed).toBe(0);
    expect(wp.startedAt).toBeGreaterThan(0);
  });

  test('parent waypoint id is propagated', () => {
    const parent = createWaypoint({ goal: 'parent' });
    const child = createWaypoint({ goal: 'child', parentWaypointId: parent.id });
    expect(child.parentWaypointId).toBe(parent.id);
  });

  test('waypoint id is unique across calls', () => {
    const a = createWaypoint({ goal: 'a' });
    const b = createWaypoint({ goal: 'b' });
    expect(a.id).not.toBe(b.id);
  });
});
