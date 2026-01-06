# Test Commands Documentation

This document describes the available test commands for the Gooch Feeder system. These commands allow you to test individual feeders, all feeders, or just the price fetching logic without submitting transactions.

## Overview

The Gooch Feeder provides three main test commands:
- `test:feeder` - Test a single feeder end-to-end
- `test:all-feeders` - Test all configured feeders
- `test:price-fetch` - Test only price fetching (no transaction submission)

All test commands require a properly configured `.env` file with necessary environment variables.

## Commands

### Test Single Feeder

**Command:** `npm run test:feeder <feeder-id>`

**Description:** Tests a single feeder by running it once and displaying detailed results including configuration, price data, validation, and metrics.

**Usage:**
```bash
npm run test:feeder voi-mainnet-47139778-VOI
```

**What it does:**
1. Loads the feeder configuration from `config/feeders.json`
2. Displays the feeder's configuration details
3. Initializes network configurations and account service
4. Runs the feeder once (fetches price and submits transaction)
5. Displays detailed results including:
   - Success/failure status
   - Price data (symbol, price, source, network, pool ID, market ID)
   - Validation results (min/max price, required fields)
   - Transaction information (batch size, batch index)
   - Feeder metrics (total runs, success rate, uptime, average response time)

**Exit Codes:**
- `0` - Test passed (feeder ran successfully)
- `1` - Test failed (feeder encountered an error)

**Example Output:**
```
=== Feeder Configuration ===
Feeder ID: voi-mainnet-47139778-VOI
Asset Symbol: VOI
Network ID: voi-mainnet
Method: api
Source Type: api
Source URL: https://humble-api.voi.nautilus.sh/tokens/419744/stats
...

=== Feeder Test Results ===
Success: ✓
Duration: 1234ms
...

--- Price Data ---
Symbol: VOI
Price: $0.1234
Source: humble-api
...
```

### Test All Feeders

**Command:** `npm run test:all-feeders`

**Description:** Tests all configured feeders sequentially with a 1-second delay between each to avoid rate limits. Provides a comprehensive summary of results.

**Usage:**
```bash
npm run test:all-feeders
```

**What it does:**
1. Loads all feeder configurations
2. Tests each feeder sequentially (one at a time)
3. Adds a 1-second delay between feeders to avoid rate limits
4. Displays:
   - Progress for each feeder being tested
   - Summary statistics (total, successful, failed, percentages)
   - Results grouped by network
   - Detailed list of successful feeders with price data
   - Detailed list of failed feeders with error messages

**Exit Codes:**
- `0` - All feeders passed
- `1` - One or more feeders failed

**Example Output:**
```
=== Testing 10 Feeder(s) ===

[1/10] Testing: voi-mainnet-47139778-VOI
  Method: api | Asset: VOI | Network: voi-mainnet
  ✓ Success (1234ms)
    Price: $0.1234 | Source: humble-api

...

=== Test Summary ===
Total Feeders: 10
Successful: 8 (80.0%)
Failed: 2 (20.0%)

=== Results by Network ===
📡 voi-mainnet
   8/10 successful
   Failed feeders:
     - voi-mainnet-xxx: Connection timeout
...
```

### Test Price Fetch Only

**Command:** `npm run test:price-fetch <feeder-id>`

**Description:** Tests only the price fetching logic without submitting any transactions. Useful for debugging price retrieval issues without incurring transaction costs.

**Usage:**
```bash
npm run test:price-fetch voi-mainnet-47139778-VOI
```

**What it does:**
1. Loads the feeder configuration
2. Displays the feeder's configuration details
3. Initializes the price lookup service
4. Fetches the price using the configured source
5. Displays results including:
   - Success/failure status
   - Price data (same as test:feeder)
   - Validation results
   - Error details if fetch failed

**Exit Codes:**
- `0` - Price fetch succeeded
- `1` - Price fetch failed

**When to use:**
- Debugging price source connectivity issues
- Testing price source API changes
- Validating price data format without submitting transactions
- Checking if price sources are accessible

**Example Output:**
```
=== Feeder Configuration ===
Feeder ID: voi-mainnet-47139778-VOI
Asset Symbol: VOI
Network ID: voi-mainnet
Source Type: api
Source URL: https://humble-api.voi.nautilus.sh/tokens/419744/stats
...

=== Price Fetch Results ===
Success: ✓
Duration: 567ms
...

--- Price Data ---
Symbol: VOI
Price: $0.1234
Source: humble-api
...
```

## Helper Commands

### List All Feeders

**Command:** `npm run list:feeders`

**Description:** Lists all available feeders from the configuration file. Useful for finding feeder IDs to use with test commands.

**Usage:**
```bash
npm run list:feeders
```

## Prerequisites

Before running test commands, ensure:

1. **Environment Variables:** A `.env` file is configured with:
   - Network RPC endpoints
   - Account private keys (if testing transaction submission)
   - Any API keys required by price sources

2. **Configuration Files:**
   - `config/feeders.json` - Contains feeder configurations
   - `config/networks.json` - Contains network configurations
   - Network-specific configs in `config/networks/`

3. **Dependencies:** All npm packages are installed:
   ```bash
   npm install
   ```

## Troubleshooting

### Common Issues

**"Feeder not found" error:**
- Verify the feeder ID exists in `config/feeders.json`
- Use `npm run list:feeders` to see all available feeders
- Check for typos in the feeder ID

**"Connection timeout" or network errors:**
- Verify network RPC endpoints in your `.env` file
- Check if the price source API is accessible
- Verify network connectivity

**"Invalid configuration" errors:**
- Check that `config/feeders.json` is valid JSON
- Verify network configurations exist for all networks referenced by feeders
- Ensure all required fields are present in feeder configurations

**Transaction submission failures:**
- Verify account private keys are set in `.env`
- Check account has sufficient balance for transaction fees
- Verify contract addresses are correct
- Check network connectivity to blockchain

### Debug Tips

1. **Start with price fetch:** Use `test:price-fetch` first to isolate price retrieval issues from transaction submission issues

2. **Test one feeder:** Use `test:feeder` on a single feeder before running `test:all-feeders` to catch configuration issues early

3. **Check logs:** Review the output carefully - test commands provide detailed error messages

4. **Validate configuration:** Ensure feeder configurations match the expected format and all required fields are present

## Integration with CI/CD

Test commands can be integrated into CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Test all feeders
  run: npm run test:all-feeders
  env:
    # Add required environment variables
```

The exit codes (0 for success, 1 for failure) make these commands suitable for automated testing.

## Related Documentation

- [Ubuntu Service Installation](./UBUNTU_SERVICE_INSTALLATION.md) - Service management commands
- [Price Adjustments](./PRICE_ADJUSTMENTS.md) - Understanding price conversions
- [Feed Burn Rate](./FEED_BURN_RATE.md) - Transaction cost analysis

