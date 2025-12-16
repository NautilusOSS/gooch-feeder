import { config } from 'dotenv';
import { Logger } from '../utils/logger';
import { NetworkConfigLoader } from '../utils/network-config-loader';
import { FeederManagerService } from '../services/feeder-manager-service';
import { AccountService } from '../services/account-service';

// Load environment variables
config();

async function testFeeder(feederId: string): Promise<void> {
  const logger = new Logger('TestFeeder');
  
  try {
    logger.info(`Testing feeder: ${feederId}`);
    
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
    logger.info(`Running feeder ${feederId}...`);
    const result = await feederManagerService.runFeederOnce(feederId);
    
    // Display results
    console.log('\n=== Feeder Test Results ===');
    console.log(`Feeder ID: ${feederId}`);
    console.log(`Success: ${result.success ? '✓' : '✗'}`);
    console.log(`Duration: ${result.duration}ms`);
    console.log(`Timestamp: ${result.timestamp.toISOString()}`);
    
    if (result.success && result.data) {
      console.log('\n--- Price Data ---');
      console.log(`Symbol: ${result.data.symbol}`);
      console.log(`Price: $${result.data.price}`);
      console.log(`Source: ${result.data.source}`);
      console.log(`Network: ${result.data.networkId}`);
      if (result.data.confidence) {
        console.log(`Confidence: ${(result.data.confidence * 100).toFixed(2)}%`);
      }
      if (result.data.volume24h) {
        console.log(`24h Volume: $${result.data.volume24h.toLocaleString()}`);
      }
      if (result.data.change24h) {
        console.log(`24h Change: ${result.data.change24h > 0 ? '+' : ''}${result.data.change24h.toFixed(2)}%`);
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

