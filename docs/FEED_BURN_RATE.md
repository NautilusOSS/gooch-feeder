# Feed Burn Rate Analysis

This document provides a detailed analysis of feed burn rates (feed frequency and transaction costs) for each network configured in the Gooch Feeder system.

## Overview

Feed burn rate refers to the frequency at which price feeds are posted to the price oracle contracts on each network. This includes:
- **Feed Frequency**: How often each feeder runs (based on `interval` configuration)
- **Total Feeds**: Aggregate number of feeds per hour/day across all enabled feeders
- **Transaction Costs**: Estimated gas/transaction costs (where applicable)

## Batch Processing Mode

The system now supports **batch processing mode** (enabled by default), which improves efficiency and reduces overhead:

- **Batch Interval**: 10 minutes (600,000ms) - The system checks for feeders that need to run every 10 minutes
- **Individual Feeder Intervals**: Each feeder still runs based on its own `interval` setting (typically 2 minutes)
- **Batch Collection**: Feeders that are ready to run are collected and processed together in batches
- **Network Grouping**: Feeders are grouped by network for efficient transaction processing
- **Priority Ordering**: Feeders are processed in priority order (higher priority first)

**How It Works:**
1. Every 10 minutes, the system checks all enabled feeders
2. Feeders whose `interval` has elapsed since their last run are collected into a batch
3. Feeders are grouped by network and destination type
4. The batch is processed together, improving efficiency and reducing transaction overhead

**Benefits:**
- More efficient processing of multiple feeders
- Reduced system overhead compared to individual intervals
- Better resource utilization
- Network-aware grouping for optimal transaction batching

**Note**: Batch processing does not change feed frequency or burn rates - it only changes how feeders are processed. The feed frequencies and costs listed below remain the same.

## Network Summary

### VOI Mainnet

**Configuration:**
- Network ID: `voi-mainnet`
- Price Oracle Contract: `47138069`
- RPC URL: `https://mainnet-api.voi.nodely.dev`
- Gas Limit: `1,000,000`
- Gas Price: `1,000` (microAlgos)

**Enabled Feeders:** 7

| Feeder ID | Asset Symbol | Interval (ms) | Interval (minutes) | Feeds/Hour | Feeds/Day |
|-----------|--------------|---------------|-------------------|------------|-----------|
| voi-mainnet-47139778-VOI | VOI | 900,000 | 15 | 4 | 96 |
| voi-mainnet-47139778-UNIT | UNIT | 900,000 | 15 | 4 | 96 |
| voi-mainnet-47139778-POW | POW | 900,000 | 15 | 4 | 96 |
| voi-mainnet-47139781-GM | GM | 900,000 | 15 | 4 | 96 |
| voi-mainnet-47139781-CORN | CORN | 900,000 | 15 | 4 | 96 |
| voi-mainnet-47139778-aALGO | aALGO | 900,000 | 15 | 4 | 96 |
| voi-mainnet-47139778-aETH | aETH | 900,000 | 15 | 4 | 96 |

**Total Feed Burn Rate:**
- **Per Hour**: 28 feeds (7 feeders × 4 feeds/hour)
- **Per Day**: 672 feeds (7 feeders × 96 feeds/day)
- **Per Week**: 4,704 feeds
- **Per Month**: ~20,160 feeds (30-day average)

**Transaction Costs:**
- **Base Transaction Cost**: 0.001 VOI per transaction
- **Cost Per Hour**: 0.028 VOI (28 feeds × 0.001 VOI)
- **Cost Per Day**: 0.672 VOI (672 feeds × 0.001 VOI)
- **Cost Per Week**: 4.704 VOI (4,704 feeds × 0.001 VOI)
- **Cost Per Month**: ~20.16 VOI (20,160 feeds × 0.001 VOI)

**Note**: Actual costs may be lower due to price comparison optimization that skips transactions when prices haven't changed.

---

### Algorand Mainnet

**Configuration:**
- Network ID: `algorand-mainnet`
- Price Oracle Contract: `3333688500`
- RPC URL: `https://mainnet-api.algonode.cloud`
- Gas Limit: `1,000,000`
- Gas Price: `1,000` (microAlgos)

**Enabled Feeders:** 24

