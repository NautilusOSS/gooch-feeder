# Network Market Price Validation Values

This document provides a comprehensive reference for price validation values configured for each market across all networks in the Gooch Feeder system.

## Overview

Price validation is a critical safety mechanism that prevents incorrect or malicious price data from being posted to the price oracle contract. Each feeder configuration includes validation rules that are checked before posting prices.

## Validation Fields

### `minPrice`
- **Type**: `number`
- **Description**: The minimum acceptable price in USD. Prices below this value will be rejected.
- **Purpose**: Prevents posting of zero, negative, or unreasonably low prices that could indicate API errors or manipulation.

### `maxPrice`
- **Type**: `number`
- **Description**: The maximum acceptable price in USD. Prices above this value will be rejected.
- **Purpose**: Prevents posting of unreasonably high prices that could indicate API errors or manipulation.

### `maxPriceChange`
- **Type**: `number`
- **Description**: The maximum allowed price change percentage between updates. Currently **not implemented** (see TODO in code).
- **Purpose**: When implemented, will prevent sudden price spikes/drops that could indicate errors or manipulation.
- **Note**: This validation is planned but not yet active in the current implementation.

### `requiredFields`
- **Type**: `string[]`
- **Description**: Array of field names that must be present in the price data response.
- **Common Values**: `["price", "timestamp"]`
- **Purpose**: Ensures the API response contains all necessary data before processing.

## How Validation Works

When a feeder fetches price data:

1. The price is fetched from the configured source API
2. The `validatePriceData()` method checks:
   - `price >= minPrice` ✓
   - `price <= maxPrice` ✓
   - All `requiredFields` are present ✓
3. If validation fails, an error is thrown and the price is **not posted** to the contract
4. The error is logged and the feeder will retry on the next interval

## Validation Values by Network

### VOI Mainnet

| Asset | Market ID | Min Price | Max Price | Max Change | Required Fields |
|-------|-----------|-----------|-----------|------------|-----------------|
| aALGO | 413153 | 0.075 | 0.3 | 0.01 | price, timestamp |
| aBTC | 40153368 | 10000 | 200000 | 1000 | price, timestamp |
| acbBTC | 40153415 | 10000 | 200000 | 1000 | price, timestamp |
| aETH | 40153308 | 1000 | 10000 | 50 | price, timestamp |
| AMMO | 798968 | 0.000001 | 0.0003 | 0.0001 | price, timestamp |
| BUIDL | 419744 | 0.000001 | 0.0004 | 0.0001 | price, timestamp |
| bVOI | 8471125 | 0.000001 | 0.01 | 0.001 | price, timestamp |
| CORN | 412682 | 0.000001 | 0.008 | 0.001 | price, timestamp |
| EV | 828295 | 0.000001 | 0.001 | 0.0001 | price, timestamp |
| F | 302222 | 0.000001 | 0.000015 | 0.000002 | price, timestamp |
| FV | 770561 | 0.000001 | 1 | 0.1 | price, timestamp |
| GM | 300279 | 0.000001 | 0.0001 | 0.00001 | price, timestamp |
| IAT | 420024 | 0.000001 | 0.0004 | 0.0001 | price, timestamp |
| NODE | 410811 | 0.000001 | 0.000005 | 0.000001 | price, timestamp |
| NV | 8324600 | 0.000001 | 0.001 | 0.0001 | price, timestamp |
| POW | 40153155 | 0.00005 | 0.004 | 0.001 | price, timestamp |
| SHELLY | 410111 | 0.0001 | 0.1 | 0.01 | price, timestamp |
| UNIT | 420069 | 0.4 | 1.2 | 0.1 | price, timestamp |
| VOI | 41877720 | 0.0001 | 10 | 50 | price, timestamp |

**VOI Mainnet Summary:**
- **Total Feeders**: 19
- **Price Range**: $0.000001 (micro tokens) to $200,000 (BTC)
- **Most Common Pattern**: Stablecoins and low-value tokens use tight ranges (0.000001 - 0.01), while major assets (BTC, ETH) use wide ranges

### Algorand Mainnet

