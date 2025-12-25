import { Logger } from '../utils/logger';
import { PriceData } from '../types';

/**
 * Price sample with timestamp for TWAP calculation
 */
interface PriceSample {
  price: number;
  timestamp: Date;
}

/**
 * TWAP calculation result
 */
export interface TwapResult {
  twap: number;
  sampleCount: number;
  windowStart: Date;
  windowEnd: Date;
  oldestPrice: number;
  newestPrice: number;
}

/**
 * Service for calculating Time-Weighted Average Price (TWAP)
 */
export class TwapService {
  private logger: Logger;
  private priceSamples: Map<string, PriceSample[]> = new Map();
  private twapCache: Map<string, TwapResult> = new Map();

  constructor() {
    this.logger = new Logger('TwapService');
  }

  /**
   * Add a price sample for a feeder
   */
  public addSample(feederId: string, priceData: PriceData): void {
    if (!this.priceSamples.has(feederId)) {
      this.priceSamples.set(feederId, []);
    }

    const samples = this.priceSamples.get(feederId)!;
    samples.push({
      price: priceData.price,
      timestamp: priceData.timestamp || new Date(),
    });

    // Invalidate cache
    this.twapCache.delete(feederId);

    this.logger.debug(
      `Added price sample for ${feederId}: $${priceData.price} (${samples.length} samples)`
    );
  }

  /**
   * Calculate TWAP for a feeder over a specified time window
   */
  public calculateTwap(
    feederId: string,
    windowMs: number
  ): TwapResult | null {
    const samples = this.priceSamples.get(feederId);
    if (!samples || samples.length === 0) {
      return null;
    }

    const now = new Date();
    const windowStart = new Date(now.getTime() - windowMs);

    // Filter samples within the window
    const windowSamples = samples.filter(
      (sample) => sample.timestamp >= windowStart
    );

    if (windowSamples.length === 0) {
      return null;
    }

    // Sort by timestamp
    windowSamples.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // Calculate time-weighted average
    let totalWeightedPrice = 0;
    let totalWeight = 0;

    for (let i = 0; i < windowSamples.length; i++) {
      const sample = windowSamples[i];
      const nextSample = windowSamples[i + 1];

      // Weight is the time duration this price was valid
      let weight: number;
      if (nextSample) {
        // Time until next sample
        weight =
          nextSample.timestamp.getTime() - sample.timestamp.getTime();
      } else {
        // Last sample: time until now
        weight = now.getTime() - sample.timestamp.getTime();
      }

      totalWeightedPrice += sample.price * weight;
      totalWeight += weight;
    }

    const twap = totalWeight > 0 ? totalWeightedPrice / totalWeight : windowSamples[0].price;

    const result: TwapResult = {
      twap,
      sampleCount: windowSamples.length,
      windowStart,
      windowEnd: now,
      oldestPrice: windowSamples[0].price,
      newestPrice: windowSamples[windowSamples.length - 1].price,
    };

    // Cache the result
    this.twapCache.set(feederId, result);

    return result;
  }

  /**
   * Get cached TWAP result or calculate it
   */
  public getTwap(
    feederId: string,
    windowMs: number
  ): TwapResult | null {
    // Check cache first
    const cached = this.twapCache.get(feederId);
    if (cached) {
      // Verify cache is still valid (window hasn't changed significantly)
      const now = new Date();
      const expectedWindowStart = new Date(now.getTime() - windowMs);
      const windowDiff = Math.abs(
        cached.windowStart.getTime() - expectedWindowStart.getTime()
      );
      
      // Cache is valid if window start is within 1 second
      if (windowDiff < 1000) {
        return cached;
      }
    }

    return this.calculateTwap(feederId, windowMs);
  }

  /**
   * Clean up old samples outside the maximum window
   */
  public cleanup(feederId: string, maxWindowMs: number): void {
    const samples = this.priceSamples.get(feederId);
    if (!samples) {
      return;
    }

    const now = new Date();
    const cutoff = new Date(now.getTime() - maxWindowMs);

    const filtered = samples.filter((sample) => sample.timestamp >= cutoff);
    this.priceSamples.set(feederId, filtered);

    // Invalidate cache if samples were removed
    if (filtered.length < samples.length) {
      this.twapCache.delete(feederId);
      this.logger.debug(
        `Cleaned up ${samples.length - filtered.length} old samples for ${feederId}`
      );
    }
  }

  /**
   * Get current sample count for a feeder
   */
  public getSampleCount(feederId: string): number {
    return this.priceSamples.get(feederId)?.length || 0;
  }

  /**
   * Clear all samples for a feeder
   */
  public clear(feederId: string): void {
    this.priceSamples.delete(feederId);
    this.twapCache.delete(feederId);
  }

  /**
   * Clear all data
   */
  public clearAll(): void {
    this.priceSamples.clear();
    this.twapCache.clear();
  }
}

