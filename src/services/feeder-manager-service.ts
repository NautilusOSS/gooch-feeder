import { Service } from '../types';
import { Logger } from '../utils/logger';
import { NetworkConfigLoader } from '../utils/network-config-loader';
import { PriceLookupService } from './price-lookup-service';
import { PriceOracleService } from './price-oracle-service';
import { AccountService } from './account-service';
import { TwapService } from './twap-service';
import { PriceFeederConfig, PriceFeedResult, FeederMetrics, BatchFeedItem, BatchFeedResult, BatchProcessingConfig, BatchProcessingResult } from '../types';
import * as fs from 'fs';
import * as path from 'path';

export class FeederManagerService implements Service {
  public name = 'FeederManagerService';
  private logger: Logger;
  private networkConfigLoader: NetworkConfigLoader;
  private priceLookupService: PriceLookupService;
  private priceOracleService: PriceOracleService;
  private twapService: TwapService;
  private feederConfigs: Map<string, PriceFeederConfig> = new Map();
  private feederMetrics: Map<string, FeederMetrics> = new Map();
  private activeFeeders: Map<string, NodeJS.Timeout> = new Map();
  private twapUpdateIntervals: Map<string, NodeJS.Timeout> = new Map(); // Separate intervals for TWAP updates
  private feederLastRun: Map<string, Date> = new Map();
  private feederLastTwapUpdate: Map<string, Date> = new Map();
  // Map to store original network IDs for tracking in dev mode
  private originalNetworkIds: Map<string, string> = new Map();
  private isRunning: boolean = false;
  private batchProcessingEnabled: boolean = true;
  private batchProcessingConfig: BatchProcessingConfig = {
    enabled: true,
    batchInterval: 30000, // 30 seconds - check for feeders to process
    maxBatchSize: 50,
    groupByNetwork: true,
    priorityOrder: true
  };
  private batchProcessingInterval?: NodeJS.Timeout;
  
  // Feed burn rate tracking
  private burnRateStats: {
    startTime: Date;
    totalFeeds: number;
    successfulFeeds: number;
    failedFeeds: number;
    totalTransactions: number; // Actual transactions sent (accounts for batching)
    successfulTransactions: number;
    failedTransactions: number;
    feedsByNetwork: Map<string, { total: number; successful: number; failed: number; transactions: number }>;
    feedsByHour: Array<{ hour: Date; count: number }>;
    lastReportTime: Date;
  } = {
    startTime: new Date(),
    totalFeeds: 0,
    successfulFeeds: 0,
    failedFeeds: 0,
    totalTransactions: 0,
    successfulTransactions: 0,
    failedTransactions: 0,
    feedsByNetwork: new Map(),
    feedsByHour: [],
    lastReportTime: new Date(),
  };
  private burnRateReportInterval?: NodeJS.Timeout;
  private twapReportInterval?: NodeJS.Timeout;

  constructor(networkConfigLoader: NetworkConfigLoader, accountService: AccountService) {
    this.logger = new Logger('FeederManagerService');
    this.networkConfigLoader = networkConfigLoader;
    this.priceLookupService = new PriceLookupService();
    this.priceOracleService = new PriceOracleService(networkConfigLoader, accountService);
    this.twapService = new TwapService();
  }

