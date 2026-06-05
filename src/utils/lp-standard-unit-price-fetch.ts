import { fetchFolksOracleUsdPrice } from './folks-oracle-price-fetch';

export type LpStandardUnitProtocol = 'tinyman-v2';

interface IndexerLocalStateEntry {
  key: string;
  value: { bytes?: string; uint?: number; type?: number };
}

interface UnderlyingPriceSource {
  assetId: number | string;
  decimals: number;
  type: 'api' | 'folks-sdk';
  url: string;
  params?: Record<string, unknown>;
}

export interface LpStandardUnitPriceParams {
  indexerBaseUrl: string;
  lpAssetId: number;
  timeoutMs: number;
  protocol: LpStandardUnitProtocol;
  /** App id whose local state on the pool account holds reserve/supply data. Required for tinyman-v2. */
  poolAppId?: number;
  underlyingPrices: UnderlyingPriceSource[];
}

interface LpPoolState {
  asset1Id: number;
  asset2Id: number;
  asset1Reserves: bigint;
  asset2Reserves: bigint;
  issuedPoolTokens: bigint;
  poolTokenAssetId: number;
}

function decodeLocalStateKey(base64Key: string): string {
  return Buffer.from(base64Key, 'base64').toString('utf8');
}

function readUintFromLocalState(
  entries: IndexerLocalStateEntry[],
  keyName: string
): bigint {
  const entry = entries.find((e) => decodeLocalStateKey(e.key) === keyName);
  const value = entry?.value?.uint;
  if (value === undefined || value === null) {
    throw new Error(`LP pool: missing local state key "${keyName}"`);
  }
  return BigInt(value);
}

async function fetchIndexerJson<T>(url: string, timeoutMs: number): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`Indexer HTTP ${response.status} ${response.statusText} (${url})`);
  }
  return (await response.json()) as T;
}

async function fetchLpAssetPoolAddress(
  indexerBaseUrl: string,
  lpAssetId: number,
  timeoutMs: number
): Promise<{ poolAddress: string; lpDecimals: number }> {
  const base = indexerBaseUrl.replace(/\/$/, '');
  const url = `${base}/v2/assets/${lpAssetId}`;
  const body = await fetchIndexerJson<{
    asset?: { params?: { reserve?: string; decimals?: number } };
  }>(url, timeoutMs);

  const reserve = body.asset?.params?.reserve;
  const lpDecimals = body.asset?.params?.decimals;
  if (!reserve) {
    throw new Error(`LP asset ${lpAssetId}: missing reserve (pool account) address`);
  }
  if (lpDecimals === undefined || lpDecimals === null) {
    throw new Error(`LP asset ${lpAssetId}: missing decimals`);
  }

  return { poolAddress: reserve, lpDecimals };
}

async function fetchPoolAccountLocalState(
  indexerBaseUrl: string,
  poolAddress: string,
  poolAppId: number,
  timeoutMs: number
): Promise<IndexerLocalStateEntry[]> {
  const base = indexerBaseUrl.replace(/\/$/, '');
  const url = `${base}/v2/accounts/${poolAddress}`;
  const body = await fetchIndexerJson<{
    account?: { 'apps-local-state'?: Array<{ id: number; 'key-value'?: IndexerLocalStateEntry[] }> };
  }>(url, timeoutMs);

  const localStates = body.account?.['apps-local-state'] ?? [];
  const poolLocalState = localStates.find((state) => state.id === poolAppId);
  const entries = poolLocalState?.['key-value'];
  if (!entries?.length) {
    throw new Error(
      `LP pool ${poolAddress}: no local state for app ${poolAppId}`
    );
  }

  return entries;
}

async function readTinymanV2PoolState(
  indexerBaseUrl: string,
  poolAddress: string,
  poolAppId: number,
  timeoutMs: number
): Promise<LpPoolState> {
  const entries = await fetchPoolAccountLocalState(
    indexerBaseUrl,
    poolAddress,
    poolAppId,
    timeoutMs
  );

  return {
    asset1Id: Number(readUintFromLocalState(entries, 'asset_1_id')),
    asset2Id: Number(readUintFromLocalState(entries, 'asset_2_id')),
    asset1Reserves: readUintFromLocalState(entries, 'asset_1_reserves'),
    asset2Reserves: readUintFromLocalState(entries, 'asset_2_reserves'),
    issuedPoolTokens: readUintFromLocalState(entries, 'issued_pool_tokens'),
    poolTokenAssetId: Number(readUintFromLocalState(entries, 'pool_token_asset_id')),
  };
}

async function readPoolState(
  params: LpStandardUnitPriceParams,
  poolAddress: string
): Promise<LpPoolState> {
  if (!params.poolAppId || params.poolAppId <= 0) {
    throw new Error(`source.params.poolAppId is required for protocol "${params.protocol}"`);
  }

  switch (params.protocol) {
    case 'tinyman-v2':
      return readTinymanV2PoolState(
        params.indexerBaseUrl,
        poolAddress,
        params.poolAppId,
        params.timeoutMs
      );
    default:
      throw new Error(`Unsupported lp-standard-unit protocol: ${params.protocol}`);
  }
}

function parsePriceApiJsonBody(bodyText: string, sourceUrl: string): unknown {
  try {
    return bodyText ? JSON.parse(bodyText) : null;
  } catch {
    const preview = bodyText.replace(/\s+/g, ' ').trim().slice(0, 280);
    throw new Error(`Price API returned non-JSON (${sourceUrl}). Body preview: ${preview}.`);
  }
}

