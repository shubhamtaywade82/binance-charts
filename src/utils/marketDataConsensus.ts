// ─────────────────────────────────────────────────────────────────────────────
// Unified Market Intelligence & Multi-Stream Consensus Engine
// Fuses ALL available market data (L2 Depth, Order Book Walls, Volume Profile,
// SMC Liquidity, RVOL, Wick Dynamics, Funding/PCR, and LLM Context) into a
// single deterministic trade decision engine.
// ─────────────────────────────────────────────────────────────────────────────

import type { Candle, OrderBookLevel, TickPayload } from "../adapters/IDataAdapter";
import { detectVolumeProfile, detectFVGs, detectOrderBlocks, detectMarketStructure } from "./smcEngine";
import { MarketRegimeEngine, MarketRegimeTelemetry } from "./marketRegimeEngine";

export interface OrderBookTelemetry {
  bidsTotalVol: number;
  asksTotalVol: number;
  imbalanceRatio: number; // bids / asks (> 1.0 = bullish pressure, < 1.0 = bearish)
  top5ImbalanceRatio: number;
  maxBidWall: { price: number; quantity: number; distancePct: number } | null;
  maxAskWall: { price: number; quantity: number; distancePct: number } | null;
  spreadPrice: number;
  spreadBps: number;
}

export interface VolumeProfileTelemetry {
  poc: number;
  vah: number;
  val: number;
  priceVsPoc: "ABOVE_POC" | "BELOW_POC" | "AT_POC";
  isInValueArea: boolean;
  valueAreaAcceptance: "BULLISH_EXPANSION" | "BEARISH_EXPANSION" | "VALUE_AREA_ROTATION";
}

export interface SmcTelemetry {
  marketStructure: "BULLISH_BOS" | "BEARISH_BOS" | "CHOCH" | "RANGING";
  unmitigatedFvgCount: number;
  nearestFvg: { type: "BULLISH" | "BEARISH"; top: number; bottom: number } | null;
  nearestOrderBlock: { type: "BULLISH" | "BEARISH"; price: number } | null;
  liquiditySweep: "BSL_SWEPT" | "SSL_SWEPT" | "NONE";
}

export interface VolumeDynamicsTelemetry {
  currentVolume: number;
  avgVolume20: number;
  rvol: number; // Relative Volume (> 1.5x = high volume confirmation)
  volumeSpreadAnalysis: "HEALTHY_EXPANSION" | "ABSORPTION_CHOP" | "CLIMAX_EXHAUSTION" | "LOW_PARTICIPATION";
  wickRejection: "BULLISH_LOWER_WICK" | "BEARISH_UPPER_WICK" | "BALANCED_BODY";
  atr: number;
  atrPct: number;
}

export interface DerivativesTelemetry {
  fundingRate?: number; // e.g. -0.04%
  pcr?: number; // Put-Call Ratio (e.g. 1.25)
  openInterestChange?: number;
  liquidations?: { shortVol: number; longVol: number };
}

export interface MarketTelemetrySnapshot {
  timestamp: number;
  symbol: string;
  price: number;
  orderBook: OrderBookTelemetry;
  volumeProfile: VolumeProfileTelemetry;
  smc: SmcTelemetry;
  volumeDynamics: VolumeDynamicsTelemetry;
  derivatives: DerivativesTelemetry;
  regime: MarketRegimeTelemetry;
}

export interface ComprehensiveTradeDirective {
  action: "EXECUTE_BUY" | "EXECUTE_SELL" | "STAND_ASIDE_AVOID" | "WAIT_FOR_PULLBACK";
  headline: string;
  confidenceScore: number; // 0 - 100
  confidenceTier: "PRIME" | "HIGH" | "MEDIUM" | "LOW";
  entryPrice: number;
  stopLossPrice: number;
  stopLossPct: number;
  target1Price: number; // 1.5R
  target2Price: number; // 3.0R
  positionSizeMultiplier: number;
  reasonsToTake: string[];
  reasonsToAvoid: string[];
  telemetry: MarketTelemetrySnapshot;
}

