/**
 * ClockChannel — temporal perception: prospective triggers by time of day.
 *
 * Fires once per configured time per day, driven by an injected `now`
 * (no timers — the hub's poller calls collect()). This is the perception
 * backbone for prospective memory: a daily check-in tick is when the agent
 * reviews its protected core's task stack against reality.
 */
import { generatePerceptionId } from './types.js';
export function createClockChannel(times) {
    // Keyed by `${YYYY-MM-DD}T${HH:MM}` so each configured time fires once
    // per day, regardless of how often collect() runs.
    const fired = new Set();
    return {
        channel: 'clock',
        times,
        collect(now) {
            const events = [];
            const day = now.toISOString().slice(0, 10);
            const minutesOfDay = now.getHours() * 60 + now.getMinutes();
            for (const time of times) {
                const triggerMinutes = parseHHMM(time);
                if (triggerMinutes === null)
                    continue;
                if (minutesOfDay < triggerMinutes)
                    continue; // not yet reached today
                const key = `${day}T${time}`;
                if (fired.has(key))
                    continue;
                fired.add(key);
                events.push({
                    id: generatePerceptionId(),
                    channel: 'clock',
                    kind: 'tick',
                    summary: `daily check-in at ${time} — review task stack vs reality`,
                    ts: now.getTime(),
                });
            }
            return events;
        },
    };
}
function parseHHMM(time) {
    const match = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!match)
        return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (Number.isNaN(hours) || Number.isNaN(minutes))
        return null;
    return hours * 60 + minutes;
}
//# sourceMappingURL=clock.js.map