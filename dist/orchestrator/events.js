export const EVENT_TYPES = [
    'voyage-started',
    'voyage-completed',
    'voyage-interrupted',
    'waypoint-started',
    'waypoint-iteration',
    'waypoint-awaiting-approval',
    'waypoint-committed',
    'waypoint-rolled-back',
    'waypoint-failed',
    'assistant-message',
    'tool-call-started',
    'tool-call-completed',
    'verify-started',
    'verify-completed',
    // Brain state + self-evolution
    'brain-state-changed',
    'voyage-idle',
    'dream-completed',
    'curiosity-completed',
    'backlog-item-added',
    'memory-consolidated',
    // Recovery intervention
    'recovery-intervention',
    // Self-monitor (continuous self-awareness during wakeful execution)
    'self-monitor',
    // Protocol-signal misuse (hard gate refused tool calls on a CONVERSATIONAL-DONE turn)
    'misused-signal',
];
//# sourceMappingURL=events.js.map