export interface Service {
  name: string;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  isHealthy(): Promise<boolean>;
}

export interface FeederData {
  id: string;
  timestamp: Date;
  data: Record<string, any>;
  source: string;
}

export interface FeederConfig {
  interval: number; // milliseconds
  enabled: boolean;
  retries: number;
  timeout: number;
}

export interface FeederStatus {
  isRunning: boolean;
  lastRun?: Date;
  nextRun?: Date;
  errorCount: number;
  successCount: number;
}

// Price Feeder Configuration Types
export interface PriceFeederConfig {
  id: string; // Format: network-poolid-marketid
  method: 'fetch' | 'post' | 'fetch-and-post';
  networkId: string;
  poolId: string;
  marketId: string;
  assetSymbol: string;
  enabled: boolean;
  interval: number; // milliseconds
  timeout: number;
  retries: number;
  priority: number; // Higher number = higher priority
  source: {
    type: 'api' | 'rpc' | 'websocket' | 'contract';
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    params?: Record<string, any>;
    contractAddress?: string;
    functionName?: string;
    abi?: any[];
  };
  destination: {
    type: 'price-oracle' | 'database' | 'api';
    contractAddress?: string;
    functionName?: string;
    marketId?: string; // tokenId for price oracle contract
    abi?: any[];
    endpoint?: string;
    headers?: Record<string, string>;
  };
  validation: {
    minPrice?: number;
    maxPrice?: number;
    maxPriceChange?: number; // percentage
    requiredFields?: string[];
  };
  fallback?: {
    enabled: boolean;
    sources: PriceFeederConfig[];
  };
}

export interface PriceData {
  symbol: string;
  price: number;
  timestamp: Date;
  source: string;
  networkId: string;
  poolId: string;
  marketId: string;
  confidence?: number; // 0-1
  volume24h?: number;
  change24h?: number;
}

export interface PriceFeedResult {
  success: boolean;
  data?: PriceData;
  error?: string;
  timestamp: Date;
  duration: number; // milliseconds
  retryCount: number;
}

export interface FeederMetrics {
  feederId: string;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  averageResponseTime: number;
  lastSuccess?: Date;
  lastFailure?: Date;
  consecutiveFailures: number;
  uptime: number; // percentage
}

// Network Configuration Types
export interface NetworkConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  wsUrl: string;
  explorerUrl: string;
  enabled: boolean;
  timeout: number;
  retries: number;
  // Optional overrides for algod configuration
  algod?: {
    url?: string; // Override rpcUrl for algod client
    port?: number; // Override default port (default: 443)
    token?: string; // API token for algod (if required)
  };
}

// Enhanced Network Configuration Types for detailed network configs
export interface TokenConfig {
  contractId: string;
  poolId: string;
  nTokenId: string;
  decimals: number;
  name: string;
  symbol: string;
  logoPath: string;
  tokenStandard: string;
  isStoken?: boolean;
}

export interface ContractConfig {
  lendingPools: string[];
  priceOracle: string;
  marketController: string;
  sToken: string;
}

export interface PreFiParameters {
  collateral_factor: number;
  liquidation_threshold: number;
  reserve_factor: number;
  borrow_rate_base: number;
  slope: number;
  liquidation_bonus: number;
  close_factor: number;
  max_borrow_caps: {
    stablecoins: string;
    majors: string;
    volatile: string;
  };
}

export interface AssetPrice {
  symbol: string;
  name: string;
  price: number;
  timestamp: number;
  lastUpdated: string;
}

export interface DetailedNetworkConfig {
  metadata: {
    network: string;
    exportDate: string;
    contractId: string;
    isDeployed: boolean;
    hasPriceOracleRole: boolean;
  };
  networkConfig: {
    networkId: string;
    walletNetworkId: string;
    name: string;
    networkType: string;
    rpcUrl: string;
    rpcPort: number;
    rpcToken: string;
    indexerUrl: string;
    explorerUrl: string;
    faucetUrl: string;
    contracts: ContractConfig;
    tokens: Record<string, TokenConfig>;
    gasStation: Record<string, string>;
    preFiParameters: PreFiParameters;
  };
  supportedAssets: Array<{
    id: string;
    symbol: string;
    name: string;
    decimals: number;
  }>;
  contractState: {
    appId: number;
    creator: string;
    globalState: Array<{
      key: string;
      value: {
        bytes: string;
        type: number;
        uint: number;
      };
    }>;
    localState: any[];
  };
  assetPrices: Record<string, AssetPrice>;
  priceFeedStatus: Record<string, any>;
}

export interface NetworkConfigs {
  networks: Record<string, NetworkConfig>;
  detailedNetworks: Record<string, DetailedNetworkConfig>;
  defaultNetwork: string;
  fallbackNetworks: string[];
  globalSettings: {
    maxConcurrentRequests: number;
    requestDelay: number;
    healthCheckInterval: number;
    circuitBreakerThreshold: number;
    circuitBreakerTimeout: number;
  };
}

export interface NetworkHealth {
  networkId: string;
  isHealthy: boolean;
  lastCheck: Date;
  responseTime?: number;
  errorCount: number;
  lastError?: string;
}
