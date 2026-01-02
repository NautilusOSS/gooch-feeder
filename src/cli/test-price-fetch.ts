import { config } from 'dotenv';
import { Logger } from '../utils/logger';
import { PriceLookupService } from '../services/price-lookup-service';
import { PriceFeederConfig, PriceFeedResult } from '../types';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
config();

async function testPriceFetch(feederId: string): Promise<void> {
  const logger = new Logger('TestPriceFetch');
  
  try {
    logger.info(`Testing price fetch for feeder: ${feederId}`);
    
    // Load feeder configuration
    const configPath = path.join(process.cwd(), 'config', 'feeders.json');
    
    if (!fs.existsSync(configPath)) {
      console.error(`Error: Feeder configuration file not found: ${configPath}`);
      process.exit(1);
    }

    const configData = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configData);

    if (!config.feeders || !config.feeders[feederId]) {
      console.error(`Error: Feeder "${feederId}" not found in configuration`);
      console.error('\nAvailable feeders:');
      if (config.feeders) {
        Object.keys(config.feeders).forEach(id => {
          const feeder = config.feeders[id];
          console.error(`  - ${id} (${feeder.assetSymbol} on ${feeder.networkId})`);
        });
      }
      process.exit(1);
    }

    const feederConfig = config.feeders[feederId] as PriceFeederConfig;
    
    // Display feeder configuration
    console.log('\n=== Feeder Configuration ===');
    console.log(`Feeder ID: ${feederConfig.id}`);
    console.log(`Asset Symbol: ${feederConfig.assetSymbol}`);
    console.log(`Network ID: ${feederConfig.networkId}`);
    console.log(`Source Type: ${feederConfig.source.type}`);
    if (feederConfig.source.url) {
      console.log(`Source URL: ${feederConfig.source.url}`);
    }
    console.log(`Timeout: ${feederConfig.timeout}ms`);
    console.log(`Retries: ${feederConfig.retries}`);
    
    // Initialize price lookup service
    const priceLookupService = new PriceLookupService();
    
    // Fetch price
    console.log('\n=== Fetching Price ===');
    const startTime = Date.now();
    const result: PriceFeedResult = await priceLookupService.fetchPrice(feederConfig);
    const totalTime = Date.now() - startTime;
    
    // Display results
    console.log('\n=== Price Fetch Results ===');
    console.log(`Success: ${result.success ? '✓' : '✗'}`);
    console.log(`Duration: ${result.duration}ms`);
    console.log(`Total Time: ${totalTime}ms`);
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
      if (feederConfig.validation && result.data) {
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
          validation.requiredFields.forEach(field => {
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
    } else if (result.error) {
      console.log('\n--- Error ---');
      console.log(`Error: ${result.error}`);
    }
    
    console.log('\n=== Test Complete ===\n');
    
    // Exit with appropriate code
    process.exit(result.success ? 0 : 1);
    
  } catch (error) {
    logger.error('Failed to test price fetch:', error instanceof Error ? error : String(error));
    console.error('\n=== Error ===');
    console.error(error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Get feeder ID from command line arguments
const feederId = process.argv[2];

if (!feederId) {
  console.error('Usage: npm run test:price-fetch <feeder-id>');
  console.error('\nExample:');
  console.error('  npm run test:price-fetch voi-mainnet-47139778-VOI');
  console.error('\nAvailable feeders can be found in config/feeders.json');
  console.error('Use "npm run list:feeders" to see all available feeders');
  process.exit(1);
}

testPriceFetch(feederId);

