import { MainnetOracle } from '@folks-finance/algorand-sdk';

/**
 * Folks oracle global-state value layout matches
 * {@link https://github.com/Folks-Finance/algorand-js-sdk Folks algorand-js-sdk}
 * `parseOracleValue` (first uint64 = price, second = timestamp). On current
 * mainnet oracle `1040271396`, the price uint64 is USD per 1 ASA unit with **8**
 * fractional digits (verified against ALGO / USDC slots vs market).
 *
 * Uses indexer HTTP JSON directly so this works with algosdk v2 (Folks SDK
 * `getOraclePrices` + Indexer responses expect different field naming).
 */

const FOLKS_ORACLE_PRICE_USD_DIVISOR = 1e8;

interface IndexerGlobalStateEntry {
  key: string;
  value: { bytes?: string; uint?: number; type?: number };
}

function assetIdToOracleStateKeyBase64(assetId: number): string {
  const hex = assetId.toString(16).padStart(16, '0');
  return Buffer.from(hex, 'hex').toString('base64');
}

function parseOracleValueBase64(base64Value: string): { price: bigint; timestamp: bigint } {
  const value = Buffer.from(base64Value, 'base64').toString('hex');
  const price = BigInt(`0x${value.slice(0, 16)}`);
  const timestamp = BigInt(`0x${value.slice(16, 32)}`);
  return { price, timestamp };
}

export function defaultFolksMainnetOracle0AppId(): number {
  return MainnetOracle.oracle0AppId;
}

export async function fetchFolksOracleUsdPrice(params: {
  indexerBaseUrl: string;
  oracleAppId: number;
  priceAssetId: number;
  timeoutMs: number;
}): Promise<{ usd: number; onChainTimestampSec: bigint; sourceLabel: string }> {
  const base = params.indexerBaseUrl.replace(/\/$/, '');
  const url = `${base}/v2/applications/${params.oracleAppId}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(params.timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Folks oracle indexer HTTP ${response.status} ${response.statusText} (${url})`);
  }
  const body: unknown = await response.json();
  const gs = (body as { application?: { params?: { 'global-state'?: IndexerGlobalStateEntry[] } } })
    ?.application?.params?.['global-state'];
  if (!Array.isArray(gs)) {
    throw new Error(`Folks oracle: missing application.params['global-state'] (${url})`);
  }
  const wantKey = assetIdToOracleStateKeyBase64(params.priceAssetId);
  const entry = gs.find((e) => e.key === wantKey);
  const b64 = entry?.value?.bytes;
  if (!b64) {
    throw new Error(
      `Folks oracle: no price bytes for asset ${params.priceAssetId} on oracle app ${params.oracleAppId}`
    );
  }
  const { price, timestamp } = parseOracleValueBase64(b64);
  if (price <= BigInt(0)) {
    throw new Error(`Folks oracle: non-positive price for asset ${params.priceAssetId}`);
  }
  const usd = Number(price) / FOLKS_ORACLE_PRICE_USD_DIVISOR;
  return {
    usd,
    onChainTimestampSec: timestamp,
    sourceLabel: `folks-oracle:${params.oracleAppId}:${params.priceAssetId}`,
  };
}
