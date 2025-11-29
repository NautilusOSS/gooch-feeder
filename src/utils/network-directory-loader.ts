import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { DetailedNetworkConfig } from '../types';

export class NetworkDirectoryLoader {
  private logger: Logger;
  private networksDir: string;

  constructor(networksDir?: string) {
    this.logger = new Logger('NetworkDirectoryLoader');
    this.networksDir = networksDir || path.join(process.cwd(), 'config', 'networks');
  }

  public async loadNetworkConfigs(): Promise<Record<string, DetailedNetworkConfig>> {
    try {
      this.logger.info(`Loading detailed network configurations from: ${this.networksDir}`);
      
      if (!fs.existsSync(this.networksDir)) {
        this.logger.warn(`Networks directory not found: ${this.networksDir}`);
        return {};
      }

      const files = fs.readdirSync(this.networksDir);
      const jsonFiles = files.filter(file => file.endsWith('.json'));
      
      if (jsonFiles.length === 0) {
        this.logger.warn('No JSON files found in networks directory');
        return {};
      }

      const networkConfigs: Record<string, DetailedNetworkConfig> = {};

      for (const file of jsonFiles) {
        try {
          const filePath = path.join(this.networksDir, file);
          const networkId = path.basename(file, '.json');
          
          this.logger.debug(`Loading network config: ${networkId}`);
          
          const fileContent = fs.readFileSync(filePath, 'utf8');
          const config = JSON.parse(fileContent) as DetailedNetworkConfig;
          
          // Validate the configuration
          this.validateDetailedConfig(networkId, config);
          
          networkConfigs[networkId] = config;
          
          this.logger.debug(`Successfully loaded ${networkId} configuration`);
        } catch (error) {
          this.logger.error(`Failed to load network config from ${file}:`, error instanceof Error ? error : String(error));
          // Continue loading other files
        }
      }

      this.logger.info(`Successfully loaded ${Object.keys(networkConfigs).length} detailed network configurations`);
      
      // Log loaded networks
      Object.keys(networkConfigs).forEach(networkId => {
        const config = networkConfigs[networkId];
        this.logger.info(`  - ${config.networkConfig.name} (${networkId})`);
        this.logger.info(`    RPC: ${config.networkConfig.rpcUrl}`);
        this.logger.info(`    Tokens: ${Object.keys(config.networkConfig.tokens).join(', ')}`);
        this.logger.info(`    Price Oracle: ${config.networkConfig.contracts.priceOracle}`);
      });

      return networkConfigs;
    } catch (error) {
      this.logger.error('Failed to load detailed network configurations:', error instanceof Error ? error : String(error));
      throw error;
    }
  }

  public getNetworkConfig(networkId: string, configs: Record<string, DetailedNetworkConfig>): DetailedNetworkConfig | null {
    return configs[networkId] || null;
  }

  public getSupportedTokens(networkId: string, configs: Record<string, DetailedNetworkConfig>): string[] {
    const config = this.getNetworkConfig(networkId, configs);
    return config ? Object.keys(config.networkConfig.tokens) : [];
  }

  public getAssetPrices(networkId: string, configs: Record<string, DetailedNetworkConfig>): Record<string, any> {
    const config = this.getNetworkConfig(networkId, configs);
    return config ? config.assetPrices : {};
  }

  public getContractAddresses(networkId: string, configs: Record<string, DetailedNetworkConfig>): any {
    const config = this.getNetworkConfig(networkId, configs);
    return config ? config.networkConfig.contracts : null;
  }

  public getPreFiParameters(networkId: string, configs: Record<string, DetailedNetworkConfig>): any {
    const config = this.getNetworkConfig(networkId, configs);
    return config ? config.networkConfig.preFiParameters : null;
  }

  private validateDetailedConfig(networkId: string, config: any): void {
    if (!config.metadata) {
      throw new Error(`Network ${networkId}: metadata is required`);
    }

    if (!config.networkConfig) {
      throw new Error(`Network ${networkId}: networkConfig is required`);
    }

    if (!config.networkConfig.rpcUrl) {
      throw new Error(`Network ${networkId}: rpcUrl is required`);
    }

    if (!config.networkConfig.name) {
      throw new Error(`Network ${networkId}: name is required`);
    }

    if (!config.networkConfig.contracts) {
      throw new Error(`Network ${networkId}: contracts configuration is required`);
    }

    if (!config.networkConfig.tokens) {
      throw new Error(`Network ${networkId}: tokens configuration is required`);
    }

    if (!config.assetPrices) {
      throw new Error(`Network ${networkId}: assetPrices is required`);
    }

    // Validate required contract addresses
    const contracts = config.networkConfig.contracts;
    
    // priceOracle can be empty string (not deployed yet), but the field must exist
    if (contracts.priceOracle === undefined || contracts.priceOracle === null) {
      throw new Error(`Network ${networkId}: priceOracle contract address field is required (can be empty string if not deployed)`);
    }

    if (!contracts.lendingPools || !Array.isArray(contracts.lendingPools)) {
      throw new Error(`Network ${networkId}: lendingPools array is required`);
    }
    
    // Log warning if priceOracle is empty (but don't fail validation)
    if (contracts.priceOracle === '') {
      this.logger.warn(
        `Network ${networkId}: priceOracle contract address is empty. ` +
        `Price feeds will not work until a contract address is configured.`
      );
    }
  }

  public async reloadConfigs(): Promise<Record<string, DetailedNetworkConfig>> {
    this.logger.info('Reloading detailed network configurations...');
    return this.loadNetworkConfigs();
  }
}