| Asset | Market ID | Min Price | Max Price | Max Change | Required Fields |
|-------|-----------|-----------|-----------|------------|-----------------|
| AKTA | 3212534634 | 0.0002 | 0.001 | 0.0002 | price, timestamp |
| ALGO | 3207744109 | 0.075 | 0.25 | 0.01 | price, timestamp |
| ALPHA | 3212531816 | 0.01 | 0.05 | 0.01 | price, timestamp |
| AVAX | 3211885849 | 5 | 20 | 1 | price, timestamp |
| aVOI | 3210709899 | 0.0001 | 0.001 | 0.0001 | price, timestamp |
| BRO | 3212768756 | 0.000001 | 0.00005 | 0.00001 | price, timestamp |
| COMPX | 3211800950 | 0.0007 | 0.0015 | 0.0002 | price, timestamp |
| COOP | 3212524778 | 0.005 | 0.015 | 0.002 | price, timestamp |
| FINITE | 3211805086 | 0.006 | 0.01 | 0.003 | price, timestamp |
| FOLKS | 3346185062 | 1 | 4 | 1 | price, timestamp |
| goBTC | 3211820549 | 10000 | 200000 | 1000 | price, timestamp |
| goETH | 3211806149 | 1500 | 5000 | 500 | price, timestamp |
| GOLD$ | 3220347315 | 100 | 200 | 25 | price, timestamp |
| HAY | 3211890928 | 0.01 | 0.05 | 0.005 | price, timestamp |
| HOG | 3212773584 | 0.25 | 1.25 | 0.05 | price, timestamp |
| LINK | 3211838479 | 10 | 25 | 1 | price, timestamp |
| PEPE | 3212771255 | 0.000001 | 0.000015 | 0.000005 | price, timestamp |
| POW | 3080081069 | 0.0005 | 0.003 | 0.002 | price, timestamp |
| SOL | 3211883276 | 75 | 250 | 5 | price, timestamp |
| TINY | 3211740909 | 0.001 | 0.005 | 0.001 | price, timestamp |
| UNIT | 3220125024 | 0.6 | 1.2 | 0.1 | price, timestamp |
| USDt | 3346408431 | 0.25 | 0.75 | 0.05 | price, timestamp |
| wBTC | 3211827406 | 75000 | 200000 | 1000 | price, timestamp |
| wETH | 3211811648 | 2500 | 5000 | 100 | price, timestamp |
| xUSD | 3346881192 | 0.5 | 1 | 0.1 | price, timestamp |

**Algorand Mainnet Summary:**
- **Total Feeders**: 25
- **Price Range**: $0.000001 (micro tokens) to $200,000 (BTC)
- **Most Common Pattern**: Validation ranges vary significantly by asset type - stablecoins use tight ranges (0.25-1.2), major assets use wide ranges (BTC: 75k-200k), and micro tokens use very small ranges

## Validation Patterns

### Stablecoins (USDt, xUSD, HAY)
- **Pattern**: Tight range around $1.00
- **Example**: `minPrice: 0.01, maxPrice: 2, maxPriceChange: 50`
- **Rationale**: Stablecoins should remain close to $1.00, with some tolerance for depegging events

### Major Cryptocurrencies (BTC, ETH)
- **Pattern**: Wide range to accommodate volatility
- **Example**: `minPrice: 10000, maxPrice: 200000, maxPriceChange: 1000`
- **Rationale**: High-value assets with significant price swings require wide validation ranges

### Low-Value Tokens (Micro tokens, memecoins)
- **Pattern**: Very small min/max values
- **Example**: `minPrice: 0.000001, maxPrice: 0.0001, maxPriceChange: 0.00001`
- **Rationale**: Tokens with very low prices need precise validation to catch errors

### Medium-Value Tokens (ALGO, UNIT, etc.)
- **Pattern**: Moderate ranges
- **Example**: `minPrice: 0.01, maxPrice: 10, maxPriceChange: 50`
- **Rationale**: Standard tokens with moderate volatility

## Configuration Example

```json
{
  "validation": {
    "minPrice": 0.01,
    "maxPrice": 10,
    "maxPriceChange": 50,
    "requiredFields": ["price", "timestamp"]
  }
}
```

## Best Practices

### Setting `minPrice` and `maxPrice`

1. **Research Historical Prices**: Review the asset's price history to determine reasonable bounds
2. **Add Buffer**: Set ranges 20-30% wider than historical extremes to account for volatility
3. **Consider Market Conditions**: During high volatility periods, wider ranges may be necessary
4. **Regular Review**: Periodically review and adjust validation ranges as markets evolve

### Setting `maxPriceChange`

1. **Calculate Typical Volatility**: Analyze historical price change percentages
2. **Set Conservative Limits**: Use 2-3x the typical volatility as the limit
3. **Account for Market Events**: Consider flash crashes and sudden spikes
4. **Note**: Currently not implemented, but should be considered for future updates

### Required Fields

1. **Always Include**: `["price", "timestamp"]` are standard
2. **Add as Needed**: Include additional fields if your price processing logic requires them
3. **API-Specific**: Different APIs may return different field names - adjust accordingly

## Validation Errors

When validation fails, you'll see errors like:

```
Error: Price 0.00005 is below minimum 0.0001
Error: Price 15 is above maximum 10
Error: Required field 'timestamp' is missing
```

These errors prevent incorrect data from being posted and are logged for monitoring.

## Testing Validation

You can test validation rules using the test commands:

```bash
# Test a specific feeder (shows validation results)
npm run test-feeder voi-mainnet-47139778-VOI

# Test price fetching only (shows validation results)
npm run test-price-fetch voi-mainnet-47139778-VOI
```

The test output will show:
- ✓ or ✗ for each validation check
- The actual price value compared to limits
- Overall validation status

## Implementation Status

- ✅ **Implemented**: `minPrice`, `maxPrice`, `requiredFields`
- ⏳ **Planned**: `maxPriceChange` (requires storing previous price data)

The `maxPriceChange` validation is currently not active. When implemented, it will compare the new price against the previous price and reject changes exceeding the configured percentage.

## Related Documentation

- [Price Adjustments](./PRICE_ADJUSTMENTS.md) - How prices are converted for contract storage
- [Test Commands](./TEST_COMMANDS.md) - How to test feeders and validation
- [Feed Burn Rate](./FEED_BURN_RATE.md) - Analysis of feed frequency and costs

