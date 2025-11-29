import * as fs from "fs";
import * as path from "path";
import { Logger } from "../utils/logger";
import {
  NetworkConfigs,
  NetworkConfig,
  NetworkHealth,
  DetailedNetworkConfig,
} from "../types";
import { NetworkDirectoryLoader } from "./network-directory-loader";
import { Algodv2 } from "algosdk";

export class NetworkConfigLoader {
  private logger: Logger;
  private configPath: string;
  private networkConfigs: NetworkConfigs | null = null;
  private networkHealth: Map<string, NetworkHealth> = new Map();
  private directoryLoader: NetworkDirectoryLoader;

  constructor(configPath?: string) {
    this.logger = new Logger("NetworkConfigLoader");
    this.configPath =
      configPath || path.join(process.cwd(), "config", "networks.json");
    this.directoryLoader = new NetworkDirectoryLoader();
  }

  public async loadConfigs(): Promise<NetworkConfigs> {
    try {
      this.logger.info(
        `Loading network configurations from: ${this.configPath}`
      );

      if (!fs.existsSync(this.configPath)) {
        throw new Error(`Network config file not found: ${this.configPath}`);
      }

      const configData = fs.readFileSync(this.configPath, "utf8");
      const parsedConfig = JSON.parse(configData) as any;

      // Validate the basic configuration
      this.validateConfig(parsedConfig);

      // Load detailed network configurations from directory
      let detailedNetworks: Record<string, DetailedNetworkConfig> = {};
      if (parsedConfig.detailedNetworksDir) {
        try {
          this.logger.info(
            `Loading detailed network configurations from: ${parsedConfig.detailedNetworksDir}`
          );
          detailedNetworks = await this.directoryLoader.loadNetworkConfigs();
        } catch (error) {
          this.logger.warn(
            "Failed to load detailed network configurations:",
            error
          );
          // Continue without detailed configs
        }
      }

      // Create the complete configuration
      const completeConfig: NetworkConfigs = {
        networks: parsedConfig.networks,
        detailedNetworks,
        defaultNetwork: parsedConfig.defaultNetwork,
        fallbackNetworks: parsedConfig.fallbackNetworks,
        globalSettings: parsedConfig.globalSettings,
      };

      this.networkConfigs = completeConfig;

      // Initialize health tracking for each network
      this.initializeHealthTracking();

      this.logger.info(
        `Successfully loaded ${
          Object.keys(completeConfig.networks).length
        } network configurations`
      );
      this.logger.info(
        `Successfully loaded ${
          Object.keys(completeConfig.detailedNetworks).length
        } detailed network configurations`
      );
      this.logger.info(`Default network: ${completeConfig.defaultNetwork}`);
      this.logger.info(
        `Fallback networks: ${completeConfig.fallbackNetworks.join(", ")}`
      );

      return completeConfig;
    } catch (error) {
      this.logger.error(
        "Failed to load network configurations:",
        error instanceof Error ? error : String(error)
      );
      throw error;
    }
  }

  public getConfigs(): NetworkConfigs | null {
    return this.networkConfigs;
  }

  public getNetworkConfig(networkId: string): NetworkConfig | null {
    if (!this.networkConfigs) {
      return null;
    }
    return this.networkConfigs.networks[networkId] || null;
  }

  public getDefaultNetwork(): NetworkConfig | null {
    if (!this.networkConfigs) {
      return null;
    }
    return this.getNetworkConfig(this.networkConfigs.defaultNetwork);
  }

  public getEnabledNetworks(): NetworkConfig[] {
    if (!this.networkConfigs) {
      return [];
    }
    return Object.values(this.networkConfigs.networks).filter(
      (network) => network.enabled
    );
  }

  public getFallbackNetworks(): NetworkConfig[] {
    if (!this.networkConfigs) {
      return [];
    }
    return this.networkConfigs.fallbackNetworks
      .map((id) => this.getNetworkConfig(id))
      .filter(
        (config): config is NetworkConfig => config !== null && config.enabled
      );
  }

  public getDetailedNetworkConfig(
    networkId: string
  ): DetailedNetworkConfig | null {
    if (!this.networkConfigs) {
      return null;
    }
    return this.networkConfigs.detailedNetworks[networkId] || null;
  }

  public getAllDetailedNetworks(): Record<string, DetailedNetworkConfig> {
    if (!this.networkConfigs) {
      return {};
    }
    return this.networkConfigs.detailedNetworks;
  }

  public getSupportedTokens(networkId: string): string[] {
    const detailedConfig = this.getDetailedNetworkConfig(networkId);
    return detailedConfig
      ? Object.keys(detailedConfig.networkConfig.tokens)
      : [];
  }

