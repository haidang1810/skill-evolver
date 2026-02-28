// Trend calculation utilities — compare metrics across time windows

/**
 * Calculate satisfaction rate from reactions array.
 * @param {{ reaction_type: string }[]} reactions
 * @returns {number} Percentage 0-100
 */
export function calcSatisfactionRate(reactions) {
  if (!reactions || reactions.length === 0) return 0;
  const satisfied = reactions.filter(r => r.reaction_type === 'satisfied').length;
  return Math.round((satisfied / reactions.length) * 100);
}

/**
 * Compare a metric between two time windows.
 * @param {number} current - Current period value
 * @param {number} previous - Previous period value
 * @returns {{ delta: number, pctChange: number, direction: 'up'|'down'|'stable' }}
 */
export function comparePeriods(current, previous) {
  const delta = current - previous;
  const pctChange = previous > 0
    ? Math.round(((current - previous) / previous) * 100)
    : 0;

  let direction = 'stable';
  if (Math.abs(pctChange) > 5) {
    direction = delta > 0 ? 'up' : 'down';
  }

  return { delta, pctChange, direction };
}

/**
 * Query two time windows of data for a skill and calculate trends.
 * @param {import('better-sqlite3').Database} db
 * @param {string} skillName
 * @returns {{ satisfaction, tokens, cancelRate, correctionRate } | null}
 */
export function calculateTrends(db, skillName) {
  const windows = [
    { key: 'curr', sql: "triggered_at >= datetime('now', '-14 days')" },
    { key: 'prev', sql: "triggered_at >= datetime('now', '-28 days') AND triggered_at < datetime('now', '-14 days')" },
  ];

  const data = {};
  for (const w of windows) {
    const row = db.prepare(`
      SELECT
        COUNT(sr.id) as runs,
        AVG(sr.tokens_used) as avg_tokens,
        SUM(CASE WHEN r.reaction_type = 'satisfied' THEN 1 ELSE 0 END) as satisfied,
        SUM(CASE WHEN r.reaction_type = 'correction' THEN 1 ELSE 0 END) as corrections,
        SUM(CASE WHEN r.reaction_type = 'cancel' THEN 1 ELSE 0 END) as cancels,
        COUNT(r.id) as total_reactions
      FROM skill_runs sr
      LEFT JOIN reactions r ON r.skill_run_id = sr.id
      WHERE sr.skill_name = ? AND sr.completed = 1 AND ${w.sql}
    `).get(skillName);
    data[w.key] = row;
  }

  if (!data.prev?.runs && !data.curr?.runs) return null;

  const satPrev = data.prev.total_reactions > 0
    ? (data.prev.satisfied / data.prev.total_reactions) * 100 : 0;
  const satCurr = data.curr.total_reactions > 0
    ? (data.curr.satisfied / data.curr.total_reactions) * 100 : 0;

  const cancelPrev = data.prev.total_reactions > 0
    ? (data.prev.cancels / data.prev.total_reactions) * 100 : 0;
  const cancelCurr = data.curr.total_reactions > 0
    ? (data.curr.cancels / data.curr.total_reactions) * 100 : 0;

  const corrPrev = data.prev.total_reactions > 0
    ? (data.prev.corrections / data.prev.total_reactions) * 100 : 0;
  const corrCurr = data.curr.total_reactions > 0
    ? (data.curr.corrections / data.curr.total_reactions) * 100 : 0;

  return {
    satisfaction: comparePeriods(Math.round(satCurr), Math.round(satPrev)),
    tokens: comparePeriods(Math.round(data.curr.avg_tokens || 0), Math.round(data.prev.avg_tokens || 0)),
    cancelRate: comparePeriods(Math.round(cancelCurr), Math.round(cancelPrev)),
    correctionRate: comparePeriods(Math.round(corrCurr), Math.round(corrPrev)),
    raw: { curr: data.curr, prev: data.prev },
  };
}