  public async initialize(): Promise<void> {
    this.logger.info('Initializing Feeder Manager Service...');
    
    try {
      // Load feeder configurations
      await this.loadFeederConfigurations();
      
      // Log diagnostic information
      const enabledFeeders = Array.from(this.feederConfigs.values()).filter(f => f.enabled);
      const disabledFeeders = Array.from(this.feederConfigs.values()).filter(f => !f.enabled);
      
      this.logger.info(`Total feeders loaded: ${this.feederConfigs.size}`);
      this.logger.info(`Enabled feeders: ${enabledFeeders.length}`);
      this.logger.info(`Disabled feeders: ${disabledFeeders.length}`);
      
      if (enabledFeeders.length === 0) {
        this.logger.warn('WARNING: No enabled feeders found! Price updates will not occur.');
        this.logger.warn('Please check your feeders.json configuration and ensure at least one feeder has "enabled": true');
      } else {
        // Log details about enabled feeders
        enabledFeeders.forEach(feeder => {
          this.logger.info(`  - ${feeder.id}: ${feeder.assetSymbol} on ${feeder.networkId} (interval: ${feeder.interval}ms)`);
          if (!feeder.destination.contractAddress) {
            this.logger.warn(`    WARNING: No contract address set for ${feeder.id}`);
          }
        });
      }
      
      // Initialize metrics for each feeder
      this.initializeMetrics();
      
      // Start enabled feeders
      this.startEnabledFeeders();
      
      // Start burn rate reporting
      this.startBurnRateReporting();
      this.startTwapReporting();
      
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
    
    // Stop batch processing if running
    if (this.batchProcessingInterval) {
      clearInterval(this.batchProcessingInterval);
      this.batchProcessingInterval = undefined;
    }
    
    // Stop burn rate reporting
    if (this.burnRateReportInterval) {
      clearInterval(this.burnRateReportInterval);
      this.burnRateReportInterval = undefined;
    }
    
    // Stop TWAP reporting
    if (this.twapReportInterval) {
      clearInterval(this.twapReportInterval);
      this.twapReportInterval = undefined;
    }
    
    // Stop all active feeders (individual mode)
    for (const [feederId, interval] of this.activeFeeders) {
      clearInterval(interval);
      this.logger.debug(`Stopped feeder: ${feederId}`);
    }
    
    // Stop all TWAP update intervals
    for (const [feederId, interval] of this.twapUpdateIntervals) {
      clearInterval(interval);
      this.logger.debug(`Stopped TWAP updates for feeder: ${feederId}`);
    }
    
    this.activeFeeders.clear();
    this.twapUpdateIntervals.clear();
    this.feederLastRun.clear();
    this.feederLastTwapUpdate.clear();
    
    // Clear TWAP data
    this.twapService.clearAll();
    
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
        let processedConfig = feederConfig as PriceFeederConfig;
        
        // Store original network ID for tracking purposes (even in dev mode)
        const originalNetworkId = processedConfig.networkId;
        this.originalNetworkIds.set(feederId, originalNetworkId);
        
        // Apply dev mode overrides if enabled
        if (this.isDevMode()) {
          processedConfig = this.applyDevModeOverrides(processedConfig);
        }
        
        this.feederConfigs.set(feederId, processedConfig);
        this.logger.debug(`Loaded feeder configuration: ${feederId}`);
      }

      if (this.isDevMode()) {
        this.logger.info(
          `Loaded ${this.feederConfigs.size} feeder configurations (dev mode: all overridden to localnet)`
        );
      } else {
        this.logger.info(`Loaded ${this.feederConfigs.size} feeder configurations`);
      }

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
    
    if (enabledFeeders.length === 0) {
      this.logger.warn('No enabled feeders to start. Price updates will not occur.');
      return;
    }
    
    this.logger.info(`Starting ${enabledFeeders.length} enabled feeders`);
    
    // Check if batch processing is enabled
    const configs = this.networkConfigLoader.getConfigs();
    if (configs?.globalSettings?.batchProcessing) {
      this.batchProcessingConfig = {
        ...this.batchProcessingConfig,
        ...configs.globalSettings.batchProcessing
      };
      this.batchProcessingEnabled = this.batchProcessingConfig.enabled !== false;
      
      // Override batch interval in dev mode if specified
      if (this.isDevMode() && process.env.DEV_BATCH_INTERVAL) {
        const devBatchInterval = parseInt(process.env.DEV_BATCH_INTERVAL, 10);
        if (!isNaN(devBatchInterval) && devBatchInterval > 0) {
          this.batchProcessingConfig.batchInterval = devBatchInterval;
          this.logger.info(`Dev mode: Overriding batch interval to ${devBatchInterval}ms (${devBatchInterval / 1000}s)`);
        }
      }
      
      this.logger.info(
        `Batch processing config: enabled=${this.batchProcessingEnabled}, ` +
        `interval=${this.batchProcessingConfig.batchInterval}ms (${this.batchProcessingConfig.batchInterval / 1000}s), ` +
        `maxBatchSize=${this.batchProcessingConfig.maxBatchSize}`
      );
    } else {
      this.logger.info('No batch processing config found in network settings, using defaults');
      
      // Override batch interval in dev mode if specified
      if (this.isDevMode() && process.env.DEV_BATCH_INTERVAL) {
        const devBatchInterval = parseInt(process.env.DEV_BATCH_INTERVAL, 10);
        if (!isNaN(devBatchInterval) && devBatchInterval > 0) {
          this.batchProcessingConfig.batchInterval = devBatchInterval;
          this.logger.info(`Dev mode: Overriding batch interval to ${devBatchInterval}ms (${devBatchInterval / 1000}s)`);
        }
      }
    }

    if (this.batchProcessingEnabled) {
      this.logger.info('Starting batch processing mode');
      this.startBatchProcessing();
    } else {
      this.logger.info('Starting individual feeder mode');
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
  }

  /**
   * Starts batch processing mode
   * Collects feeders that need to run and processes them in batches
   */
  private startBatchProcessing(): void {
    // Initialize last run times for all enabled feeders
    const enabledFeeders = Array.from(this.feederConfigs.values()).filter(f => f.enabled);
    const now = new Date();
    
    this.logger.info(`Initializing batch processing for ${enabledFeeders.length} enabled feeders`);
    
    enabledFeeders.forEach(feeder => {
      // Set initial last run to now minus interval so they're ready to run immediately
      const initialLastRun = new Date(now.getTime() - feeder.interval);
      this.feederLastRun.set(feeder.id, initialLastRun);
      this.logger.debug(
        `Feeder ${feeder.id}: interval=${feeder.interval}ms, initial last run set to ${initialLastRun.toISOString()}`
      );
      
      // Start TWAP update intervals for feeders with TWAP enabled (even in batch mode)
      if (feeder.twap?.enabled) {
        const twapInterval = feeder.twap?.interval || (feeder.interval / 4);
        const twapWindow = feeder.twap?.window || feeder.interval;
        
        this.logger.info(
          `Starting TWAP updates for ${feeder.id}: interval=${twapInterval}ms, window=${twapWindow}ms`
        );
        
        // Run TWAP update immediately
        this.updateTwap(feeder).catch(error => {
          this.logger.error(`Error updating TWAP for feeder ${feeder.id} on startup:`, error);
        });

        // Set up TWAP update interval
        const twapUpdateInterval = setInterval(async () => {
          await this.updateTwap(feeder);
        }, twapInterval);

        this.twapUpdateIntervals.set(feeder.id, twapUpdateInterval);
      }
    });

    // Start batch processing interval
    this.batchProcessingInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.processBatch();
      }
    }, this.batchProcessingConfig.batchInterval);

    this.logger.info(
      `Batch processing started with ${this.batchProcessingConfig.batchInterval}ms interval (${this.batchProcessingConfig.batchInterval / 1000}s)`
    );
    
    // Run first batch immediately
    this.logger.info('Running initial batch check...');
    this.processBatch().catch(error => {
      this.logger.error('Error in initial batch processing:', error);
    });
  }

  /**
   * Collects feeders that need to run and processes them in batches
   */
  private async processBatch(): Promise<void> {
    const now = new Date();
    const batchItems: BatchFeedItem[] = [];

    // Collect feeders that need to run
    for (const [feederId, config] of this.feederConfigs) {
      if (!config.enabled) {
        this.logger.debug(`Skipping disabled feeder: ${feederId}`);
        continue;
      }

      const lastRun = this.feederLastRun.get(feederId);
      const timeSinceLastRun = lastRun 
        ? now.getTime() - lastRun.getTime()
        : Infinity;

      this.logger.debug(
        `Checking feeder ${feederId}: ` +
        `lastRun=${lastRun ? lastRun.toISOString() : 'never'}, ` +
        `timeSinceLastRun=${Math.round(timeSinceLastRun / 1000)}s, ` +
        `interval=${config.interval}ms, ` +
        `ready=${timeSinceLastRun >= config.interval}`
      );

      // Check if feeder needs to run (interval has elapsed)
      if (timeSinceLastRun >= config.interval) {
        batchItems.push({
          config,
          priority: config.priority || 0,
          scheduledTime: new Date(),
        });
        this.logger.info(
          `✓ Feeder ${feederId} ready to run (${Math.round(timeSinceLastRun / 1000)}s since last run, interval: ${config.interval}ms)`
        );
      }
    }

    if (batchItems.length === 0) {
      this.logger.debug('No feeders ready to process in this batch cycle');
      return; // No feeders need to run
    }

    // Sort by priority if enabled
    if (this.batchProcessingConfig.priorityOrder) {
      batchItems.sort((a, b) => b.priority - a.priority);
    }

    // Process in batches if maxBatchSize is set
    const maxBatchSize = this.batchProcessingConfig.maxBatchSize || batchItems.length;
    
    for (let i = 0; i < batchItems.length; i += maxBatchSize) {
      const batch = batchItems.slice(i, i + maxBatchSize);
      await this.processBatchItems(batch);
    }
  }

  /**
   * Processes a batch of feeder items
   */
  private async processBatchItems(batchItems: BatchFeedItem[]): Promise<void> {
    this.logger.debug(`Processing batch of ${batchItems.length} feeders`);

    // First, fetch prices for all feeders that need fetching
    // For TWAP-enabled feeders, use TWAP value instead of fetching
    const fetchPromises = batchItems
      .filter(item => item.config.method === 'fetch-and-post' || item.config.method === 'fetch')
      .map(async (item) => {
        try {
          const twapEnabled = item.config.twap?.enabled || false;
          
          if (twapEnabled) {
            // Use TWAP value
            const twapWindow = item.config.twap?.window || item.config.interval;
            const twapResult = this.twapService.getTwap(item.config.id, twapWindow);
            
            if (twapResult) {
              // Get a recent price structure for metadata
              const recentFetch = await this.priceLookupService.fetchWithRetry(item.config);
              item.priceData = recentFetch.success && recentFetch.data
                ? {
                    ...recentFetch.data,
                    price: twapResult.twap,
                  }
                : {
                    symbol: item.config.assetSymbol,
                    price: twapResult.twap,
                    timestamp: new Date(),
                    source: 'twap',
                    networkId: item.config.networkId,
                    poolId: item.config.poolId,
                    marketId: item.config.marketId,
                  };
              
              this.logger.debug(
                `Using TWAP for batch item ${item.config.id}: $${twapResult.twap} ` +
                `(from ${twapResult.sampleCount} samples)`
              );
            } else {
              // No TWAP data, fetch normally
              const fetchResult = await this.priceLookupService.fetchWithRetry(item.config);
              if (fetchResult.success && fetchResult.data) {
                item.priceData = fetchResult.data;
              }
            }
          } else {
            // Normal fetch
            const fetchResult = await this.priceLookupService.fetchWithRetry(item.config);
            if (fetchResult.success && fetchResult.data) {
              item.priceData = fetchResult.data;
            }
          }
        } catch (error) {
          this.logger.warn(`Failed to fetch price for ${item.config.id}:`, error);
        }
      });

    await Promise.all(fetchPromises);

    // Now process the batch
    const batchResult = await this.priceOracleService.postBatch(batchItems, this.priceLookupService);

    // Update metrics and last run times
    // Track transactions correctly based on batch information from results
    for (const batchFeedResult of batchResult.results) {
      const metrics = this.feederMetrics.get(batchFeedResult.feederId);
      const config = batchFeedResult.config;
      const batchSize = batchFeedResult.result.batchSize || 1;
      const batchIndex = batchFeedResult.result.batchIndex ?? 0;

      if (metrics) {
        metrics.totalRuns++;
        metrics.averageResponseTime = 
          (metrics.averageResponseTime * (metrics.totalRuns - 1) + batchFeedResult.result.duration) / 
          metrics.totalRuns;

        if (batchFeedResult.result.success) {
          metrics.successfulRuns++;
          metrics.consecutiveFailures = 0;
          metrics.lastSuccess = new Date();
          metrics.uptime = (metrics.successfulRuns / metrics.totalRuns) * 100;
          
          // Track burn rate: only count transaction once per batch (when batchIndex === 0)
          // This ensures batch3 counts as 1 transaction (0.001 tokens) not 3 transactions
          if (batchIndex === 0) {
            this.trackFeedAttempt(batchFeedResult.feederId, config.networkId, true, batchSize);
          }
        } else {
          metrics.failedRuns++;
          metrics.consecutiveFailures++;
          metrics.lastFailure = new Date();
          metrics.uptime = (metrics.successfulRuns / metrics.totalRuns) * 100;

          // Track failed feeds individually (each failed feed is its own transaction attempt)
          this.trackFeedAttempt(batchFeedResult.feederId, config.networkId, false, 1);

          // Try fallback if configured
          if (config.fallback?.enabled && config.fallback.sources.length > 0) {
            await this.tryFallbackSources(config, batchFeedResult.result.error || 'Unknown error');
          }
        }
      }

      // Update last run time
      this.feederLastRun.set(batchFeedResult.feederId, new Date());
    }

    this.logger.info(
      `Batch processed: ${batchResult.successful}/${batchResult.totalProcessed} successful in ${batchResult.duration}ms`
    );
  }

  private startFeeder(config: PriceFeederConfig): void {
    if (this.activeFeeders.has(config.id)) {
      this.logger.warn(`Feeder ${config.id} is already running`);
      return;
    }

    const twapEnabled = config.twap?.enabled || false;
    const twapInterval = config.twap?.interval || (config.interval / 4); // Default: 4x more frequent
    const twapWindow = config.twap?.window || config.interval; // Default: same as posting interval

    this.logger.info(
      `Starting feeder: ${config.id} (${config.method}) - ` +
      `interval: ${config.interval}ms (${config.interval / 1000}s), ` +
      `network: ${config.networkId}, ` +
      `asset: ${config.assetSymbol}` +
      (twapEnabled ? `, TWAP: enabled (update: ${twapInterval}ms, window: ${twapWindow}ms)` : '')
    );
    
    // If TWAP is enabled, start TWAP update interval (more frequent)
    if (twapEnabled) {
      // Run TWAP update immediately
      this.updateTwap(config).catch(error => {
        this.logger.error(`Error updating TWAP for feeder ${config.id} on startup:`, error);
      });

      // Set up TWAP update interval
      const twapUpdateInterval = setInterval(async () => {
        await this.updateTwap(config);
      }, twapInterval);

      this.twapUpdateIntervals.set(config.id, twapUpdateInterval);
    }
    
    // Run posting immediately on start
    this.runFeeder(config).catch(error => {
      this.logger.error(`Error running feeder ${config.id} on startup:`, error);
    });
    
    // Then set up posting interval (uses TWAP value if enabled)
    const interval = setInterval(async () => {
      await this.runFeeder(config);
    }, config.interval);

    this.activeFeeders.set(config.id, interval);
  }

  /**
   * Update TWAP samples for a feeder (runs at twapInterval)
   */
  private async updateTwap(config: PriceFeederConfig): Promise<void> {
    if (!config.twap?.enabled) {
      return;
    }

    try {
      this.logger.debug(`Updating TWAP sample for ${config.id}`);
      
      // Fetch current price
      const fetchResult = await this.priceLookupService.fetchWithRetry(config);
      
      if (fetchResult.success && fetchResult.data) {
        // Add sample to TWAP service
        this.twapService.addSample(config.id, fetchResult.data);
        
        // Clean up old samples (keep 2x the window for safety)
        const twapWindow = config.twap?.window || config.interval;
        this.twapService.cleanup(config.id, twapWindow * 2);
        
        this.feederLastTwapUpdate.set(config.id, new Date());
        
        const sampleCount = this.twapService.getSampleCount(config.id);
        this.logger.debug(
          `TWAP sample updated for ${config.id}: $${fetchResult.data.price} (${sampleCount} samples)`
        );
      } else {
        this.logger.warn(`Failed to fetch price for TWAP update: ${config.id} - ${fetchResult.error}`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error updating TWAP for ${config.id}:`, errorMessage);
    }
  }

  private async runFeeder(config: PriceFeederConfig): Promise<void> {
    const startTime = Date.now();
    const metrics = this.feederMetrics.get(config.id);
    
    if (!metrics) {
      this.logger.error(`Metrics not found for feeder ${config.id}`);
      return;
    }

    try {
      const twapEnabled = config.twap?.enabled || false;
      this.logger.info(
        `Running feeder: ${config.id} (${config.assetSymbol} on ${config.networkId})` +
        (twapEnabled ? ' [using TWAP]' : '')
      );
      
      // Check for common issues before running
      if (!config.destination.contractAddress && config.destination.type === 'price-oracle') {
        this.logger.warn(`WARNING: Feeder ${config.id} has no contract address. Price update will likely fail.`);
      }
      
      let result: PriceFeedResult;
      
      // If TWAP is enabled, use TWAP value instead of fetching fresh price
      if (twapEnabled) {
        const twapWindow = config.twap?.window || config.interval;
        const twapResult = this.twapService.getTwap(config.id, twapWindow);
        
        if (!twapResult) {
          // No TWAP data yet, fetch a price and add it as first sample
          this.logger.warn(`No TWAP data available for ${config.id}, fetching initial price...`);
          const fetchResult = await this.priceLookupService.fetchWithRetry(config);
          
          if (fetchResult.success && fetchResult.data) {
            this.twapService.addSample(config.id, fetchResult.data);
            // Try again
            const retryTwapResult = this.twapService.getTwap(config.id, twapWindow);
            if (!retryTwapResult) {
              // Still no data, use the fetched price directly
              result = await this.priceOracleService.postWithRetry(config, fetchResult.data);
            } else {
              // Use TWAP value
              const twapPriceData = {
                ...fetchResult.data,
                price: retryTwapResult.twap,
              };
              this.logger.info(
                `Using TWAP for ${config.id}: $${retryTwapResult.twap} ` +
                `(from ${retryTwapResult.sampleCount} samples, range: $${retryTwapResult.oldestPrice} - $${retryTwapResult.newestPrice})`
              );
              result = await this.priceOracleService.postWithRetry(config, twapPriceData);
            }
          } else {
            result = {
              success: false,
              error: `Failed to fetch initial price for TWAP: ${fetchResult.error}`,
              timestamp: new Date(),
              duration: fetchResult.duration,
              retryCount: fetchResult.retryCount,
            };
          }
        } else {
          // Use TWAP value
          // We need to get a recent price data structure to use with TWAP price
          // Fetch once to get the structure, but use TWAP price
          const recentFetch = await this.priceLookupService.fetchWithRetry(config);
          const twapPriceData = recentFetch.success && recentFetch.data
            ? {
                ...recentFetch.data,
                price: twapResult.twap,
              }
            : {
                symbol: config.assetSymbol,
                price: twapResult.twap,
                timestamp: new Date(),
                source: 'twap',
                networkId: config.networkId,
                poolId: config.poolId,
                marketId: config.marketId,
              };
          
          this.logger.info(
            `Using TWAP for ${config.id}: $${twapResult.twap} ` +
            `(from ${twapResult.sampleCount} samples, range: $${twapResult.oldestPrice} - $${twapResult.newestPrice})`
          );
          result = await this.priceOracleService.postWithRetry(config, twapPriceData);
        }
      } else {
        // Normal flow: fetch and post
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
      }
      
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
        
        // Track burn rate (use original network for tracking)
        this.trackFeedAttempt(config.id, config.networkId, true);
        
        this.logger.info(
          `✓ Feeder ${config.id} (${config.assetSymbol}) completed successfully in ${duration}ms. ` +
          `Price: $${result.data?.price || 'N/A'}`
        );
      } else {
        metrics.failedRuns++;
        metrics.consecutiveFailures++;
        metrics.lastFailure = new Date();
        metrics.uptime = (metrics.successfulRuns / metrics.totalRuns) * 100;
        
        // Track burn rate (use original network for tracking)
        this.trackFeedAttempt(config.id, config.networkId, false);
        
        this.logger.error(
          `✗ Feeder ${config.id} (${config.assetSymbol}) failed: ${result.error || 'Unknown error'}`
        );
        
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
    // Stop main feeder interval
    const interval = this.activeFeeders.get(feederId);
    if (interval) {
      clearInterval(interval);
      this.activeFeeders.delete(feederId);
    }
    
    // Stop TWAP update interval if exists
    const twapInterval = this.twapUpdateIntervals.get(feederId);
    if (twapInterval) {
      clearInterval(twapInterval);
      this.twapUpdateIntervals.delete(feederId);
    }
    
    // Clear TWAP data for this feeder
    this.twapService.clear(feederId);
    
    this.logger.info(`Stopped feeder: ${feederId}`);
  }
  
  public stopFeederOld(feederId: string): void {
    const interval = this.activeFeeders.get(feederId);
    
    if (interval) {
      clearInterval(interval);
      this.activeFeeders.delete(feederId);
      this.logger.info(`Stopped feeder: ${feederId}`);
    } else {
      this.logger.warn(`Feeder ${feederId} is not running`);
    }
  }

  /**
   * Check if dev mode is enabled via environment variable
   */
  private isDevMode(): boolean {
    return process.env.DEV_MODE === "true" || process.env.DEV_MODE === "1";
  }

  /**
   * Apply dev mode overrides to a feeder configuration
   */
  private applyDevModeOverrides(config: PriceFeederConfig): PriceFeederConfig {
    const NETWORK = "localnet";
    const DEV_CONTRACT_ADDRESS = process.env.DEV_CONTRACT_ADDRESS || "";
    // Default to 1 minute (60000ms), but allow override via env var
    const DEV_INTERVAL = process.env.DEV_INTERVAL 
      ? parseInt(process.env.DEV_INTERVAL, 10) 
      : 60000; // 1 minute in milliseconds

    // Warn if contract address is not set in dev mode
    if (!DEV_CONTRACT_ADDRESS && !config.destination.contractAddress) {
      this.logger.warn(
        `WARNING: DEV_CONTRACT_ADDRESS not set and feeder ${config.id} has no contract address. ` +
        `Price updates will fail. Set DEV_CONTRACT_ADDRESS in your .env file.`
      );
    }

    // Calculate scaling factor if interval is being changed
    const originalInterval = config.interval;
    const intervalScale = originalInterval > 0 ? DEV_INTERVAL / originalInterval : 1;

    // Scale TWAP intervals proportionally if they exist
    let twapConfig = config.twap;
    if (config.twap && intervalScale !== 1) {
      twapConfig = {
        ...config.twap,
        // Scale TWAP interval if explicitly set, otherwise it will default to DEV_INTERVAL / 4
        interval: config.twap.interval
          ? Math.max(1000, Math.round(config.twap.interval * intervalScale)) // Minimum 1 second
          : undefined,
        // Scale TWAP window if explicitly set, otherwise it will default to DEV_INTERVAL
        window: config.twap.window
          ? Math.max(1000, Math.round(config.twap.window * intervalScale)) // Minimum 1 second
          : undefined,
      };
    }

    // Create a deep copy to avoid mutating the original
    const overriddenConfig: PriceFeederConfig = {
      ...config,
      networkId: NETWORK,
      interval: DEV_INTERVAL,
      twap: twapConfig,
      source: {
        ...config.source,
        contractAddress: config.source.contractAddress
          ? DEV_CONTRACT_ADDRESS || config.source.contractAddress
          : undefined,
      },
      destination: {
        ...config.destination,
        contractAddress: DEV_CONTRACT_ADDRESS || config.destination.contractAddress || "",
      },
    };

    const twapInfo = twapConfig?.enabled
      ? `, TWAP: enabled (update: ${twapConfig.interval || DEV_INTERVAL / 4}ms, window: ${twapConfig.window || DEV_INTERVAL}ms)`
      : '';

    this.logger.info(
      `Dev mode: Overriding feeder ${config.id} to use network ${NETWORK}, interval ${DEV_INTERVAL}ms, ` +
      `contract address: ${overriddenConfig.destination.contractAddress || "NOT SET (will fail)"}` +
      twapInfo
    );

    return overriddenConfig;
  }

  public startFeederById(feederId: string): void {
    const config = this.feederConfigs.get(feederId);
    
    if (!config) {
      this.logger.error(`Feeder configuration not found: ${feederId}`);
      return;
    }

    this.startFeeder(config);
  }

  /**
   * Track a feed attempt for burn rate statistics
   * Uses original network ID for tracking even in dev mode
   * @param feederId - The feeder ID
   * @param networkId - The network ID (may be overridden in dev mode)
   * @param success - Whether the feed was successful
   * @param batchSize - Optional: number of feeds in this transaction (for batch transactions)
   */
  private trackFeedAttempt(feederId: string, networkId: string, success: boolean, batchSize: number = 1): void {
    // In dev mode, use original network ID for tracking instead of localnet
    const trackingNetworkId = this.isDevMode() 
      ? (this.originalNetworkIds.get(feederId) || networkId)
      : networkId;
    
    // Track feeds
    this.burnRateStats.totalFeeds += batchSize;
    if (success) {
      this.burnRateStats.successfulFeeds += batchSize;
    } else {
      this.burnRateStats.failedFeeds += batchSize;
    }

    // Track transactions (1 transaction can contain multiple feeds)
    this.burnRateStats.totalTransactions++;
    if (success) {
      this.burnRateStats.successfulTransactions++;
    } else {
      this.burnRateStats.failedTransactions++;
    }

    // Track by network (using original network ID for proper splitting)
    const networkStats = this.burnRateStats.feedsByNetwork.get(trackingNetworkId) || {
      total: 0,
      successful: 0,
      failed: 0,
      transactions: 0,
    };
    networkStats.total += batchSize;
    if (success) {
      networkStats.successful += batchSize;
    } else {
      networkStats.failed += batchSize;
    }
    networkStats.transactions++;
    this.burnRateStats.feedsByNetwork.set(trackingNetworkId, networkStats);

    // Track hourly feeds (keep last 24 hours)
    const now = new Date();
    const currentHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
    const lastHourEntry = this.burnRateStats.feedsByHour[this.burnRateStats.feedsByHour.length - 1];
    
    if (lastHourEntry && lastHourEntry.hour.getTime() === currentHour.getTime()) {
      lastHourEntry.count++;
    } else {
      this.burnRateStats.feedsByHour.push({ hour: currentHour, count: 1 });
      // Keep only last 24 hours
      if (this.burnRateStats.feedsByHour.length > 24) {
        this.burnRateStats.feedsByHour.shift();
      }
    }
  }

  /**
   * Start periodic burn rate reporting
   */
  private startBurnRateReporting(): void {
    // Report interval: every hour (3600000ms), configurable via env
    const reportInterval = process.env.BURN_RATE_REPORT_INTERVAL
      ? parseInt(process.env.BURN_RATE_REPORT_INTERVAL, 10)
      : 3600000; // 1 hour default

    // Initial report immediately (after a short delay to allow some activity)
    setTimeout(() => {
      this.printBurnRateReport();
      this.logger.info('Initial burn rate report generated');
    }, 10000); // 10 seconds - allow some initial activity

    // Second report after 5 minutes
    setTimeout(() => {
      this.printBurnRateReport();
      this.logger.info('5-minute burn rate report generated');
    }, 300000); // 5 minutes

    // Then report periodically
    this.burnRateReportInterval = setInterval(() => {
      this.printBurnRateReport();
    }, reportInterval);

    this.logger.info(
      `Burn rate reporting started (interval: ${reportInterval / 1000}s, ` +
      `initial report in 10s, second report in 5 minutes)`
    );
  }

  /**
   * Print burn rate statistics to console and file
   */
  private printBurnRateReport(): void {
    const now = new Date();
    const uptime = now.getTime() - this.burnRateStats.startTime.getTime();
    const uptimeHours = uptime / (1000 * 60 * 60);
    const uptimeDays = uptimeHours / 24;

    // Calculate rates
    const feedsPerHour = uptimeHours > 0 ? this.burnRateStats.totalFeeds / uptimeHours : 0;
    const feedsPerDay = feedsPerHour * 24;
    const successRate = this.burnRateStats.totalFeeds > 0
      ? (this.burnRateStats.successfulFeeds / this.burnRateStats.totalFeeds) * 100
      : 0;

    // Calculate recent hourly rate (last hour)
    const recentHourFeeds = this.burnRateStats.feedsByHour.reduce((sum, entry) => {
      const hourDiff = (now.getTime() - entry.hour.getTime()) / (1000 * 60 * 60);
      return hourDiff < 1 ? sum + entry.count : sum;
    }, 0);

    // Estimate costs (0.001 per transaction, not per feed)
    // Batch transactions (batch2, batch3) count as 1 transaction regardless of number of feeds
    const estimatedCostPerTransaction = 0.001;
    const estimatedTotalCost = this.burnRateStats.successfulTransactions * estimatedCostPerTransaction;
    
    // Calculate transaction rates based on actual feeder configuration
    // This gives more accurate projections than dividing by short uptime
    const allEnabledFeeders = Array.from(this.feederConfigs.values()).filter(f => f.enabled);
    
    // Calculate expected transactions per hour based on feeder intervals
    // With batching (batch3), we can fit up to 3 feeds per transaction
    // Estimate: average of 2.5 feeds per transaction (between batch2 and batch3)
    const expectedFeedsPerHour = allEnabledFeeders.reduce((sum, feeder) => {
      const feedsPerHour = 3600000 / feeder.interval; // 3600000ms = 1 hour
      return sum + feedsPerHour;
    }, 0);
    
    // Estimate transactions per hour: assume average of 2.5 feeds per transaction with batching
    // This is conservative - in practice with batch3 it could be better
    const estimatedFeedsPerTransaction = 2.5;
    let transactionsPerHour: number;
    
    if (uptimeHours >= 0.1) {
      // Use actual rate if we have enough data (at least 6 minutes)
      transactionsPerHour = uptimeHours > 0 ? this.burnRateStats.totalTransactions / uptimeHours : 0;
    } else {
      // For short uptime, use expected rate based on feeder configuration
      transactionsPerHour = expectedFeedsPerHour / estimatedFeedsPerTransaction;
    }
    
    const transactionsPerDay = transactionsPerHour * 24;
    const estimatedHourlyCost = transactionsPerHour * estimatedCostPerTransaction;
    const estimatedDailyCost = transactionsPerDay * estimatedCostPerTransaction;

    // Build report content
    const reportLines: string[] = [];
    reportLines.push('\n' + '='.repeat(80));
    reportLines.push('📊 FEED BURN RATE REPORT');
    reportLines.push('='.repeat(80));
    reportLines.push(`Time: ${now.toISOString()}`);
    reportLines.push(`Uptime: ${uptimeDays.toFixed(2)} days (${uptimeHours.toFixed(2)} hours)`);
    reportLines.push('');

    // Overall statistics
    reportLines.push('📈 OVERALL STATISTICS:');
    reportLines.push(`  Total Feeds: ${this.burnRateStats.totalFeeds}`);
    reportLines.push(`  Successful: ${this.burnRateStats.successfulFeeds} (${successRate.toFixed(2)}%)`);
    reportLines.push(`  Failed: ${this.burnRateStats.failedFeeds} (${(100 - successRate).toFixed(2)}%)`);
    reportLines.push('');

    // Rates
    reportLines.push('⚡ FEED RATES:');
    reportLines.push(`  Average Rate: ${feedsPerHour.toFixed(2)} feeds/hour`);
    reportLines.push(`  Projected Daily: ${feedsPerDay.toFixed(2)} feeds/day`);
    reportLines.push(`  Recent Hour: ${recentHourFeeds} feeds`);
    reportLines.push('');

    // Network breakdown
    reportLines.push('🌐 NETWORK BREAKDOWN:');
    for (const [networkId, stats] of this.burnRateStats.feedsByNetwork.entries()) {
      const networkSuccessRate = stats.total > 0
        ? (stats.successful / stats.total) * 100
        : 0;
      const networkFeedsPerHour = uptimeHours > 0 ? stats.total / uptimeHours : 0;
      reportLines.push(`  ${networkId}:`);
      reportLines.push(`    Total: ${stats.total} (${stats.successful} successful, ${stats.failed} failed)`);
      reportLines.push(`    Success Rate: ${networkSuccessRate.toFixed(2)}%`);
      reportLines.push(`    Rate: ${networkFeedsPerHour.toFixed(2)} feeds/hour`);
    }
    reportLines.push('');

    // Cost estimates - overall
    reportLines.push('💰 ESTIMATED COSTS (OVERALL):');
    reportLines.push(`  Total Transactions: ${this.burnRateStats.totalTransactions} (${this.burnRateStats.successfulTransactions} successful)`);
    reportLines.push(`  Total Cost: ${estimatedTotalCost.toFixed(6)} tokens`);
    reportLines.push(`  Transactions/Hour: ${transactionsPerHour.toFixed(2)}`);
    reportLines.push(`  Projected Hourly Cost: ${estimatedHourlyCost.toFixed(6)} tokens`);
    reportLines.push(`  Projected Daily Cost: ${estimatedDailyCost.toFixed(6)} tokens`);
    reportLines.push(`  Projected Monthly Cost: ${(estimatedDailyCost * 30).toFixed(6)} tokens`);
    reportLines.push(`  Note: Batch transactions (batch2/batch3) count as 1 transaction regardless of feed count`);
    reportLines.push('');

    // Cost estimates by network
    reportLines.push('💰 ESTIMATED COSTS BY NETWORK:');
    for (const [networkId, stats] of this.burnRateStats.feedsByNetwork.entries()) {
      const networkFeedsPerHour = uptimeHours > 0 ? stats.total / uptimeHours : 0;
      const networkFeedsPerDay = networkFeedsPerHour * 24;
      // Calculate network transaction rates with same logic as overall
      let networkTransactionsPerHour: number;
      
      // Get enabled feeders for this network (using original network ID in dev mode)
      const enabledFeedersForNetwork = Array.from(this.feederConfigs.values())
        .filter(f => f.enabled && (this.isDevMode() 
          ? (this.originalNetworkIds.get(f.id) === networkId)
          : f.networkId === networkId));
      
      // Calculate expected feeds per hour for this network
      const expectedNetworkFeedsPerHour = enabledFeedersForNetwork.reduce((sum, feeder) => {
        const feedsPerHour = 3600000 / feeder.interval; // 3600000ms = 1 hour
        return sum + feedsPerHour;
      }, 0);
      
      if (uptimeHours >= 0.1) {
        // Use actual rate if we have enough data (at least 6 minutes)
        networkTransactionsPerHour = uptimeHours > 0 ? stats.transactions / uptimeHours : 0;
      } else {
        // For short uptime, use expected rate based on feeder configuration
        // Estimate: average of 2.5 feeds per transaction with batching
        networkTransactionsPerHour = expectedNetworkFeedsPerHour / estimatedFeedsPerTransaction;
      }
      
      const networkTransactionsPerDay = networkTransactionsPerHour * 24;
      // Use transactions for cost calculation, not feeds
      const networkTotalCost = stats.transactions * estimatedCostPerTransaction;
      const networkHourlyCost = networkTransactionsPerHour * estimatedCostPerTransaction;
      const networkDailyCost = networkTransactionsPerDay * estimatedCostPerTransaction;
      const networkMonthlyCost = networkDailyCost * 30;
      
      // Determine token symbol based on network
      let tokenSymbol = 'tokens';
      if (networkId === 'algorand-mainnet') {
        tokenSymbol = 'ALGO';
      } else if (networkId === 'voi-mainnet') {
        tokenSymbol = 'VOI';
      } else if (networkId === 'localnet') {
        tokenSymbol = 'ALGO'; // localnet typically uses ALGO
      } else {
        // Try to extract token from network name
        const networkUpper = networkId.toUpperCase();
        if (networkUpper.includes('ALGORAND')) {
          tokenSymbol = 'ALGO';
        } else if (networkUpper.includes('VOI')) {
          tokenSymbol = 'VOI';
        }
      }
      
      reportLines.push(`  ${networkId}:`);
      reportLines.push(`    Transactions: ${stats.transactions} (${stats.successful} feeds in ${stats.transactions} txns)`);
      reportLines.push(`    Total Cost: ${networkTotalCost.toFixed(6)} ${tokenSymbol}`);
      reportLines.push(`    Projected Hourly: ${networkHourlyCost.toFixed(6)} ${tokenSymbol}`);
      reportLines.push(`    Projected Daily: ${networkDailyCost.toFixed(6)} ${tokenSymbol}`);
      reportLines.push(`    Projected Monthly: ${networkMonthlyCost.toFixed(6)} ${tokenSymbol}`);
      reportLines.push(`    Rate: ${networkFeedsPerHour.toFixed(2)} feeds/hour, ${networkTransactionsPerHour.toFixed(2)} txns/hour`);
    }
    reportLines.push('');

    // Enabled feeders summary
    const enabledFeeders = Array.from(this.feederConfigs.values()).filter(f => f.enabled);
    const feedersByNetwork = new Map<string, number>();
    enabledFeeders.forEach(f => {
      feedersByNetwork.set(f.networkId, (feedersByNetwork.get(f.networkId) || 0) + 1);
    });

    reportLines.push('🔧 CONFIGURATION:');
    reportLines.push(`  Enabled Feeders: ${enabledFeeders.length}`);
    for (const [networkId, count] of feedersByNetwork.entries()) {
      reportLines.push(`    ${networkId}: ${count} feeders`);
    }
    reportLines.push('='.repeat(80) + '\n');

    const reportContent = reportLines.join('\n');

    // Output to console
    console.log(reportContent);

    // Write to file
    try {
      const logsDir = path.join(process.cwd(), 'logs');
      
      // Ensure logs directory exists
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const reportFilePath = path.join(logsDir, 'burn-rate-report.log');
      
      // Check file size and truncate if necessary
      const maxFileSize = process.env.BURN_RATE_MAX_FILE_SIZE
        ? parseInt(process.env.BURN_RATE_MAX_FILE_SIZE, 10)
        : 5 * 1024 * 1024; // Default: 5MB
      
      const maxReportsToKeep = process.env.BURN_RATE_MAX_REPORTS
        ? parseInt(process.env.BURN_RATE_MAX_REPORTS, 10)
        : 50; // Default: keep last 50 reports
      
      let fileContent = '';
      if (fs.existsSync(reportFilePath)) {
        const stats = fs.statSync(reportFilePath);
        
        // If file is too large, truncate it
        if (stats.size > maxFileSize) {
          this.logger.info(
            `Burn rate report file size (${(stats.size / 1024 / 1024).toFixed(2)}MB) exceeds limit ` +
            `(${(maxFileSize / 1024 / 1024).toFixed(2)}MB), truncating...`
          );
          
          // Read the file and keep only the last N reports
          const existingContent = fs.readFileSync(reportFilePath, 'utf8');
          const reportSeparator = '='.repeat(80) + '\nREPORT GENERATED:';
          const reports = existingContent.split(reportSeparator);
          
          // Keep the last N reports (plus header if present)
          const reportsToKeep = reports.slice(-maxReportsToKeep);
          const truncatedContent = reportsToKeep.join(reportSeparator);
          
          // Write truncated content
          fs.writeFileSync(reportFilePath, truncatedContent, 'utf8');
          
          this.logger.info(
            `Truncated burn rate report file, kept last ${reportsToKeep.length} reports`
          );
        }
      }
      
      // Append new report to file with timestamp separator
      const newReportContent = `\n${'='.repeat(80)}\nREPORT GENERATED: ${now.toISOString()}\n${'='.repeat(80)}\n${reportContent}\n`;
      
      fs.appendFileSync(reportFilePath, newReportContent, 'utf8');
      
      const finalStats = fs.statSync(reportFilePath);
      this.logger.info(
        `Burn rate report written to: ${reportFilePath} ` +
        `(${(finalStats.size / 1024).toFixed(2)}KB)`
      );
    } catch (error) {
      this.logger.error('Failed to write burn rate report to file:', error instanceof Error ? error.message : String(error));
    }

    // Update last report time
    this.burnRateStats.lastReportTime = now;
  }

  /**
   * Start TWAP reporting
   */
  private startTwapReporting(): void {
    // Report interval: every hour (3600000ms), configurable via env
    const reportInterval = process.env.TWAP_REPORT_INTERVAL
      ? parseInt(process.env.TWAP_REPORT_INTERVAL, 10)
      : 3600000; // 1 hour default

    // Initial report immediately (after a short delay to allow some activity)
    setTimeout(() => {
      this.printTwapReport();
      this.logger.info('Initial TWAP report generated');
    }, 10000); // 10 seconds - allow some initial activity

    // Second report after 5 minutes
    setTimeout(() => {
      this.printTwapReport();
      this.logger.info('5-minute TWAP report generated');
    }, 300000); // 5 minutes

    // Then report periodically
    this.twapReportInterval = setInterval(() => {
      this.printTwapReport();
    }, reportInterval);

    this.logger.info(
      `TWAP reporting started (interval: ${reportInterval / 1000}s, ` +
      `initial report in 10s, second report in 5 minutes)`
    );
  }

  /**
   * Print TWAP statistics to console and file
   */
  private printTwapReport(): void {
    const now = new Date();
    
    // Get all TWAP-enabled feeders
    const twapEnabledFeeders = Array.from(this.feederConfigs.values())
      .filter(f => f.enabled && f.twap?.enabled);

    if (twapEnabledFeeders.length === 0) {
      // Still generate a report to show that TWAP is available but not enabled
      const reportLines: string[] = [];
      reportLines.push('\n' + '='.repeat(80));
      reportLines.push('📈 TWAP (TIME-WEIGHTED AVERAGE PRICE) REPORT');
      reportLines.push('='.repeat(80));
      reportLines.push(`Time: ${now.toISOString()}`);
      reportLines.push('');
      reportLines.push('⚠️  NO TWAP-ENABLED FEEDERS FOUND');
      reportLines.push('');
      reportLines.push('To enable TWAP for a feeder, add the following to your feeder configuration:');
      reportLines.push('');
      reportLines.push('  "twap": {');
      reportLines.push('    "enabled": true,');
      reportLines.push('    "interval": 15000,  // Optional: TWAP update interval (default: interval / 4)');
      reportLines.push('    "window": 60000     // Optional: TWAP calculation window (default: interval)');
      reportLines.push('  }');
      reportLines.push('');
      reportLines.push(`Total Enabled Feeders: ${Array.from(this.feederConfigs.values()).filter(f => f.enabled).length}`);
      reportLines.push(`Total Feeders: ${this.feederConfigs.size}`);
      reportLines.push('='.repeat(80) + '\n');

      const reportContent = reportLines.join('\n');
      console.log(reportContent);
      
      // Write to file even when no TWAP feeders
      try {
        const logsDir = path.join(process.cwd(), 'logs');
        if (!fs.existsSync(logsDir)) {
          fs.mkdirSync(logsDir, { recursive: true });
        }
        const reportFilePath = path.join(logsDir, 'twap-report.log');
        const newReportContent = `\n${'='.repeat(80)}\nREPORT GENERATED: ${now.toISOString()}\n${'='.repeat(80)}\n${reportContent}\n`;
        fs.appendFileSync(reportFilePath, newReportContent, 'utf8');
        this.logger.info(`TWAP report written to: ${reportFilePath} (no TWAP-enabled feeders found)`);
      } catch (error) {
        this.logger.error('Failed to write TWAP report to file:', error instanceof Error ? error.message : String(error));
      }
      
      return;
    }

    // Build report content
    const reportLines: string[] = [];
    reportLines.push('\n' + '='.repeat(80));
    reportLines.push('📈 TWAP (TIME-WEIGHTED AVERAGE PRICE) REPORT');
    reportLines.push('='.repeat(80));
    reportLines.push(`Time: ${now.toISOString()}`);
    reportLines.push(`TWAP-Enabled Feeders: ${twapEnabledFeeders.length}`);
    reportLines.push('');

    // Group by network
    const feedersByNetwork = new Map<string, PriceFeederConfig[]>();
    for (const feeder of twapEnabledFeeders) {
      const networkId = this.isDevMode() 
        ? (this.originalNetworkIds.get(feeder.id) || feeder.networkId)
        : feeder.networkId;
      
      if (!feedersByNetwork.has(networkId)) {
        feedersByNetwork.set(networkId, []);
      }
      feedersByNetwork.get(networkId)!.push(feeder);
    }

    // Report by network
    for (const [networkId, feeders] of feedersByNetwork.entries()) {
      reportLines.push(`🌐 NETWORK: ${networkId}`);
      reportLines.push(`  Feeders: ${feeders.length}`);
      reportLines.push('');

      for (const feeder of feeders) {
        const twapInterval = feeder.twap?.interval || (feeder.interval / 4);
        const twapWindow = feeder.twap?.window || feeder.interval;
        const sampleCount = this.twapService.getSampleCount(feeder.id);
        const lastUpdate = this.feederLastTwapUpdate.get(feeder.id);
        const twapResult = this.twapService.getTwap(feeder.id, twapWindow);

        reportLines.push(`  📊 ${feeder.id} (${feeder.assetSymbol}):`);
        reportLines.push(`    Configuration:`);
        reportLines.push(`      Posting Interval: ${feeder.interval}ms (${(feeder.interval / 1000).toFixed(1)}s)`);
        reportLines.push(`      TWAP Update Interval: ${twapInterval}ms (${(twapInterval / 1000).toFixed(1)}s)`);
        reportLines.push(`      TWAP Window: ${twapWindow}ms (${(twapWindow / 1000).toFixed(1)}s)`);
        reportLines.push(`    Current Status:`);
        reportLines.push(`      Total Samples: ${sampleCount}`);
        
        if (lastUpdate) {
          const timeSinceUpdate = (now.getTime() - lastUpdate.getTime()) / 1000;
          reportLines.push(`      Last Update: ${timeSinceUpdate.toFixed(1)}s ago`);
        } else {
          reportLines.push(`      Last Update: Never`);
        }

        if (twapResult) {
          const priceRange = twapResult.newestPrice - twapResult.oldestPrice;
          const priceRangePercent = twapResult.oldestPrice > 0
            ? ((priceRange / twapResult.oldestPrice) * 100)
            : 0;
          
          reportLines.push(`      Current TWAP: $${twapResult.twap.toFixed(6)}`);
          reportLines.push(`      Price Range: $${twapResult.oldestPrice.toFixed(6)} - $${twapResult.newestPrice.toFixed(6)}`);
          reportLines.push(`      Range: $${priceRange.toFixed(6)} (${priceRangePercent.toFixed(2)}%)`);
          reportLines.push(`      Samples in Window: ${twapResult.sampleCount}`);
          reportLines.push(`      Window: ${twapResult.windowStart.toISOString()} to ${twapResult.windowEnd.toISOString()}`);
        } else {
          reportLines.push(`      Current TWAP: Not available (insufficient samples)`);
          reportLines.push(`      Status: Waiting for more samples (need samples within ${(twapWindow / 1000).toFixed(1)}s window)`);
        }
        reportLines.push('');
      }
    }

    // Summary statistics
    reportLines.push('📊 SUMMARY:');
    let totalSamples = 0;
    let feedersWithTwap = 0;
    let feedersWithoutTwap = 0;
    const twapValues: number[] = [];

    for (const feeder of twapEnabledFeeders) {
      const twapWindow = feeder.twap?.window || feeder.interval;
      const sampleCount = this.twapService.getSampleCount(feeder.id);
      const twapResult = this.twapService.getTwap(feeder.id, twapWindow);
      
      totalSamples += sampleCount;
      
      if (twapResult) {
        feedersWithTwap++;
        twapValues.push(twapResult.twap);
      } else {
        feedersWithoutTwap++;
      }
    }

    reportLines.push(`  Total TWAP-Enabled Feeders: ${twapEnabledFeeders.length}`);
    reportLines.push(`  Feeders with Valid TWAP: ${feedersWithTwap}`);
    reportLines.push(`  Feeders without TWAP (insufficient samples): ${feedersWithoutTwap}`);
    reportLines.push(`  Total Samples Collected: ${totalSamples}`);
    reportLines.push(`  Average Samples per Feeder: ${twapEnabledFeeders.length > 0 ? (totalSamples / twapEnabledFeeders.length).toFixed(1) : 0}`);

    if (twapValues.length > 0) {
      const avgTwap = twapValues.reduce((sum, val) => sum + val, 0) / twapValues.length;
      const minTwap = Math.min(...twapValues);
      const maxTwap = Math.max(...twapValues);
      reportLines.push(`  Average TWAP Value: $${avgTwap.toFixed(6)}`);
      reportLines.push(`  TWAP Range: $${minTwap.toFixed(6)} - $${maxTwap.toFixed(6)}`);
    }

    reportLines.push('='.repeat(80) + '\n');

    const reportContent = reportLines.join('\n');

    // Output to console
    console.log(reportContent);

    // Write to file
    try {
      const logsDir = path.join(process.cwd(), 'logs');
      
      // Ensure logs directory exists
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const reportFilePath = path.join(logsDir, 'twap-report.log');
      
      // Check file size and truncate if necessary
      const maxFileSize = process.env.TWAP_REPORT_MAX_FILE_SIZE
        ? parseInt(process.env.TWAP_REPORT_MAX_FILE_SIZE, 10)
        : 5 * 1024 * 1024; // Default: 5MB
      
      const maxReportsToKeep = process.env.TWAP_REPORT_MAX_REPORTS
        ? parseInt(process.env.TWAP_REPORT_MAX_REPORTS, 10)
        : 50; // Default: keep last 50 reports
      
      let fileContent = '';
      if (fs.existsSync(reportFilePath)) {
        const stats = fs.statSync(reportFilePath);
        
        // If file is too large, truncate it
        if (stats.size > maxFileSize) {
          this.logger.info(
            `TWAP report file size (${(stats.size / 1024 / 1024).toFixed(2)}MB) exceeds limit ` +
            `(${(maxFileSize / 1024 / 1024).toFixed(2)}MB), truncating...`
          );
          
          // Read the file and keep only the last N reports
          const existingContent = fs.readFileSync(reportFilePath, 'utf8');
          const reportSeparator = '='.repeat(80) + '\nREPORT GENERATED:';
          const reports = existingContent.split(reportSeparator);
          
          // Keep the last N reports (plus header if present)
          const reportsToKeep = reports.slice(-maxReportsToKeep);
          const truncatedContent = reportsToKeep.join(reportSeparator);
          
          // Write truncated content
          fs.writeFileSync(reportFilePath, truncatedContent, 'utf8');
          
          this.logger.info(
            `Truncated TWAP report file, kept last ${reportsToKeep.length} reports`
          );
        }
      }
      
      // Append new report to file with timestamp separator
      const newReportContent = `\n${'='.repeat(80)}\nREPORT GENERATED: ${now.toISOString()}\n${'='.repeat(80)}\n${reportContent}\n`;
      
      fs.appendFileSync(reportFilePath, newReportContent, 'utf8');
      
      const finalStats = fs.statSync(reportFilePath);
      this.logger.info(
        `TWAP report written to: ${reportFilePath} ` +
        `(${(finalStats.size / 1024).toFixed(2)}KB)`
      );
    } catch (error) {
      this.logger.error('Failed to write TWAP report to file:', error instanceof Error ? error.message : String(error));
    }
  }
}
