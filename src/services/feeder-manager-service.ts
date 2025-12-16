import { Service } from '../types';
import { Logger } from '../utils/logger';
import { NetworkConfigLoader } from '../utils/network-config-loader';
import { PriceLookupService } from './price-lookup-service';
import { PriceOracleService } from './price-oracle-service';
import { AccountService } from './account-service';
import { PriceFeederConfig, PriceFeedResult, FeederMetrics } from '../types';

export class FeederManagerService implements Service {
  public name = 'FeederManagerService';
  private logger: Logger;
  private networkConfigLoader: NetworkConfigLoader;
  private priceLookupService: PriceLookupService;
  private priceOracleService: PriceOracleService;
  private feederConfigs: Map<string, PriceFeederConfig> = new Map();
  private feederMetrics: Map<string, FeederMetrics> = new Map();
  private activeFeeders: Map<string, NodeJS.Timeout> = new Map();
  private isRunning: boolean = false;

  constructor(networkConfigLoader: NetworkConfigLoader, accountService: AccountService) {
    this.logger = new Logger('FeederManagerService');
    this.networkConfigLoader = networkConfigLoader;
    this.priceLookupService = new PriceLookupService();
    this.priceOracleService = new PriceOracleService(networkConfigLoader, accountService);
  }

  public async initialize(): Promise<void> {
    this.logger.info('Initializing Feeder Manager Service...');
    
    try {
      // Load feeder configurations
      await this.loadFeederConfigurations();
      
      // Initialize metrics for each feeder
      this.initializeMetrics();
      
      // Start enabled feeders
      this.startEnabledFeeders();
      
      this.isRunning = true;
      this.logger.info(`Feeder Manager Service initialized with ${this.feederConfigs.size} feeders`);
      
    } catch (error) {
      this.logger.error('Failed to initialize Feeder Manager Service:', error instanceof Error ? error : String(error));
      throw error;
    }
  }

  public async shutdown(): Promise<void> {
    this.logger.info('Shutting down Feeder Manager Service...');
    
    this.isRunning = false;
    
    // Stop all active feeders
    for (const [feederId, interval] of this.activeFeeders) {
      clearInterval(interval);
      this.logger.debug(`Stopped feeder: ${feederId}`);
    }
    
    this.activeFeeders.clear();
    this.logger.info('Feeder Manager Service shut down');
  }

  public async isHealthy(): Promise<boolean> {
    try {
      const enabledFeeders = Array.from(this.feederConfigs.values()).filter(f => f.enabled);
      const healthyFeeders = Array.from(this.feederMetrics.values()).filter(m => m.uptime > 50);
      
      // Service is healthy if at least 50% of enabled feeders are healthy
      return enabledFeeders.length === 0 || healthyFeeders.length >= enabledFeeders.length * 0.5;
    } catch (error) {
      this.logger.error('Health check failed:', error instanceof Error ? error : String(error));
      return false;
    }
  }