| Feeder ID | Asset Symbol | Interval (ms) | Interval (minutes) | Feeds/Hour | Feeds/Day |
|-----------|--------------|---------------|-------------------|------------|-----------|
| algorand-mainnet-3333688282-ALGO | ALGO | 900,000 | 15 | 4 | 96 |
| algorand-mainnet-3333688282-UNIT | UNIT | 900,000 | 15 | 4 | 96 |
| algorand-mainnet-3333688282-POW | POW | 900,000 | 15 | 4 | 96 |
| algorand-mainnet-3333688282-goBTC | goBTC | 900,000 | 15 | 4 | 96 |
| algorand-mainnet-3333688282-wBTC | wBTC | 900,000 | 15 | 4 | 96 |
| algorand-mainnet-3333688282-goETH | goETH | 900,000 | 15 | 4 | 96 |
| algorand-mainnet-3333688282-wETH | wETH | 900,000 | 15 | 4 | 96 |
| algorand-mainnet-3333688282-LINK | LINK | 900,000 | 15 | 4 | 96 |
| algorand-mainnet-3333688282-SOL | SOL | 900,000 | 15 | 4 | 96 |
| algorand-mainnet-3333688282-AVAX | AVAX | 900,000 | 15 | 4 | 96 |
| algorand-mainnet-3345940978-FINITE | FINITE | 900,000 | 15 | 4 | 96 |
| algorand-mainnet-3345940978-FOLKS | FOLKS | 900,000 | 15 | 4 | 96 |
| algorand-mainnet-3345940978-COOP | COOP | 900,000 | 15 | 4 | 96 |
| algorand-mainnet-3345940978-HOG | HOG | 900,000 | 15 | 4 | 96 |
| algorand-mainnet-3345940978-USDt | USDt | 900,000 | 15 | 4 | 96 |
| algorand-mainnet-3345940978-xUSD | xUSD | 900,000 | 15 | 4 | 96 |
| algorand-mainnet-3345940978-HAY | HAY | 900,000 | 15 | 4 | 96 |
| algorand-mainnet-3345940978-BRO | BRO | 900,000 | 15 | 4 | 96 |
| algorand-mainnet-3333688282-aVOI | aVOI | 900,000 | 15 | 4 | 96 |
| algorand-mainnet-3345940978-ALPHA | ALPHA | 900,000 | 15 | 4 | 96 |
| algorand-mainnet-3345940978-COMPX | COMPX | 900,000 | 15 | 4 | 96 |
| algorand-mainnet-3345940978-AKTA | AKTA | 900,000 | 15 | 4 | 96 |
| algorand-mainnet-3345940978-PEPE | PEPE | 900,000 | 15 | 4 | 96 |
| algorand-mainnet-3345940978-GOLD$ | GOLD$ | 900,000 | 15 | 4 | 96 |

**Total Feed Burn Rate:**
- **Per Hour**: 96 feeds (24 feeders × 4 feeds/hour)
- **Per Day**: 2,304 feeds (24 feeders × 96 feeds/day)
- **Per Week**: 16,128 feeds
- **Per Month**: ~69,120 feeds (30-day average)

**Transaction Costs:**
- **Base Transaction Cost**: 0.001 ALGO per transaction
- **Cost Per Hour**: 0.096 ALGO (96 feeds × 0.001 ALGO)
- **Cost Per Day**: 2.304 ALGO (2,304 feeds × 0.001 ALGO)
- **Cost Per Week**: 16.128 ALGO (16,128 feeds × 0.001 ALGO)
- **Cost Per Month**: ~69.12 ALGO (69,120 feeds × 0.001 ALGO)

**Note**: Actual costs may be lower due to price comparison optimization that skips transactions when prices haven't changed.

---

## System-Wide Totals

**Combined Feed Burn Rate:**
- **Total Enabled Feeders**: 31 (7 VOI + 24 Algorand)
- **Per Hour**: 124 feeds (28 VOI + 96 Algorand)
- **Per Day**: 2,976 feeds (672 VOI + 2,304 Algorand)
- **Per Week**: 20,832 feeds (4,704 VOI + 16,128 Algorand)
- **Per Month**: ~89,280 feeds (~20,160 VOI + ~69,120 Algorand)

