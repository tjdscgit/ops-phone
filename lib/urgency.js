// Urgency derivation — the four-state model that drives every status pill:
// overdue · due today · on track · quiet.
//
// A port of @roseberry-ops/shared/src/urgency.ts. The rule that matters most:
// NEVER author a summary count; derive it, so a domain pill can never
// disagree with a card inside it.

export const URGENCY_LABEL = { over: 'Overdue', due: 'Due today', ok: 'On track', quiet: 'Quiet' };

// One object's urgency from its own counts.
export function urgencyFromCounts(c) {
  if (c.overdue > 0) return 'over';
  if ((c.dueToday ?? 0) > 0 || c.targetNear) return 'due';
  if (c.open === 0 && c.waiting === 0) return 'quiet';
  return 'ok';
}

// Content pill state. Content has no "overdue task" concept — its urgency is
// its publish target (for my-move work) plus the editor-aging signal.
export function contentUrgency(c) {
  if (c.holder === 'me' && c.target != null && c.target < c.today) return 'over';
  if (c.myMoveDue || (c.holder === 'editor' && c.days != null && c.days >= 7)) return 'due';
  return 'ok';
}

// The my-move verb for content held by me. Lowercase; callers capitalise.
export function moveVerb(status, type, unpublishedShorts) {
  switch (status) {
    case 'outline':
      return type === 'article' || type === 'newsletter' ? 'write it' : 'outline done — film it';
    case 'filming': return 'finish filming';
    case 'editing': return 'finish the edit';
    case 'derivatives_pending':
      return unpublishedShorts > 0 ? `harvest ${unpublishedShorts} shorts` : 'harvest shorts';
    default: return null;
  }
}

// A parent's urgency, computed so it can NEVER read calmer than a child.
export function parentUrgency(own, children) {
  if (own.overdue > 0 || children.includes('over')) return 'over';
  if ((own.dueToday ?? 0) > 0 || children.includes('due')) return 'due';
  if (own.open === 0 && own.waiting === 0 && children.length === 0) return 'quiet';
  return 'ok';
}
