// payloads copied from real runs: codex 0.169 account/rateLimits/updated, claude cli 2.1.325 rate_limit_event
import assert from 'node:assert/strict';
import { claudeUsageFromRateLimitInfo, codexUsageFromSnapshot } from '../src/providers/usage.js';

const codex = codexUsageFromSnapshot({
  limitId: 'codex', limitName: null, normalModelSlug: null,
  primary: { usedPercent: 74, windowDurationMins: 10080, resetsAt: 1795295703 },
  secondary: null,
  credits: { hasCredits: false, unlimited: false, balance: null },
  individualLimit: null, spendControlReached: null,
  planType: 'self_serve_business_prolite', rateLimitReachedType: null,
});
assert.deepEqual(codex?.windows, [{ label: '7d', usedPercent: 74, resetsAt: 1795295703000 }]);
assert.equal(codex?.plan, 'self_serve_business_prolite');
assert.equal(codexUsageFromSnapshot({ primary: { usedPercent: 3, windowDurationMins: 300 } })?.windows[0].label, '5h');
assert.equal(codexUsageFromSnapshot(null), null);

const future = Math.floor(Date.now() / 1000) + 3600;
const info = {
  status: 'allowed', resetsAt: future, rateLimitType: 'seven_day', overageStatus: 'rejected',
  overageDisabledReason: 'out_of_credits', isUsingOverage: false,
  unifiedWindows: { seven_day: { utilization: 0.17, resetsAt: future, status: 'allowed' } },
};
const claude = claudeUsageFromRateLimitInfo(info, null);
assert.deepEqual(claude?.windows, [{ label: '7d', usedPercent: 17, resetsAt: future * 1000 }]);

// a later event with only the 5h window keeps the 7d one; expired windows drop out
const merged = claudeUsageFromRateLimitInfo({ unifiedWindows: { five_hour: { utilization: 0.5, resetsAt: future } } }, claude);
assert.deepEqual(merged?.windows.map(w => [w.label, w.usedPercent]), [['7d', 17], ['5h', 50]]);
const expired = claudeUsageFromRateLimitInfo({ unifiedWindows: { five_hour: { utilization: 0.9, resetsAt: 1 } } }, null);
assert.deepEqual(expired?.windows, []);
assert.equal(claudeUsageFromRateLimitInfo({ status: 'allowed' }, null), null);

console.log('provider usage: passed');