**Combined Transaction Costs:**
- **Cost Per Hour**: 0.124 tokens (0.028 VOI + 0.096 ALGO)
- **Cost Per Day**: 2.976 tokens (0.672 VOI + 2.304 ALGO)
- **Cost Per Week**: 20.832 tokens (4.704 VOI + 16.128 ALGO)
- **Cost Per Month**: ~89.28 tokens (~20.16 VOI + ~69.12 ALGO)

**Note**: Costs are calculated assuming all feeds result in transactions. Actual costs will be lower due to the price comparison optimization that skips transactions when prices haven't changed.

## Feed Interval Standardization

All currently enabled feeders use a standardized interval of **900,000 milliseconds (15 minutes)**. This means:
- Each feeder attempts to post a price update every 15 minutes
- The system checks if the price has changed before posting (see [Price Adjustments](./PRICE_ADJUSTMENTS.md))
- If the fetched price equals the current contract price, the transaction is skipped to reduce costs

## Cost Optimization

The system includes several optimizations to reduce unnecessary transactions:

1. **Price Comparison**: Before posting, the system compares the fetched price with the current contract price. If they match (within tolerance), the transaction is skipped. This is the most significant cost optimization, as it prevents posting when prices haven't changed.

2. **Batch Processing**: Feeders are processed in batches, which reduces system overhead and improves efficiency. While this doesn't directly reduce transaction costs, it optimizes resource usage and can improve overall system performance.

3. **Validation Checks**: Prices are validated against `minPrice` and `maxPrice` constraints before posting.

4. **Change Threshold**: The `maxPriceChange` validation (50% by default) helps prevent posting during extreme volatility.

5. **Retry Logic**: Failed transactions are retried up to 3 times (configurable) before being marked as failed.

6. **Network Grouping**: In batch mode, feeders are grouped by network, allowing for more efficient transaction processing and potential future optimizations like atomic transaction batching.

**Cost Savings**: The price comparison optimization can significantly reduce actual transaction costs, especially during periods of price stability. The costs listed above represent maximum potential costs if every feed attempt results in a transaction. In practice, costs will be lower based on how frequently prices actually change.

**Batch Processing Benefits**: While batch processing doesn't change feed frequency or transaction costs, it provides:
- Reduced system overhead (single batch check vs. multiple individual timers)
- Better resource utilization
- Improved scalability for large numbers of feeders
- Foundation for future transaction batching optimizations

## Monitoring Feed Activity

To monitor actual feed activity and costs:

1. Check the application logs for successful/failed feed attempts
2. Monitor on-chain transaction history for the price oracle contracts
3. Review metrics collected by the `FeederManagerService` (if metrics collection is enabled)

## Configuration Reference

### Feeder Configuration

Feed intervals and other settings are configured in `config/feeders.json`. To modify feed frequency:

1. Update the `interval` field (in milliseconds) for individual feeders
2. Adjust `defaultInterval` in `globalSettings` for new feeders
3. Consider network capacity and transaction costs when reducing intervals

**Note**: Reducing intervals will increase feed frequency and transaction costs proportionally.

### Batch Processing Configuration

Batch processing settings are configured in `config/networks.json` under `globalSettings.batchProcessing`:

```json
{
  "globalSettings": {
    "batchProcessing": {
      "enabled": true,
      "batchInterval": 600000,
      "maxBatchSize": 50,
      "groupByNetwork": true,
      "priorityOrder": true
    }
  }
}
```

**Configuration Options:**
- **`enabled`**: Enable/disable batch processing mode (default: `true`)
- **`batchInterval`**: How often to check for feeders that need to run (default: `600000` ms = 10 minutes)
- **`maxBatchSize`**: Maximum feeders processed per batch (default: `50`)
- **`groupByNetwork`**: Group feeders by network for efficient batching (default: `true`)
- **`priorityOrder`**: Process feeders in priority order (default: `true`)

**Disabling Batch Processing:**
Set `enabled: false` to use individual intervals for each feeder (legacy mode). This will start each feeder on its own interval timer.

## Current Configuration: 15 Minutes (900,000ms)

**VOI Mainnet (7 feeders):**
- Feeds per hour: 28 (7 × 4)
- Feeds per day: 672 (7 × 96)
- **Daily cost: 0.672 VOI**
- **Monthly cost: ~20.16 VOI**

