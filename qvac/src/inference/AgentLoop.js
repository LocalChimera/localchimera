import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { Logger } from '../core/Logger.js';

export class AgentLoop {
  constructor(config = {}) {
    this.config = config;
    this.logger = new Logger('AgentLoop');
    this.executor = null;
    this.started = false;
  }

  initialize({ llm, tools = [] }) {
    this.llm = llm;
    this.tools = tools;
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', 'You are a helpful AI assistant. Use tools when appropriate.'],
      ['placeholder', '{chat_history}'],
      ['human', '{input}'],
      ['placeholder', '{agent_scratchpad}'],
    ]);
    this.executor = new AgentExecutor({
      agent: createToolCallingAgent({ llm, tools, prompt }),
      tools,
    });
  }

  async start() { this.started = true; }
  async stop() { this.started = false; }

  async run(input, context = {}) {
    if (!this.executor) throw new Error('AgentLoop not initialized — call initialize({ llm, tools })');
    return this.executor.invoke({ input, ...context });
  }

  getStatus() {
    return { started: this.started, hasExecutor: !!this.executor, toolCount: this.tools?.length || 0 };
  }
}
