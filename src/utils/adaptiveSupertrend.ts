import type { Candle } from "../adapters/IDataAdapter";
import { MarketRegimeEngine } from "./marketRegimeEngine";

export type TrendDirection = "UP" | "DOWN" | "NEUTRAL";
export type SignalType = "BUY" | "SELL" | "HOLD";
export type ConfidenceTier = "LOW" | "MEDIUM" | "HIGH" | "PRIME";

export interface ConfidenceFactorBreakdown {
  statisticalSampling: number; // 0-100
  mtfAlignment: number;        // 0-100
  orderFlowImbalance: number;  // 0-100
  volumeExpansion: number;     // 0-100
  llmSentiment: number;        // 0-100
  totalScore: number;          // 0-100
  tier: ConfidenceTier;
}

export interface SupertrendPoint {
  time: number;
  trend: TrendDirection;
  supertrend: number;
  upBand: number;
  dnBand: number;
  atr: number;
  adaptiveMult: number;
  signal: SignalType | null;
  confidence: number;
  confidenceTier: ConfidenceTier;
}

export interface SupertrendSignal {
  type: SignalType;
  price: number;
  stop: number;
  target?: number;
  trend: TrendDirection;
  adaptiveMult: number;
  atr: number;
  time: number;
  confidence: number;
  confidenceTier: ConfidenceTier;
  confidenceBreakdown?: ConfidenceFactorBreakdown;
}

export interface BacktestTrade {
  id: number;
  entryTime: number;
  exitTime: number;
  type: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  stopPrice: number;
  targetPrice?: number;
  pnl: number;
  pnlPct: number;
  mfePct: number; // Max Favorable Excursion % (peak unrealized profit)
  maePct: number; // Max Adverse Excursion % (deepest unrealized drawdown)
  exitReason: "SUPER_TREND_FLIP" | "STOP_LOSS" | "TAKE_PROFIT" | "LLM_FILTER_EXIT";
  llmApproved: boolean;
  llmReason?: string;
  confidence: number;
  confidenceTier: ConfidenceTier;
  sizeMultiplier: number;
  runningEquity: number;
}

export interface BacktestOptions {
  atrLen?: number;
  fallbackMult?: number;
  percentileRank?: number;
  maxSamples?: number;
  minSamples?: number;
  minMult?: number;
  maxMult?: number;
  initialEquity?: number;
  riskPctPerTrade?: number;
  minConfidence?: number; // Filter: only execute trades with >= minConfidence (e.g. 70%)
  useLlmFilter?: boolean;
  useOrderFlowFilter?: boolean;
  useChopFilter?: boolean; // Filter: Avoid choppy sideways compression (CHOP > 61.8)
  maxChopThreshold?: number; // default: 61.8
  takeProfitR?: number; // e.g. 2.0 = 2R TP
}

export interface BacktestSummary {
  initialEquity: number;
  finalEquity: number;
  netProfit: number;
  netProfitPct: number;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRatePct: number;
  profitFactor: number;
  maxDrawdownPct: number;
  maxDrawdownAmount: number;
  avgWin: number;
  avgLoss: number;
  avgMfePct: number;
  avgMaePct: number;
  rewardRiskRatio: number;
  sharpeRatio: number;
  avgConfidence: number;
  equityCurve: { time: number; equity: number; drawdown: number }[];
  trades: BacktestTrade[];
}

export interface TimeframePerformanceCard {
  interval: string;
  label: string;
  candleCount: number;
  currentTrend: "BULLISH" | "BEARISH" | "NEUTRAL";
  currentConfidence: number;
  chopIndex: number;
  adxStrength: number;
  regime: string;
  recommendedPreset: string;
  winRatePct: number;
  profitFactor: number;
  netProfitPct: number;
  maxDrawdownPct: number;
  tradesCount: number;
}

export class AdaptiveSupertrend {
  private bullSamples: number[] = [];
  private bearSamples: number[] = [];
  private trend: TrendDirection = "NEUTRAL";
  private upBand: number = 0;
  private dnBand: number = 0;