  public getAssetPrices(networkId: string): Record<string, any> {
    const detailedConfig = this.getDetailedNetworkConfig(networkId);
    return detailedConfig ? detailedConfig.assetPrices : {};
  }

  public getContractAddresses(networkId: string): any {
    const detailedConfig = this.getDetailedNetworkConfig(networkId);
    return detailedConfig ? detailedConfig.networkConfig.contracts : null;
  }

  public getPreFiParameters(networkId: string): any {
    const detailedConfig = this.getDetailedNetworkConfig(networkId);
    return detailedConfig ? detailedConfig.networkConfig.preFiParameters : null;
  }

  public getTokenConfig(networkId: string, tokenSymbol: string): any {
    const detailedConfig = this.getDetailedNetworkConfig(networkId);
    return detailedConfig
      ? detailedConfig.networkConfig.tokens[tokenSymbol]
      : null;
  }

  public updateNetworkHealth(
    networkId: string,
    isHealthy: boolean,
    responseTime?: number,
    error?: string
  ): void {
    const health = this.networkHealth.get(networkId);
    if (health) {
      health.isHealthy = isHealthy;
      health.lastCheck = new Date();
      health.responseTime = responseTime;

      if (error) {
        health.errorCount++;
        health.lastError = error;
      } else {
        health.errorCount = 0;
        health.lastError = undefined;
      }
    }
  }

  public getNetworkHealth(networkId: string): NetworkHealth | null {
    return this.networkHealth.get(networkId) || null;
  }

  public getAllNetworkHealth(): Map<string, NetworkHealth> {
    return new Map(this.networkHealth);
  }

  public getHealthyNetworks(): string[] {
    const healthy: string[] = [];
    for (const [networkId, health] of this.networkHealth) {
      if (health.isHealthy) {
        healthy.push(networkId);
      }
    }
    return healthy;
  }

  private validateConfig(config: any): void {
    if (!config.networks || typeof config.networks !== "object") {
      throw new Error("Invalid config: networks object is required");
    }

    if (!config.defaultNetwork || typeof config.defaultNetwork !== "string") {
      throw new Error("Invalid config: defaultNetwork is required");
    }

    if (!config.fallbackNetworks || !Array.isArray(config.fallbackNetworks)) {
      throw new Error("Invalid config: fallbackNetworks array is required");
    }

    if (!config.globalSettings || typeof config.globalSettings !== "object") {
      throw new Error("Invalid config: globalSettings object is required");
    }

    // Validate each network
    for (const [networkId, network] of Object.entries(config.networks)) {
      this.validateNetworkConfig(networkId, network as any);
    }

    // Validate default network exists
    if (!config.networks[config.defaultNetwork]) {
      throw new Error(
        `Default network '${config.defaultNetwork}' not found in networks`
      );
    }

    // Validate fallback networks exist
    for (const fallbackId of config.fallbackNetworks) {
      if (!config.networks[fallbackId]) {
        throw new Error(
          `Fallback network '${fallbackId}' not found in networks`
        );
      }
    }
  }

  private validateNetworkConfig(networkId: string, network: any): void {
    const requiredFields = [
      "name",
      "chainId",
      "rpcUrl",
      "wsUrl",
      "explorerUrl",
    ];

    for (const field of requiredFields) {
      if (network[field] === undefined || network[field] === null) {
        throw new Error(
          `Network '${networkId}' missing required field: ${field}`
        );
      }
    }

    if (typeof network.chainId !== "number" || network.chainId < 0) {
      throw new Error(
        `Network '${networkId}' chainId must be a non-negative number`
      );
    }

    if (typeof network.enabled !== "boolean") {
      throw new Error(`Network '${networkId}' enabled must be a boolean`);
    }

    if (typeof network.timeout !== "number" || network.timeout <= 0) {
      throw new Error(
        `Network '${networkId}' timeout must be a positive number`
      );
    }

    if (typeof network.retries !== "number" || network.retries < 0) {
      throw new Error(
        `Network '${networkId}' retries must be a non-negative number`
      );
    }
  }

  private initializeHealthTracking(): void {
    if (!this.networkConfigs) return;

    for (const networkId of Object.keys(this.networkConfigs.networks)) {
      this.networkHealth.set(networkId, {
        networkId,
        isHealthy: true,
        lastCheck: new Date(),
        errorCount: 0,
      });
    }
  }

  public getAlgodClient(networkId: string): Algodv2 {
    const networkConfig = this.getNetworkConfig(networkId);
    if (!networkConfig) {
      throw new Error(`Network config not found for networkId: ${networkId}`);
    }
    return new Algodv2("", networkConfig.rpcUrl, 443);
  }

  public async reloadConfigs(): Promise<NetworkConfigs> {
    this.logger.info("Reloading network configurations...");
    return this.loadConfigs();
  }
}
