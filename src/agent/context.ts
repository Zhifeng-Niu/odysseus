import type { ChatMessage } from '../llm/provider.js';

export interface AgentContextInit {
  mission: string;
  initialMessages?: ChatMessage[];
}

export class AgentContext {
  private readonly mission: string;
  private readonly messagesRef: ChatMessage[];

  constructor(init: AgentContextInit) {
    this.mission = init.mission;
    this.messagesRef = init.initialMessages ? [...init.initialMessages] : [];
  }

  append(message: ChatMessage): void {
    this.messagesRef.push(message);
  }

  messages(): ChatMessage[] {
    return [...this.messagesRef];
  }

  getMission(): string {
    return this.mission;
  }
}