export class MarketDataConsensusEngine {
  /**
   * Analyzes all available live market streams and synthesizes a complete telemetry snapshot.
   */
  public static analyzeFullMarket(
    symbol: string,
    candles: Candle[],
    orderBook?: { bids: OrderBookLevel[]; asks: OrderBookLevel[] },
    derivatives?: DerivativesTelemetry,
    currentLivePrice?: number
  ): MarketTelemetrySnapshot {
    const currentPrice = currentLivePrice || (candles.length > 0 ? candles[candles.length - 1].close : 0);
    const lastCandle = candles[candles.length - 1];

    // 1. Compute Order Book Depth Telemetry
    const obTelemetry = this.computeOrderBookTelemetry(orderBook, currentPrice);

    // 2. Compute Volume Profile Telemetry
    const vpTelemetry = this.computeVolumeProfileTelemetry(candles, currentPrice);

    // 3. Compute Smart Money Concepts (SMC) Telemetry
    const smcTelemetry = this.computeSmcTelemetry(candles, currentPrice);

    // 4. Compute Volume Dynamics & Wick Rejection
    const volDynamics = this.computeVolumeDynamics(candles, currentPrice);

    // 5. Compute Choppiness & Market Regime Telemetry
    const regimeTelemetry = MarketRegimeEngine.evaluateMarketRegime(candles);

    return {
      timestamp: lastCandle?.time || Math.floor(Date.now() / 1000),
      symbol,
      price: currentPrice,
      orderBook: obTelemetry,
      volumeProfile: vpTelemetry,
      smc: smcTelemetry,
      volumeDynamics: volDynamics,
      derivatives: derivatives || {},
      regime: regimeTelemetry,
    };
  }

