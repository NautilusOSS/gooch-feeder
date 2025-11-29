import { Logger, ErrorContext } from "../utils/logger";
import { ApiErrorHelper } from "../utils/api-error-helper";
import { PriceFeederConfig, PriceData, PriceFeedResult } from "../types";
import { NetworkConfigLoader } from "../utils/network-config-loader";
import { APP_SPEC as PriceOracleAppSpec } from "../clients/PriceOracleClient";
import { CONTRACT } from "ulujs";
import { AccountService } from "./account-service";
import { BigNumber } from "bignumber.js";
import algosdk, { waitForConfirmation } from "algosdk";

export class PriceOracleService {
  private logger: Logger;
  private networkConfigLoader: NetworkConfigLoader;
  private accountService: AccountService;

  constructor(
    networkConfigLoader: NetworkConfigLoader,
    accountService: AccountService
  ) {
    this.logger = new Logger("PriceOracleService");
    this.networkConfigLoader = networkConfigLoader;
    this.accountService = accountService;
  }

  public async postPrice(
    config: PriceFeederConfig,
    priceData: PriceData
  ): Promise<PriceFeedResult> {
    const startTime = Date.now();

    try {
      this.logger.debug(
        `Posting price for ${priceData.symbol} to price oracle`
      );

      let result: PriceFeedResult;

      switch (config.destination.type) {
        case "price-oracle":
          result = await this.postToPriceOracle(config, priceData);
          break;
        case "database":
          result = await this.postToDatabase(config, priceData);
          break;
        case "api":
          result = await this.postToAPI(config, priceData);
          break;
        default:
          throw new Error(
            `Unsupported destination type: ${config.destination.type}`
          );
      }

      const duration = Date.now() - startTime;
      result.duration = duration;

      this.logger.info(
        `Successfully posted price for ${priceData.symbol}: $${priceData.price}`
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      this.logger.error(
        `Failed to post price for ${priceData.symbol}:`,
        errorMessage
      );

      return {
        success: false,
        error: errorMessage,
        timestamp: new Date(),
        duration,
        retryCount: 0,
      };
    }
  }

  private async postToPriceOracle(
    config: PriceFeederConfig,
    priceData: PriceData
  ): Promise<PriceFeedResult> {
    // Get network configuration first to check for fallback contract address
    const networkConfig = this.networkConfigLoader.getDetailedNetworkConfig(
      config.networkId
    );
    if (!networkConfig) {
      throw new Error(
        `Network configuration not found for ${config.networkId}. ` +
        `Feeder ID: ${config.id}, Asset: ${config.assetSymbol}`
      );
    }

    // Check for missing required fields and provide detailed error
    const missingFields: string[] = [];
    if (!config.destination.contractAddress) {
      missingFields.push('contractAddress');
    }
    if (!config.destination.functionName) {
      missingFields.push('functionName');
    }

    if (missingFields.length > 0) {
      // Check if network config has a fallback contract address
      const networkContractAddress = networkConfig.networkConfig.contracts.priceOracle;
      const contractAddressSource = config.destination.contractAddress 
        ? `feeder config: "${config.destination.contractAddress}"`
        : networkContractAddress 
          ? `network config: "${networkContractAddress}"`
          : 'not found in feeder or network config';

      const errorDetails = [
        `Feeder ID: ${config.id}`,
        `Asset: ${config.assetSymbol}`,
        `Network: ${config.networkId}`,
        `Missing fields: ${missingFields.join(', ')}`,
        `Contract address: ${contractAddressSource}`,
        `Function name: ${config.destination.functionName || 'not specified'}`,
        `Market ID: ${config.destination.marketId || config.marketId || 'not specified'}`
      ].join('; ');

      throw new Error(
        `Contract address and function name are required for price oracle destination. ${errorDetails}`
      );
    }

    // Get price oracle contract address from network config if not specified in feeder config
    const contractAddress =
      config.destination.contractAddress ||
      networkConfig.networkConfig.contracts.priceOracle;

    this.logger.debug("contractAddress", contractAddress);

    if (!contractAddress) {
      const errorDetails = [
        `Feeder ID: ${config.id}`,
        `Asset: ${config.assetSymbol}`,
        `Network: ${config.networkId}`,
        `Contract address not found in feeder config (${config.destination.contractAddress || 'empty'}) or network config (${networkConfig.networkConfig.contracts.priceOracle || 'empty'})`
      ].join('; ');

      throw new Error(
        `Price oracle contract address not found for network ${config.networkId}. ${errorDetails}`
      );
    }

    this.logger.debug(
      `Posting to price oracle contract ${contractAddress} on ${config.networkId}`
    );

    // Convert price to appropriate format (e.g., multiply by decimals)
    const formattedPrice = this.formatPriceForContract(priceData.price, config);
    const timestamp = Math.floor(priceData.timestamp.getTime() / 1000); // Convert to Unix timestamp

    this.logger.debug("formattedPrice", formattedPrice);
    this.logger.debug("timestamp", timestamp);

    // This would implement the actual smart contract interaction
    // For now, simulate the transaction
    const algod = this.networkConfigLoader.getAlgodClient(config.networkId);
    const secretKey = this.accountService.getSecretKey();
    const address = this.accountService.getAddress();

    if (!secretKey || !address) {
      throw new Error("Account service not properly initialized");
    }

    // At this point, we know functionName is defined (checked earlier)
    const functionName = config.destination.functionName!;

    const ci = new CONTRACT(
      Number(contractAddress),
      algod,
      undefined,
      { ...PriceOracleAppSpec.contract, events: [] },
      { addr: address, sk: secretKey }
    );

    if (!ci[functionName]) {
      throw new Error(
        `Function ${functionName} not found in contract ${contractAddress}`
      );
    }

    // Use destination.marketId if available, otherwise fall back to config.marketId
    const marketId = Number(config.destination.marketId || config.marketId);
    const price = BigInt(formattedPrice);
    const post_priceR = await ci[functionName](
      marketId,
      price
    );
    this.logger.debug("post_priceR", post_priceR);

    if (!post_priceR.success) {
      throw new Error(
        `Failed to post price to price oracle: ${post_priceR.error}`
      );
    }

    const stxns = await post_priceR.txns.map((txn: any) =>
      algosdk
        .decodeUnsignedTransaction(Uint8Array.from(Buffer.from(txn, "base64")))
        .signTxn(secretKey)
    );

    const res = await algod.sendRawTransaction(stxns).do();
    await waitForConfirmation(algod, res.txId, 4);

    return {
      success: true,
      data: priceData,
      timestamp: new Date(),
      duration: 0,
      retryCount: 0,
    };
  }

  private async postToDatabase(
    config: PriceFeederConfig,
    priceData: PriceData
  ): Promise<PriceFeedResult> {
    // This would implement database storage
    // For now, simulate the operation
    this.logger.debug(`Storing price data in database for ${priceData.symbol}`);

    // Simulate database operation
    await new Promise((resolve) => setTimeout(resolve, 100));

    return {
      success: true,
      data: priceData,
      timestamp: new Date(),
      duration: 0,
      retryCount: 0,
    };
  }

  private async postToAPI(
    config: PriceFeederConfig,
    priceData: PriceData
  ): Promise<PriceFeedResult> {
    if (!config.destination.endpoint) {
      throw new Error("API endpoint is required for API destination type");
    }

    const payload = {
      symbol: priceData.symbol,
      price: priceData.price,
      timestamp: priceData.timestamp.toISOString(),
      networkId: priceData.networkId,
      poolId: priceData.poolId,
      marketId: priceData.marketId,
      source: priceData.source,
      confidence: priceData.confidence,
    };

    const requestInfo = {
      url: config.destination.endpoint,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...config.destination.headers,
      },
      body: payload,
      timeout: config.timeout,
    };

    try {
      const response = await fetch(requestInfo.url, {
        method: requestInfo.method,
        headers: requestInfo.headers,
        body: JSON.stringify(requestInfo.body),
        signal: AbortSignal.timeout(config.timeout),
      });

      if (!response.ok) {
        const errorContext =
          await ApiErrorHelper.createErrorContextFromResponse(
            requestInfo,
            response,
            {
              networkId: config.networkId,
              assetSymbol: config.assetSymbol,
            }
          );

        this.logger.error(
          `API post failed for ${config.assetSymbol}`,
          `HTTP ${response.status} ${response.statusText}`,
          ApiErrorHelper.sanitizeContext(errorContext)
        );

        throw new Error(
          `API request failed: ${response.status} ${response.statusText}`
        );
      }

      return {
        success: true,
        data: priceData,
        timestamp: new Date(),
        duration: 0,
        retryCount: 0,
      };
    } catch (error) {
      // Handle different types of errors
      if (error instanceof Error) {
        if (
          error.name === "TimeoutError" ||
          error.message.includes("timeout")
        ) {
          const errorContext = ApiErrorHelper.createTimeoutErrorContext(
            requestInfo,
            config.timeout,
            {
              networkId: config.networkId,
              assetSymbol: config.assetSymbol,
            }
          );

          this.logger.error(
            `API post timeout for ${config.assetSymbol}`,
            error,
            ApiErrorHelper.sanitizeContext(errorContext)
          );
        } else if (
          error.name === "TypeError" &&
          error.message.includes("fetch")
        ) {
          const errorContext = ApiErrorHelper.createNetworkErrorContext(
            requestInfo,
            error,
            {
              networkId: config.networkId,
              assetSymbol: config.assetSymbol,
            }
          );

          this.logger.error(
            `Network error for API post ${config.assetSymbol}`,
            error,
            ApiErrorHelper.sanitizeContext(errorContext)
          );
        } else {
          const errorContext = ApiErrorHelper.createErrorContext(
            requestInfo,
            undefined,
            {
              networkId: config.networkId,
              assetSymbol: config.assetSymbol,
            }
          );

          this.logger.error(
            `API post error for ${config.assetSymbol}`,
            error,
            ApiErrorHelper.sanitizeContext(errorContext)
          );
        }
      }

      throw error;
    }
  }

