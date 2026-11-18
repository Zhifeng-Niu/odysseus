/**
 * PerceptionHub — aggregates channels and drains events into the backlog.
 *
 * Why the backlog and not a direct LLM call: perception must not bypass
 * the waypoint loop (same "one path" contract as user input). The backlog
 * carries dedup gates, priority, and provenance — repeated perceptions of
 * an unchanged world do not re-enqueue.
 */

import { enqueueBacklog } from '../cerebellum/backlog-enqueue.js';
import type { PerceptionChannelAdapter, PerceptionEvent } from './types.js';

export interface PerceptionHubOptions {
  channels: readonly PerceptionChannelAdapter[];
}

export interface PerceptionHub {
  /** Aggregate events from all channels (stable channel order). */
  collect(now: Date): PerceptionEvent[];
  /**
   * Collect and enqueue each event as a backlog item with origin
   * 'perception'. Returns the number of events processed.
   */
  drainToBacklog(rootDir: string, now: Date): Promise<number>;
}

export function createPerceptionHub(options: PerceptionHubOptions): PerceptionHub {
  const channels = options.channels;

  return {
    collect(now: Date): PerceptionEvent[] {
      const events: PerceptionEvent[] = [];
      for (const channel of channels) {
        events.push(...channel.collect(now));
      }
      return events;
    },

    async drainToBacklog(rootDir: string, now: Date): Promise<number> {
      const events = this.collect(now);
      for (const event of events) {
        await enqueueBacklog(
          rootDir,
          `[perception:${event.channel}] ${event.summary}`,
          'perception'
        );
      }
      return events.length;
    },
  };
}
