import { promises as fsp } from 'fs';
import path from 'path';
import winston from 'winston';

/**
 * AuditLogger — structured JSON-Lines audit log for model lifecycle and
 * inference performance. Uses winston (MIT) for logging with daily rotation.
 */
export class AuditLogger {
  constructor(config = {}) {
    this.baseDir = config.auditDir || path.join(process.cwd(), 'data', 'audit');
    this.maxLinesPerFile = config.maxLinesPerFile || 10000;
    this._buffer = [];
    this._flushTimer = null;
    this._flushIntervalMs = config.flushIntervalMs || 1000;
    this._linesInCurrentFile = 0;
    this._currentDate = this._today();

    this._logger = winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      transports: [
        new winston.transports.File({
          filename: path.join(this.baseDir, `${this._currentDate}.jsonl`),
          options: { flags: 'a' },
        }),
      ],
    });

    this._startFlushTimer();
  }

  _today() {
    return new Date().toISOString().split('T')[0];
  }

  _filePath() {
    return path.join(this.baseDir, `${this._currentDate}.jsonl`);
  }

  async _ensureDir() {
    await fsp.mkdir(this.baseDir, { recursive: true });
  }

  _startFlushTimer() {
    this._flushTimer = setInterval(() => this.flush(), this._flushIntervalMs);
    this._flushTimer.unref?.();
  }

  stop() {
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
    return this.flush();
  }

  async flush() {
    if (this._buffer.length === 0) return;
    const batch = this._buffer.splice(0, this._buffer.length);

    const today = this._today();
    if (today !== this._currentDate || this._linesInCurrentFile >= this.maxLinesPerFile) {
      this._currentDate = today;
      this._linesInCurrentFile = 0;
      this._logger = winston.createLogger({
        level: 'info',
        format: winston.format.json(),
        transports: [
          new winston.transports.File({
            filename: path.join(this.baseDir, `${this._currentDate}.jsonl`),
            options: { flags: 'a' },
          }),
        ],
      });
    }

    for (const event of batch) {
      this._logger.info(event.type, event);
    }
    this._linesInCurrentFile += batch.length;
  }

  _emit(event) {
    event.ts = Date.now();
    this._buffer.push(event);
  }

  modelLoad({ modelId, durationMs, source = 'qvac-sdk' }) {
    this._emit({ type: 'modelLoad', modelId, durationMs, source });
  }

  modelUnload({ modelId, source = 'qvac-sdk' }) {
    this._emit({ type: 'modelUnload', modelId, source });
  }

  inference({ prompt, outputTokens, durationMs, ttftMs = 0, modelId, source = 'qvac-sdk', routeId = '' }) {
    const tokensPerSec = durationMs > 0 ? (outputTokens / (durationMs / 1000)) : 0;
    const promptPreview = typeof prompt === 'string' ? prompt.slice(0, 200) : '';
    this._emit({
      type: 'inference',
      prompt: promptPreview,
      outputTokens,
      durationMs,
      ttftMs,
      tokensPerSec: Math.round(tokensPerSec * 100) / 100,
      modelId,
      source,
      routeId
    });
  }

  embedding({ textCount, dimension, durationMs, modelId }) {
    this._emit({ type: 'embedding', textCount, dimension, durationMs, modelId });
  }

  ragIngest({ docCount, workspace, durationMs, modelId }) {
    this._emit({ type: 'ragIngest', docCount, workspace, durationMs, modelId });
  }

  ragSearch({ query, topK, matchCount, durationMs, modelId }) {
    this._emit({
      type: 'ragSearch',
      query: typeof query === 'string' ? query.slice(0, 200) : '',
      topK,
      matchCount,
      durationMs,
      modelId
    });
  }

  proofOfInference({ routeId, merkleRoot, chainIndex }) {
    this._emit({ type: 'proofOfInference', routeId, merkleRoot, chainIndex });
  }

  voiceTranscribe({ audioPath, durationMs, transcriptLength }) {
    this._emit({ type: 'voiceTranscribe', audioPath, durationMs, transcriptLength });
  }

  agentLoop({ query, rounds, toolCalls, citations }) {
    this._emit({
      type: 'agentLoop',
      query: typeof query === 'string' ? query.slice(0, 200) : '',
      rounds,
      toolCalls: toolCalls || 0,
      citations: citations || 0,
    });
  }

  contentVerify({ hash, valid }) {
    this._emit({ type: 'contentVerify', hash: hash?.slice(0, 16), valid });
  }

  tokenSettle({ routeId, amount, txHash }) {
    this._emit({ type: 'tokenSettle', routeId, amount, txHash });
  }
}
