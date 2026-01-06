import { config } from 'dotenv';
import { Logger } from '../utils/logger';
import { NetworkConfigLoader } from '../utils/network-config-loader';
import { FeederManagerService } from '../services/feeder-manager-service';
import { AccountService } from '../services/account-service';

// Load environment variables
config();

async function listFeeders(): Promise<void> {
  const logger = new Logger('ListFeeders');
  
  try {
    logger.info('Loading feeder configurations...');
    
    // Load network configurations
    const networkConfigLoader = new NetworkConfigLoader();
    await networkConfigLoader.loadConfigs();
    
    // Initialize account service
    const accountService = new AccountService();
    await accountService.initialize();
    
    // Initialize feeder manager service (skip starting feeders since we're just listing)
    const feederManagerService = new FeederManagerService(networkConfigLoader, accountService);
    await feederManagerService.initialize(true);
    
    // Get all feeder configs
    const feederConfigs = feederManagerService.getAllFeederConfigs();
    
    console.log('\n=== Available Feeders ===\n');
    
    if (feederConfigs.size === 0) {
      console.log('No feeders found in configuration.');
    } else {
      const feedersArray = Array.from(feederConfigs.entries());
      
      // Group by network
      const feedersByNetwork = new Map<string, typeof feedersArray>();
      
      feedersArray.forEach(([id, config]) => {
        const networkId = config.networkId;
        if (!feedersByNetwork.has(networkId)) {
          feedersByNetwork.set(networkId, []);
        }
        feedersByNetwork.get(networkId)!.push([id, config]);
      });
      
      // Display feeders grouped by network
      feedersByNetwork.forEach((feeders, networkId) => {
        console.log(`\n📡 Network: ${networkId}`);
        console.log('─'.repeat(60));
        
        feeders.forEach(([id, config]) => {
          const status = config.enabled ? '✓ Enabled' : '✗ Disabled';
          console.log(`  ${id}`);
          console.log(`    Method: ${config.method}`);
          console.log(`    Asset: ${config.assetSymbol}`);
          console.log(`    Status: ${status}`);
          console.log(`    Interval: ${config.interval}ms`);
          console.log(`    Source: ${config.source.type}${config.source.url ? ` (${config.source.url})` : ''}`);
          console.log(`    Destination: ${config.destination.type}`);
          console.log('');
        });
      });
      
      console.log(`\nTotal: ${feedersArray.length} feeder(s)`);
      console.log(`\nTo test a feeder, run:`);
      console.log(`  npm run test:feeder <feeder-id>`);
      console.log(`\nExample:`);
      console.log(`  npm run test:feeder ${feedersArray[0][0]}\n`);
    }
    
    // Shutdown
    await feederManagerService.shutdown();
    await accountService.shutdown();
    
    process.exit(0);
    
  } catch (error) {
    logger.error('Failed to list feeders:', error instanceof Error ? error : String(error));
    console.error('\n=== Error ===');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

listFeeders();