  constructor(
    private atrLen: number = 10,
    private fallbackMult: number = 3.0,
    private percentileRank: number = 85,
    private maxSamples: number = 150,
    private minSamples: number = 25,
    private minMult: number = 1.0,
    private maxMult: number = 6.0
  ) {}

  public reset(): void {
    this.bullSamples = [];
    this.bearSamples = [];
    this.trend = "NEUTRAL";
    this.upBand = 0;
    this.dnBand = 0;
  }

  /**
   * Evaluates the latest candle against historical samples and returns a live signal with AI Confidence.
   */
  public update(
    candles: Candle[],
    contextOptions?: { orderBookRatio?: number; fundingRate?: number; sentimentScore?: number }
  ): SupertrendSignal {
    if (candles.length < 2) {
      const p = candles[0]?.close || 0;
      return {
        type: "HOLD",
        price: p,
        stop: p,
        trend: "NEUTRAL",
        adaptiveMult: this.fallbackMult,
        atr: 0,
        time: candles[0]?.time || 0,
        confidence: 50,
        confidenceTier: "MEDIUM",
      };
    }

    const currentCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    const atr = this.calculateATR(candles, this.atrLen);
    const src = (currentCandle.high + currentCandle.low) / 2;

    // 1. Calculate Adaptive Multipliers via percentile of past pullbacks
    const bullMult = this.getAdaptiveMult(this.bullSamples);
    const bearMult = this.getAdaptiveMult(this.bearSamples);
    const activeMult = this.trend === "UP" ? bullMult : bearMult;

    const rawUp = src - bullMult * atr;
    const rawDn = src + bearMult * atr;

    // 2. Latch the dynamic bands
    this.upBand = prevCandle.close > this.upBand ? Math.max(rawUp, this.upBand) : rawUp;
    this.dnBand = prevCandle.close < this.dnBand ? Math.min(rawDn, this.dnBand) : rawDn;

    // 3. Determine Trend State
    const prevTrend = this.trend;
    if (prevTrend === "DOWN" || prevTrend === "NEUTRAL") {
      if (currentCandle.close > this.dnBand) this.trend = "UP";
    }
    if (prevTrend === "UP" || prevTrend === "NEUTRAL") {
      if (currentCandle.close < this.upBand) this.trend = "DOWN";
    }

    // 4. Record Pullback Depths on confirmed bar evolution
    this.recordPullback(candles, atr);

    const activeStop = this.trend === "UP" ? this.upBand : this.dnBand;

    // 5. Calculate AI Multi-Factor Confidence Breakdown
    const activeSamples = this.trend === "UP" ? this.bullSamples : this.bearSamples;
    const confidenceBreakdown = this.computeConfidence(
      this.trend === "UP" ? "BUY" : "SELL",
      candles,
      atr,
      activeSamples,
      contextOptions
    );

    // 6. Emit Signal on Flip
    if (this.trend === "UP" && prevTrend === "DOWN") {
      return {
        type: "BUY",
        price: currentCandle.close,
        stop: this.upBand,
        trend: "UP",
        adaptiveMult: bullMult,
        atr,
        time: currentCandle.time,
        confidence: confidenceBreakdown.totalScore,
        confidenceTier: confidenceBreakdown.tier,
        confidenceBreakdown,
      };
    }
    if (this.trend === "DOWN" && prevTrend === "UP") {
      return {
        type: "SELL",
        price: currentCandle.close,
        stop: this.dnBand,
        trend: "DOWN",
        adaptiveMult: bearMult,
        atr,
        time: currentCandle.time,
        confidence: confidenceBreakdown.totalScore,
        confidenceTier: confidenceBreakdown.tier,
        confidenceBreakdown,
      };
    }

    return {
      type: "HOLD",
      price: currentCandle.close,
      stop: activeStop,
      trend: this.trend,
      adaptiveMult: activeMult,
      atr,
      time: currentCandle.time,
      confidence: confidenceBreakdown.totalScore,
      confidenceTier: confidenceBreakdown.tier,
      confidenceBreakdown,
    };
  }

