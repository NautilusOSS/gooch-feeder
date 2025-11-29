import { Logger, ErrorContext } from '../utils/logger';
import { ApiErrorHelper } from '../utils/api-error-helper';
import { PriceFeederConfig, PriceData, PriceFeedResult } from '../types';

export class PriceLookupService {
  private logger: Logger;
  private requestQueue: Array<() => Promise<void>> = [];
  private isProcessingQueue: boolean = false;
  private lastRequestTime: number = 0;
  private readonly minRequestInterval: number = 2000; // 2 seconds between requests

  constructor() {
    this.logger = new Logger('PriceLookupService');
  }

  public async fetchPrice(config: PriceFeederConfig): Promise<PriceFeedResult> {
    const startTime = Date.now();
    let retryCount = 0;
    
    try {
      this.logger.debug(`Fetching price for ${config.assetSymbol} from ${config.source.type}`);
      
      let priceData: PriceData;
      
      switch (config.source.type) {
        case 'api':
          priceData = await this.fetchFromAPI(config);
          break;
        case 'rpc':
          priceData = await this.fetchFromRPC(config);
          break;
        case 'websocket':
          priceData = await this.fetchFromWebSocket(config);
          break;
        case 'contract':
          priceData = await this.fetchFromContract(config);
          break;
        default:
          throw new Error(`Unsupported source type: ${config.source.type}`);
      }

      // Validate the price data
      this.validatePriceData(priceData, config);

      const duration = Date.now() - startTime;
      
      this.logger.info(`Successfully fetched price for ${config.assetSymbol}: $${priceData.price}`);
      
      return {
        success: true,
        data: priceData,
        timestamp: new Date(),
        duration,
        retryCount
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      this.logger.error(`Failed to fetch price for ${config.assetSymbol}:`, errorMessage);
      
      return {
        success: false,
        error: errorMessage,
        timestamp: new Date(),
        duration,
        retryCount
      };
    }
  }

  private async fetchFromAPI(config: PriceFeederConfig): Promise<PriceData> {
    if (!config.source.url) {
      throw new Error('API URL is required for API source type');
    }

    const url = new URL(config.source.url);
    
    // Add query parameters
    if (config.source.params) {
      Object.entries(config.source.params).forEach(([key, value]) => {
        url.searchParams.append(key, String(value));
      });
    }

    const requestInfo = {
      url: url.toString(),
      method: config.source.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...config.source.headers
      },
      timeout: config.timeout
    };

    try {
      const response = await fetch(requestInfo.url, {
        method: requestInfo.method,
        headers: requestInfo.headers,
        signal: AbortSignal.timeout(config.timeout)
      });

      if (!response.ok) {
        const errorContext = await ApiErrorHelper.createErrorContextFromResponse(
          requestInfo,
          response,
          {
            networkId: config.networkId,
            assetSymbol: config.assetSymbol
          }
        );

        this.logger.error(
          `API request failed for ${config.assetSymbol}`,
          `HTTP ${response.status} ${response.statusText}`,
          ApiErrorHelper.sanitizeContext(errorContext)
        );

        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Extract price from response (this would need to be customized based on API response format)
      const price = this.extractPriceFromAPIResponse(data, config);
      
      return {
        symbol: config.assetSymbol,
        price,
        timestamp: new Date(),
        source: config.source.url,
        networkId: config.networkId,
        poolId: config.poolId,
        marketId: config.marketId,
        confidence: 0.9
      };

    } catch (error) {
      // Handle different types of errors
      if (error instanceof Error) {
        if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
          const errorContext = ApiErrorHelper.createTimeoutErrorContext(
            requestInfo,
            config.timeout,
            {
              networkId: config.networkId,
              assetSymbol: config.assetSymbol
            }
          );

          this.logger.error(
            `API request timeout for ${config.assetSymbol}`,
            error,
            ApiErrorHelper.sanitizeContext(errorContext)
          );
        } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
          const errorContext = ApiErrorHelper.createNetworkErrorContext(
            requestInfo,
            error,
            {
              networkId: config.networkId,
              assetSymbol: config.assetSymbol
            }
          );

          this.logger.error(
            `Network error for ${config.assetSymbol}`,
            error,
            ApiErrorHelper.sanitizeContext(errorContext)
          );
        } else {
          const errorContext = ApiErrorHelper.createErrorContext(
            requestInfo,
            undefined,
            {
              networkId: config.networkId,
              assetSymbol: config.assetSymbol
            }
          );

          this.logger.error(
            `API request error for ${config.assetSymbol}`,
            error,
            ApiErrorHelper.sanitizeContext(errorContext)
          );
        }
      }

      throw error;
    }
  }

  private async fetchFromRPC(config: PriceFeederConfig): Promise<PriceData> {
    if (!config.source.url) {
      throw new Error('RPC URL is required for RPC source type');
    }

    // This would implement RPC calls to blockchain networks
    // For now, return a placeholder
    throw new Error('RPC fetching not yet implemented');
  }

  private async fetchFromWebSocket(config: PriceFeederConfig): Promise<PriceData> {
    if (!config.source.url) {
      throw new Error('WebSocket URL is required for WebSocket source type');
    }

    // This would implement WebSocket connections for real-time price feeds
    // For now, return a placeholder
    throw new Error('WebSocket fetching not yet implemented');
  }

  private async fetchFromContract(config: PriceFeederConfig): Promise<PriceData> {
    if (!config.source.contractAddress || !config.source.functionName) {
      throw new Error('Contract address and function name are required for contract source type');
    }

    // This would implement smart contract calls to fetch prices
    // For now, return a placeholder
    throw new Error('Contract fetching not yet implemented');
  }

  private extractPriceFromAPIResponse(data: any, config: PriceFeederConfig): number {
    try {
      // Handle VOI Rewards API format
      if (config.source.url?.includes('voirewards.com')) {
        return this.extractPriceFromVOIRewardsAPI(data, config);
      }
      
      // Handle Humble API format (humble-api.voi.nautilus.sh)
      if (config.source.url?.includes('humble-api.voi.nautilus.sh')) {
        return this.extractPriceFromHumbleAPI(data, config);
      }
      
      // Handle CoinGecko API format
      if (data && typeof data === 'object') {
        const assetId = this.getAssetIdForCoinGecko(config.assetSymbol);
        if (data[assetId] && data[assetId].usd) {
          return data[assetId].usd;
        }
      }
      
      throw new Error('Unable to extract price from API response');
    } catch (error) {
      this.logger.error('Failed to extract price from API response:', error instanceof Error ? error : String(error));
      throw error;
    }
  }

  private extractPriceFromHumbleAPI(data: any, config: PriceFeederConfig): number {
    try {
      if (!data || !data.price) {
        throw new Error('Invalid Humble API response format: missing price object');
      }

      // Extract USD price from price.usd (may be string or number)
      if (data.price.usd !== undefined && data.price.usd !== null) {
        const price = typeof data.price.usd === 'string' 
          ? parseFloat(data.price.usd) 
          : Number(data.price.usd);
        
        if (isNaN(price) || price <= 0) {
          throw new Error(`Invalid price value: ${data.price.usd}`);
        }

        this.logger.debug(`Extracted USD price from Humble API: $${price}`);
        return price;
      }

      throw new Error('No USD price found in Humble API response');
    } catch (error) {
      this.logger.error('Failed to extract price from Humble API:', error instanceof Error ? error : String(error));
      throw error;
    }
  }

  private extractPriceFromVOIRewardsAPI(data: any, config: PriceFeederConfig): number {
    try {
      if (!data || !data.aggregates) {
        throw new Error('Invalid VOI Rewards API response format');
      }

      // Use the weighted average price from aggregates
      if (data.aggregates.weightedAveragePrice && typeof data.aggregates.weightedAveragePrice === 'number') {
        const price = data.aggregates.weightedAveragePrice;
        this.logger.debug(`Using weighted average price: $${price}`);
        return price;
      }

      // Fallback to individual market data if aggregates not available
      if (data.marketData && Array.isArray(data.marketData)) {
        // Find the best price from multiple exchanges
        // Priority: Nomadex (VOI network) > Tinyman > PactFi > Uniswap > Humble
        const exchangePriority = ['nomadex', 'Tinyman', 'PactFi', 'Uniswap', 'Humble'];
        
        let bestPrice: number | null = null;
        let bestExchange = '';
        let bestVolume = 0;

        for (const market of data.marketData) {
          if (market.price && market.volume_24h) {
            // Check if this is a VOI pair and has good volume
            if (market.pair && market.pair.includes('VOI') && market.volume_24h > bestVolume) {
              bestPrice = market.price;
              bestExchange = market.exchange;
              bestVolume = market.volume_24h;
            }
          }
        }

        if (bestPrice === null) {
          throw new Error('No valid VOI price found in market data');
        }

        this.logger.debug(`Fallback: Selected price from ${bestExchange}: $${bestPrice} (volume: $${bestVolume})`);
        return bestPrice;
      }

      throw new Error('No valid VOI price found in API response');
    } catch (error) {
      this.logger.error('Failed to extract price from VOI Rewards API:', error instanceof Error ? error : String(error));
      throw error;
    }
  }

  private getAssetIdForCoinGecko(symbol: string): string {
    const mapping: Record<string, string> = {
      'VOI': 'voi-network',
      'ALGO': 'algorand',
      'USDC': 'usd-coin',
      'ETH': 'ethereum',
      'BTC': 'bitcoin',
      'WAD': 'wad'
    };
    
    return mapping[symbol] || symbol.toLowerCase();
  }

  private validatePriceData(priceData: PriceData, config: PriceFeederConfig): void {
    const { validation } = config;
    
    if (!validation) return;

    // Check minimum price
    if (validation.minPrice && priceData.price < validation.minPrice) {
      throw new Error(`Price ${priceData.price} is below minimum ${validation.minPrice}`);
    }

    // Check maximum price
    if (validation.maxPrice && priceData.price > validation.maxPrice) {
      throw new Error(`Price ${priceData.price} is above maximum ${validation.maxPrice}`);
    }

    // Check required fields
    if (validation.requiredFields) {
      for (const field of validation.requiredFields) {
        if (!(field in priceData)) {
          throw new Error(`Required field '${field}' is missing`);
        }
      }
    }

    // TODO: Implement maxPriceChange validation (would need previous price data)
  }

  public async fetchWithRetry(config: PriceFeederConfig): Promise<PriceFeedResult> {
    let lastError: string | undefined;
    let lastErrorContext: ErrorContext | undefined;
    
    for (let attempt = 0; attempt <= config.retries; attempt++) {
      try {
        // Add rate limiting delay
        await this.throttleRequest();
        
        const result = await this.fetchPrice(config);
        result.retryCount = attempt;
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
        
        // Create error context for retry logging
        const errorContext: ErrorContext = {
          networkId: config.networkId,
          assetSymbol: config.assetSymbol,
          retryAttempt: attempt,
          duration: 0 // This would be calculated if we had timing info
        };
        
        lastErrorContext = errorContext;
        
        // Check if it's a rate limit error
        if (this.isRateLimitError(error)) {
          const backoffDelay = this.calculateBackoffDelay(attempt);
          this.logger.warn(
            `Rate limit hit for ${config.assetSymbol}, backing off for ${backoffDelay}ms`,
            error,
            errorContext
          );
          await this.sleep(backoffDelay);
          continue;
        }
        
        if (attempt < config.retries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000); // Exponential backoff, max 10s
          this.logger.warn(
            `Attempt ${attempt + 1} failed for ${config.assetSymbol}, retrying in ${delay}ms`,
            lastError,
            errorContext
          );
          await this.sleep(delay);
        } else {
          // Final attempt failed
          this.logger.error(
            `All retry attempts failed for ${config.assetSymbol}`,
            lastError,
            errorContext
          );
        }
      }
    }

    return {
      success: false,
      error: lastError || 'Max retries exceeded',
      timestamp: new Date(),
      duration: 0,
      retryCount: config.retries
    };
  }

  private async throttleRequest(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minRequestInterval) {
      const delay = this.minRequestInterval - timeSinceLastRequest;
      this.logger.debug(`Throttling request, waiting ${delay}ms`);
      await this.sleep(delay);
    }
    
    this.lastRequestTime = Date.now();
  }

  private isRateLimitError(error: any): boolean {
    if (error && error.message) {
      return error.message.includes('429') || 
             error.message.includes('Too Many Requests') ||
             error.message.includes('rate limit');
    }
    return false;
  }

  private calculateBackoffDelay(attempt: number): number {
    // Exponential backoff with jitter: 2^attempt * 1000ms + random(0-1000ms)
    const baseDelay = Math.min(1000 * Math.pow(2, attempt), 30000); // Max 30 seconds
    const jitter = Math.random() * 1000;
    return baseDelay + jitter;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