  private formatPriceForContract(
    price: number,
    config: PriceFeederConfig
  ): string {
    // Get token configuration to determine decimals
    const tokenConfig = this.networkConfigLoader.getTokenConfig(
      config.networkId,
      config.assetSymbol
    );
    const tokenDecimals = tokenConfig?.decimals || 6;

    // Adjust target price by 12 - token decimals
    // Price oracle uses 6 decimals as standard, but we need to adjust based on token decimals
    // Formula: 12 - tokenDecimals
    // Example: token with 8 decimals -> 12 - 8 = 4, so we use 10^4
    // Example: token with 6 decimals -> 12 - 6 = 6, so we use 10^6
    const targetAdjustment = 12 - tokenDecimals;
    const priceOracleDecimals = targetAdjustment;

    // Convert price to contract format
    // Price is per 1 standard unit of the token
    const multiplier = Math.pow(10, priceOracleDecimals);
    const formattedPrice = Math.floor(price * multiplier);

    return formattedPrice.toString();
  }

  private formatPriceFromContract(
    price: bigint | number,
    config: PriceFeederConfig
  ): number {
    // Get token configuration to determine decimals
    const tokenConfig = this.networkConfigLoader.getTokenConfig(
      config.networkId,
      config.assetSymbol
    );
    const tokenDecimals = tokenConfig?.decimals || 6;

    // Price oracle uses 6 decimals as standard, but we need to adjust based on token decimals
    // Formula: 12 - tokenDecimals
    // This must match the formatPriceForContract calculation
    const priceOracleDecimals = 12 - tokenDecimals;

    // Convert price from contract format
    const divisor = Math.pow(10, priceOracleDecimals);
    const priceNumber = typeof price === "bigint" ? Number(price) : price;
    return priceNumber / divisor;
  }

