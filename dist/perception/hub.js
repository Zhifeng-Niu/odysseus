/**
 * PerceptionHub — aggregates channels and drains events into the backlog.
 *
 * Why the backlog and not a direct LLM call: perception must not bypass
 * the waypoint loop (same "one path" contract as user input). The backlog
 * carries dedup gates, priority, and provenance — repeated perceptions of
 * an unchanged world do not re-enqueue.
 */
import { enqueueBacklog } from '../cerebellum/backlog-enqueue.js';
export function createPerceptionHub(options) {
    const channels = options.channels;
    const gate = options.gate;
    return {
        collect(now) {
            const events = [];
            for (const channel of channels) {
                events.push(...channel.collect(now));
            }
            return events;
        },
        async drainToBacklog(rootDir, now) {
            const events = this.collect(now);
            let enqueued = 0;
            for (const event of events) {
                if (gate) {
                    try {
                        if (!(await gate(event)))
                            continue;
                    }
                    catch {
                        continue; // fail-closed: a broken gate blocks, never crashes
                    }
                }
                await enqueueBacklog(rootDir, `[perception:${event.channel}] ${event.summary}`, 'perception');
                enqueued += 1;
            }
            return enqueued;
        },
    };
}
//# sourceMappingURL=hub.js.map