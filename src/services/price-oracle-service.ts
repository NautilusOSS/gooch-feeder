import { Logger, ErrorContext } from "../utils/logger";
import { ApiErrorHelper } from "../utils/api-error-helper";
import {
  PriceFeederConfig,
  PriceData,
  PriceFeedResult,
  BatchFeedItem,
  BatchFeedResult,
  BatchProcessingResult,
} from "../types";
import { NetworkConfigLoader } from "../utils/network-config-loader";
import { APP_SPEC as PriceOracleAppSpec } from "../clients/GoochClient";
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
      missingFields.push("contractAddress");
    }
    if (!config.destination.functionName) {
      missingFields.push("functionName");
    }

    if (missingFields.length > 0) {
      // Check if network config has a fallback contract address
      const networkContractAddress =
        networkConfig.networkConfig.contracts.priceOracle;
      const contractAddressSource = config.destination.contractAddress
        ? `feeder config: "${config.destination.contractAddress}"`
        : networkContractAddress
        ? `network config: "${networkContractAddress}"`
        : "not found in feeder or network config";

      const errorDetails = [
        `Feeder ID: ${config.id}`,
        `Asset: ${config.assetSymbol}`,
        `Network: ${config.networkId}`,
        `Missing fields: ${missingFields.join(", ")}`,
        `Contract address: ${contractAddressSource}`,
        `Function name: ${config.destination.functionName || "not specified"}`,
        `Market ID: ${
          config.destination.marketId || config.marketId || "not specified"
        }`,
      ].join("; ");

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
        `Contract address not found in feeder config (${
          config.destination.contractAddress || "empty"
        }) or network config (${
          networkConfig.networkConfig.contracts.priceOracle || "empty"
        })`,
      ].join("; ");

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

    this.logger.info(
      `Calling ${functionName} on contract ${contractAddress} ` +
        `(feeder: ${config.id}, asset: ${config.assetSymbol}, ` +
        `marketId: ${marketId}, price: $${priceData.price}, formatted: ${formattedPrice})`
    );

    const post_priceR = await ci[functionName](marketId, price);

    console.log("post_priceR", post_priceR);

    this.logger.info(
      `Contract call result for ${config.id} (${config.assetSymbol}): ` +
        `success=${post_priceR.success}, ` +
        `marketId=${marketId}, ` +
        `contract=${contractAddress}, ` +
        `network=${config.networkId}` +
        (post_priceR.error ? `, error=${post_priceR.error}` : "")
    );

    if (!post_priceR.success) {
      const errorMsg = `Failed to post price to price oracle: ${post_priceR.error}`;
      this.logger.error(
        `${errorMsg} (feeder: ${config.id}, asset: ${config.assetSymbol}, ` +
          `marketId: ${marketId}, contract: ${contractAddress}, network: ${config.networkId})`
      );
      throw new Error(errorMsg);
    }

    const stxns = await post_priceR.txns.map((txn: any) =>
      algosdk
        .decodeUnsignedTransaction(Uint8Array.from(Buffer.from(txn, "base64")))
        .signTxn(secretKey)
    );

    this.logger.debug(
      `Prepared ${stxns.length} transaction(s) for ${config.id} (${config.assetSymbol})`
    );

    const res = await algod.sendRawTransaction(stxns).do();
    this.logger.info(
      `Transaction submitted for ${config.id} (${config.assetSymbol}): ` +
        `txId=${res.txId}, network=${config.networkId}, contract=${contractAddress}`
    );

    await waitForConfirmation(algod, res.txId, 4);

    this.logger.info(
      `Transaction confirmed for ${config.id} (${config.assetSymbol}): ` +
      `txId=${res.txId}, network=${config.networkId}`
    );

    return {
      success: true,
      data: priceData,
      timestamp: new Date(),
      duration: 0,
      retryCount: 0,
      batchSize: 1, // Individual post = 1 feed per transaction
      batchIndex: 0,
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
    // Get marketId (contractId) - this is the token ID in the price oracle contract
    const marketId = config.destination.marketId || config.marketId;
    
    // Try to get token config by contractId (marketId) first, as this is the actual token
    // that the price oracle contract uses for this market
    let tokenConfig = null;
    let tokenDecimals = 6; // default
    
    if (marketId) {
      tokenConfig = this.networkConfigLoader.getTokenConfigByContractId(
        config.networkId,
        String(marketId)
      );
    }
    
    // Fallback to assetSymbol if we couldn't find by contractId
    if (!tokenConfig) {
      tokenConfig = this.networkConfigLoader.getTokenConfig(
        config.networkId,
        config.assetSymbol
      );
    }
    
    tokenDecimals = tokenConfig?.decimals || 6;

    // Log which token we're using for decimals (for debugging)
    if (marketId && tokenConfig) {
      this.logger.debug(
        `Using decimals from market token (contractId: ${marketId}, symbol: ${tokenConfig.symbol}, decimals: ${tokenDecimals})`
      );
    } else {
      this.logger.debug(
        `Using decimals from asset symbol (${config.assetSymbol}, decimals: ${tokenDecimals})`
      );
    }

    // Adjust target price by 12 - token decimals
    // Price oracle uses 12 decimals as standard, but we need to adjust based on token decimals
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
    // Get marketId (contractId) - this is the token ID in the price oracle contract
    const marketId = config.destination.marketId || config.marketId;
    
    // Try to get token config by contractId (marketId) first, as this is the actual token
    // that the price oracle contract uses for this market
    let tokenConfig = null;
    let tokenDecimals = 6; // default
    
    if (marketId) {
      tokenConfig = this.networkConfigLoader.getTokenConfigByContractId(
        config.networkId,
        String(marketId)
      );
    }
    
    // Fallback to assetSymbol if we couldn't find by contractId
    if (!tokenConfig) {
      tokenConfig = this.networkConfigLoader.getTokenConfig(
        config.networkId,
        config.assetSymbol
      );
    }
    
    tokenDecimals = tokenConfig?.decimals || 6;

    // Price oracle uses 12 decimals as standard, but we need to adjust based on token decimals
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

        // Extract price and timestamp from return value
        // get_price_with_timestamp returns (uint256, uint64) which could be:
        // - An array [price, timestamp]
        // - An object { price, timestamp }
        // - Just the price value
        let priceValue: bigint | number | undefined;
        let timestampValue: bigint | number | undefined;
        let returnType = 'unknown';
        
        if (Array.isArray(getPriceResult.returnValue)) {
          returnType = 'array';
          priceValue = getPriceResult.returnValue[0];
          timestampValue = getPriceResult.returnValue[1];
        } else if (
          getPriceResult.returnValue &&
          typeof getPriceResult.returnValue === "object" &&
          "price" in getPriceResult.returnValue
        ) {
          returnType = 'object';
          priceValue = (getPriceResult.returnValue as any).price;
          timestampValue = (getPriceResult.returnValue as any).timestamp;
        } else {
          returnType = 'single';
          priceValue = getPriceResult.returnValue;
        }

        // Check if priceValue was extracted successfully
        if (priceValue === undefined) {
          this.logger.warn(
            `Failed to extract price from return value for ${config.assetSymbol}`
          );
          return null;
        }

        // Format price for display
        const formattedPrice = typeof priceValue === 'bigint' 
          ? priceValue.toString() 
          : String(priceValue);
        
        // Format timestamp for display
        let formattedTimestamp = 'undefined';
        if (timestampValue !== undefined) {
          if (typeof timestampValue === 'bigint') {
            const ts = Number(timestampValue);
            formattedTimestamp = `${timestampValue.toString()} (${ts > 0 ? new Date(ts * 1000).toISOString() : 'epoch'})`;
          } else {
            const ts = Number(timestampValue);
            formattedTimestamp = `${timestampValue} (${ts > 0 ? new Date(ts * 1000).toISOString() : 'epoch'})`;
          }
        }

        // Log the full result for debugging with enhanced information
        this.logger.debug(`getPriceResult for ${config.assetSymbol}:`, {
          networkId: config.networkId,
          contractAddress: contractAddress,
          marketId: marketId,
          feederId: config.id,
          success: getPriceResult.success,
          error: getPriceResult.error,
          returnType: returnType,
          returnValue: getPriceResult.returnValue,
          hasReturn:
            getPriceResult.returnValue !== undefined &&
            getPriceResult.returnValue !== null,
          price: formattedPrice,
          timestamp: formattedTimestamp,
          priceIsZero: (
            (typeof priceValue === 'bigint' && priceValue === 0n) ||
            (typeof priceValue === 'number' && priceValue === 0)
          ),
          interpretation: (
            (typeof priceValue === 'bigint' && priceValue === 0n) ||
            (typeof priceValue === 'number' && priceValue === 0)
          ) ? 'No price set (price is 0)' : 'Price is set'
        });

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
    // Get marketId (contractId) - this is the token ID in the price oracle contract
    const marketId = config.destination.marketId || config.marketId;
    
    // Try to get token config by contractId (marketId) first, as this is the actual token
    // that the price oracle contract uses for this market
    let tokenConfig = null;
    let tokenDecimals = 6; // default
    
    if (marketId) {
      tokenConfig = this.networkConfigLoader.getTokenConfigByContractId(
        config.networkId,
        String(marketId)
      );
    }
    
    // Fallback to assetSymbol if we couldn't find by contractId
    if (!tokenConfig) {
      tokenConfig = this.networkConfigLoader.getTokenConfig(
        config.networkId,
        config.assetSymbol
      );
    }
    
    tokenDecimals = tokenConfig?.decimals || 6;
    
    this.logger.debug(
      `Using decimals for price comparison: ${tokenDecimals} ` +
      `(from ${tokenConfig && marketId ? `market token contractId: ${marketId}` : `asset symbol: ${config.assetSymbol}`})`
    );
    
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
        contractAddress: config.destination.contractAddress || "not specified",
        functionName: config.destination.functionName || "not specified",
        error: lastError,
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

  /**
   * Posts a batch of prices to the oracle
   * Groups by network and destination type for efficient processing
   */
  public async postBatch(
    batchItems: BatchFeedItem[],
    priceLookupService: any
  ): Promise<BatchProcessingResult> {
    const startTime = Date.now();
    const results: BatchFeedResult[] = [];

    if (batchItems.length === 0) {
      return {
        success: true,
        totalProcessed: 0,
        successful: 0,
        failed: 0,
        results: [],
        duration: 0,
        timestamp: new Date(),
      };
    }

    this.logger.info(`Processing batch of ${batchItems.length} feeders`);

    // Group by network and destination type
    const groupedBatches = this.groupBatchItems(batchItems);

    // Process each group
    for (const [groupKey, items] of groupedBatches) {
      const [networkId, destinationType] = groupKey.split("::");
      this.logger.debug(
        `Processing batch group: ${networkId} (${destinationType}) with ${items.length} items`
      );

      if (destinationType === "price-oracle" && items.length > 1) {
        // Try to batch post to oracle (if all same network and contract)
        const batchResult = await this.postBatchToPriceOracle(items);
        results.push(...batchResult);
      } else {
        // Process individually or by destination type
        for (const item of items) {
          let result: PriceFeedResult;

          if (item.priceData) {
            // Price data already fetched, just post
            result = await this.postPrice(item.config, item.priceData);
          } else {
            // Need to fetch and post
            result = await this.fetchAndPost(item.config, priceLookupService);
          }

          results.push({
            feederId: item.config.id,
            result,
            config: item.config,
          });
        }
      }
    }

    const duration = Date.now() - startTime;
    const successful = results.filter((r) => r.result.success).length;
    const failed = results.length - successful;

    this.logger.info(
      `Batch processing completed: ${successful}/${results.length} successful in ${duration}ms`
    );

    return {
      success: failed === 0,
      totalProcessed: results.length,
      successful,
      failed,
      results,
      duration,
      timestamp: new Date(),
    };
  }

  /**
   * Groups batch items by network and destination type
   */
  private groupBatchItems(
    items: BatchFeedItem[]
  ): Map<string, BatchFeedItem[]> {
    const groups = new Map<string, BatchFeedItem[]>();

    for (const item of items) {
      const networkId = item.config.networkId;
      const destinationType = item.config.destination.type;
      const key = `${networkId}::${destinationType}`;

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(item);
    }

    return groups;
  }

  /**
   * Posts a batch of prices to the price oracle contract
   * Attempts to use atomic transaction composer for efficiency
   */
  private async postBatchToPriceOracle(
    items: BatchFeedItem[]
  ): Promise<BatchFeedResult[]> {
    const results: BatchFeedResult[] = [];

    if (items.length === 0) {
      return results;
    }

    // All items should be same network (grouped)
    const networkId = items[0].config.networkId;
    const networkConfig =
      this.networkConfigLoader.getDetailedNetworkConfig(networkId);

    if (!networkConfig) {
      this.logger.error(
        `Network configuration not found for batch: ${networkId}`
      );
      // Return failed results for all items
      for (const item of items) {
        results.push({
          feederId: item.config.id,
          result: {
            success: false,
            error: `Network configuration not found for ${networkId}`,
            timestamp: new Date(),
            duration: 0,
            retryCount: 0,
          },
          config: item.config,
        });
      }
      return results;
    }

    const algod = this.networkConfigLoader.getAlgodClient(networkId);
    const secretKey = this.accountService.getSecretKey();
    const address = this.accountService.getAddress();

    if (!secretKey || !address) {
      const error = "Account service not properly initialized";
      this.logger.error(error);
      for (const item of items) {
        results.push({
          feederId: item.config.id,
          result: {
            success: false,
            error,
            timestamp: new Date(),
            duration: 0,
            retryCount: 0,
          },
          config: item.config,
        });
      }
      return results;
    }

    // Get contract address (should be same for all items in batch)
    const contractAddress =
      items[0].config.destination.contractAddress ||
      networkConfig.networkConfig.contracts.priceOracle;

    if (!contractAddress) {
      const error = `Price oracle contract address not found for network ${networkId}`;
      this.logger.error(error);
      for (const item of items) {
        results.push({
          feederId: item.config.id,
          result: {
            success: false,
            error,
            timestamp: new Date(),
            duration: 0,
            retryCount: 0,
          },
          config: item.config,
        });
      }
      return results;
    }

    const functionName = items[0].config.destination.functionName;
    if (!functionName) {
      const error = "Function name not specified";
      this.logger.error(error);
      for (const item of items) {
        results.push({
          feederId: item.config.id,
          result: {
            success: false,
            error,
            timestamp: new Date(),
            duration: 0,
            retryCount: 0,
          },
          config: item.config,
        });
      }
      return results;
    }

    // Check if all items have price data
    const itemsWithPriceData = items.filter((item) => item.priceData);
    if (itemsWithPriceData.length !== items.length) {
      this.logger.warn(
        `Some items in batch missing price data. Processing ${itemsWithPriceData.length}/${items.length} items.`
      );
    }

    // Use batch posting with fallback strategy
    this.logger.debug(
      `Posting batch of ${itemsWithPriceData.length} prices to oracle contract ${contractAddress} using batch methods`
    );

    await this.postBatchWithFallback(itemsWithPriceData, contractAddress, networkId, results);

    // Add failed results for items without price data
    for (const item of items) {
      if (!item.priceData) {
        results.push({
          feederId: item.config.id,
          result: {
            success: false,
            error: "Price data not available for batch processing",
            timestamp: new Date(),
            duration: 0,
            retryCount: 0,
          },
          config: item.config,
        });
      }
    }

    return results;
  }

  /**
   * Posts a batch of prices using batch methods with fallback strategy:
   * 1. Try to post up to 3 prices at once using post_price_batch3
   * 2. If that fails, split into batches of 2 using post_price_batch2
   * 3. If that fails, post individually using post_price
   */
  private async postBatchWithFallback(
    items: BatchFeedItem[],
    contractAddress: string,
    networkId: string,
    results: BatchFeedResult[]
  ): Promise<void> {
    if (items.length === 0) {
      return;
    }

    const algod = this.networkConfigLoader.getAlgodClient(networkId);
    const secretKey = this.accountService.getSecretKey();
    const address = this.accountService.getAddress();

    if (!secretKey || !address) {
      throw new Error("Account service not properly initialized");
    }

    const ci = new CONTRACT(
      Number(contractAddress),
      algod,
      undefined,
      { ...PriceOracleAppSpec.contract, events: [] },
      { addr: address, sk: secretKey }
    );

    // Process items in batches of 3, then 2, then individually
    let remainingItems = [...items];
    
    while (remainingItems.length > 0) {
      if (remainingItems.length >= 3) {
        // Try batch of 3
        const batch3 = remainingItems.slice(0, 3);
        const batch3Result = await this.tryPostBatch3(batch3, ci, algod, secretKey);
        
        if (batch3Result.success) {
          results.push(...batch3Result.results);
          remainingItems = remainingItems.slice(3);
          this.logger.info(`Successfully posted batch of 3 prices`);
          continue;
        } else {
          this.logger.warn(`Batch of 3 failed, splitting into smaller batches: ${batch3Result.error}`);
        }
      }

      if (remainingItems.length >= 2) {
        // Try batch of 2
        const batch2 = remainingItems.slice(0, 2);
        const batch2Result = await this.tryPostBatch2(batch2, ci, algod, secretKey);
        
        if (batch2Result.success) {
          results.push(...batch2Result.results);
          remainingItems = remainingItems.slice(2);
          this.logger.info(`Successfully posted batch of 2 prices`);
          continue;
        } else {
          this.logger.warn(`Batch of 2 failed, posting individually: ${batch2Result.error}`);
        }
      }

      // Post individually
      const item = remainingItems[0];
      try {
        const result = await this.postToPriceOracle(item.config, item.priceData!);
        results.push({
          feederId: item.config.id,
          result,
          config: item.config,
        });
        this.logger.info(`Successfully posted individual price for ${item.config.id}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        results.push({
          feederId: item.config.id,
          result: {
            success: false,
            error: errorMessage,
            timestamp: new Date(),
            duration: 0,
            retryCount: 0,
          },
          config: item.config,
        });
        this.logger.error(`Failed to post individual price for ${item.config.id}: ${errorMessage}`);
      }
      remainingItems = remainingItems.slice(1);
    }
  }

  /**
   * Try to post 3 prices using post_price_batch3
   */
  private async tryPostBatch3(
    items: BatchFeedItem[],
    ci: any,
    algod: algosdk.Algodv2,
    secretKey: Uint8Array
  ): Promise<{ success: boolean; results: BatchFeedResult[]; error?: string }> {
    if (items.length !== 3 || !items[0].priceData || !items[1].priceData || !items[2].priceData) {
      return { success: false, results: [], error: "Invalid batch size or missing price data" };
    }

    try {
      const marketId0 = Number(items[0].config.destination.marketId || items[0].config.marketId);
      const price0 = BigInt(this.formatPriceForContract(items[0].priceData.price, items[0].config));
      
      const marketId1 = Number(items[1].config.destination.marketId || items[1].config.marketId);
      const price1 = BigInt(this.formatPriceForContract(items[1].priceData.price, items[1].config));
      
      const marketId2 = Number(items[2].config.destination.marketId || items[2].config.marketId);
      const price2 = BigInt(this.formatPriceForContract(items[2].priceData.price, items[2].config));

      this.logger.info(
        `Attempting batch3: ${items[0].config.id}, ${items[1].config.id}, ${items[2].config.id}`
      );

      if (!ci.post_price_batch3) {
        return { success: false, results: [], error: "post_price_batch3 method not available" };
      }

      const batch3Result = await ci.post_price_batch3(marketId0, price0, marketId1, price1, marketId2, price2);

      if (!batch3Result.success) {
        return { success: false, results: [], error: batch3Result.error || "Batch3 call failed" };
      }

      // Sign and send transaction
      const stxns = await batch3Result.txns.map((txn: any) =>
        algosdk
          .decodeUnsignedTransaction(Uint8Array.from(Buffer.from(txn, "base64")))
          .signTxn(secretKey)
      );

      const res = await algod.sendRawTransaction(stxns).do();
      await waitForConfirmation(algod, res.txId, 4);

      this.logger.info(
        `Batch3 transaction confirmed: txId=${res.txId} for ${items.map(i => i.config.id).join(', ')}`
      );

      // All 3 succeeded - mark as batch transaction
      return {
        success: true,
        results: items.map((item, index) => ({
          feederId: item.config.id,
          result: {
            success: true,
            data: item.priceData!,
            timestamp: new Date(),
            duration: 0,
            retryCount: 0,
            batchSize: 3, // Mark as part of batch of 3
            batchIndex: index, // Position in batch
          },
          config: item.config,
        })),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, results: [], error: errorMessage };
    }
  }

  /**
   * Try to post 2 prices using post_price_batch2
   */
  private async tryPostBatch2(
    items: BatchFeedItem[],
    ci: any,
    algod: algosdk.Algodv2,
    secretKey: Uint8Array
  ): Promise<{ success: boolean; results: BatchFeedResult[]; error?: string }> {
    if (items.length !== 2 || !items[0].priceData || !items[1].priceData) {
      return { success: false, results: [], error: "Invalid batch size or missing price data" };
    }

    try {
      const marketId0 = Number(items[0].config.destination.marketId || items[0].config.marketId);
      const price0 = BigInt(this.formatPriceForContract(items[0].priceData.price, items[0].config));
      
      const marketId1 = Number(items[1].config.destination.marketId || items[1].config.marketId);
      const price1 = BigInt(this.formatPriceForContract(items[1].priceData.price, items[1].config));

      this.logger.info(
        `Attempting batch2: ${items[0].config.id}, ${items[1].config.id}`
      );

      if (!ci.post_price_batch2) {
        return { success: false, results: [], error: "post_price_batch2 method not available" };
      }

      const batch2Result = await ci.post_price_batch2(marketId0, price0, marketId1, price1);

      if (!batch2Result.success) {
        return { success: false, results: [], error: batch2Result.error || "Batch2 call failed" };
      }

      // Sign and send transaction
      const stxns = await batch2Result.txns.map((txn: any) =>
        algosdk
          .decodeUnsignedTransaction(Uint8Array.from(Buffer.from(txn, "base64")))
          .signTxn(secretKey)
      );

      const res = await algod.sendRawTransaction(stxns).do();
      await waitForConfirmation(algod, res.txId, 4);

      this.logger.info(
        `Batch2 transaction confirmed: txId=${res.txId} for ${items.map(i => i.config.id).join(', ')}`
      );

      // Both succeeded - mark as batch transaction
      return {
        success: true,
        results: items.map((item, index) => ({
          feederId: item.config.id,
          result: {
            success: true,
            data: item.priceData!,
            timestamp: new Date(),
            duration: 0,
            retryCount: 0,
            batchSize: 2, // Mark as part of batch of 2
            batchIndex: index, // Position in batch
          },
          config: item.config,
        })),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, results: [], error: errorMessage };
    }
  }
}