  private async getCurrentPriceFromContract(
    config: PriceFeederConfig
  ): Promise<number | null> {
    try {
      // Get network configuration
      const networkConfig = this.networkConfigLoader.getDetailedNetworkConfig(
        config.networkId
      );
      if (!networkConfig) {
        this.logger.warn(
          `Network configuration not found for ${config.networkId}`
        );
        return null;
      }

      // Get price oracle contract address from network config if not specified in feeder config
      const contractAddress =
        config.destination.contractAddress ||
        networkConfig.networkConfig.contracts.priceOracle;

      if (!contractAddress) {
        this.logger.warn(
          `Price oracle contract address not found for network ${config.networkId}`
        );
        return null;
      }

      const algod = this.networkConfigLoader.getAlgodClient(config.networkId);
      const secretKey = this.accountService.getSecretKey();
      const address = this.accountService.getAddress();

      if (!secretKey || !address) {
        this.logger.warn("Account service not properly initialized");
        return null;
      }

      const ci = new CONTRACT(
        Number(contractAddress),
        algod,
        undefined,
        { ...PriceOracleAppSpec.contract, events: [] },
        { addr: address, sk: secretKey }
      );

      // Check if get_price_with_timestamp method exists
      if (!ci.get_price_with_timestamp) {
        this.logger.warn(
          `get_price_with_timestamp method not found in contract ${contractAddress}`
        );
        return null;
      }

      // Use destination.marketId if available, otherwise fall back to config.marketId
      const marketId = Number(config.destination.marketId || config.marketId);

      this.logger.debug(
        `Getting current price for ${
          config.assetSymbol
        } with marketId/tokenId: ${marketId} (from destination.marketId: ${
          config.destination.marketId || "not set"
        }, config.marketId: ${config.marketId})`
      );

      try {
        // Try calling get_price_with_timestamp - it may need to be a read-only call
        // The CONTRACT class might try to create a transaction, which could fail
        const getPriceResult = await ci.get_price_with_timestamp(marketId);

        // Log the full result for debugging
        this.logger.debug(`getPriceResult for ${config.assetSymbol}:`, {
          success: getPriceResult.success,
          error: getPriceResult.error,
          return: getPriceResult.returnValue,
          hasReturn:
            getPriceResult.returnValue !== undefined &&
            getPriceResult.returnValue !== null,
        });

        if (!getPriceResult.success) {
          const errorMsg = getPriceResult.error || "Unknown error";
          this.logger.warn(
            `Failed to get current price from contract (success=false) for ${config.assetSymbol}: ${errorMsg}`
          );
          // Try to extract more details from the error
          if (getPriceResult.error) {
            this.logger.debug(`Full error details:`, getPriceResult.error);
          }
          return null;
        }

        if (
          getPriceResult.returnValue === undefined ||
          getPriceResult.returnValue === null
        ) {
          this.logger.warn(
            `Failed to get current price from contract: return value is undefined for ${config.assetSymbol}`
          );
          return null;
        }

        // Extract price from the returned value
        // get_price_with_timestamp returns (uint256, uint64) which could be:
        // - An array [price, timestamp]
        // - An object { price, timestamp }
        // - Just the price value
        let priceValue: bigint | number;
        if (Array.isArray(getPriceResult.returnValue)) {
          // Tuple returned as array: [price, timestamp]
          priceValue = getPriceResult.returnValue[0];
        } else if (
          getPriceResult.returnValue &&
          typeof getPriceResult.returnValue === "object" &&
          "price" in getPriceResult.returnValue
        ) {
          // Object with price property: { price, timestamp }
          priceValue = (getPriceResult.returnValue as any).price;
        } else {
          // Just the price value
          priceValue = getPriceResult.returnValue;
        }

        this.logger.debug("priceValue", priceValue);

        // Convert from contract format to regular price
        const currentPrice = this.formatPriceFromContract(priceValue, config);

        this.logger.debug(
          `Retrieved current price for ${config.assetSymbol}: $${currentPrice}`
        );

        return currentPrice;
      } catch (getPriceError) {
        const errorMessage =
          getPriceError instanceof Error
            ? getPriceError.message
            : "Unknown error";
        this.logger.warn(
          `Exception calling get_price_with_timestamp method for ${config.assetSymbol}:`,
          errorMessage
        );
        this.logger.debug(
          `getPriceError stack:`,
          getPriceError instanceof Error
            ? getPriceError.stack
            : "No stack trace"
        );
        return null;
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.warn(
        `Error getting current price from contract for ${config.assetSymbol}:`,
        errorMessage
      );
      this.logger.debug(
        `Error stack:`,
        error instanceof Error ? error.stack : "No stack trace"
      );
      return null;
    }
  }

  private async simulateContractCall(
    contractAddress: string,
    functionName: string,
    params: any
  ): Promise<void> {
    this.logger.debug(
      `Simulating contract call to ${contractAddress}.${functionName}`,
      params
    );

    // Simulate contract call delay
    await new Promise((resolve) => setTimeout(resolve, 200));

    // In a real implementation, this would:
    // 1. Connect to the blockchain network
    // 2. Create a transaction to call the contract function
    // 3. Sign and broadcast the transaction
    // 4. Wait for confirmation

    this.logger.debug(`Contract call simulated successfully`);
  }

  public async postWithRetry(
    config: PriceFeederConfig,
    priceData: PriceData
  ): Promise<PriceFeedResult> {
    // Get token configuration to determine decimals for target adjustment
    console.log("config.networkId", config.networkId);
    console.log("config.assetSymbol", config.assetSymbol);
    const tokenConfig = this.networkConfigLoader.getTokenConfig(
      config.networkId,
      config.assetSymbol
    );
    const tokenDecimals = tokenConfig?.decimals || 6;
    console.log("tokenDecimals", tokenDecimals);
    const targetAdjustment = 12 - tokenDecimals;
    const adjustmentMultiplier = Math.pow(10, targetAdjustment);

    // Adjust target price by 12 - token decimals for contract scale comparisons
    const rawTargetPrice = priceData.price;
    const adjustedTargetPrice = rawTargetPrice * adjustmentMultiplier;

    const maxRetries = 5;
    let lastError: string = "";

    // Check if fetched price equals current contract price - if so, do nothing
    const currentPrice = await this.getCurrentPriceFromContract(config);
    if (currentPrice !== null) {
      // Adjust current price to contract scale for comparison
      const adjustedCurrentPrice = currentPrice * adjustmentMultiplier;
      // Use a small tolerance for floating point comparison (0.000001)
      const priceDifference = Math.abs(
        adjustedTargetPrice - adjustedCurrentPrice
      );
      if (priceDifference < 0.000001) {
        this.logger.info(
          `Fetched price ($${rawTargetPrice.toFixed(
            6
          )}) equals current contract price ($${currentPrice.toFixed(
            6
          )}). Skipping post for ${priceData.symbol}.`
        );
        return {
          success: true,
          data: priceData,
          timestamp: new Date(),
          duration: 0,
          retryCount: 0,
        };
      }
    }

    // Attempt 0: Try posting the original target price
    try {
      const result = await this.postPrice(config, priceData);
      if (!result.success) {
        throw new Error(result.error);
      }
      result.retryCount = 0;
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown error";
      const errorContext = {
        feederId: config.id,
        assetSymbol: priceData.symbol,
        networkId: config.networkId,
        marketId: config.destination.marketId || config.marketId,
        contractAddress: config.destination.contractAddress || 'not specified',
        functionName: config.destination.functionName || 'not specified',
        error: lastError
      };
      this.logger.warn(
        `Initial price post failed for ${priceData.symbol} (Feeder: ${config.id}, Network: ${config.networkId}), will retry up to ${maxRetries} times using midpoint strategy`,
        lastError,
        errorContext
      );
    }

    // Retry attempts 1-5: Use midpoint between current price and target, moving closer to on-chain each time
    // Work in contract scale for midpoint calculations
    let lastAttemptedPriceAdjusted = adjustedTargetPrice; // Track the last adjusted price we tried to post

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Get current price from contract
        const currentPrice = await this.getCurrentPriceFromContract(config);

        if (currentPrice === null) {
          this.logger.warn(
            `Attempt ${attempt}/${maxRetries}: Could not get current price from contract for ${priceData.symbol}. Skipping this attempt.`
          );
          // Skip this attempt and continue to next iteration
          continue;
        }

        // Adjust current price to contract scale for midpoint calculation
        const adjustedCurrentPrice = currentPrice * adjustmentMultiplier;

        // Calculate midpoint between current on-chain price and the last attempted price in contract scale
        // This moves us closer to the on-chain price with each retry
        const midpointPriceAdjusted =
          (adjustedCurrentPrice + lastAttemptedPriceAdjusted) / 2;

        // Convert back to raw USD scale for posting
        const midpointPrice = midpointPriceAdjusted / adjustmentMultiplier;

        this.logger.info(
          `Retry attempt ${attempt}/${maxRetries}: Using midpoint moving toward on-chain price. Current on-chain: $${currentPrice.toFixed(
            6
          )}, Last attempted: $${(
            lastAttemptedPriceAdjusted / adjustmentMultiplier
          ).toFixed(6)}, Target: $${rawTargetPrice.toFixed(
            6
          )}, Posting midpoint: $${midpointPrice.toFixed(6)}`
        );

        // Create new price data with midpoint price (in raw USD scale)
        const midpointPriceData: PriceData = {
          ...priceData,
          price: midpointPrice,
        };

        const result = await this.postPrice(config, midpointPriceData);

        if (result.success) {
          result.retryCount = attempt;
          this.logger.info(
            `Successfully posted price on attempt ${attempt}/${maxRetries} for ${priceData.symbol}`
          );
          return result;
        } else {
          // If post failed, update lastAttemptedPriceAdjusted for next iteration (keep in contract scale)
          lastAttemptedPriceAdjusted = midpointPriceAdjusted;
          lastError = result.error || "Unknown error";
          this.logger.warn(
            `Attempt ${attempt}/${maxRetries} failed for ${priceData.symbol}: ${lastError}`
          );
        }
      } catch (retryError) {
        const retryErrorMessage =
          retryError instanceof Error ? retryError.message : "Unknown error";
        lastError = retryErrorMessage;
        this.logger.warn(
          `Attempt ${attempt}/${maxRetries} threw exception for ${priceData.symbol}: ${retryErrorMessage}`
        );
        // Continue to next attempt
      }
    }