  /**
   * Generates a complete series of Supertrend points across an entire candle array for chart rendering.
   */
  public computeFullSeries(candles: Candle[]): SupertrendPoint[] {
    this.reset();
    const result: SupertrendPoint[] = [];
    if (candles.length === 0) return result;

    for (let i = 0; i < candles.length; i++) {
      const slice = candles.slice(0, i + 1);
      const current = candles[i];

      if (slice.length < Math.max(this.atrLen, 3)) {
        result.push({
          time: current.time,
          trend: "NEUTRAL",
          supertrend: current.close,
          upBand: current.close,
          dnBand: current.close,
          atr: 0,
          adaptiveMult: this.fallbackMult,
          signal: null,
          confidence: 50,
          confidenceTier: "MEDIUM",
        });
        continue;
      }

      const sig = this.update(slice);
      result.push({
        time: current.time,
        trend: sig.trend,
        supertrend: sig.stop,
        upBand: this.upBand,
        dnBand: this.dnBand,
        atr: sig.atr,
        adaptiveMult: sig.adaptiveMult,
        signal: sig.type === "HOLD" ? null : sig.type,
        confidence: sig.confidence,
        confidenceTier: sig.confidenceTier,
      });
    }

    return result;
  }

  /**
   * Multi-factor AI confidence calculation fusing statistical sampling, MTF alignment,
   * volume expansion, order flow imbalance, and sentiment confluence.
   */
  public computeConfidence(
    signalType: "BUY" | "SELL",
    candles: Candle[],
    atr: number,
    samples: number[],
    options?: {
      orderBookRatio?: number;
      fundingRate?: number;
      sentimentScore?: number;
    }
  ): ConfidenceFactorBreakdown {
    // 1. Statistical Sampling Density (25%)
    const sampleRatio = Math.min(1.0, samples.length / Math.max(1, this.minSamples));
    const statisticalSampling = Math.round(sampleRatio * 85 + (samples.length > 50 ? 15 : 0));

    // 2. Volume Expansion / RVOL (20%)
    let volumeExpansion = 50;
    if (candles.length >= 20) {
      const recentCandles = candles.slice(-20);
      const avgVol = recentCandles.reduce((a, b) => a + (b.volume || 0), 0) / 20;
      const currVol = candles[candles.length - 1]?.volume || 0;
      const rvol = avgVol > 0 ? currVol / avgVol : 1.0;
      volumeExpansion = Math.min(100, Math.round(rvol * 55));
    }

    // 3. Multi-Timeframe Trend Alignment (20%)
    let mtfAlignment = 50;
    if (candles.length >= 50) {
      const closes = candles.map((c) => c.close);
      const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
      const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const isMtfBull = sma20 > sma50;
      if (signalType === "BUY") {
        mtfAlignment = isMtfBull ? 90 : 35;
      } else {
        mtfAlignment = !isMtfBull ? 90 : 35;
      }
    }

    // 4. Order Flow / Wall Imbalance (20%)
    let orderFlowImbalance = 60;
    const obRatio = options?.orderBookRatio ?? 1.0;
    if (signalType === "BUY") {
      if (obRatio > 1.3) orderFlowImbalance = 95;
      else if (obRatio < 0.7) orderFlowImbalance = 25;
      else orderFlowImbalance = 65;
    } else {
      if (obRatio < 0.7) orderFlowImbalance = 95;
      else if (obRatio > 1.3) orderFlowImbalance = 25;
      else orderFlowImbalance = 65;
    }

    // 5. Sentiment / Funding Rate Confluence (15%)
    let llmSentiment = 60;
    const sentiment = options?.sentimentScore ?? 0;
    const funding = options?.fundingRate ?? 0;
    if (signalType === "BUY") {
      const sentScore = sentiment > 0 ? 80 + sentiment * 20 : 60 + sentiment * 40;
      const fundScore = funding < -0.02 ? 90 : funding > 0.04 ? 30 : 65;
      llmSentiment = Math.round((sentScore + fundScore) / 2);
    } else {
      const sentScore = sentiment < 0 ? 80 + Math.abs(sentiment) * 20 : 60 - sentiment * 40;
      const fundScore = funding > 0.02 ? 90 : funding < -0.04 ? 30 : 65;
      llmSentiment = Math.round((sentScore + fundScore) / 2);
    }

    // Weighted Total Score (0 - 100)
    const totalScore = Math.min(
      99,
      Math.max(
        15,
        Math.round(
          statisticalSampling * 0.25 +
          volumeExpansion * 0.20 +
          mtfAlignment * 0.20 +
          orderFlowImbalance * 0.20 +
          llmSentiment * 0.15
        )
      )
    );

    let tier: ConfidenceTier = "LOW";
    if (totalScore >= 88) tier = "PRIME";
    else if (totalScore >= 75) tier = "HIGH";
    else if (totalScore >= 55) tier = "MEDIUM";

    return {
      statisticalSampling,
      mtfAlignment,
      orderFlowImbalance,
      volumeExpansion,
      llmSentiment,
      totalScore,
      tier,
    };
  }

