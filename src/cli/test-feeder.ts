import { config } from 'dotenv';
import { Logger } from '../utils/logger';
import { NetworkConfigLoader } from '../utils/network-config-loader';
import { FeederManagerService } from '../services/feeder-manager-service';
import { AccountService } from '../services/account-service';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
config();

async function testFeeder(feederId: string): Promise<void> {
  const logger = new Logger('TestFeeder');
  
  try {
    logger.info(`Testing feeder: ${feederId}`);
    
    // Load feeder configuration to display details
    const configPath = path.join(process.cwd(), 'config', 'feeders.json');
    let feederConfig = null;
    
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);
      if (config.feeders && config.feeders[feederId]) {
        feederConfig = config.feeders[feederId];
        
        // Display feeder configuration
        console.log('\n=== Feeder Configuration ===');
        console.log(`Feeder ID: ${feederConfig.id}`);
        console.log(`Asset Symbol: ${feederConfig.assetSymbol}`);
        console.log(`Network ID: ${feederConfig.networkId}`);
        console.log(`Method: ${feederConfig.method}`);
        console.log(`Source Type: ${feederConfig.source.type}`);
        if (feederConfig.source.url) {
          console.log(`Source URL: ${feederConfig.source.url}`);
        }
        if (feederConfig.destination.contractAddress) {
          console.log(`Price Oracle Contract: ${feederConfig.destination.contractAddress}`);
        }
        if (feederConfig.destination.marketId) {
          console.log(`Market ID: ${feederConfig.destination.marketId}`);
        }
        console.log(`Timeout: ${feederConfig.timeout}ms`);
        console.log(`Retries: ${feederConfig.retries}`);
        console.log(`Interval: ${feederConfig.interval}ms`);
      }
    }
    
    // Load network configurations
    const networkConfigLoader = new NetworkConfigLoader();
    await networkConfigLoader.loadConfigs();
    
    // Initialize account service
    const accountService = new AccountService();
    await accountService.initialize();
    
    // Initialize feeder manager service
    const feederManagerService = new FeederManagerService(networkConfigLoader, accountService);
    await feederManagerService.initialize();
    
    // Run the feeder once
    console.log('\n=== Running Feeder ===');
    logger.info(`Running feeder ${feederId}...`);
    const result = await feederManagerService.runFeederOnce(feederId);
    
    // Display results
    console.log('\n=== Feeder Test Results ===');
    console.log(`Feeder ID: ${feederId}`);
    console.log(`Success: ${result.success ? '✓' : '✗'}`);
    console.log(`Duration: ${result.duration}ms`);
    console.log(`Timestamp: ${result.timestamp.toISOString()}`);
    console.log(`Retry Count: ${result.retryCount}`);
    
    if (result.success && result.data) {
      console.log('\n--- Price Data ---');
      console.log(`Symbol: ${result.data.symbol}`);
      console.log(`Price: $${result.data.price}`);
      console.log(`Source: ${result.data.source}`);
      console.log(`Network: ${result.data.networkId}`);
      console.log(`Pool ID: ${result.data.poolId}`);
      console.log(`Market ID: ${result.data.marketId}`);
      if (result.data.confidence !== undefined) {
        console.log(`Confidence: ${(result.data.confidence * 100).toFixed(2)}%`);
      }
      if (result.data.volume24h !== undefined) {
        console.log(`24h Volume: $${result.data.volume24h.toLocaleString()}`);
      }
      if (result.data.change24h !== undefined) {
        console.log(`24h Change: ${result.data.change24h > 0 ? '+' : ''}${result.data.change24h.toFixed(2)}%`);
      }
      console.log(`Timestamp: ${result.data.timestamp.toISOString()}`);
      
      // Validate against feeder validation rules
      if (feederConfig && feederConfig.validation && result.data) {
        console.log('\n--- Validation ---');
        const validation = feederConfig.validation;
        const priceData = result.data;
        let validationPassed = true;
        
        if (validation.minPrice !== undefined) {
          const passed = priceData.price >= validation.minPrice;
          validationPassed = validationPassed && passed;
          console.log(`Min Price (${validation.minPrice}): ${passed ? '✓' : '✗'} (${priceData.price})`);
        }
        
        if (validation.maxPrice !== undefined) {
          const passed = priceData.price <= validation.maxPrice;
          validationPassed = validationPassed && passed;
          console.log(`Max Price (${validation.maxPrice}): ${passed ? '✓' : '✗'} (${priceData.price})`);
        }
        
        if (validation.requiredFields) {
          const missingFields: string[] = [];
          validation.requiredFields.forEach((field: string) => {
            if (!(field in priceData)) {
              missingFields.push(field);
            }
          });
          const passed = missingFields.length === 0;
          validationPassed = validationPassed && passed;
          if (passed) {
            console.log(`Required Fields: ✓`);
          } else {
            console.log(`Required Fields: ✗ (Missing: ${missingFields.join(', ')})`);
          }
        }
        
        console.log(`\nOverall Validation: ${validationPassed ? '✓ PASSED' : '✗ FAILED'}`);
      }
      
      // Show transaction info if available
      if (result.batchSize !== undefined) {
        console.log('\n--- Transaction Info ---');
        console.log(`Batch Size: ${result.batchSize}`);
        if (result.batchIndex !== undefined) {
          console.log(`Batch Index: ${result.batchIndex}`);
        }
      }
    } else if (result.error) {
      console.log('\n--- Error ---');
      console.log(`Error: ${result.error}`);
    }
    
    // Get metrics
    const metrics = feederManagerService.getFeederMetrics(feederId);
    if (typeof metrics !== 'string' && 'totalRuns' in metrics) {
      console.log('\n--- Metrics ---');
      console.log(`Total Runs: ${metrics.totalRuns}`);
      console.log(`Successful Runs: ${metrics.successfulRuns}`);
      console.log(`Failed Runs: ${metrics.failedRuns}`);
      console.log(`Uptime: ${metrics.uptime.toFixed(2)}%`);
      console.log(`Average Response Time: ${metrics.averageResponseTime.toFixed(2)}ms`);
      if (metrics.lastSuccess) {
        console.log(`Last Success: ${metrics.lastSuccess.toISOString()}`);
      }
      if (metrics.lastFailure) {
        console.log(`Last Failure: ${metrics.lastFailure.toISOString()}`);
      }
    }
    
    console.log('\n=== Test Complete ===\n');
    
    // Shutdown
    await feederManagerService.shutdown();
    await accountService.shutdown();
    
    // Exit with appropriate code
    process.exit(result.success ? 0 : 1);
    
  } catch (error) {
    logger.error('Failed to test feeder:', error instanceof Error ? error : String(error));
    console.error('\n=== Error ===');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Get feeder ID from command line arguments
const feederId = process.argv[2];

if (!feederId) {
  console.error('Usage: npm run test:feeder <feeder-id>');
  console.error('\nExample:');
  console.error('  npm run test:feeder voi-mainnet-47139778-VOI');
  console.error('\nAvailable feeders can be found in config/feeders.json');
  process.exit(1);
}

testFeeder(feederId);

