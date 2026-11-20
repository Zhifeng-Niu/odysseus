export class AgentContext {
    mission;
    messagesRef;
    constructor(init) {
        this.mission = init.mission;
        this.messagesRef = init.initialMessages ? [...init.initialMessages] : [];
    }
    append(message) {
        this.messagesRef.push(message);
    }
    messages() {
        return [...this.messagesRef];
    }
    getMission() {
        return this.mission;
    }
}
//# sourceMappingURL=context.js.map