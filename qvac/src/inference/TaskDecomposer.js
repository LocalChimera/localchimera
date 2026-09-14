import { PromptTemplate } from '@langchain/core/prompts';

export class TaskDecomposer {
  constructor(config = {}) {
    this.config = config;
    this.started = false;
    this.llm = null;
    this.prompt = PromptTemplate.fromTemplate(
      'Break down the following task into {count} sub-tasks:\n{task}\n\nSub-tasks (JSON array):'
    );
  }

  initialize({ llm }) {
    this.llm = llm;
  }

  async start() { this.started = true; }
  async stop() { this.started = false; }

  async decompose(task, count = 3) {
    if (!this.llm) return [{ description: task, order: 0 }];
    const formatted = await this.prompt.format({ task, count });
    const result = await this.llm.invoke(formatted);
    try {
      return JSON.parse(result.content || result);
    } catch {
      return [{ description: task, order: 0 }];
    }
  }

  getStats() {
    return { started: this.started, hasLLM: !!this.llm };
  }
}
