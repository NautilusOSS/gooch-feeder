/**
 * Classify price-oracle / TEAL errors so we can avoid noisy alerts
 * (e.g. Discord) when the failure is expected.
 */

/**
 * True when the Gooch price oracle rejected the transaction because the
 * new price is not far enough from the stored price (TEAL assert).
 *
 * Typical node error includes:
 * `logic eval error: assert failed pc=...` and `opcodes=b/; b<=; assert`
 */
export function isOraclePriceChangeInsufficientError(message: string): boolean {
  if (!message) {
    return false;
  }

  // Normalized: match opcode fingerprint from algod (spacing may vary slightly)
  if (/opcodes\s*=\s*b\/\s*;\s*b<=\s*;\s*assert/i.test(message)) {
    return true;
  }

  // Compact form without spaces around `=`
  if (message.includes('opcodes=b/; b<=; assert')) {
    return true;
  }

  return false;
}