async function fetchUsdPriceFromApiSource(
  source: UnderlyingPriceSource,
  timeoutMs: number
): Promise<number> {
  const url = new URL(source.url);
  if (source.params) {
    Object.entries(source.params).forEach(([key, value]) => {
      url.searchParams.append(key, String(value));
    });
  }

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Underlying price API HTTP ${response.status} ${response.statusText} (${url})`);
  }

  const bodyText = await response.text();
  const data = parsePriceApiJsonBody(bodyText, url.toString());

  if (url.toString().includes('perawallet.app')) {
    const results = Array.isArray((data as { results?: unknown[] })?.results)
      ? (data as { results: Array<Record<string, unknown>> }).results
      : [];
    const targetAssetId = String(source.assetId);
    const assetEntry = results.find((asset) => String(asset.asset_id) === targetAssetId);
    const rawUsdValue =
      assetEntry?.usd_value ?? assetEntry?.usd_price ?? assetEntry?.price_usd ?? assetEntry?.price;
    const price =
      typeof rawUsdValue === 'string' ? parseFloat(rawUsdValue) : Number(rawUsdValue);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Invalid Pera USD price for asset ${source.assetId}: ${rawUsdValue}`);
    }
    return price;
  }

  if (url.toString().includes('coingecko.com')) {
    const coinId = String(source.params?.ids ?? '').split(',')[0].trim();
    const coinData = (data as Record<string, Record<string, unknown>>)[coinId];
    const rawUsd = coinData?.usd;
    const price = typeof rawUsd === 'string' ? parseFloat(rawUsd) : Number(rawUsd);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Invalid CoinGecko USD price for ${coinId}: ${rawUsd}`);
    }
    return price;
  }

  throw new Error(`Unsupported underlying price API URL: ${source.url}`);
}

async function fetchUnderlyingUsdPrice(
  source: UnderlyingPriceSource,
  timeoutMs: number
): Promise<number> {
  if (source.type === 'folks-sdk') {
    const priceAssetId = Number(source.params?.priceAssetId ?? source.assetId);
    const oracleAppIdRaw = source.params?.oracleAppId;
    const oracleAppId =
      oracleAppIdRaw !== undefined && oracleAppIdRaw !== null && String(oracleAppIdRaw).trim() !== ''
        ? Number(oracleAppIdRaw)
        : undefined;
    const assetDecimalsRaw = source.params?.assetDecimals;
    const assetDecimals =
      assetDecimalsRaw !== undefined &&
      assetDecimalsRaw !== null &&
      String(assetDecimalsRaw).trim() !== ''
        ? Number(assetDecimalsRaw)
        : source.decimals;

    const { usd } = await fetchFolksOracleUsdPrice({
      indexerBaseUrl: source.url,
      oracleAppId: oracleAppId ?? 1040271396,
      priceAssetId,
      timeoutMs,
      assetDecimals,
    });
    return usd;
  }

  return fetchUsdPriceFromApiSource(source, timeoutMs);
}

function toStandardUnits(amount: bigint, decimals: number): number {
  return Number(amount) / Math.pow(10, decimals);
}

/**
 * Derives USD value of one LP standard unit (1.0 LP token) from on-chain pool
 * reserves and configured underlying asset USD prices.
 *
 * Formula:
 *   (reserve1 * price1 + reserve2 * price2) / issuedPoolTokens
 * with reserves and LP supply converted from micro-units to standard units.
 */
export async function fetchLpStandardUnitUsdPrice(
  params: LpStandardUnitPriceParams
): Promise<{ usd: number; sourceLabel: string }> {
  const { poolAddress, lpDecimals } = await fetchLpAssetPoolAddress(
    params.indexerBaseUrl,
    params.lpAssetId,
    params.timeoutMs
  );
  const poolState = await readPoolState(params, poolAddress);

  if (poolState.poolTokenAssetId !== params.lpAssetId) {
    throw new Error(
      `LP pool token mismatch: expected LP asset ${params.lpAssetId}, got ${poolState.poolTokenAssetId}`
    );
  }
  if (poolState.issuedPoolTokens <= BigInt(0)) {
    throw new Error(`LP pool ${poolAddress}: issued pool tokens must be positive`);
  }

  const priceByAssetId = new Map<number, { usd: number; decimals: number }>();
  for (const source of params.underlyingPrices) {
    const assetId = Number(source.assetId);
    const usd = await fetchUnderlyingUsdPrice(source, params.timeoutMs);
    priceByAssetId.set(assetId, { usd, decimals: source.decimals });
  }

  const assetIds = [poolState.asset1Id, poolState.asset2Id];
  const reserves = [poolState.asset1Reserves, poolState.asset2Reserves];
  let poolTvlUsd = 0;

  for (let i = 0; i < assetIds.length; i += 1) {
    const assetId = assetIds[i];
    const priceEntry = priceByAssetId.get(assetId);
    if (!priceEntry) {
      throw new Error(
        `Missing underlying USD price config for LP pool asset ${assetId} (leg ${i + 1})`
      );
    }
    const reserveStandardUnits = toStandardUnits(reserves[i], priceEntry.decimals);
    poolTvlUsd += reserveStandardUnits * priceEntry.usd;
  }

  const lpSupplyStandardUnits = toStandardUnits(poolState.issuedPoolTokens, lpDecimals);
  const usd = poolTvlUsd / lpSupplyStandardUnits;
  if (!Number.isFinite(usd) || usd <= 0) {
    throw new Error(`Computed non-positive LP standard-unit USD price for asset ${params.lpAssetId}`);
  }

  return {
    usd,
    sourceLabel: `lp-standard-unit:${params.protocol}:${params.lpAssetId}:${poolAddress}`,
  };
}