  /**
   * Synthesizes all market telemetry streams into a definitive trade execution directive.
   */
  public static synthesizeDirective(
    telemetry: MarketTelemetrySnapshot,
    supertrendTrend: "UP" | "DOWN" | "NEUTRAL",
    supertrendStop: number,
    minConfidenceThreshold: number = 70
  ): ComprehensiveTradeDirective {
    const { price, orderBook, volumeProfile, smc, volumeDynamics, derivatives } = telemetry;
    const reasonsToTake: string[] = [];
    const reasonsToAvoid: string[] = [];

    let score = 50; // Base score

    // --- VECTOR 1: Supertrend & Price Action (25 pts) ---
    if (supertrendTrend === "UP") {
      score += 15;
      reasonsToTake.push(`Supertrend in confirmed Bullish Uptrend (Stop: ${supertrendStop.toLocaleString()})`);
    } else if (supertrendTrend === "DOWN") {
      score += 15;
      reasonsToTake.push(`Supertrend in confirmed Bearish Downtrend (Stop: ${supertrendStop.toLocaleString()})`);
    } else {
      score -= 10;
      reasonsToAvoid.push("Supertrend is in neutral / transition phase");
    }

    // --- VECTOR 2: Order Book L2 Depth & Walls (20 pts) ---
    if (supertrendTrend === "UP") {
      if (orderBook.imbalanceRatio > 1.3) {
        score += 12;
        reasonsToTake.push(`L2 Depth confirms ${(orderBook.imbalanceRatio).toFixed(2)}x Bid support pressure`);
      } else if (orderBook.imbalanceRatio < 0.75) {
        score -= 15;
        reasonsToAvoid.push(`Heavy Ask Resistance: Asks outweigh Bids by ${(1 / orderBook.imbalanceRatio).toFixed(2)}x`);
      }

      if (orderBook.maxAskWall && orderBook.maxAskWall.distancePct < 0.8) {
        score -= 10;
        reasonsToAvoid.push(`Overhead Sell Wall: ${orderBook.maxAskWall.quantity.toLocaleString()} qty at +${orderBook.maxAskWall.distancePct.toFixed(2)}%`);
      }
    } else if (supertrendTrend === "DOWN") {
      if (orderBook.imbalanceRatio < 0.75) {
        score += 12;
        reasonsToTake.push(`L2 Depth confirms ${(1 / orderBook.imbalanceRatio).toFixed(2)}x Ask selling pressure`);
      } else if (orderBook.imbalanceRatio > 1.3) {
        score -= 15;
        reasonsToAvoid.push(`Bid Support Floor: Bids outweigh Asks by ${orderBook.imbalanceRatio.toFixed(2)}x`);
      }

      if (orderBook.maxBidWall && orderBook.maxBidWall.distancePct < 0.8) {
        score -= 10;
        reasonsToAvoid.push(`Underlying Buy Wall: ${orderBook.maxBidWall.quantity.toLocaleString()} qty at -${orderBook.maxBidWall.distancePct.toFixed(2)}%`);
      }
    }

    // --- VECTOR 3: Volume Profile POC & Value Area (20 pts) ---
    if (supertrendTrend === "UP") {
      if (volumeProfile.priceVsPoc === "ABOVE_POC") {
        score += 10;
        reasonsToTake.push(`Trading above Volume Profile POC (${volumeProfile.poc.toLocaleString()}) — Bullish value acceptance`);
      } else {
        score -= 8;
        reasonsToAvoid.push(`Trading below POC (${volumeProfile.poc.toLocaleString()}) — High overhead volume supply`);
      }
    } else if (supertrendTrend === "DOWN") {
      if (volumeProfile.priceVsPoc === "BELOW_POC") {
        score += 10;
        reasonsToTake.push(`Trading below Volume Profile POC (${volumeProfile.poc.toLocaleString()}) — Bearish distribution acceptance`);
      } else {
        score -= 8;
        reasonsToAvoid.push(`Trading above POC (${volumeProfile.poc.toLocaleString()}) — Buyers holding value area`);
      }
    }

    // --- VECTOR 4: RVOL & Volume Spread Dynamics (15 pts) ---
    if (volumeDynamics.rvol >= 1.4) {
      score += 10;
      reasonsToTake.push(`High Relative Volume (RVOL ${volumeDynamics.rvol.toFixed(1)}x) validates genuine momentum`);
    } else if (volumeDynamics.rvol < 0.7) {
      score -= 10;
      reasonsToAvoid.push(`Low Relative Volume (RVOL ${volumeDynamics.rvol.toFixed(1)}x) indicates low conviction / chop`);
    }

    if (supertrendTrend === "UP" && volumeDynamics.wickRejection === "BULLISH_LOWER_WICK") {
      score += 6;
      reasonsToTake.push("Strong lower wick price rejection (Buyers aggressively absorbing dips)");
    } else if (supertrendTrend === "DOWN" && volumeDynamics.wickRejection === "BEARISH_UPPER_WICK") {
      score += 6;
      reasonsToTake.push("Strong upper wick price rejection (Sellers actively rejecting rallies)");
    }

    // --- VECTOR 5: Smart Money Liquidity & Derivatives (10 pts) ---
    if (supertrendTrend === "UP") {
      if (smc.liquiditySweep === "SSL_SWEPT") {
        score += 8;
        reasonsToTake.push("Sell-Side Liquidity (SSL) swept into institutional demand zone");
      }
      if (derivatives.fundingRate !== undefined && derivatives.fundingRate < -0.02) {
        score += 6;
        reasonsToTake.push(`Negative Funding (${derivatives.fundingRate}%) elevates short-squeeze probability`);
      }
    } else if (supertrendTrend === "DOWN") {
      if (smc.liquiditySweep === "BSL_SWEPT") {
        score += 8;
        reasonsToTake.push("Buy-Side Liquidity (BSL) swept into institutional supply zone");
      }
      if (derivatives.fundingRate !== undefined && derivatives.fundingRate > 0.04) {
        score += 6;
        reasonsToTake.push(`Elevated Funding (+${derivatives.fundingRate}%) increases long liquidation cascade risk`);
      }
    }

    // --- VECTOR 6: Choppiness Index (CHOP) & Market Regime Filter (25 pts) ---
    if (telemetry.regime) {
      if (telemetry.regime.chopIndex <= 38.2 && telemetry.regime.adx >= 25) {
        score += 15;
        reasonsToTake.push(`Explosive Trending Regime (CHOP ${telemetry.regime.chopIndex} < 38.2, ADX ${telemetry.regime.adx} > 25)`);
      } else if (telemetry.regime.isChop || telemetry.regime.chopIndex >= 61.8) {
        score -= 30; // Severe penalty for chop!
        reasonsToAvoid.push(`High Choppiness Detected (CHOP ${telemetry.regime.chopIndex} > 61.8) — High whip-saw probability; stand aside`);
      } else if (telemetry.regime.isSqueezeActive) {
        score -= 20;
        reasonsToAvoid.push("Volatility Squeeze Active (Bollinger inside Keltner) — Energy compressing; avoid breakout trades");
      }
    }

    // Clamp score between 10 and 99
    const finalConfidence = Math.min(99, Math.max(10, Math.round(score)));

    let tier: "PRIME" | "HIGH" | "MEDIUM" | "LOW" = "LOW";
    if (finalConfidence >= 85) tier = "PRIME";
    else if (finalConfidence >= 75) tier = "HIGH";
    else if (finalConfidence >= 55) tier = "MEDIUM";

    const isTakeTrade = finalConfidence >= minConfidenceThreshold && supertrendTrend !== "NEUTRAL";
    const action = isTakeTrade
      ? supertrendTrend === "UP"
        ? "EXECUTE_BUY"
        : "EXECUTE_SELL"
      : finalConfidence >= 55
      ? "WAIT_FOR_PULLBACK"
      : "STAND_ASIDE_AVOID";

    const stopDistance = Math.abs(price - supertrendStop) || price * 0.015;
    const stopLossPct = Number(((stopDistance / price) * 100).toFixed(2));
    const target1Price = supertrendTrend === "UP" ? price + stopDistance * 1.5 : price - stopDistance * 1.5;
    const target2Price = supertrendTrend === "UP" ? price + stopDistance * 3.0 : price - stopDistance * 3.0;

    let sizeMult = 1.0;
    if (tier === "PRIME") sizeMult = 1.4;
    else if (tier === "HIGH") sizeMult = 1.1;
    else if (tier === "LOW") sizeMult = 0.5;

    const headline = isTakeTrade
      ? supertrendTrend === "UP"
        ? `HIGH-PROBABILITY BULLISH EXPANSION SETUP (${finalConfidence}% CONFIDENCE · ${tier})`
        : `HIGH-PROBABILITY BEARISH BREAKDOWN SETUP (${finalConfidence}% CONFIDENCE · ${tier})`
      : finalConfidence >= 55
      ? `WAIT FOR PULLBACK — CONFLICTING ORDER FLOW (${finalConfidence}% CONFIDENCE)`
      : `STAND ASIDE / DO NOT TRADE — SUB-THRESHOLD CERTAINTY (${finalConfidence}% < ${minConfidenceThreshold}%)`;

    return {
      action,
      headline,
      confidenceScore: finalConfidence,
      confidenceTier: tier,
      entryPrice: Number(price.toFixed(4)),
      stopLossPrice: Number(supertrendStop.toFixed(4)),
      stopLossPct,
      target1Price: Number(target1Price.toFixed(4)),
      target2Price: Number(target2Price.toFixed(4)),
      positionSizeMultiplier: sizeMult,
      reasonsToTake,
      reasonsToAvoid,
      telemetry,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TELEMETRY COMPUTATION HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  private static computeOrderBookTelemetry(
    orderBook: { bids: OrderBookLevel[]; asks: OrderBookLevel[] } | undefined,
    currentPrice: number
  ): OrderBookTelemetry {
    if (!orderBook || (!orderBook.bids.length && !orderBook.asks.length)) {
      return {
        bidsTotalVol: 100,
        asksTotalVol: 100,
        imbalanceRatio: 1.0,
        top5ImbalanceRatio: 1.0,
        maxBidWall: null,
        maxAskWall: null,
        spreadPrice: 0,
        spreadBps: 0,
      };
    }

    const bids = orderBook.bids;
    const asks = orderBook.asks;

    const bidsTotalVol = bids.reduce((sum, b) => sum + (b.qty || b.quantity || 0), 0);
    const asksTotalVol = asks.reduce((sum, a) => sum + (a.qty || a.quantity || 0), 0);
    const imbalanceRatio = asksTotalVol > 0 ? Number((bidsTotalVol / asksTotalVol).toFixed(2)) : 1.0;

    const top5Bids = bids.slice(0, 5).reduce((sum, b) => sum + (b.qty || b.quantity || 0), 0);
    const top5Asks = asks.slice(0, 5).reduce((sum, a) => sum + (a.qty || a.quantity || 0), 0);
    const top5ImbalanceRatio = top5Asks > 0 ? Number((top5Bids / top5Asks).toFixed(2)) : 1.0;

    let maxBid = bids[0];
    for (const b of bids) {
      const q = b.qty || b.quantity || 0;
      const maxQ = maxBid ? (maxBid.qty || maxBid.quantity || 0) : 0;
      if (q > maxQ) maxBid = b;
    }

    let maxAsk = asks[0];
    for (const a of asks) {
      const q = a.qty || a.quantity || 0;
      const maxQ = maxAsk ? (maxAsk.qty || maxAsk.quantity || 0) : 0;
      if (q > maxQ) maxAsk = a;
    }

    const bestBid = bids[0]?.price || currentPrice;
    const bestAsk = asks[0]?.price || currentPrice;
    const spreadPrice = Math.max(0, bestAsk - bestBid);
    const spreadBps = currentPrice > 0 ? Number(((spreadPrice / currentPrice) * 10000).toFixed(1)) : 0;

    return {
      bidsTotalVol: Number(bidsTotalVol.toFixed(2)),
      asksTotalVol: Number(asksTotalVol.toFixed(2)),
      imbalanceRatio,
      top5ImbalanceRatio,
      maxBidWall: maxBid
        ? {
            price: maxBid.price,
            quantity: Number((maxBid.qty || maxBid.quantity || 0).toFixed(2)),
            distancePct: Number((((currentPrice - maxBid.price) / currentPrice) * 100).toFixed(2)),
          }
        : null,
      maxAskWall: maxAsk
        ? {
            price: maxAsk.price,
            quantity: Number((maxAsk.qty || maxAsk.quantity || 0).toFixed(2)),
            distancePct: Number((((maxAsk.price - currentPrice) / currentPrice) * 100).toFixed(2)),
          }
        : null,
      spreadPrice,
      spreadBps,
    };
  }

  private static computeVolumeProfileTelemetry(candles: Candle[], currentPrice: number): VolumeProfileTelemetry {
    if (candles.length < 10) {
      return {
        poc: currentPrice,
        vah: currentPrice * 1.01,
        val: currentPrice * 0.99,
        priceVsPoc: "AT_POC",
        isInValueArea: true,
        valueAreaAcceptance: "VALUE_AREA_ROTATION",
      };
    }

    try {
      const vp = detectVolumeProfile(candles.slice(-100) as any, 24, 0.7);
      const poc = vp ? vp.pocPrice : currentPrice;
      const vah = vp ? vp.vahPrice : currentPrice * 1.01;
      const val = vp ? vp.valPrice : currentPrice * 0.99;

      const priceVsPoc = currentPrice > poc ? "ABOVE_POC" : currentPrice < poc ? "BELOW_POC" : "AT_POC";
      const isInValueArea = currentPrice >= val && currentPrice <= vah;
      const valueAreaAcceptance = currentPrice > vah
        ? "BULLISH_EXPANSION"
        : currentPrice < val
        ? "BEARISH_EXPANSION"
        : "VALUE_AREA_ROTATION";

      return {
        poc: Number(poc.toFixed(2)),
        vah: Number(vah.toFixed(2)),
        val: Number(val.toFixed(2)),
        priceVsPoc,
        isInValueArea,
        valueAreaAcceptance,
      };
    } catch {
      return {
        poc: currentPrice,
        vah: currentPrice * 1.01,
        val: currentPrice * 0.99,
        priceVsPoc: "AT_POC",
        isInValueArea: true,
        valueAreaAcceptance: "VALUE_AREA_ROTATION",
      };
    }
  }

  private static computeSmcTelemetry(candles: Candle[], currentPrice: number): SmcTelemetry {
    if (candles.length < 15) {
      return {
        marketStructure: "RANGING",
        unmitigatedFvgCount: 0,
        nearestFvg: null,
        nearestOrderBlock: null,
        liquiditySweep: "NONE",
      };
    }

    try {
      const recent = candles.slice(-50);
      const fvgs = detectFVGs(recent as any);
      const obs = detectOrderBlocks(recent as any);
      const structure = detectMarketStructure(recent as any);

      const activeFvg = fvgs.length > 0 ? fvgs[fvgs.length - 1] : null;
      const activeOb = obs.length > 0 ? obs[obs.length - 1] : null;

      // Check liquidity sweep on recent bars
      const lastCandle = recent[recent.length - 1];
      const prevHigh = Math.max(...recent.slice(-10, -1).map((c) => c.high));
      const prevLow = Math.min(...recent.slice(-10, -1).map((c) => c.low));

      let liquiditySweep: "BSL_SWEPT" | "SSL_SWEPT" | "NONE" = "NONE";
      if (lastCandle.high > prevHigh && lastCandle.close < prevHigh) {
        liquiditySweep = "BSL_SWEPT";
      } else if (lastCandle.low < prevLow && lastCandle.close > prevLow) {
        liquiditySweep = "SSL_SWEPT";
      }

      const structType = structure.length > 0
        ? structure[structure.length - 1].type.includes("BOS")
          ? structure[structure.length - 1].type.includes("BULL")
            ? "BULLISH_BOS"
            : "BEARISH_BOS"
          : "CHOCH"
        : "RANGING";

      return {
        marketStructure: structType,
        unmitigatedFvgCount: fvgs.length,
        nearestFvg: activeFvg ? { type: activeFvg.type === "BULLISH" ? "BULLISH" : "BEARISH", top: activeFvg.top, bottom: activeFvg.bottom } : null,
        nearestOrderBlock: activeOb ? { type: activeOb.type.includes("BULL") ? "BULLISH" : "BEARISH", price: activeOb.bottom } : null,
        liquiditySweep,
      };
    } catch {
      return {
        marketStructure: "RANGING",
        unmitigatedFvgCount: 0,
        nearestFvg: null,
        nearestOrderBlock: null,
        liquiditySweep: "NONE",
      };
    }
  }

  private static computeVolumeDynamics(candles: Candle[], currentPrice: number): VolumeDynamicsTelemetry {
    if (candles.length < 20) {
      return {
        currentVolume: 0,
        avgVolume20: 0,
        rvol: 1.0,
        volumeSpreadAnalysis: "HEALTHY_EXPANSION",
        wickRejection: "BALANCED_BODY",
        atr: currentPrice * 0.015,
        atrPct: 1.5,
      };
    }

    const recent = candles.slice(-20);
    const current = recent[recent.length - 1];
    const avgVol = recent.reduce((sum, c) => sum + (c.volume || 0), 0) / 20;
    const rvol = avgVol > 0 ? Number(((current.volume || 0) / avgVol).toFixed(2)) : 1.0;

    // Wick dynamics
    const range = current.high - current.low || 1;
    const body = Math.abs(current.close - current.open);
    const upperWick = current.high - Math.max(current.open, current.close);
    const lowerWick = Math.min(current.open, current.close) - current.low;

    let wickRejection: "BULLISH_LOWER_WICK" | "BEARISH_UPPER_WICK" | "BALANCED_BODY" = "BALANCED_BODY";
    if (lowerWick / range > 0.45) wickRejection = "BULLISH_LOWER_WICK";
    else if (upperWick / range > 0.45) wickRejection = "BEARISH_UPPER_WICK";

    // VSA classification
    let volumeSpreadAnalysis: "HEALTHY_EXPANSION" | "ABSORPTION_CHOP" | "CLIMAX_EXHAUSTION" | "LOW_PARTICIPATION" = "HEALTHY_EXPANSION";
    if (rvol > 2.0 && body / range < 0.3) volumeSpreadAnalysis = "ABSORPTION_CHOP";
    else if (rvol > 2.5 && body / range > 0.7) volumeSpreadAnalysis = "CLIMAX_EXHAUSTION";
    else if (rvol < 0.6) volumeSpreadAnalysis = "LOW_PARTICIPATION";

    // ATR
    let trSum = 0;
    for (let i = 1; i < recent.length; i++) {
      const c = recent[i];
      const p = recent[i - 1];
      trSum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    }
    const atr = trSum / (recent.length - 1 || 1);
    const atrPct = currentPrice > 0 ? Number(((atr / currentPrice) * 100).toFixed(2)) : 1.5;

    return {
      currentVolume: current.volume || 0,
      avgVolume20: Math.round(avgVol),
      rvol,
      volumeSpreadAnalysis,
      wickRejection,
      atr: Number(atr.toFixed(2)),
      atrPct,
    };
  }
}
