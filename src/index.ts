import { config } from 'dotenv';
import { Logger } from './utils/logger';
import { ServiceManager } from './services/service-manager';
import { NetworkConfigLoader } from './utils/network-config-loader';
import { NetworkMonitoringService } from './services/network-monitoring-service';
import { PriceFeedService } from './services/price-feed-service';
import { FeederManagerService } from './services/feeder-manager-service';
import { AccountService } from './services/account-service';

// Load environment variables
config();

class GoochFeederService {
  private logger: Logger;
  private serviceManager: ServiceManager;
  private networkConfigLoader: NetworkConfigLoader;
  private isRunning: boolean = false;

  constructor() {
    this.logger = new Logger('GoochFeederService');
    this.serviceManager = new ServiceManager();
    this.networkConfigLoader = new NetworkConfigLoader();
  }

  public async start(): Promise<void> {
    try {
      this.logger.info('Starting Gooch Feeder Service...');
      
      // Load network configurations first
      await this.loadNetworkConfigurations();
      
      // Register services
      this.registerServices();
      
      // Initialize services
      await this.serviceManager.initialize();
      
      this.isRunning = true;
      this.logger.info('Gooch Feeder Service started successfully');
      
      // Keep the service running
      this.keepAlive();
      
    } catch (error) {
      this.logger.error('Failed to start service:', error instanceof Error ? error : String(error));
      process.exit(1);
    }
  }

  public async stop(): Promise<void> {
    try {
      this.logger.info('Stopping Gooch Feeder Service...');
      this.isRunning = false;
      
      await this.serviceManager.shutdown();
      
      this.logger.info('Gooch Feeder Service stopped');
      process.exit(0);
    } catch (error) {
      this.logger.error('Error during shutdown:', error instanceof Error ? error : String(error));
      process.exit(1);
    }
  }

  private keepAlive(): void {
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      this.logger.info('Received SIGINT, shutting down gracefully...');
      this.stop();
    });

    process.on('SIGTERM', () => {
      this.logger.info('Received SIGTERM, shutting down gracefully...');
      this.stop();
    });

    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught Exception:', error);
      this.stop();
    });

    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Unhandled Rejection at:', String(promise), undefined, 'reason:', reason instanceof Error ? reason : String(reason));
      this.stop();
    });

    // Keep the process alive with a heartbeat
    const heartbeat = setInterval(() => {
      if (this.isRunning) {
        this.logger.debug('Service heartbeat - running normally');
      } else {
        clearInterval(heartbeat);
      }
    }, 60000); // Log every minute

    // Optional: Add a keep-alive mechanism for long-running tasks
    this.startBackgroundTasks();
  }

  private startBackgroundTasks(): void {
    // Example: Run a task every 30 seconds
    setInterval(async () => {
      if (this.isRunning) {
        try {
          this.logger.debug('Running background task...');
          // Add your background task logic here
          await this.performBackgroundTask();
        } catch (error) {
          this.logger.error('Background task failed:', error instanceof Error ? error : String(error));
        }
      }
    }, 30000);
  }

  private registerServices(): void {
    this.logger.info('Registering services...');
    
    // Register account service
    const accountService = new AccountService();
    this.serviceManager.registerService(accountService);
    
    // Register network monitoring service
    const networkMonitoringService = new NetworkMonitoringService(this.networkConfigLoader);
    this.serviceManager.registerService(networkMonitoringService);
    
    // Register price feed service
    const priceFeedService = new PriceFeedService(this.networkConfigLoader);
    this.serviceManager.registerService(priceFeedService);
    
    // Register feeder manager service
    const feederManagerService = new FeederManagerService(this.networkConfigLoader, accountService);
    this.serviceManager.registerService(feederManagerService);
    
    this.logger.info('Services registered successfully');
  }

  private async loadNetworkConfigurations(): Promise<void> {
    try {
      this.logger.info('Loading network configurations...');
      const configs = await this.networkConfigLoader.loadConfigs();
      
      // Log loaded networks
      const enabledNetworks = this.networkConfigLoader.getEnabledNetworks();
      this.logger.info(`Loaded ${enabledNetworks.length} enabled networks:`);
      enabledNetworks.forEach(network => {
        this.logger.info(`  - ${network.name} (Chain ID: ${network.chainId})`);
      });
      
      // Log detailed network configurations
      const detailedNetworks = this.networkConfigLoader.getAllDetailedNetworks();
      if (Object.keys(detailedNetworks).length > 0) {
        this.logger.info(`Loaded ${Object.keys(detailedNetworks).length} detailed network configurations:`);
        Object.entries(detailedNetworks).forEach(([networkId, config]) => {
          this.logger.info(`  - ${config.networkConfig.name} (${networkId})`);
          this.logger.info(`    RPC: ${config.networkConfig.rpcUrl}`);
          this.logger.info(`    Tokens: ${Object.keys(config.networkConfig.tokens).join(', ')}`);
          this.logger.info(`    Price Oracle: ${config.networkConfig.contracts.priceOracle}`);
          
          // Log asset prices
          const assetPrices = this.networkConfigLoader.getAssetPrices(networkId);
          if (Object.keys(assetPrices).length > 0) {
            this.logger.info(`    Asset Prices:`);
            Object.entries(assetPrices).forEach(([assetId, price]) => {
              this.logger.info(`      ${price.symbol}: $${price.price} (${price.lastUpdated})`);
            });
          }
        });
      }
      
      // Log global settings
      const globalSettings = configs.globalSettings;
      this.logger.info('Global settings:', {
        maxConcurrentRequests: globalSettings.maxConcurrentRequests,
        requestDelay: globalSettings.requestDelay,
        healthCheckInterval: globalSettings.healthCheckInterval,
        circuitBreakerThreshold: globalSettings.circuitBreakerThreshold,
        circuitBreakerTimeout: globalSettings.circuitBreakerTimeout
      });
      
    } catch (error) {
      this.logger.error('Failed to load network configurations:', error instanceof Error ? error : String(error));
      throw error;
    }
  }

  private async performBackgroundTask(): Promise<void> {
    // Example background task - replace with your actual logic
    this.logger.debug('Performing background task...');
    
    // Check network health
    await this.checkNetworkHealth();
    
    // Simulate some work
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    this.logger.debug('Background task completed');
  }

  private async checkNetworkHealth(): Promise<void> {
    try {
      const enabledNetworks = this.networkConfigLoader.getEnabledNetworks();
      
      for (const network of enabledNetworks) {
        const startTime = Date.now();
        try {
          // Simple health check - you can implement actual network checks here
          // For now, we'll simulate a health check
          await new Promise(resolve => setTimeout(resolve, 100));
          
          const responseTime = Date.now() - startTime;
          this.networkConfigLoader.updateNetworkHealth(network.name.toLowerCase(), true, responseTime);
          
          this.logger.debug(`Network ${network.name} is healthy (${responseTime}ms)`);
        } catch (error) {
          this.networkConfigLoader.updateNetworkHealth(
            network.name.toLowerCase(), 
            false, 
            undefined, 
            error instanceof Error ? error.message : 'Unknown error'
          );
          this.logger.warn(`Network ${network.name} health check failed:`, error);
        }
      }
    } catch (error) {
      this.logger.error('Network health check failed:', error instanceof Error ? error : String(error));
    }
  }
}

// Start the service
const service = new GoochFeederService();
service.start().catch((error) => {
  console.error('Failed to start service:', error);
  process.exit(1);
});
