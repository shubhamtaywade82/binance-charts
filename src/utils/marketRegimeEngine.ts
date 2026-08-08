// ─────────────────────────────────────────────────────────────────────────────
// Market Regime & Choppiness Filter Engine
// Uses Dreiss Choppiness Index (Fractal Dimension), Wilder's ADX, Multi-Timeframe
// (MTF) Alignment, and Bollinger-Keltner Volatility Squeezes to detect and avoid
// choppy whip-saw consolidation zones.
// ─────────────────────────────────────────────────────────────────────────────

import type { Candle } from "../adapters/IDataAdapter";

export type MarketRegimeType = "TRENDING_EXPANSION" | "CHOPPY_COMPRESSION" | "VOLATILITY_SQUEEZE" | "TRANSITION";
export type MacroBias = "STRONG_BULLISH" | "LEAN_BULLISH" | "NEUTRAL_CHOP" | "LEAN_BEARISH" | "STRONG_BEARISH";

export interface MarketRegimeTelemetry {
  regime: MarketRegimeType;
  chopIndex: number; // 0 - 100 (> 61.8 = High Chop, < 38.2 = Trending)
  isChop: boolean;
  adx: number; // > 25 = Strong Trend, < 20 = Absent Trend / Noise
  plusDI: number;
  minusDI: number;
  macroBias: MacroBias;
  htfAlignmentScore: number; // 0 - 100%
  isSqueezeActive: boolean; // Bollinger Bands compressed inside Keltner Channel
  canExecuteTrendTrade: boolean;
  regimeMessage: string;
}

export class MarketRegimeEngine {
  /**
   * Calculates the Dreiss Choppiness Index (CHOP) over n bars.
   * CHOP = 100 * log10( Sum(ATR(1), n) / (MaxHigh(n) - MinLow(n)) ) / log10(n)
   */
  public static calculateChoppinessIndex(candles: Candle[], length: number = 14): number {
    if (!candles || candles.length < length + 1) return 50;

    const slice = candles.slice(-length - 1);
    let trueRangeSum = 0;
    let maxHigh = -Infinity;
    let minLow = Infinity;

    for (let i = 1; i < slice.length; i++) {
      const curr = slice[i];
      const prev = slice[i - 1];

      const tr = Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prev.close),
        Math.abs(curr.low - prev.close)
      );
      trueRangeSum += tr;

