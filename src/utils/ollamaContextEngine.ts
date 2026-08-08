// ─────────────────────────────────────────────────────────────────────────────
// Ollama LLM Context Layer & Order Flow Confluence Engine
// Evaluates market context, news sentiment, and order book walls for AI validation.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupertrendSignal } from "./adaptiveSupertrend";
import type { OrderBookLevel } from "../adapters/IDataAdapter";

export interface LLMDecision {
  approve: boolean;
  reason: string;
  size_multiplier: number;
  model: string;
  latencyMs: number;
  isSimulated?: boolean;
}

export interface MarketContextParams {
  symbol: string;
  price: number;
  supertrendMult: number;
  atr: number;
  orderBook?: { bids: OrderBookLevel[]; asks: OrderBookLevel[] };
  volumeProfile?: { poc: number; vah: number; val: number; priceVsPoc: string };
  smc?: { marketStructure: string; liquiditySweep: string; nearestFvg?: { type: string; top: number; bottom: number } | null };
  volumeDynamics?: { rvol: number; volumeSpreadAnalysis: string; wickRejection: string };
  fundingRate?: number; // e.g. +0.01% or -0.05%
  pcr?: number;
  recentLiquidations?: { shortVol: number; longVol: number }; // In millions
  newsHeadline?: string;
  sentimentScore?: number; // -1.0 to +1.0
}

export interface OllamaConfig {
  host?: string;
  model?: string;
  timeoutMs?: number;
  mockIfOffline?: boolean;
}

const DEFAULT_CONFIG: OllamaConfig = {
  host: "http://localhost:11434",
  model: "llama3.2:3b",
  timeoutMs: 4000,
  mockIfOffline: true,
};

export class OllamaContextEngine {
  private config: OllamaConfig;

