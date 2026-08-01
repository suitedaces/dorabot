export function canReuseAccessTokenAfterRefreshFailure(
  expiresAt: number,
  refreshRejected: boolean,
  forceRefresh = false,
  now = Date.now(),
): boolean {
  return !forceRefresh && !refreshRejected && now < expiresAt;
}
