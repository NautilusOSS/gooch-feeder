/**
 * Classify price-oracle / TEAL errors so we can avoid noisy alerts
 * (e.g. Discord) when the failure is expected.
 */

/**
 * Program counter for the “price change too small” assert in the deployed oracle TEAL
 * (matches algod `assert failed pc=843` / `Details: ..., pc=843`).
 */
const ORACLE_PRICE_DELTA_ASSERT_PC = 843;

/**
 * True when the Gooch price oracle rejected the transaction because the
 * new price is not far enough from the stored price (TEAL assert).
 *
 * Typical node errors include:
 * - `opcodes=b/; b<=; assert` (dryrun-style detail)
 * - `TransactionPool.Remember: ... logic eval error: assert failed pc=843 ...`
 *   (mempool path omits opcode fingerprint; pc=843 is the reliable needle)
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

  // TransactionPool.Remember / submit path: assert at fixed PC, no opcodes line
  const assertAtPriceDeltaPc = new RegExp(`\\bpc\\s*=\\s*${ORACLE_PRICE_DELTA_ASSERT_PC}\\b`, 'i');
  if (/logic eval error:\s*assert failed/i.test(message) && assertAtPriceDeltaPc.test(message)) {
    return true;
  }

  return false;
}
