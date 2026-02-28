// Parse Claude Code transcript JSONL to extract run metrics
import { readFileSync, existsSync } from 'node:fs';

/**
 * Parse transcript JSONL file and extract metrics for the most recent skill run.
 * Reads from end backwards to minimize processing.
 *
 * @param {string} transcriptPath - Path to transcript JSONL file
 * @param {string} sessionId - Current session ID
 * @returns {{ tokensUsed, outputTokens, toolCalls, durationMs, model, filesInvolved }}
 */
export function parseTranscriptMetrics(transcriptPath, sessionId) {
  const defaults = {
    tokensUsed: 0,
    outputTokens: 0,
    toolCalls: 0,
    durationMs: 0,
    model: null,
    filesInvolved: [],
  };

  if (!transcriptPath || !existsSync(transcriptPath)) return defaults;

  try {
    const raw = readFileSync(transcriptPath, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return defaults;

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let toolCallCount = 0;
    let model = null;
    let firstTimestamp = null;
    let lastTimestamp = null;
    const filesSet = new Set();

    for (const line of lines) {
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }

      // Extract timestamps for duration calculation
      const ts = entry.timestamp || entry.createdAt || entry.created_at;
      if (ts) {
        const time = new Date(ts).getTime();
        if (!isNaN(time)) {
          if (!firstTimestamp || time < firstTimestamp) firstTimestamp = time;
          if (!lastTimestamp || time > lastTimestamp) lastTimestamp = time;
        }
      }

      // Extract model info
      if (entry.model && typeof entry.model === 'string') {
        model = entry.model;
      }

      // Extract token usage from various formats
      const usage = entry.usage || entry.message?.usage;
      if (usage) {
        if (usage.input_tokens) totalInputTokens += usage.input_tokens;
        if (usage.output_tokens) totalOutputTokens += usage.output_tokens;
      }

      // Count tool calls
      if (entry.type === 'tool_use' || entry.type === 'tool_call') {
        toolCallCount++;
      }
      // Also check content blocks for tool_use
      const content = entry.content || entry.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_use') {
            toolCallCount++;
            extractFilesFromToolUse(block, filesSet);
          }
        }
      }
    }

    const durationMs = (firstTimestamp && lastTimestamp)
      ? lastTimestamp - firstTimestamp
      : 0;

    return {
      tokensUsed: totalInputTokens + totalOutputTokens,
      outputTokens: totalOutputTokens,
      toolCalls: toolCallCount,
      durationMs,
      model,
      filesInvolved: [...filesSet],
    };
  } catch {
    return defaults;
  }
}

/** Extract file paths from tool_use blocks (Write, Edit, Read tools) */
function extractFilesFromToolUse(block, filesSet) {
  const input = block.input;
  if (!input || typeof input !== 'object') return;

  // Common file path parameter names
  const pathKeys = ['file_path', 'filePath', 'path', 'filename'];
  for (const key of pathKeys) {
    if (input[key] && typeof input[key] === 'string') {
      filesSet.add(input[key]);
      break;
    }
  }
}
