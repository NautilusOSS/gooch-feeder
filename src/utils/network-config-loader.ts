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
      let completeConfig: NetworkConfigs = {
        networks: parsedConfig.networks,
        detailedNetworks,
        defaultNetwork: parsedConfig.defaultNetwork,
        fallbackNetworks: parsedConfig.fallbackNetworks,
        globalSettings: parsedConfig.globalSettings,
      };

      // Apply dev mode overrides if enabled
      if (this.isDevMode()) {
        this.logger.info("DEV_MODE enabled - applying localnet overrides");
        completeConfig = this.applyDevModeOverrides(completeConfig);
      }

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

  public getTokenConfigByContractId(networkId: string, contractId: string): any {
    const detailedConfig = this.getDetailedNetworkConfig(networkId);
    if (!detailedConfig) {
      return null;
    }

    // Search through all tokens to find one with matching contractId
    const tokens = detailedConfig.networkConfig.tokens;
    for (const tokenSymbol in tokens) {
      const token = tokens[tokenSymbol];
      if (token.contractId === contractId) {
        return token;
      }
    }

    return null;
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

    // In dev mode, use localhost settings for localnet
    if (this.isDevMode() && networkId === "localnet") {
      const ALGO_SERVER = "http://localhost";
      const ALGO_PORT = 4001;
      // Default localnet token (can be overridden via DEV_ALGOD_TOKEN env var)
      const DEFAULT_LOCALNET_TOKEN = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const token = process.env.DEV_ALGOD_TOKEN || DEFAULT_LOCALNET_TOKEN;
      this.logger.info(
        `[ALGOD CONFIG] Dev mode: Using localnet algod at ${ALGO_SERVER}:${ALGO_PORT} with token ${token.substring(0, 8)}...`
      );
      return new Algodv2(token, ALGO_SERVER, ALGO_PORT);
    }

    // Convert networkId to environment variable prefix (e.g., "algorand-mainnet" -> "ALGORAND_MAINNET")
    const envPrefix = networkId.toUpperCase().replace(/-/g, "_");
    const envUrlKey = `${envPrefix}_ALGOD_URL`;
    const envPortKey = `${envPrefix}_ALGOD_PORT`;
    const envTokenKey = `${envPrefix}_ALGOD_TOKEN`;

    // Check environment variables first (highest priority)
    const envUrl = process.env[envUrlKey];
    const envPort = process.env[envPortKey];
    const envToken = process.env[envTokenKey];

    // Log what we're checking (helpful for debugging)
    this.logger.debug(
      `Checking env vars for ${networkId}: ${envUrlKey}=${envUrl ? 'set' : 'undefined'}, ${envPortKey}=${envPort || 'undefined'}, ${envTokenKey}=${envToken ? 'set' : 'undefined'}`
    );

    if (envUrl) {
      const token = envToken || "";
      const port = envPort ? parseInt(envPort, 10) : 443;
      this.logger.info(
        `[ALGOD CONFIG] Using environment variable override for ${networkId}: ${envUrl}:${port}`
      );
      return new Algodv2(token, envUrl, port);
    }

    // Check for explicit algod override in network config
    if (networkConfig.algod?.url) {
      const token = networkConfig.algod.token || "";
      const port = networkConfig.algod.port || 443;
      this.logger.info(
        `[ALGOD CONFIG] Using config algod override for ${networkId}: ${networkConfig.algod.url}:${port}`
      );
      return new Algodv2(token, networkConfig.algod.url, port);
    }

    // Check detailed network config for rpcUrl and rpcToken
    const detailedConfig = this.getDetailedNetworkConfig(networkId);
    if (detailedConfig?.networkConfig) {
      const token = detailedConfig.networkConfig.rpcToken || "";
      const port = detailedConfig.networkConfig.rpcPort || 443;
      const url = detailedConfig.networkConfig.rpcUrl || networkConfig.rpcUrl;
      this.logger.info(
        `[ALGOD CONFIG] Using detailed network config for ${networkId} algod: ${url}:${port}`
      );
      return new Algodv2(token, url, port);
    }

    // Fall back to basic network config
    this.logger.info(
      `[ALGOD CONFIG] Using basic network config (default) for ${networkId} algod: ${networkConfig.rpcUrl}:443`
    );
    return new Algodv2("", networkConfig.rpcUrl, 443);
  }

  public async reloadConfigs(): Promise<NetworkConfigs> {
    this.logger.info("Reloading network configurations...");
    return this.loadConfigs();
  }

  /**
   * Check if dev mode is enabled via environment variable
   */
  private isDevMode(): boolean {
    return process.env.DEV_MODE === "true" || process.env.DEV_MODE === "1";
  }

  /**
   * Apply dev mode overrides to network configuration
   */
  private applyDevModeOverrides(config: NetworkConfigs): NetworkConfigs {
    const NETWORK = "localnet";
    const ALGO_SERVER = "http://localhost";
    const ALGO_PORT = 4001;
    const ALGO_INDEXER_SERVER = "http://localhost";
    const ALGO_INDEXER_PORT = 8980;
    // Default localnet token (can be overridden via DEV_ALGOD_TOKEN env var)
    const DEFAULT_LOCALNET_TOKEN = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const token = process.env.DEV_ALGOD_TOKEN || DEFAULT_LOCALNET_TOKEN;

    // Create localnet network config
    const localnetConfig: NetworkConfig = {
      name: "Local Network",
      chainId: 0,
      rpcUrl: ALGO_SERVER,
      wsUrl: ALGO_SERVER.replace("http", "ws"),
      explorerUrl: "http://localhost",
      enabled: true,
      timeout: 30000,
      retries: 3,
      algod: {
        url: ALGO_SERVER,
        port: ALGO_PORT,
        token: token,
      },
    };

    // Override networks to only include localnet
    const overriddenConfig: NetworkConfigs = {
      ...config,
      networks: {
        [NETWORK]: localnetConfig,
      },
      defaultNetwork: NETWORK,
      fallbackNetworks: [],
    };

    // Create a minimal detailed network config for localnet
    const localnetDetailedConfig: DetailedNetworkConfig = {
      metadata: {
        network: NETWORK,
        exportDate: new Date().toISOString(),
        contractId: "",
        isDeployed: false,
        hasPriceOracleRole: false,
      },
      networkConfig: {
        networkId: NETWORK,
        walletNetworkId: NETWORK,
        name: "Local Network",
        networkType: "avm",
        rpcUrl: ALGO_SERVER,
        rpcPort: ALGO_PORT,
        rpcToken: token,
        indexerUrl: `${ALGO_INDEXER_SERVER}:${ALGO_INDEXER_PORT}`,
        explorerUrl: "http://localhost",
        faucetUrl: "",
        contracts: {
          priceOracle: "", // Will be overridden in feeders
          marketController: "",
          sToken: "",
          lendingPools: [],
        },
        tokens: {},
        gasStation: {},
        preFiParameters: {
          collateral_factor: 0,
          liquidation_threshold: 0,
          reserve_factor: 0,
          borrow_rate_base: 0,
          slope: 0,
          liquidation_bonus: 0,
          close_factor: 0,
          max_borrow_caps: {
            stablecoins: "0",
            majors: "0",
            volatile: "0",
          },
        },
      },
      supportedAssets: [],
      contractState: {
        appId: 0,
        creator: "",
        globalState: [],
        localState: [],
      },
      assetPrices: {},
      priceFeedStatus: {},
    };

    overriddenConfig.detailedNetworks = {
      [NETWORK]: localnetDetailedConfig,
    };

    this.logger.info(
      `Dev mode: Overriding network configuration to use ${NETWORK} at ${ALGO_SERVER}:${ALGO_PORT} with token ${token.substring(0, 8)}...`
    );

    return overriddenConfig;
  }

  /**
   * Debug helper: Log all environment variables related to algod configuration
   */
  public logAlgodEnvVars(): void {
    if (!this.networkConfigs) {
      this.logger.warn("Network configs not loaded yet");
      return;
    }

    this.logger.info("Checking for algod-related environment variables...");
    const envVars = Object.keys(process.env)
      .filter((key) => key.includes("ALGOD"))
      .sort();

    if (envVars.length === 0) {
      this.logger.info("No ALGOD-related environment variables found");
    } else {
      this.logger.info(`Found ${envVars.length} ALGOD-related environment variables:`);
      envVars.forEach((key) => {
        const value = process.env[key];
        // Mask sensitive values (tokens)
        const displayValue = key.includes("TOKEN") && value
          ? "***"
          : value || "undefined";
        this.logger.info(`  ${key}=${displayValue}`);
      });
    }

    // Also check what each network would use
    this.logger.info("Algod client resolution for each network:");
    Object.keys(this.networkConfigs.networks).forEach((networkId) => {
      const envPrefix = networkId.toUpperCase().replace(/-/g, "_");
      const envUrl = process.env[`${envPrefix}_ALGOD_URL`];
      const envPort = process.env[`${envPrefix}_ALGOD_PORT`];
      const envToken = process.env[`${envPrefix}_ALGOD_TOKEN`];
      const networkConfig = this.getNetworkConfig(networkId);
      const detailedConfig = this.getDetailedNetworkConfig(networkId);

      this.logger.info(`  ${networkId}:`);
      this.logger.info(`    Env URL: ${envUrl || "not set"}`);
      this.logger.info(`    Env Port: ${envPort || "not set"}`);
      this.logger.info(`    Env Token: ${envToken ? "***" : "not set"}`);
      this.logger.info(`    Config algod.url: ${networkConfig?.algod?.url || "not set"}`);
      this.logger.info(`    Detailed rpcUrl: ${detailedConfig?.networkConfig?.rpcUrl || "not set"}`);
      this.logger.info(`    Basic rpcUrl: ${networkConfig?.rpcUrl || "not set"}`);
    });
  }
}
