import { Service } from '../types';
import { Logger } from '../utils/logger';
import { NetworkConfigLoader } from '../utils/network-config-loader';

export class PriceFeedService implements Service {
  public name = 'PriceFeedService';
  private logger: Logger;
  private networkConfigLoader: NetworkConfigLoader;

  constructor(networkConfigLoader: NetworkConfigLoader) {
    this.logger = new Logger('PriceFeedService');
    this.networkConfigLoader = networkConfigLoader;
  }

  public async initialize(): Promise<void> {
    this.logger.info('Initializing Price Feed Service...');
    
    const configs = this.networkConfigLoader.getConfigs();
    if (!configs) {
      throw new Error('Network configurations not loaded');
    }

    // Log available networks and their price data
    const detailedNetworks = this.networkConfigLoader.getAllDetailedNetworks();
    this.logger.info(`Price Feed Service initialized for ${Object.keys(detailedNetworks).length} networks`);
    
    for (const [networkId, config] of Object.entries(detailedNetworks)) {
      this.logger.info(`Network: ${config.networkConfig.name}`);
      this.logger.info(`  Price Oracle Contract: ${config.networkConfig.contracts.priceOracle}`);
      
      const assetPrices = this.networkConfigLoader.getAssetPrices(networkId);
      this.logger.info(`  Available Assets: ${Object.keys(assetPrices).join(', ')}`);
      
      // Log current prices
      Object.entries(assetPrices).forEach(([assetId, price]) => {
        this.logger.info(`    ${price.symbol}: $${price.price} (Updated: ${price.lastUpdated})`);
      });
    }
  }

  public async shutdown(): Promise<void> {
    this.logger.info('Shutting down Price Feed Service...');
    // Cleanup any ongoing price feed operations
  }

  public async isHealthy(): Promise<boolean> {
    try {
      const detailedNetworks = this.networkConfigLoader.getAllDetailedNetworks();
      
      // Service is healthy if we have at least one network with price data
      return Object.keys(detailedNetworks).length > 0;
    } catch (error) {
      this.logger.error('Price Feed Service health check failed:', error instanceof Error ? error : String(error));
      return false;
    }
  }

  public getAssetPrice(networkId: string, assetId: string): number | null {
    const assetPrices = this.networkConfigLoader.getAssetPrices(networkId);
    const price = assetPrices[assetId];
    return price ? price.price : null;
  }

  public getAllAssetPrices(networkId: string): Record<string, any> {
    return this.networkConfigLoader.getAssetPrices(networkId);
  }

  public getSupportedAssets(networkId: string): string[] {
    return this.networkConfigLoader.getSupportedTokens(networkId);
  }

  public getPriceOracleContract(networkId: string): string | null {
    const contracts = this.networkConfigLoader.getContractAddresses(networkId);
    return contracts ? contracts.priceOracle : null;
  }

  public getTokenContract(networkId: string, tokenSymbol: string): string | null {
    const tokenConfig = this.networkConfigLoader.getTokenConfig(networkId, tokenSymbol);
    return tokenConfig ? tokenConfig.contractId : null;
  }

  public getPreFiParameters(networkId: string): any {
    return this.networkConfigLoader.getPreFiParameters(networkId);
  }

  public async updatePriceData(networkId: string, assetId: string, newPrice: number): Promise<void> {
    this.logger.info(`Updating price for ${assetId} on ${networkId}: $${newPrice}`);
    
    // Here you would implement actual price update logic
    // For example, calling the price oracle contract
    
    const priceOracle = this.getPriceOracleContract(networkId);
    if (priceOracle) {
      this.logger.debug(`Would update price oracle contract ${priceOracle} with new price`);
      // Implement actual contract interaction here
    }
  }
}
