// Regex-based user reaction classification — no LLM involved

const SATISFIED_RE = /^(thanks|thank you|ok|okay|good|great|perfect|nice|awesome|lgtm|looks good|well done|excellent|cool|neat|sweet|love it|that works|works great)\b/i;

const CORRECTION_RE = /\b(no[,.]?\s|nope|wrong|incorrect|fix\s|change\s?that|actually[,.]?\s|instead[,.]?\s|not what i|that's not|should be|shouldn't|don't|not right|mistake)\b/i;

const FOLLOW_UP_RE = /\b(also\s|what about|you forgot|forgot to|missing|add also|and also|one more|another thing|additionally|can you also|don't forget)\b/i;

// Time window: reactions within 30s of skill output are meaningful
const REACTION_WINDOW_MS = 30_000;

/**
 * Classify user's next message as a reaction to the previous skill run.
 *
 * @param {string} prompt - User's message text
 * @param {string|null} previousSkillName - Skill that just ran
 * @param {number} timeSinceLastRunMs - Ms since previous skill completed
 * @returns {'satisfied'|'correction'|'follow_up'|'retry'|'neutral'}
 */
export function classifyReaction(prompt, previousSkillName, timeSinceLastRunMs) {
  if (!prompt || typeof prompt !== 'string') return 'neutral';

  const trimmed = prompt.trim();

  // If too much time passed, classify as neutral (user moved on)
  if (timeSinceLastRunMs > REACTION_WINDOW_MS) return 'neutral';

  // Check for retry: user invokes same skill again
  // Escape skill name to prevent regex injection from metacharacters
  if (previousSkillName) {
    const escaped = previousSkillName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const retryRe = new RegExp(`^\\/${escaped}(\\s|$)`, 'i');
    if (retryRe.test(trimmed)) return 'retry';
  }

  // Check patterns in priority order
  if (CORRECTION_RE.test(trimmed)) return 'correction';
  if (FOLLOW_UP_RE.test(trimmed)) return 'follow_up';
  if (SATISFIED_RE.test(trimmed)) return 'satisfied';

  return 'neutral';
}

export { REACTION_WINDOW_MS };
