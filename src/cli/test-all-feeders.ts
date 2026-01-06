import { config } from 'dotenv';
import { Logger } from '../utils/logger';
import { NetworkConfigLoader } from '../utils/network-config-loader';
import { FeederManagerService } from '../services/feeder-manager-service';
import { AccountService } from '../services/account-service';
import { PriceFeedResult, PriceFeederConfig } from '../types';

// Load environment variables
config();

interface FeederTestResult {
  feederId: string;
  result: PriceFeedResult;
  config: PriceFeederConfig;
}

async function testAllFeeders(): Promise<void> {
  const logger = new Logger('TestAllFeeders');
  
  try {
    logger.info('Testing all feeders...');
    
    // Load network configurations
    const networkConfigLoader = new NetworkConfigLoader();
    await networkConfigLoader.loadConfigs();
    
    // Initialize account service
    const accountService = new AccountService();
    await accountService.initialize();
    
    // Initialize feeder manager service (skip starting feeders to avoid batch processing)
    const feederManagerService = new FeederManagerService(networkConfigLoader, accountService);
    await feederManagerService.initialize(true);
    
    // Get all feeder configs
    const feederConfigs = feederManagerService.getAllFeederConfigs();
    const feedersArray = Array.from(feederConfigs.entries());
    
    if (feedersArray.length === 0) {
      console.log('No feeders found in configuration.');
      await feederManagerService.shutdown();
      await accountService.shutdown();
      process.exit(0);
    }
    
    console.log(`\n=== Testing ${feedersArray.length} Feeder(s) ===\n`);
    
    const results: FeederTestResult[] = [];
    let successCount = 0;
    let failureCount = 0;
    
    // Run each feeder sequentially to avoid rate limits
    for (let i = 0; i < feedersArray.length; i++) {
      const [feederId, config] = feedersArray[i];
      
      console.log(`[${i + 1}/${feedersArray.length}] Testing: ${feederId}`);
      console.log(`  Method: ${config.method} | Asset: ${config.assetSymbol} | Network: ${config.networkId}`);
      
      try {
        const result = await feederManagerService.runFeederOnce(feederId);
        results.push({ feederId, result, config });
        
        if (result.success) {
          successCount++;
          console.log(`  ✓ Success (${result.duration}ms)`);
          if (result.data) {
            console.log(`    Price: $${result.data.price} | Source: ${result.data.source}`);
          }
        } else {
          failureCount++;
          console.log(`  ✗ Failed (${result.duration}ms)`);
          if (result.error) {
            console.log(`    Error: ${result.error}`);
          }
        }
      } catch (error) {
        failureCount++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.log(`  ✗ Error: ${errorMessage}`);
        results.push({
          feederId,
          result: {
            success: false,
            error: errorMessage,
            timestamp: new Date(),
            duration: 0,
            retryCount: 0
          },
          config
        });
      }
      
      // Add a small delay between feeders to avoid rate limits
      if (i < feedersArray.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      console.log('');
    }
    
    // Display summary
    console.log('\n=== Test Summary ===\n');
    console.log(`Total Feeders: ${feedersArray.length}`);
    console.log(`Successful: ${successCount} (${((successCount / feedersArray.length) * 100).toFixed(1)}%)`);
    console.log(`Failed: ${failureCount} (${((failureCount / feedersArray.length) * 100).toFixed(1)}%)`);
    
    // Group results by network
    const resultsByNetwork = new Map<string, FeederTestResult[]>();
    results.forEach(r => {
      const networkId = r.config.networkId;
      if (!resultsByNetwork.has(networkId)) {
        resultsByNetwork.set(networkId, []);
      }
      resultsByNetwork.get(networkId)!.push(r);
    });
    
    // Display detailed results by network
    console.log('\n=== Results by Network ===\n');
    resultsByNetwork.forEach((networkResults, networkId) => {
      const networkSuccess = networkResults.filter(r => r.result.success).length;
      const networkTotal = networkResults.length;
      
      console.log(`📡 ${networkId}`);
      console.log(`   ${networkSuccess}/${networkTotal} successful`);
      
      // Show failed feeders
      const failed = networkResults.filter(r => !r.result.success);
      if (failed.length > 0) {
        console.log(`   Failed feeders:`);
        failed.forEach(f => {
          console.log(`     - ${f.feederId}: ${f.result.error || 'Unknown error'}`);
        });
      }
      console.log('');
    });
    
    // Show successful feeders with price data
    const successful = results.filter(r => r.result.success && r.result.data);
    if (successful.length > 0) {
      console.log('=== Successful Feeders with Price Data ===\n');
      successful.forEach(r => {
        const data = r.result.data!;
        console.log(`${r.feederId}`);
        console.log(`  Symbol: ${data.symbol}`);
        console.log(`  Price: $${data.price}`);
        console.log(`  Source: ${data.source}`);
        console.log(`  Duration: ${r.result.duration}ms`);
        if (data.confidence) {
          console.log(`  Confidence: ${(data.confidence * 100).toFixed(2)}%`);
        }
        console.log('');
      });
    }
    
    // Show failed feeders details
    const failed = results.filter(r => !r.result.success);
    if (failed.length > 0) {
      console.log('=== Failed Feeders ===\n');
      failed.forEach(r => {
        console.log(`${r.feederId}`);
        console.log(`  Error: ${r.result.error || 'Unknown error'}`);
        console.log(`  Duration: ${r.result.duration}ms`);
        console.log(`  Method: ${r.config.method}`);
        console.log(`  Source: ${r.config.source.type}${r.config.source.url ? ` (${r.config.source.url})` : ''}`);
        console.log('');
      });
    }
    
    console.log('=== Test Complete ===\n');
    
    // Shutdown
    await feederManagerService.shutdown();
    await accountService.shutdown();
    
    // Exit with code 0 if all succeeded, 1 if any failed
    process.exit(failureCount === 0 ? 0 : 1);
    
  } catch (error) {
    logger.error('Failed to test feeders:', error instanceof Error ? error : String(error));
    console.error('\n=== Error ===');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

testAllFeeders();

