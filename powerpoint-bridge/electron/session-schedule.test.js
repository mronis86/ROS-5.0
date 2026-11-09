const {
  planSession,
  sessionIsActive,
  clampLiveHours,
  nextLocalMidnight,
} = require('./session-schedule');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assert failed');
}

{
  const now = new Date(2026, 10, 8, 10, 0, 0);
  const plan = planSession({ mode: 'testing', now });
  assert(plan.ok, 'testing ok');
  assert(plan.endsAt.getTime() === now.getTime() + 2 * 3600 * 1000, 'testing 2h');
}

{
  const now = new Date(2026, 10, 8, 22, 0, 0); // 10pm
  const plan = planSession({ mode: 'live', hours: 6, now });
  assert(plan.ok, 'live ok');
  assert(plan.endsAt.getTime() === nextLocalMidnight(now).getTime(), 'live caps at midnight');
}

{
  const now = new Date(2026, 10, 8, 10, 0, 0);
  const plan = planSession({ mode: 'live', hours: 2, now });
  assert(plan.ok && plan.endsAt.getTime() === now.getTime() + 2 * 3600 * 1000, 'live short');
}

{
  const mid = new Date(2026, 10, 8, 12, 0, 0);
  const plan = planSession({ mode: 'everyday', now: mid });
  assert(plan.ok, 'everyday midday');
  assert(plan.endsAt.getHours() === 21, 'everyday ends 9pm');
  assert(!planSession({ mode: 'everyday', now: new Date(2026, 10, 8, 6, 0, 0) }).ok, 'before 7');
  assert(!planSession({ mode: 'everyday', now: new Date(2026, 10, 8, 21, 0, 0) }).ok, 'at/after 9');
}

assert(clampLiveHours(0) === 1 && clampLiveHours(99) === 24, 'hours clamp');
assert(sessionIsActive(new Date(Date.now() + 1000)), 'active');
assert(!sessionIsActive(new Date(Date.now() - 1000)), 'expired');

console.log('session-schedule.test.js OK');