    // All retry attempts failed
    this.logger.error(
      `All ${maxRetries} retry attempts failed for ${priceData.symbol}. Last error: ${lastError}`
    );

    return {
      success: false,
      error: `Failed after ${maxRetries} retry attempts. Initial error: ${lastError}`,
      timestamp: new Date(),
      duration: 0,
      retryCount: maxRetries,
    };
  }

  public async fetchAndPost(
    config: PriceFeederConfig,
    priceLookupService: any
  ): Promise<PriceFeedResult> {
    try {
      this.logger.debug(`Starting fetch-and-post for ${config.assetSymbol}`);

      // First, fetch the price
      const fetchResult = await priceLookupService.fetchWithRetry(config);

      if (!fetchResult.success || !fetchResult.data) {
        return {
          success: false,
          error: `Failed to fetch price: ${fetchResult.error}`,
          timestamp: new Date(),
          duration: fetchResult.duration,
          retryCount: fetchResult.retryCount,
        };
      }

      // Then, post the price
      const postResult = await this.postWithRetry(config, fetchResult.data);

      if (!postResult.success) {
        return {
          success: false,
          error: `Failed to post price: ${postResult.error}`,
          timestamp: new Date(),
          duration: fetchResult.duration + postResult.duration,
          retryCount: Math.max(fetchResult.retryCount, postResult.retryCount),
        };
      }

      return {
        success: true,
        data: fetchResult.data,
        timestamp: new Date(),
        duration: fetchResult.duration + postResult.duration,
        retryCount: Math.max(fetchResult.retryCount, postResult.retryCount),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(
        `Fetch-and-post failed for ${config.assetSymbol}:`,
        errorMessage
      );

      return {
        success: false,
        error: errorMessage,
        timestamp: new Date(),
        duration: 0,
        retryCount: 0,
      };
    }
  }
}