  constructor(config?: Partial<OllamaConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Assembles a structured comprehensive market context string incorporating all available data:
   * Order book depth walls, Volume Profile POC/VAH/VAL, SMC liquidity sweeps, RVOL, wick rejection, funding/PCR.
   */
  public buildContextString(params: MarketContextParams): string {
    const parts: string[] = [];

    // 1. Order Book Depth & Walls
    if (params.orderBook && params.orderBook.bids.length > 0 && params.orderBook.asks.length > 0) {
      const topBidVol = params.orderBook.bids.slice(0, 10).reduce((acc, b) => acc + (b.qty || (b as any).quantity || 0), 0);
      const topAskVol = params.orderBook.asks.slice(0, 10).reduce((acc, a) => acc + (a.qty || (a as any).quantity || 0), 0);
      const ratio = topAskVol > 0 ? (topBidVol / topAskVol).toFixed(2) : "1.00";
      parts.push(`L2 Order Book (Top 10): Bid/Ask volume ratio ${ratio} (Bids: ${topBidVol.toFixed(1)}, Asks: ${topAskVol.toFixed(1)}).`);
    }

    // 2. Volume Profile (POC / VAH / VAL)
    if (params.volumeProfile) {
      parts.push(
        `Volume Profile: POC at ${params.volumeProfile.poc}, VAH ${params.volumeProfile.vah}, VAL ${params.volumeProfile.val} (Price is ${params.volumeProfile.priceVsPoc.replace("_", " ")}).`
      );
    }

    // 3. Smart Money Concepts (SMC) & Liquidity Sweeps
    if (params.smc) {
      const sweep = params.smc.liquiditySweep !== "NONE" ? `Liquidity Sweep: ${params.smc.liquiditySweep.replace("_", " ")}.` : "";
      const fvg = params.smc.nearestFvg ? `Nearest FVG: ${params.smc.nearestFvg.type} [${params.smc.nearestFvg.bottom}-${params.smc.nearestFvg.top}].` : "";
      parts.push(`Market Structure: ${params.smc.marketStructure}. ${sweep} ${fvg}`.trim());
    }

    // 4. Volume Dynamics & RVOL
    if (params.volumeDynamics) {
      parts.push(
        `Volume Dynamics: RVOL is ${params.volumeDynamics.rvol.toFixed(1)}x (${params.volumeDynamics.volumeSpreadAnalysis.replace("_", " ")}), Wick Rejection: ${params.volumeDynamics.wickRejection.replace("_", " ")}.`
      );
    }

    // 5. Funding Rate & Liquidations
    if (params.fundingRate !== undefined) {
      const frSign = params.fundingRate >= 0 ? "+" : "";
      const frDesc = params.fundingRate > 0.03
        ? "heavily positive (over-leveraged longs, cascade risk)"
        : params.fundingRate < -0.03
        ? "heavily negative (heavily shorted, squeeze potential)"
        : "neutral";
      parts.push(`Funding Rate: ${frSign}${(params.fundingRate * 100).toFixed(3)}% (${frDesc}).`);
    }

    if (params.pcr !== undefined) {
      parts.push(`Option Put-Call Ratio (PCR): ${params.pcr.toFixed(2)} (${params.pcr > 1.2 ? "Bullish put floor" : params.pcr < 0.8 ? "Heavy call resistance" : "Balanced"}).`);
    }

    if (params.recentLiquidations) {
      parts.push(
        `Liquidations (1h): $${params.recentLiquidations.shortVol.toFixed(1)}M shorts, $${params.recentLiquidations.longVol.toFixed(1)}M longs.`
      );
    }

    if (params.newsHeadline) {
      parts.push(`Macro News Context: "${params.newsHeadline}".`);
    }

    if (params.sentimentScore !== undefined) {
      const sentimentLabel = params.sentimentScore > 0.3 ? "BULLISH" : params.sentimentScore < -0.3 ? "BEARISH" : "NEUTRAL";
      parts.push(`Macro Sentiment Index: ${sentimentLabel} (${(params.sentimentScore * 100).toFixed(0)}/100).`);
    }

    return parts.length > 0 ? parts.join(" ") : "Normal market liquidity and neutral macro sentiment.";
  }

  /**
   * Evaluates a trade signal against the local Ollama LLM endpoint or falls back gracefully.
   */
  public async validateTradeWithLLM(
    signal: SupertrendSignal,
    context: MarketContextParams
  ): Promise<LLMDecision> {
    const startTime = Date.now();
    const contextText = this.buildContextString(context);

    const systemPrompt =
      'You are a strict risk manager for a crypto futures AI trading bot. You receive a trade signal and current market context. You must output ONLY a valid JSON object matching this schema: {"approve": boolean, "reason": "string", "size_multiplier": number (between 0.5 and 2.0)}. Do not include any markdown fences, thoughts, or text outside the JSON object.';

    const userPrompt = `Signal: ${signal.type} ${context.symbol.toUpperCase()}. Current Price: ${signal.price}. Supertrend Multiplier: ${signal.adaptiveMult.toFixed(2)} (ATR: ${signal.atr.toFixed(2)}). Context: ${contextText} Approve this trade?`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs || 4000);

      const res = await fetch(`${this.config.host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          stream: false,
          format: "json",
          options: {
            temperature: 0.1,
            num_predict: 120,
          },
        }),
      });

      clearTimeout(timeout);

      if (res.ok) {
        const json = await res.json();
        const rawContent = json?.message?.content || "";
        const parsed = JSON.parse(rawContent.trim());

        return {
          approve: Boolean(parsed.approve),
          reason: String(parsed.reason || "Approved by local Ollama AI model"),
          size_multiplier: Math.max(0.5, Math.min(2.0, Number(parsed.size_multiplier) || 1.0)),
          model: this.config.model || "llama3",
          latencyMs: Date.now() - startTime,
          isSimulated: false,
        };
      }
    } catch (e: any) {
      // If local Ollama is offline / unreachable, fallback to high-speed deterministic heuristic evaluator
      if (this.config.mockIfOffline) {
        return this.heuristicEvaluator(signal, context, Date.now() - startTime);
      }
    }

    return this.heuristicEvaluator(signal, context, Date.now() - startTime);
  }

  /**
   * Deterministic local heuristic evaluator used when Ollama is offline.
   */
  private heuristicEvaluator(
    signal: SupertrendSignal,
    context: MarketContextParams,
    latencyMs: number
  ): LLMDecision {
    const obBlocked = this.isOrderBookBlocked(signal.type, context.orderBook);
    const fundingRate = context.fundingRate || 0;
    const sentiment = context.sentimentScore || 0;

    let approve = true;
    let sizeMult = 1.0;
    let reasons: string[] = [];

    if (obBlocked.blocked) {
      approve = false;
      reasons.push(obBlocked.reason);
    }

    if (signal.type === "BUY") {
      if (sentiment < -0.4) {
        approve = false;
        reasons.push("Macro sentiment is heavily bearish (-" + Math.abs(sentiment * 100).toFixed(0) + "%)");
      }
      if (fundingRate > 0.05) {
        sizeMult *= 0.75;
        reasons.push("High positive funding warns of over-leveraged longs");
      } else if (fundingRate < -0.03) {
        sizeMult *= 1.25;
        reasons.push("Negative funding creates high short-squeeze confluence");
      }
    } else if (signal.type === "SELL") {
      if (sentiment > 0.4) {
        approve = false;
        reasons.push("Macro sentiment is heavily bullish (+" + (sentiment * 100).toFixed(0) + "%)");
      }
      if (fundingRate > 0.03) {
        sizeMult *= 1.25;
        reasons.push("Positive funding signals long liquidation cascade potential");
      } else if (fundingRate < -0.05) {
        sizeMult *= 0.75;
        reasons.push("Heavily negative funding warns of short-squeeze risk");
      }
    }

    const finalSize = Math.max(0.5, Math.min(2.0, sizeMult));
    const reasonText = reasons.length > 0
      ? reasons.join("; ")
      : `AI Risk approved ${signal.type} with clean order flow & normal volatility.`;

    return {
      approve,
      reason: reasonText,
      size_multiplier: finalSize,
      model: "ai-risk-heuristic (ollama fallback)",
      latencyMs,
      isSimulated: true,
    };
  }

  /**
   * Order Book Depth Imbalance Wall Check:
   * - BUY: If Ask Volume > Bid Volume * 1.5, blocks long into massive resistance wall.
   * - SELL: If Bid Volume > Ask Volume * 1.5, blocks short into massive bid wall.
   */
  public isOrderBookBlocked(
    signalType: "BUY" | "SELL" | "HOLD",
    orderBook?: { bids: OrderBookLevel[]; asks: OrderBookLevel[] }
  ): { blocked: boolean; reason: string; bidAskRatio: number } {
    if (!orderBook || !orderBook.bids || !orderBook.asks || orderBook.bids.length === 0 || orderBook.asks.length === 0) {
      return { blocked: false, reason: "Order book neutral", bidAskRatio: 1.0 };
    }

    const topBids = orderBook.bids.slice(0, 10).reduce((acc, b) => acc + (b.qty || 0), 0);
    const topAsks = orderBook.asks.slice(0, 10).reduce((acc, a) => acc + (a.qty || 0), 0);
    const ratio = topAsks > 0 ? topBids / topAsks : 1.0;

    if (signalType === "BUY" && topAsks > topBids * 1.5) {
      return {
        blocked: true,
        reason: `Heavy sell wall detected above entry (Asks: ${topAsks.toFixed(1)} vs Bids: ${topBids.toFixed(1)}, ratio: ${ratio.toFixed(2)})`,
        bidAskRatio: ratio,
      };
    }

    if (signalType === "SELL" && topBids > topAsks * 1.5) {
      return {
        blocked: true,
        reason: `Heavy buy support wall detected below entry (Bids: ${topBids.toFixed(1)} vs Asks: ${topAsks.toFixed(1)}, ratio: ${ratio.toFixed(2)})`,
        bidAskRatio: ratio,
      };
    }

    return { blocked: false, reason: `Order book balanced (ratio ${ratio.toFixed(2)})`, bidAskRatio: ratio };
  }

  /**
   * Evaluates a fully backtested strategy configuration with Ollama.
   * Called once per top-N candidate in the grid search sweep — NOT per candle.
   * Returns a 0–100 score + rationale.
   */
  public async evaluateStrategyWithLLM(params: {
    symbol: string;
    interval: string;
    atrLen: number;
    fallbackMult: number;
    percentileRank: number;
    minConfidence: number;
    takeProfitR: number;
    useChopFilter: boolean;
    winRatePct: number;
    profitFactor: number;
    maxDrawdownPct: number;
    netProfitPct: number;
    totalTrades: number;
    fitnessScore: number;
  }): Promise<{ score: number; rationale: string; approved: boolean }> {
    const startTime = Date.now();

    const systemPrompt =
      'You are an expert quantitative trading strategy analyst. You evaluate algorithmic trading configurations based on their backtest statistics. ' +
      'Output ONLY a valid JSON object: {"score": number (0-100), "rationale": "string (max 120 chars)", "approved": boolean}. ' +
      'Score 80-100 = excellent, 60-79 = good, 40-59 = marginal, below 40 = poor. No markdown, no extra text.';

    const tpLabel = params.takeProfitR === 0 ? "Trend-Flip Exit" : `${params.takeProfitR}R Target`;
    const userPrompt =
      `Strategy Config for ${params.symbol.toUpperCase()} on ${params.interval}: ` +
      `ATR Length=${params.atrLen}, Fallback Mult=${params.fallbackMult}x, Percentile Rail=P${params.percentileRank}, ` +
      `Min AI Confidence=${params.minConfidence}%, Take Profit=${tpLabel}, Chop Filter=${params.useChopFilter ? "ON" : "OFF"}. ` +
      `Backtest Results (${params.totalTrades} trades): Win Rate=${params.winRatePct}%, Profit Factor=${params.profitFactor.toFixed(2)}, ` +
      `Net Profit=${params.netProfitPct}%, Max Drawdown=-${params.maxDrawdownPct}%, Fitness Score=${params.fitnessScore}. ` +
      `Rate this strategy configuration.`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs || 5000);

      const res = await fetch(`${this.config.host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          stream: false,
          format: "json",
          options: { temperature: 0.15, num_predict: 80 },
        }),
      });

      clearTimeout(timeout);

      if (res.ok) {
        const json = await res.json();
        const parsed = JSON.parse((json?.message?.content || "").trim());
        return {
          score: Math.max(0, Math.min(100, Number(parsed.score) || 50)),
          rationale: String(parsed.rationale || "").slice(0, 140),
          approved: Boolean(parsed.approved),
        };
      }
    } catch {
      // Ollama offline — use deterministic scoring
    }

    // Deterministic fallback: derive a score from the math
    const score = Math.min(
      100,
      Math.round(
        (params.winRatePct * 0.4) +
        (Math.min(params.profitFactor, 10) * 3) +
        (params.netProfitPct * 0.5) -
        (params.maxDrawdownPct * 1.5)
      )
    );
    const approved = score >= 55 && params.profitFactor >= 1.5 && params.maxDrawdownPct <= 10;
    const latency = Date.now() - startTime;
    return {
      score: Math.max(0, score),
      rationale: `Heuristic (Ollama offline, ${latency}ms): WR ${params.winRatePct}% × PF ${params.profitFactor.toFixed(1)} / DD ${params.maxDrawdownPct}%.`,
      approved,
    };
  }
}