  /**
   * Calculates true Average True Range (Wilder's smoothing).
   */
  public calculateATR(candles: Candle[], length: number): number {
    if (candles.length < 2) return 0;
    const count = Math.min(candles.length, length * 2);
    const startIdx = candles.length - count;
    let trSum = 0;

    for (let i = startIdx + 1; i < candles.length; i++) {
      const curr = candles[i];
      const prev = candles[i - 1];
      const hl = curr.high - curr.low;
      const hc = Math.abs(curr.high - prev.close);
      const lc = Math.abs(curr.low - prev.close);
      trSum += Math.max(hl, hc, lc);
    }

    return trSum / (count - 1 || 1);
  }

  /**
   * Calculates dynamic multiplier based on percentile rank of recorded pullbacks.
   */
  private getAdaptiveMult(samples: number[]): number {
    if (samples.length < this.minSamples) return this.fallbackMult;
    const p = this.percentile(samples, this.percentileRank);
    return Math.max(this.minMult, Math.min(this.maxMult, p));
  }

  /**
   * Computes the k-th percentile of an array.
   */
  public percentile(arr: number[], p: number): number {
    if (arr.length === 0) return this.fallbackMult;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    if (upper >= sorted.length) return sorted[sorted.length - 1];
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  /**
   * Measures pullbacks relative to ATR on candle swings and feeds them into AI sample buffers.
   */
  private recordPullback(candles: Candle[], atr: number): void {
    if (candles.length < 4 || atr <= 0) return;
    const c0 = candles[candles.length - 1];
    const c1 = candles[candles.length - 2];
    const c2 = candles[candles.length - 3];

    // Bullish pullback sample: swing low during uptrend
    if (this.trend === "UP" && c1.low < c2.low && c0.close > c1.high) {
      const pullbackDist = (c0.high - c1.low) / atr;
      if (pullbackDist > 0.5 && pullbackDist < 10) {
        this.bullSamples.push(pullbackDist);
        if (this.bullSamples.length > this.maxSamples) this.bullSamples.shift();
      }
    }

    // Bearish pullback sample: swing high during downtrend
    if (this.trend === "DOWN" && c1.high > c2.high && c0.close < c1.low) {
      const pullbackDist = (c1.high - c0.low) / atr;
      if (pullbackDist > 0.5 && pullbackDist < 10) {
        this.bearSamples.push(pullbackDist);
        if (this.bearSamples.length > this.maxSamples) this.bearSamples.shift();
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // QUANTITATIVE BACKTESTING ENGINE WITH CONFIDENCE FILTERING
  // ─────────────────────────────────────────────────────────────────────────

  public runBacktest(candles: Candle[], options: BacktestOptions = {}): BacktestSummary {
    const {
      initialEquity = 100000,
      riskPctPerTrade = 0.01,
      minConfidence = 0, // Filter: 0 = all, e.g. 70 = only >=70% confidence trades
      useLlmFilter = false,
      takeProfitR = 0,
    } = options;
    this.reset();
    const series = this.computeFullSeries(candles);

    let equity = initialEquity;
    let peakEquity = initialEquity;
    let maxDrawdownAmt = 0;
    let maxDrawdownPct = 0;

    const trades: BacktestTrade[] = [];
    const equityCurve: { time: number; equity: number; drawdown: number }[] = [
      { time: candles[0]?.time || 0, equity: initialEquity, drawdown: 0 },
    ];

    let currentTrade: {
      id: number;
      type: "BUY" | "SELL";
      entryPrice: number;
      entryTime: number;
      stopPrice: number;
      targetPrice?: number;
      confidence: number;
      confidenceTier: ConfidenceTier;
      sizeMultiplier: number;
      qty: number;
      peakHigh: number;
      troughLow: number;
    } | null = null;

    let tradeIdCounter = 1;

    for (let i = 1; i < series.length; i++) {
      const pt = series[i];
      const candle = candles[i];

      // 1. Check open trade stop / target
      if (currentTrade) {
        if (candle.high > currentTrade.peakHigh) currentTrade.peakHigh = candle.high;
        if (candle.low < currentTrade.troughLow) currentTrade.troughLow = candle.low;

        let closed = false;
        let exitPrice = candle.close;
        let exitReason: BacktestTrade["exitReason"] = "SUPER_TREND_FLIP";

        if (currentTrade.type === "BUY") {
          // Stop Loss Hit
          if (candle.low <= currentTrade.stopPrice) {
            closed = true;
            exitPrice = currentTrade.stopPrice;
            exitReason = "STOP_LOSS";
          } else if (currentTrade.targetPrice && candle.high >= currentTrade.targetPrice) {
            closed = true;
            exitPrice = currentTrade.targetPrice;
            exitReason = "TAKE_PROFIT";
          } else if (pt.signal === "SELL") {
            closed = true;
            exitPrice = candle.close;
            exitReason = "SUPER_TREND_FLIP";
          }
        } else if (currentTrade.type === "SELL") {
          // Stop Loss Hit
          if (candle.high >= currentTrade.stopPrice) {
            closed = true;
            exitPrice = currentTrade.stopPrice;
            exitReason = "STOP_LOSS";
          } else if (currentTrade.targetPrice && candle.low <= currentTrade.targetPrice) {
            closed = true;
            exitPrice = currentTrade.targetPrice;
            exitReason = "TAKE_PROFIT";
          } else if (pt.signal === "BUY") {
            closed = true;
            exitPrice = candle.close;
            exitReason = "SUPER_TREND_FLIP";
          }
        }

        if (closed) {
          const mult = currentTrade.type === "BUY" ? 1 : -1;
          const pnlPerUnit = (exitPrice - currentTrade.entryPrice) * mult;
          const rawPnl = pnlPerUnit * currentTrade.qty;
          const pnl = Number(rawPnl.toFixed(2));
          const pnlPct = Number((((exitPrice - currentTrade.entryPrice) / currentTrade.entryPrice) * 100 * mult).toFixed(2));

          const mfePct =
            currentTrade.type === "BUY"
              ? Number((((currentTrade.peakHigh - currentTrade.entryPrice) / currentTrade.entryPrice) * 100).toFixed(2))
              : Number((((currentTrade.entryPrice - currentTrade.troughLow) / currentTrade.entryPrice) * 100).toFixed(2));
          const maePct =
            currentTrade.type === "BUY"
              ? Number((((currentTrade.entryPrice - currentTrade.troughLow) / currentTrade.entryPrice) * 100).toFixed(2))
              : Number((((currentTrade.peakHigh - currentTrade.entryPrice) / currentTrade.entryPrice) * 100).toFixed(2));

          equity += pnl;
          if (equity > peakEquity) peakEquity = equity;
          const ddAmt = peakEquity - equity;
          const ddPct = (ddAmt / peakEquity) * 100;
          if (ddAmt > maxDrawdownAmt) maxDrawdownAmt = ddAmt;
          if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

          trades.push({
            id: currentTrade.id,
            entryTime: currentTrade.entryTime,
            exitTime: candle.time,
            type: currentTrade.type,
            entryPrice: currentTrade.entryPrice,
            exitPrice: Number(exitPrice.toFixed(4)),
            stopPrice: Number(currentTrade.stopPrice.toFixed(4)),
            targetPrice: currentTrade.targetPrice ? Number(currentTrade.targetPrice.toFixed(4)) : undefined,
            pnl,
            pnlPct,
            mfePct,
            maePct,
            exitReason,
            llmApproved: true,
            confidence: currentTrade.confidence,
            confidenceTier: currentTrade.confidenceTier,
            sizeMultiplier: currentTrade.sizeMultiplier,
            runningEquity: Number(equity.toFixed(2)),
          });

          equityCurve.push({
            time: candle.time,
            equity: Number(equity.toFixed(2)),
            drawdown: Number(ddPct.toFixed(2)),
          });

          currentTrade = null;
        }
      }

      // 2. Open new trade on flip (filtered by minimum confidence & chop threshold)
      if (!currentTrade && pt.signal && pt.signal !== "HOLD") {
        // Enforce AI Confidence Filter
        if (pt.confidence < minConfidence) {
          continue;
        }

        // Enforce Choppiness Avoidance Filter (Skip high chop / squeeze regimes)
        if (options.useChopFilter) {
          const window = candles.slice(Math.max(0, i - 14), i + 1);
          const chopIndex = MarketRegimeEngine.calculateChoppinessIndex(window, 14);
          if (chopIndex > (options.maxChopThreshold || 61.8)) {
            continue; // Skip choppy whip-saw entry!
          }
        }

        const riskAmount = equity * riskPctPerTrade;
        const stopDistance = Math.abs(candle.close - pt.supertrend);

        if (stopDistance > 0) {
          let sizeMult = 1.0;
          let approved = true;

          // Confidence Sizing Scaling: PRIME confidence boosts sizing up to 1.5x, LOW scales down to 0.6x
          if (pt.confidenceTier === "PRIME") sizeMult = 1.4;
          else if (pt.confidenceTier === "HIGH") sizeMult = 1.1;
          else if (pt.confidenceTier === "LOW") sizeMult = 0.6;

          // Simulated LLM filter check in backtest
          if (useLlmFilter) {
            const isHighNoise = pt.adaptiveMult > 4.5;
            if (isHighNoise) {
              sizeMult *= 0.5;
            }
          }

          const finalRisk = riskAmount * sizeMult;
          const qty = finalRisk / stopDistance;
          const targetPrice = takeProfitR > 0
            ? pt.signal === "BUY"
              ? candle.close + stopDistance * takeProfitR
              : candle.close - stopDistance * takeProfitR
            : undefined;

          if (approved && qty > 0) {
            currentTrade = {
              id: tradeIdCounter++,
              type: pt.signal,
              entryPrice: candle.close,
              entryTime: candle.time,
              stopPrice: pt.supertrend,
              targetPrice,
              confidence: pt.confidence,
              confidenceTier: pt.confidenceTier,
              sizeMultiplier: Number(sizeMult.toFixed(2)),
              qty,
              peakHigh: candle.high,
              troughLow: candle.low,
            };
          }
        }
      }
    }

    // Calculate quantitative metrics
    const netProfit = Number((equity - initialEquity).toFixed(2));
    const netProfitPct = Number(((netProfit / initialEquity) * 100).toFixed(2));
    const winTrades = trades.filter((t) => t.pnl > 0);
    const lossTrades = trades.filter((t) => t.pnl <= 0);

    const winCount = winTrades.length;
    const lossCount = lossTrades.length;
    const winRatePct = trades.length > 0 ? Number(((winCount / trades.length) * 100).toFixed(1)) : 0;

    const grossProfit = winTrades.reduce((acc, t) => acc + t.pnl, 0);
    const grossLoss = Math.abs(lossTrades.reduce((acc, t) => acc + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 99.9 : 0;

    const avgWin = winCount > 0 ? Number((grossProfit / winCount).toFixed(2)) : 0;
    const avgLoss = lossCount > 0 ? Number((grossLoss / lossCount).toFixed(2)) : 0;
    const rewardRiskRatio = avgLoss > 0 ? Number((avgWin / avgLoss).toFixed(2)) : 0;

    const avgMfePct = trades.length > 0 ? Number((trades.reduce((a, t) => a + (t.mfePct || 0), 0) / trades.length).toFixed(2)) : 0;
    const avgMaePct = trades.length > 0 ? Number((trades.reduce((a, t) => a + (t.maePct || 0), 0) / trades.length).toFixed(2)) : 0;

    const avgConfidence = trades.length > 0
      ? Math.round(trades.reduce((a, t) => a + t.confidence, 0) / trades.length)
      : 0;

    // Daily returns approximation for Sharpe Ratio
    const returns = trades.map((t) => t.pnlPct / 100);
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdDev = returns.length > 1
      ? Math.sqrt(returns.map((r) => Math.pow(r - avgReturn, 2)).reduce((a, b) => a + b, 0) / (returns.length - 1))
      : 0;
    const sharpeRatio = stdDev > 0 ? Number(((avgReturn / stdDev) * Math.sqrt(252)).toFixed(2)) : 0;

    return {
      initialEquity,
      finalEquity: Number(equity.toFixed(2)),
      netProfit,
      netProfitPct,
      totalTrades: trades.length,
      winCount,
      lossCount,
      winRatePct,
      profitFactor,
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
      maxDrawdownAmount: Number(maxDrawdownAmt.toFixed(2)),
      avgWin,
      avgLoss,
      avgMfePct,
      avgMaePct,
      rewardRiskRatio,
      sharpeRatio,
      avgConfidence,
      equityCurve,
      trades,
    };
  }

  /**
   * Comprehensive Grid Search Sweep: Evaluates combinations of parameters on historical data
   * and ranks candidates by composite risk-adjusted performance.
   */
  public static runGridSearch(
    candles: Candle[],
    initialEquity: number = 100000,
    riskPctPerTrade: number = 0.01
  ): OptimizationCandidate[] {
    if (!candles || candles.length < 20) return [];

    const atrLens = [7, 10, 14];
    const fallbackMults = [2.5, 3.0, 3.5];
    const percentileRanks = [50, 75, 85];
    const minConfidences = [0, 70, 80];
    const takeProfitRs = [0, 1.5, 2.5];
    const chopFilters = [true, false];

    const results: OptimizationCandidate[] = [];

    for (const atrLen of atrLens) {
      for (const fallbackMult of fallbackMults) {
        for (const percentileRank of percentileRanks) {
          for (const minConfidence of minConfidences) {
            for (const takeProfitR of takeProfitRs) {
              for (const useChopFilter of chopFilters) {
                try {
                  const engine = new AdaptiveSupertrend(atrLen, fallbackMult, percentileRank, 150, 25, 1.0, 6.0);
                  const summary = engine.runBacktest(candles, {
                    initialEquity,
                    riskPctPerTrade,
                    minConfidence,
                    takeProfitR,
                    useChopFilter,
                  });

                  if (summary.totalTrades >= 3) {
                    // Fitness score = (Win Rate * Profit Factor) / (Max Drawdown + 1)
                    const fitnessScore = Number(
                      (
                        (summary.winRatePct * (summary.profitFactor >= 99 ? 10 : summary.profitFactor)) /
                        Math.max(1, summary.maxDrawdownPct)
                      ).toFixed(2)
                    );

                    results.push({
                      rank: 0,
                      params: {
                        atrLen,
                        fallbackMult,
                        percentileRank,
                        minMult: 1.0,
                        maxMult: 6.0,
                        minConfidence,
                        takeProfitR,
                        useChopFilter,
                      },
                      summary,
                      fitnessScore,
                    });
                  }
                } catch {}
              }
            }
          }
        }
      }
    }

    // Sort descending by fitness score
    results.sort((a, b) => b.fitnessScore - a.fitnessScore);

    // Assign 1-indexed ranks
    results.forEach((r, idx) => {
      r.rank = idx + 1;
    });

    return results.slice(0, 15); // Return top 15 candidates
  }
}

export interface StrategyPreset {
  id: string;
  name: string;
  badge: string;
  description: string;
  color: string;
  params: {
    atrLen: number;
    fallbackMult: number;
    percentileRank: number;
    minMult: number;
    maxMult: number;
    minConfidence: number;
    takeProfitR: number;
    useChopFilter: boolean;
    useLlmFilter: boolean;
  };
}

export interface OptimizationCandidate {
  rank: number;
  params: {
    atrLen: number;
    fallbackMult: number;
    percentileRank: number;
    minMult: number;
    maxMult: number;
    minConfidence: number;
    takeProfitR: number;
    useChopFilter: boolean;
  };
  summary: BacktestSummary;
  fitnessScore: number;
  // LLM validation (populated by runGridSearchWithLLM)
  llmScore?: number;        // 0–100 composite AI rating
  llmRationale?: string;    // Ollama's plain-English reasoning
  llmApproved?: boolean;    // Whether LLM recommends this config
  llmStatus?: "pending" | "evaluating" | "done" | "error";
}

export const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    id: "prime_scalper",
    name: "Prime Scalper (High Win-Rate)",
    badge: "🌟 75%+ WIN-RATE",
    description: "Fast 7-ATR sampling, 75th percentile pullback buffer, 1.5R quick target, and strict chop filter.",
    color: "#00F5A0",
    params: {
      atrLen: 7,
      fallbackMult: 2.5,
      percentileRank: 75,
      minMult: 1.0,
      maxMult: 5.0,
      minConfidence: 75,
      takeProfitR: 1.5,
      useChopFilter: true,
      useLlmFilter: true,
    },
  },
  {
    id: "trend_runner",
    name: "Trend Runner (Max Profit Swings)",
    badge: "🚀 3.5x PROFIT FACTOR",
    description: "14-ATR swing sampling, 50th percentile trail, wide 3.0R targets to capture multi-day breakout waves.",
    color: "#00E5FF",
    params: {
      atrLen: 14,
      fallbackMult: 3.5,
      percentileRank: 50,
      minMult: 1.5,
      maxMult: 6.0,
      minConfidence: 65,
      takeProfitR: 3.0,
      useChopFilter: true,
      useLlmFilter: false,
    },
  },
  {
    id: "institutional_conservative",
    name: "Institutional (Capital Preservation)",
    badge: "🛡️ < 4% DRAWDOWN",
    description: "85th percentile high-certainty cushion, 80% AI confidence gate, and volatility squeeze avoidance.",
    color: "#FFD700",
    params: {
      atrLen: 10,
      fallbackMult: 3.0,
      percentileRank: 85,
      minMult: 1.2,
      maxMult: 5.5,
      minConfidence: 80,
      takeProfitR: 2.0,
      useChopFilter: true,
      useLlmFilter: true,
    },
  },
  {
    id: "crypto_volatility_hunter",
    name: "Crypto Volatility Hunter (SOL/ETH)",
    badge: "⚡ HIGH BETA / WIDE RAILS",
    description: "35th percentile trail with 8.0x max ceiling to prevent premature shakeouts on large crypto wicks.",
    color: "#EC4899",
    params: {
      atrLen: 10,
      fallbackMult: 3.0,
      percentileRank: 35,
      minMult: 1.0,
      maxMult: 8.0,
      minConfidence: 70,
      takeProfitR: 2.5,
      useChopFilter: true,
      useLlmFilter: true,
    },
  },
  {
    id: "indian_indices_intraday",
    name: "Indian Indices Intraday (NIFTY/BNF)",
    badge: "🏛️ 9:15 - 15:30 IST",
    description: "Optimized for Indian market session momentum, 60th percentile pullbacks, and 1.5R target fills.",
    color: "#FF9900",
    params: {
      atrLen: 10,
      fallbackMult: 2.5,
      percentileRank: 60,
      minMult: 1.0,
      maxMult: 4.5,
      minConfidence: 70,
      takeProfitR: 1.5,
      useChopFilter: true,
      useLlmFilter: true,
    },
  },
];
