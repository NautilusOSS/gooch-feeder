# Decimal-Based Price Adjustments

The price oracle contract uses a standardized 12-decimal scale for storing all prices, regardless of the token's native decimal places. This system automatically adjusts prices to ensure consistent storage and retrieval across different tokens.

## Overview

When posting prices to the price oracle contract, the system must convert prices from their native decimal representation to the contract's 12-decimal standard. Similarly, when reading prices from the contract, prices must be converted back to their native decimal representation.

## How It Works

The adjustment formula is:

```
targetAdjustment = 12 - tokenDecimals
adjustmentMultiplier = 10^targetAdjustment
```

Where:
- `12` is the standard decimal scale used by the price oracle contract
- `tokenDecimals` is the number of decimal places for the specific token (e.g., 6 for ALGO, 8 for some tokens)
- `targetAdjustment` is the difference needed to reach the contract's scale

## Examples

### Example 1: Token with 6 decimals (e.g., ALGO)
- Token decimals: `6`
- Target adjustment: `12 - 6 = 6`
- Multiplier: `10^6 = 1,000,000`
- If price is `$0.50`:
  - Contract format: `0.50 × 1,000,000 = 500,000`
  - Stored as: `500000` (uint256)

### Example 2: Token with 8 decimals
- Token decimals: `8`
- Target adjustment: `12 - 8 = 4`
- Multiplier: `10^4 = 10,000`
- If price is `$1.25`:
  - Contract format: `1.25 × 10,000 = 12,500`
  - Stored as: `12500` (uint256)

### Example 3: Token with 4 decimals
- Token decimals: `4`
- Target adjustment: `12 - 4 = 8`
- Multiplier: `10^8 = 100,000,000`
- If price is `$10.00`:
  - Contract format: `10.00 × 100,000,000 = 1,000,000,000`
  - Stored as: `1000000000` (uint256)

## Implementation Details

The decimal adjustment is implemented in the `PriceOracleService` class:

### Formatting Price for Contract (`formatPriceForContract`)

```typescript
const tokenDecimals = tokenConfig?.decimals || 6;
const targetAdjustment = 12 - tokenDecimals;
const multiplier = Math.pow(10, targetAdjustment);
const formattedPrice = Math.floor(price * multiplier);
```

This converts a human-readable price (e.g., `$0.50`) to the contract's uint256 format.

### Reading Price from Contract (`formatPriceFromContract`)

```typescript
const tokenDecimals = tokenConfig?.decimals || 6;
const priceOracleDecimals = 12 - tokenDecimals;
const divisor = Math.pow(10, priceOracleDecimals);
const price = contractPrice / divisor;
```

This converts the contract's uint256 price back to a human-readable decimal format.

### Price Comparison (`postWithRetry`)

When comparing fetched prices with current contract prices, both values are adjusted to the contract scale:

```typescript
const targetAdjustment = 12 - tokenDecimals;
const adjustmentMultiplier = Math.pow(10, targetAdjustment);
const adjustedTargetPrice = rawTargetPrice * adjustmentMultiplier;
const adjustedCurrentPrice = currentPrice * adjustmentMultiplier;
```

This ensures accurate comparison regardless of the token's native decimals.

## Configuration

Token decimal configurations are stored in network configuration files:

- `config/networks/algorand-mainnet.json`
- `config/networks/voi-mainnet.json`

Each token entry includes a `decimals` field:

```json
{
  "ALGO": {
    "decimals": 6,
    "symbol": "ALGO",
    ...
  }
}
```

## Default Behavior

If a token's decimal configuration is not found, the system defaults to **6 decimals**, which is the most common value for Algorand Standard Assets (ASAs).

## Benefits

1. **Consistency**: All prices are stored in a uniform 12-decimal scale in the contract
2. **Precision**: Maintains full precision during conversions
3. **Flexibility**: Supports tokens with any decimal configuration (4, 6, 8, etc.)
4. **Accuracy**: Ensures correct price comparisons and updates

## Important Notes

- The adjustment is **symmetric**: the same formula is used for both encoding and decoding
- Prices are **floored** when converting to contract format to avoid rounding issues
- The contract stores prices as **uint256**, so very large prices may require careful handling
- The 12-decimal standard provides sufficient precision for most use cases while maintaining consistency