      if (curr.high > maxHigh) maxHigh = curr.high;
      if (curr.low < minLow) minLow = curr.low;
    }

    const priceRange = maxHigh - minLow;
    if (priceRange <= 0 || trueRangeSum <= 0) return 50;

    const chop = 100 * (Math.log10(trueRangeSum / priceRange) / Math.log10(length));
    return Number(Math.min(100, Math.max(0, chop)).toFixed(1));
  }

  /**
   * Calculates Wilder's ADX (Average Directional Index) and +DI / -DI lines.
   */
  public static calculateADX(candles: Candle[], length: number = 14): { adx: number; plusDI: number; minusDI: number } {
    if (!candles || candles.length < length * 2) {
      return { adx: 22, plusDI: 20, minusDI: 20 };
    }

    const trArr: number[] = [];
    const plusDMArr: number[] = [];
    const minusDMArr: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      const curr = candles[i];
      const prev = candles[i - 1];

      const tr = Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prev.close),
        Math.abs(curr.low - prev.close)
      );
      trArr.push(tr);

      const upMove = curr.high - prev.high;
      const downMove = prev.low - curr.low;

      plusDMArr.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDMArr.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }

    // Smoothed sums
    let smoothTR = trArr.slice(0, length).reduce((a, b) => a + b, 0);
    let smoothPlusDM = plusDMArr.slice(0, length).reduce((a, b) => a + b, 0);
    let smoothMinusDM = minusDMArr.slice(0, length).reduce((a, b) => a + b, 0);

    const dxArr: number[] = [];

    for (let i = length; i < trArr.length; i++) {
      smoothTR = smoothTR - smoothTR / length + trArr[i];
      smoothPlusDM = smoothPlusDM - smoothPlusDM / length + plusDMArr[i];
      smoothMinusDM = smoothMinusDM - smoothMinusDM / length + minusDMArr[i];

      const plusDI = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
      const minusDI = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;
      const diSum = plusDI + minusDI;
      const dx = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
      dxArr.push(dx);
    }

    if (dxArr.length < length) {
      return { adx: 22, plusDI: 20, minusDI: 20 };
    }

    const adx = dxArr.slice(-length).reduce((a, b) => a + b, 0) / length;
    const lastPlusDI = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
    const lastMinusDI = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;

    return {
      adx: Number(adx.toFixed(1)),
      plusDI: Number(lastPlusDI.toFixed(1)),
      minusDI: Number(lastMinusDI.toFixed(1)),
    };
  }

  /**
   * Multi-Timeframe (MTF) Macro Bias Evaluation using EMA cascades (20 EMA vs 50 SMA vs 200 SMA).
   */
  public static calculateMacroBias(candles: Candle[]): { bias: MacroBias; alignmentScore: number } {
    if (candles.length < 50) return { bias: "NEUTRAL_CHOP", alignmentScore: 50 };

    const closes = candles.map((c) => c.close);
    const lastPrice = closes[closes.length - 1];

    const ema20 = this.calcEMA(closes, 20);
    const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
    const sma200 = candles.length >= 200 ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200 : sma50;

    const isAboveEma20 = lastPrice > ema20;
    const isAboveSma50 = lastPrice > sma50;
    const isAboveSma200 = lastPrice > sma200;
    const isBullCascade = ema20 > sma50 && sma50 > sma200;
    const isBearCascade = ema20 < sma50 && sma50 < sma200;

    let score = 50;
    let bias: MacroBias = "NEUTRAL_CHOP";

    if (isBullCascade && isAboveEma20) {
      bias = "STRONG_BULLISH";
      score = 95;
    } else if (isAboveSma50 && isAboveEma20) {
      bias = "LEAN_BULLISH";
      score = 75;
    } else if (isBearCascade && !isAboveEma20) {
      bias = "STRONG_BEARISH";
      score = 95;
    } else if (!isAboveSma50 && !isAboveEma20) {
      bias = "LEAN_BEARISH";
      score = 75;
    }

    return { bias, alignmentScore: score };
  }

  /**
   * Detects volatility compression squeeze (Bollinger Bands inside Keltner Channel).
   */
  public static detectVolatilitySqueeze(candles: Candle[], length: number = 20): boolean {
    if (candles.length < length) return false;
    const slice = candles.slice(-length);
    const closes = slice.map((c) => c.close);
    const mean = closes.reduce((a, b) => a + b, 0) / length;
    const stdDev = Math.sqrt(closes.map((x) => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / length);

    const bbUpper = mean + stdDev * 2.0;
    const bbLower = mean - stdDev * 2.0;

    let trSum = 0;
    for (let i = 1; i < slice.length; i++) {
      trSum += Math.max(slice[i].high - slice[i].low, Math.abs(slice[i].high - slice[i - 1].close));
    }
    const atr = trSum / (length - 1 || 1);
    const kcUpper = mean + atr * 1.5;
    const kcLower = mean - atr * 1.5;

    // Squeeze is active when BB is completely inside KC
    return bbUpper < kcUpper && bbLower > kcLower;
  }

  /**
   * Synthesizes all regime metrics into a unified verdict.
   */
  public static evaluateMarketRegime(candles: Candle[]): MarketRegimeTelemetry {
    if (!candles || candles.length < 15) {
      return {
        regime: "TRANSITION",
        chopIndex: 50,
        isChop: false,
        adx: 22,
        plusDI: 20,
        minusDI: 20,
        macroBias: "NEUTRAL_CHOP",
        htfAlignmentScore: 50,
        isSqueezeActive: false,
        canExecuteTrendTrade: true,
        regimeMessage: "Insufficient history for regime calibration.",
      };
    }

    const chopIndex = this.calculateChoppinessIndex(candles, 14);
    const { adx, plusDI, minusDI } = this.calculateADX(candles, 14);
    const { bias: macroBias, alignmentScore: htfAlignmentScore } = this.calculateMacroBias(candles);
    const isSqueezeActive = this.detectVolatilitySqueeze(candles, 20);

    const isHighChop = chopIndex >= 61.8;
    const isWeakTrend = adx < 20;
    const isChop = isHighChop || isWeakTrend;

    let regime: MarketRegimeType = "TRANSITION";
    let canExecuteTrendTrade = true;
    let regimeMessage = "";

    if (isSqueezeActive) {
      regime = "VOLATILITY_SQUEEZE";
      canExecuteTrendTrade = false;
      regimeMessage = "Volatility Squeeze Active: Bands compressed. Stand aside until expansion breakout.";
    } else if (isHighChop) {
      regime = "CHOPPY_COMPRESSION";
      canExecuteTrendTrade = false;
      regimeMessage = `High Choppiness (CHOP ${chopIndex} > 61.8): Market in noisy compression. Avoid trend signals.`;
    } else if (isWeakTrend) {
      regime = "CHOPPY_COMPRESSION";
      canExecuteTrendTrade = false;
      regimeMessage = `Weak Trend Strength (ADX ${adx} < 20): Directional momentum absent. Stand aside.`;
    } else if (chopIndex <= 38.2 && adx >= 25) {
      regime = "TRENDING_EXPANSION";
      canExecuteTrendTrade = true;
      regimeMessage = `Explosive Trending Regime (CHOP ${chopIndex} < 38.2, ADX ${adx} > 25): Prime execution state.`;
    } else {
      regime = "TRANSITION";
      canExecuteTrendTrade = true;
      regimeMessage = `Moderate Trend (CHOP ${chopIndex}, ADX ${adx}): Normal market conditions.`;
    }

    return {
      regime,
      chopIndex,
      isChop,
      adx,
      plusDI,
      minusDI,
      macroBias,
      htfAlignmentScore,
      isSqueezeActive,
      canExecuteTrendTrade,
      regimeMessage,
    };
  }

  private static calcEMA(arr: number[], period: number): number {
    if (arr.length === 0) return 0;
    const k = 2 / (period + 1);
    let ema = arr[0];
    for (let i = 1; i < arr.length; i++) {
      ema = arr[i] * k + ema * (1 - k);
    }
    return ema;
  }
}
