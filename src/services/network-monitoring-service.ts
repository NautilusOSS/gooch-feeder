import { Service } from '../types';
import { Logger } from '../utils/logger';
import { NetworkConfigLoader } from '../utils/network-config-loader';

export class NetworkMonitoringService implements Service {
  public name = 'NetworkMonitoringService';
  private logger: Logger;
  private networkConfigLoader: NetworkConfigLoader;

  constructor(networkConfigLoader: NetworkConfigLoader) {
    this.logger = new Logger('NetworkMonitoringService');
    this.networkConfigLoader = networkConfigLoader;
  }

  public async initialize(): Promise<void> {
    this.logger.info('Initializing Network Monitoring Service...');
    
    const configs = this.networkConfigLoader.getConfigs();
    if (!configs) {
      throw new Error('Network configurations not loaded');
    }

    this.logger.info(`Monitoring ${Object.keys(configs.networks).length} networks`);
    
    // Start monitoring loop
    this.startMonitoring();
  }

  public async shutdown(): Promise<void> {
    this.logger.info('Shutting down Network Monitoring Service...');
    // Cleanup any ongoing monitoring
  }

  public async isHealthy(): Promise<boolean> {
    try {
      const healthyNetworks = this.networkConfigLoader.getHealthyNetworks();
      const enabledNetworks = this.networkConfigLoader.getEnabledNetworks();
      
      // Service is healthy if at least one network is healthy
      return healthyNetworks.length > 0 && healthyNetworks.length >= enabledNetworks.length * 0.5;
    } catch (error) {
      this.logger.error('Health check failed:', error instanceof Error ? error : String(error));
      return false;
    }
  }

  private startMonitoring(): void {
    const configs = this.networkConfigLoader.getConfigs();
    if (!configs) return;

    const interval = configs.globalSettings.healthCheckInterval;
    
    setInterval(async () => {
      await this.performHealthChecks();
    }, interval);

    this.logger.info(`Started network monitoring with ${interval}ms interval`);
  }

  private async performHealthChecks(): Promise<void> {
    const enabledNetworks = this.networkConfigLoader.getEnabledNetworks();
    
    for (const network of enabledNetworks) {
      try {
        await this.checkNetworkConnectivity(network);
      } catch (error) {
        this.logger.error(`Health check failed for ${network.name}:`, error instanceof Error ? error : String(error));
      }
    }
  }

  private async checkNetworkConnectivity(network: any): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Here you would implement actual network connectivity checks
      // For example: HTTP requests to RPC endpoints, WebSocket connections, etc.
      
      // Simulate network check
      await new Promise(resolve => setTimeout(resolve, Math.random() * 1000));
      
      const responseTime = Date.now() - startTime;
      this.networkConfigLoader.updateNetworkHealth(network.name.toLowerCase(), true, responseTime);
      
      this.logger.debug(`${network.name} connectivity check passed (${responseTime}ms)`);
    } catch (error) {
      this.networkConfigLoader.updateNetworkHealth(
        network.name.toLowerCase(),
        false,
        undefined,
        error instanceof Error ? error.message : 'Unknown error'
      );
      
      this.logger.warn(`${network.name} connectivity check failed:`, error);
    }
  }
}