  private async loadFeederConfigurations(): Promise<void> {
    try {
      const configPath = `${process.cwd()}/config/feeders.json`;
      const fs = await import('fs');
      
      if (!fs.existsSync(configPath)) {
        this.logger.warn(`Feeder configuration file not found: ${configPath}`);
        return;
      }

      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);

      if (!config.feeders) {
        this.logger.warn('No feeders found in configuration');
        return;
      }

      // Load each feeder configuration
      for (const [feederId, feederConfig] of Object.entries(config.feeders)) {
        this.feederConfigs.set(feederId, feederConfig as PriceFeederConfig);
        this.logger.debug(`Loaded feeder configuration: ${feederId}`);
      }

      this.logger.info(`Loaded ${this.feederConfigs.size} feeder configurations`);

    } catch (error) {
      this.logger.error('Failed to load feeder configurations:', error instanceof Error ? error : String(error));
      throw error;
    }
  }

  private initializeMetrics(): void {
    for (const [feederId] of this.feederConfigs) {
      this.feederMetrics.set(feederId, {
        feederId,
        totalRuns: 0,
        successfulRuns: 0,
        failedRuns: 0,
        averageResponseTime: 0,
        consecutiveFailures: 0,
        uptime: 100
      });
    }
  }

  private startEnabledFeeders(): void {
    const enabledFeeders = Array.from(this.feederConfigs.values()).filter(f => f.enabled);
    
    this.logger.info(`Starting ${enabledFeeders.length} enabled feeders`);
    
    // Stagger feeder starts to avoid hitting rate limits
    enabledFeeders.forEach((feederConfig, index) => {
      const delay = index * 5000; // 5 seconds between each feeder start
      
      if (delay > 0) {
        setTimeout(() => {
          this.startFeeder(feederConfig);
        }, delay);
      } else {
        this.startFeeder(feederConfig);
      }
    });
  }

  private startFeeder(config: PriceFeederConfig): void {
    if (this.activeFeeders.has(config.id)) {
      this.logger.warn(`Feeder ${config.id} is already running`);
      return;
    }

    this.logger.info(`Starting feeder: ${config.id} (${config.method})`);
    
    const interval = setInterval(async () => {
      await this.runFeeder(config);
    }, config.interval);

    this.activeFeeders.set(config.id, interval);
  }

  private async runFeeder(config: PriceFeederConfig): Promise<void> {
    const startTime = Date.now();
    const metrics = this.feederMetrics.get(config.id);
    
    if (!metrics) {
      this.logger.error(`Metrics not found for feeder ${config.id}`);
      return;
    }

    try {
      this.logger.debug(`Running feeder: ${config.id}`);
      
      let result: PriceFeedResult;
      
      switch (config.method) {
        case 'fetch':
          result = await this.priceLookupService.fetchWithRetry(config);
          break;
        case 'post':
          // For post-only method, we'd need existing price data
          this.logger.warn(`Post-only method not yet implemented for ${config.id}`);
          return;
        case 'fetch-and-post':
          result = await this.priceOracleService.fetchAndPost(config, this.priceLookupService);
          break;
        default:
          throw new Error(`Unsupported feeder method: ${config.method}`);
      }

      const duration = Date.now() - startTime;
      
      // Update metrics
      metrics.totalRuns++;
      metrics.averageResponseTime = (metrics.averageResponseTime * (metrics.totalRuns - 1) + duration) / metrics.totalRuns;
      
      if (result.success) {
        metrics.successfulRuns++;
        metrics.consecutiveFailures = 0;
        metrics.lastSuccess = new Date();
        metrics.uptime = (metrics.successfulRuns / metrics.totalRuns) * 100;
        
        this.logger.info(`Feeder ${config.id} completed successfully in ${duration}ms`);
      } else {
        metrics.failedRuns++;
        metrics.consecutiveFailures++;
        metrics.lastFailure = new Date();
        metrics.uptime = (metrics.successfulRuns / metrics.totalRuns) * 100;
        
        this.logger.warn(`Feeder ${config.id} failed: ${result.error}`);
        
        // Check if we should use fallback
        if (config.fallback?.enabled && config.fallback.sources.length > 0) {
          await this.tryFallbackSources(config, result.error || 'Unknown error');
        }
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      metrics.totalRuns++;
      metrics.failedRuns++;
      metrics.consecutiveFailures++;
      metrics.lastFailure = new Date();
      metrics.uptime = (metrics.successfulRuns / metrics.totalRuns) * 100;
      
      this.logger.error(`Feeder ${config.id} threw error:`, errorMessage);
    }
  }

  private async tryFallbackSources(config: PriceFeederConfig, originalError: string): Promise<void> {
    this.logger.info(`Trying fallback sources for ${config.id}`);
    
    for (const fallbackConfig of config.fallback!.sources) {
      try {
        this.logger.debug(`Trying fallback source: ${fallbackConfig.id}`);
        
        const result = await this.priceOracleService.fetchAndPost(fallbackConfig, this.priceLookupService);
        
        if (result.success) {
          this.logger.info(`Fallback source ${fallbackConfig.id} succeeded for ${config.id}`);
          return;
        } else {
          this.logger.warn(`Fallback source ${fallbackConfig.id} failed: ${result.error}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(`Fallback source ${fallbackConfig.id} threw error:`, errorMessage);
      }
    }
    
    this.logger.error(`All fallback sources failed for ${config.id}`);
  }

  public getFeederMetrics(feederId?: string): FeederMetrics | Map<string, FeederMetrics> {
    if (feederId) {
      return this.feederMetrics.get(feederId) || {
        feederId,
        totalRuns: 0,
        successfulRuns: 0,
        failedRuns: 0,
        averageResponseTime: 0,
        consecutiveFailures: 0,
        uptime: 0
      };
    }
    
    return new Map(this.feederMetrics);
  }

  public getFeederConfig(feederId: string): PriceFeederConfig | undefined {
    return this.feederConfigs.get(feederId);
  }

  public getAllFeederConfigs(): Map<string, PriceFeederConfig> {
    return new Map(this.feederConfigs);
  }

  public async runFeederOnce(feederId: string): Promise<PriceFeedResult> {
    const config = this.feederConfigs.get(feederId);
    
    if (!config) {
      throw new Error(`Feeder configuration not found: ${feederId}`);
    }

    this.logger.info(`Running feeder once: ${feederId}`);
    
    // Initialize metrics if not already initialized
    if (!this.feederMetrics.has(feederId)) {
      this.feederMetrics.set(feederId, {
        feederId,
        totalRuns: 0,
        successfulRuns: 0,
        failedRuns: 0,
        averageResponseTime: 0,
        consecutiveFailures: 0,
        uptime: 100
      });
    }

    const startTime = Date.now();
    let result: PriceFeedResult;

    try {
      this.logger.debug(`Running feeder: ${feederId}`);
      
      switch (config.method) {
        case 'fetch':
          result = await this.priceLookupService.fetchWithRetry(config);
          break;
        case 'post':
          // For post-only method, we'd need existing price data
          result = {
            success: false,
            error: 'Post-only method not yet implemented',
            timestamp: new Date(),
            duration: Date.now() - startTime,
            retryCount: 0
          };
          break;
        case 'fetch-and-post':
          result = await this.priceOracleService.fetchAndPost(config, this.priceLookupService);
          break;
        default:
          throw new Error(`Unsupported feeder method: ${config.method}`);
      }

      const duration = Date.now() - startTime;
      result.duration = duration;

      // Update metrics
      const metrics = this.feederMetrics.get(feederId)!;
      metrics.totalRuns++;
      metrics.averageResponseTime = (metrics.averageResponseTime * (metrics.totalRuns - 1) + duration) / metrics.totalRuns;
      
      if (result.success) {
        metrics.successfulRuns++;
        metrics.consecutiveFailures = 0;
        metrics.lastSuccess = new Date();
        metrics.uptime = (metrics.successfulRuns / metrics.totalRuns) * 100;
        
        this.logger.info(`Feeder ${feederId} completed successfully in ${duration}ms`);
      } else {
        metrics.failedRuns++;
        metrics.consecutiveFailures++;
        metrics.lastFailure = new Date();
        metrics.uptime = (metrics.successfulRuns / metrics.totalRuns) * 100;
        
        this.logger.warn(`Feeder ${feederId} failed: ${result.error}`);
      }

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      const metrics = this.feederMetrics.get(feederId)!;
      metrics.totalRuns++;
      metrics.failedRuns++;
      metrics.consecutiveFailures++;
      metrics.lastFailure = new Date();
      metrics.uptime = (metrics.successfulRuns / metrics.totalRuns) * 100;
      
      this.logger.error(`Feeder ${feederId} threw error:`, errorMessage);
      
      result = {
        success: false,
        error: errorMessage,
        timestamp: new Date(),
        duration,
        retryCount: 0
      };

      return result;
    }
  }

  public stopFeeder(feederId: string): void {
    const interval = this.activeFeeders.get(feederId);
    
    if (interval) {
      clearInterval(interval);
      this.activeFeeders.delete(feederId);
      this.logger.info(`Stopped feeder: ${feederId}`);
    } else {
      this.logger.warn(`Feeder ${feederId} is not running`);
    }
  }

  public startFeederById(feederId: string): void {
    const config = this.feederConfigs.get(feederId);
    
    if (!config) {
      this.logger.error(`Feeder configuration not found: ${feederId}`);
      return;
    }

    this.startFeeder(config);
  }
}