**Algorand Mainnet (24 feeders):**
- Feeds per hour: 96 (24 × 4)
- Feeds per day: 2,304 (24 × 96)
- **Daily cost: 2.304 ALGO**
- **Monthly cost: ~69.12 ALGO**

**System Total:**
- Feeds per day: 2,976
- **Daily cost: 2.976 tokens (0.672 VOI + 2.304 ALGO)**
- **Monthly cost: ~89.28 tokens**

---

## Interval Comparison: 2 Minutes vs 5 Minutes vs 15 Minutes

This section compares feed burn rates and costs at different interval settings to help with cost planning.

### Alternative Configuration: 5 Minutes (300,000ms)

If all feeders were configured with a 5-minute interval:

**VOI Mainnet (7 feeders):**
- Feeds per hour: 84 (7 × 12)
- Feeds per day: 2,016 (7 × 288)
- **Daily cost: 2.016 VOI**
- **Monthly cost: ~60.48 VOI**

**Algorand Mainnet (24 feeders):**
- Feeds per hour: 288 (24 × 12)
- Feeds per day: 6,912 (24 × 288)
- **Daily cost: 6.912 ALGO**
- **Monthly cost: ~207.36 ALGO**

**System Total:**
- Feeds per day: 8,928
- **Daily cost: 8.928 tokens (2.016 VOI + 6.912 ALGO)**
- **Monthly cost: ~267.84 tokens**

### Alternative Configuration: 2 Minutes (120,000ms)

If all feeders were configured with a 2-minute interval:

**VOI Mainnet (7 feeders):**
- Feeds per hour: 210 (7 × 30)
- Feeds per day: 5,040 (7 × 720)
- **Daily cost: 5.04 VOI**
- **Monthly cost: ~151.2 VOI**

**Algorand Mainnet (24 feeders):**
- Feeds per hour: 720 (24 × 30)
- Feeds per day: 17,280 (24 × 720)
- **Daily cost: 17.28 ALGO**
- **Monthly cost: ~518.4 ALGO**

**System Total:**
- Feeds per day: 22,320
- **Daily cost: 22.32 tokens (5.04 VOI + 17.28 ALGO)**
- **Monthly cost: ~669.6 tokens**

### Cost Comparison Summary

| Metric | Current (15 min) | 5 Minutes | 2 Minutes | Savings vs 5min | Savings vs 2min |
|--------|------------------|-----------|-----------|-----------------|----------------|
| **Daily Feeds** | 2,976 | 8,928 | 22,320 | 66.7% reduction | 86.7% reduction |
| **Daily Cost** | 2.976 tokens | 8.928 tokens | 22.32 tokens | 66.7% savings | 86.7% savings |
| **Monthly Cost** | ~89.28 tokens | ~267.84 tokens | ~669.6 tokens | ~178.56 tokens | ~580.32 tokens |
| **VOI Daily Cost** | 0.672 VOI | 2.016 VOI | 5.04 VOI | 66.7% savings | 86.7% savings |
| **ALGO Daily Cost** | 2.304 ALGO | 6.912 ALGO | 17.28 ALGO | 66.7% savings | 86.7% savings |

**Key Insights:**
- The current 15-minute interval provides **66.7% cost savings** compared to a 5-minute interval
- The current 15-minute interval provides **86.7% cost savings** compared to a 2-minute interval
- This results in **~178.56 tokens per month** savings vs 5 minutes (~5.95 tokens per day)
- This results in **~580.32 tokens per month** savings vs 2 minutes (~19.34 tokens per day)
- The 15-minute interval provides price updates every 15 minutes, which is suitable for most price oracle use cases
- Batch processing (10-minute batch interval) efficiently handles all feeders while maintaining their individual 15-minute intervals

**Trade-offs:**
- **Pros**: Significant cost reduction (66.7% vs 5min, 86.7% vs 2min), lower network load, efficient batch processing, still frequent enough for most applications
- **Cons**: Less frequent price updates (15 minutes vs 5 or 2 minutes), potentially slower response to price changes

**Recommendation**: The current 15-minute interval provides excellent cost efficiency while maintaining reasonable update frequency for price oracle use cases. The 10-minute batch processing interval ensures efficient handling of all feeders.

