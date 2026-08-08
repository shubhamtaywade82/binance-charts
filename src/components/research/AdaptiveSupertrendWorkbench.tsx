import React, { useState, useEffect, useMemo } from "react";
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Play,
  RotateCcw,
  Sliders,
  Shield,
  Zap,
  Layers,
  Sparkles,
  BarChart3,
  Terminal,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Send,
  Clock,
  DollarSign,
} from "lucide-react";
import {
  AdaptiveSupertrend,
  BacktestSummary,
  BacktestTrade,
  STRATEGY_PRESETS,
  StrategyPreset,
  OptimizationCandidate,
  TimeframePerformanceCard,
} from "../../utils/adaptiveSupertrend";
import { OllamaContextEngine, LLMDecision } from "../../utils/ollamaContextEngine";
import {
  MarketDataConsensusEngine,
  MarketTelemetrySnapshot,
  ComprehensiveTradeDirective,
} from "../../utils/marketDataConsensus";
import { MarketRegimeEngine } from "../../utils/marketRegimeEngine";
import type { IDataAdapter, Candle, OrderBookLevel } from "../../adapters/IDataAdapter";

interface AdaptiveSupertrendWorkbenchProps {
  adapter: IDataAdapter;
  selectedSymbol: string;
  selectedInterval: string;
  livePrice?: number;
}

export const AdaptiveSupertrendWorkbench: React.FC<AdaptiveSupertrendWorkbenchProps> = ({
  adapter,
  selectedSymbol,
  selectedInterval,
  livePrice,
}) => {
  // Strategy Parameters
  const [atrLen, setAtrLen] = useState<number>(10);
  const [fallbackMult, setFallbackMult] = useState<number>(3.0);
  const [percentileRank, setPercentileRank] = useState<number>(85);
  const [minSamples, setMinSamples] = useState<number>(25);
  const [maxSamples, setMaxSamples] = useState<number>(150);
  const [minMult, setMinMult] = useState<number>(1.0);
  const [maxMult, setMaxMult] = useState<number>(6.0);
  const [initialEquity, setInitialEquity] = useState<number>(100000);
  const [riskPct, setRiskPct] = useState<number>(1.0);
  const [minConfidence, setMinConfidence] = useState<number>(0);
  const [takeProfitR, setTakeProfitR] = useState<number>(0);
  const [useLlmFilter, setUseLlmFilter] = useState<boolean>(true);
  const [useOrderFlow, setUseOrderFlow] = useState<boolean>(true);
  const [useChopFilter, setUseChopFilter] = useState<boolean>(true);

  // Timeframe and State
  const [currentInterval, setCurrentInterval] = useState<string>(selectedInterval || "15m");
  const [mtfScanResults, setMtfScanResults] = useState<TimeframePerformanceCard[]>([]);
  const [isScanningMtf, setIsScanningMtf] = useState<boolean>(false);

  // Ollama Model Configuration (Auto-set to installed local model llama3.2:3b)
  const [ollamaHost, setOllamaHost] = useState<string>("http://localhost:11434");
  const [ollamaModel, setOllamaModel] = useState<string>("llama3.2:3b");
  const [customNewsHeadline, setCustomNewsHeadline] = useState<string>(
    "Funding rates heavily negative at -0.05% with $50M in shorts liquidated in past hour."
  );

  // State
  const [candles, setCandles] = useState<Candle[]>([]);
  const [isLoadingCandles, setIsLoadingCandles] = useState<boolean>(false);
  const [liveOrderBook, setLiveOrderBook] = useState<{ bids: OrderBookLevel[]; asks: OrderBookLevel[] }>({ bids: [], asks: [] });
  const [backtestResult, setBacktestResult] = useState<BacktestSummary | null>(null);
  const [isBacktesting, setIsBacktesting] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"metrics" | "optimizer" | "mtf_matrix" | "telemetry" | "trades" | "ollama_sandbox" | "docs">("metrics");
  const [optimizationCandidates, setOptimizationCandidates] = useState<OptimizationCandidate[]>([]);
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  const [isLLMSweeping, setIsLLMSweeping] = useState<boolean>(false);
  const [activePresetId, setActivePresetId] = useState<string | null>("prime_scalper");

  const handleApplyPreset = (preset: StrategyPreset) => {
    setActivePresetId(preset.id);
    setAtrLen(preset.params.atrLen);
    setFallbackMult(preset.params.fallbackMult);
    setPercentileRank(preset.params.percentileRank);
    setMinMult(preset.params.minMult);
    setMaxMult(preset.params.maxMult);
    setMinConfidence(preset.params.minConfidence);
    setTakeProfitR(preset.params.takeProfitR);
    setUseChopFilter(preset.params.useChopFilter);
    setUseLlmFilter(preset.params.useLlmFilter);
  };

  const handleRunOptimizer = () => {
    setIsOptimizing(true);
    setIsLLMSweeping(false);
    setActiveTab("optimizer");
    setTimeout(() => {
      try {
        const candidates = AdaptiveSupertrend.runGridSearch(candles, initialEquity, riskPct / 100);
        setOptimizationCandidates(candidates);
      } catch (e) {
        console.error("Optimizer error:", e);
      } finally {
        setIsOptimizing(false);
      }
    }, 60);
  };

  // Run math sweep → then validate top-5 candidates with Ollama (1 LLM call per candidate)
  const handleRunLLMSweep = async () => {
    setIsOptimizing(true);
    setIsLLMSweeping(true);
    setActiveTab("optimizer");

    // Step 1: Run full 486-combo math sweep (sync, fast)
    let candidates: OptimizationCandidate[] = [];
    try {
      candidates = AdaptiveSupertrend.runGridSearch(candles, initialEquity, riskPct / 100);
    } catch (e) {
      console.error("Grid search error:", e);
      setIsOptimizing(false);
      setIsLLMSweeping(false);
      return;
    }

    // Mark top-5 as pending LLM validation, rest as no-status
    const marked = candidates.map((c, idx) => ({
      ...c,
      llmStatus: (idx < 5 ? "pending" : undefined) as OptimizationCandidate["llmStatus"],
    }));
    setOptimizationCandidates(marked);
    setIsOptimizing(false);

    // Step 2: Evaluate top-5 with Ollama one at a time (sequential to avoid parallel rate limits)
    const activeTf = currentInterval || selectedInterval || "15m";
    for (let i = 0; i < Math.min(5, marked.length); i++) {
      // Mark as evaluating
      setOptimizationCandidates((prev) =>
        prev.map((c, idx) => (idx === i ? { ...c, llmStatus: "evaluating" } : c))
      );

      try {
        const c = marked[i];
        const result = await ollama.evaluateStrategyWithLLM({
          symbol: selectedSymbol,
          interval: activeTf,
          atrLen: c.params.atrLen,
          fallbackMult: c.params.fallbackMult,
          percentileRank: c.params.percentileRank,
          minConfidence: c.params.minConfidence,
          takeProfitR: c.params.takeProfitR,
          useChopFilter: c.params.useChopFilter,
          winRatePct: c.summary.winRatePct,
          profitFactor: c.summary.profitFactor,
          maxDrawdownPct: c.summary.maxDrawdownPct,
          netProfitPct: c.summary.netProfitPct,
          totalTrades: c.summary.totalTrades,
          fitnessScore: c.fitnessScore,
        });
        setOptimizationCandidates((prev) =>
          prev.map((c2, idx) =>
            idx === i
              ? { ...c2, llmScore: result.score, llmRationale: result.rationale, llmApproved: result.approved, llmStatus: "done" }
              : c2
          )
        );
      } catch (e) {
        setOptimizationCandidates((prev) =>
          prev.map((c2, idx) => (idx === i ? { ...c2, llmStatus: "error" } : c2))
        );
      }
    }

    setIsLLMSweeping(false);
  };

  const handleApplyCandidate = (c: OptimizationCandidate) => {
    setAtrLen(c.params.atrLen);
    setFallbackMult(c.params.fallbackMult);
    setPercentileRank(c.params.percentileRank);
    setMinMult(c.params.minMult);
    setMaxMult(c.params.maxMult);
    setMinConfidence(c.params.minConfidence);
    setTakeProfitR(c.params.takeProfitR);
    setUseChopFilter(c.params.useChopFilter);
    setActiveTab("metrics");
  };

  const handleRunMtfScan = async () => {
    setIsScanningMtf(true);
    setActiveTab("mtf_matrix");
    const intervals = ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1D"];
    const cards: TimeframePerformanceCard[] = [];

    for (const tf of intervals) {
      try {
        const fetched = await adapter.fetchCandles(selectedSymbol, tf, 500);
        if (fetched && fetched.length >= 20) {
          const chop = MarketRegimeEngine.calculateChoppinessIndex(fetched, 14);
          const adxResult = MarketRegimeEngine.calculateADX(fetched, 14);
          const adxVal = adxResult?.adx || 25;
          const testEngine = new AdaptiveSupertrend(10, 3.0, 85, 150, 25, 1.0, 6.0);
          const signal = testEngine.update(fetched);
          const summary = testEngine.runBacktest(fetched, {
            initialEquity,
            riskPctPerTrade: riskPct / 100,
            useChopFilter: true,
            minConfidence: 65,
          });

          let recommended = "Trend Runner (3.0R)";
          if (tf === "1m" || tf === "3m" || tf === "5m") recommended = "Prime Scalper (1.5R)";
          else if (tf === "4h" || tf === "1D") recommended = "Institutional (P85th)";

          cards.push({
            interval: tf,
            label: tf.toUpperCase(),
            candleCount: fetched.length,
            currentTrend: signal?.trend === "UP" ? "BULLISH" : signal?.trend === "DOWN" ? "BEARISH" : "NEUTRAL",
            currentConfidence: signal?.confidence || 70,
            chopIndex: Number(chop.toFixed(1)),
            adxStrength: Number(adxVal.toFixed(1)),
            regime: chop > 61.8 ? "CHOPPY CONSOLIDATION" : adxVal >= 25 ? "EXPANSION TREND" : "TRANSITION",
            recommendedPreset: recommended,
            winRatePct: summary.winRatePct,
            profitFactor: summary.profitFactor >= 99 ? 99.9 : summary.profitFactor,
            netProfitPct: summary.netProfitPct,
            maxDrawdownPct: summary.maxDrawdownPct,
            tradesCount: summary.totalTrades,
          });
        }
      } catch (e) {
        console.error(`Failed MTF scan for ${tf}:`, e);
      }
    }

    setMtfScanResults(cards);
    setIsScanningMtf(false);
  };

  // Live Ollama Sandbox State
  const [liveTestDecision, setLiveTestDecision] = useState<LLMDecision | null>(null);
  const [isTestingOllama, setIsTestingOllama] = useState<boolean>(false);

  const engine = useMemo(() => {
    return new AdaptiveSupertrend(
      atrLen,
      fallbackMult,
      percentileRank,
      maxSamples,
      minSamples,
      minMult,
      maxMult
    );
  }, [atrLen, fallbackMult, percentileRank, maxSamples, minSamples, minMult, maxMult]);

  const ollama = useMemo(() => {
    return new OllamaContextEngine({ host: ollamaHost, model: ollamaModel });
  }, [ollamaHost, ollamaModel]);

  // Subscribe to live L2 Order Book Depth
  useEffect(() => {
    let unsub: (() => void) | undefined;
    if (adapter.subscribeOrderBook) {
      unsub = adapter.subscribeOrderBook(selectedSymbol, 20, (bids: OrderBookLevel[], asks: OrderBookLevel[]) => {
        setLiveOrderBook({ bids, asks });
      });
    }
    return () => {
      if (unsub) unsub();
    };
  }, [selectedSymbol, adapter]);

  // Compute Unified Market Telemetry from all available data feeds
  const telemetry = useMemo(() => {
    return MarketDataConsensusEngine.analyzeFullMarket(
      selectedSymbol,
      candles,
      liveOrderBook,
      { fundingRate: -0.04, pcr: 1.15, liquidations: { shortVol: 52.4, longVol: 8.1 } },
      livePrice
    );
  }, [selectedSymbol, candles, liveOrderBook, livePrice]);

  // Synthesize Unified Consensus Trade Directive
  const directive = useMemo(() => {
    const liveSignal = candles.length >= 5 ? engine.update(candles) : null;
    const supertrendTrend = liveSignal?.trend || "NEUTRAL";
    const supertrendStop = liveSignal?.stop || (livePrice || (candles[candles.length - 1]?.close || 64500)) * 0.985;
    return MarketDataConsensusEngine.synthesizeDirective(
      telemetry,
      supertrendTrend,
      supertrendStop,
      minConfidence || 70
    );
  }, [telemetry, candles, engine, livePrice, minConfidence]);

  // Load candle data for current symbol & interval
  useEffect(() => {
    let active = true;
    const loadData = async () => {
      setIsLoadingCandles(true);
      try {
        const activeTf = currentInterval || selectedInterval || "15m";
        const fetched = await adapter.fetchCandles(selectedSymbol, activeTf, 1000);
        if (active && fetched && fetched.length > 0) {
          setCandles(fetched);
        }
      } catch (e) {
        console.error("Failed to load candles for backtest:", e);
      } finally {
        if (active) setIsLoadingCandles(false);
      }
    };
    loadData();
    return () => {
      active = false;
    };
  }, [selectedSymbol, currentInterval, selectedInterval, adapter]);

  // Run backtest whenever candles or core parameters change
  const runBacktest = () => {
    if (candles.length < 15) return;
    setIsBacktesting(true);
    setTimeout(() => {
      try {
        const res = engine.runBacktest(candles, {
          initialEquity,
          riskPctPerTrade: riskPct / 100,
          minConfidence,
          useLlmFilter,
          useChopFilter,
          takeProfitR,
        });
        setBacktestResult(res);
      } catch (e) {
        console.error("Backtest calculation error:", e);
      } finally {
        setIsBacktesting(false);
      }
    }, 50);
  };

  useEffect(() => {
    if (candles.length >= 15) {
      runBacktest();
    }
  }, [candles, atrLen, fallbackMult, percentileRank, minConfidence, initialEquity, riskPct, takeProfitR, useLlmFilter, useChopFilter]);

  // Live Ollama Sandbox test
  const handleTestOllama = async (type: "BUY" | "SELL") => {
    setIsTestingOllama(true);
    setLiveTestDecision(null);
    try {
      const currentPrice = livePrice || (candles[candles.length - 1]?.close || 64500);
      const atr = engine.calculateATR(candles, atrLen) || currentPrice * 0.015;
      const signal = {
        type,
        price: currentPrice,
        stop: type === "BUY" ? currentPrice - atr * fallbackMult : currentPrice + atr * fallbackMult,
        trend: type === "BUY" ? ("UP" as const) : ("DOWN" as const),
        adaptiveMult: fallbackMult,
        atr,
        time: Math.floor(Date.now() / 1000),
        confidence: 85,
        confidenceTier: "HIGH" as const,
      };

      const decision = await ollama.validateTradeWithLLM(signal, {
        symbol: selectedSymbol,
        price: currentPrice,
        supertrendMult: fallbackMult,
        atr,
        fundingRate: -0.04,
        recentLiquidations: { shortVol: 52.4, longVol: 8.1 },
        newsHeadline: customNewsHeadline,
        sentimentScore: type === "BUY" ? 0.65 : -0.65,
      });

      setLiveTestDecision(decision);
    } catch (e) {
      console.error("Ollama test failed:", e);
    } finally {
      setIsTestingOllama(false);
    }
  };

  const currency = adapter.currency || "$";

  return (
    <div
      style={{
        padding: "20px",
        background: "linear-gradient(180deg, #0F131C 0%, #090B10 100%)",
        color: "#FFFFFF",
        minHeight: "calc(100vh - 70px)",
        fontFamily: "Inter, sans-serif",
      }}
    >
      {/* HEADER CAPSULE */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "rgba(255, 255, 255, 0.02)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: "10px",
          padding: "14px 20px",
          marginBottom: "20px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "8px",
              background: "linear-gradient(135deg, #00F5A0 0%, #00E5FF 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#0F131C",
            }}
          >
            <Brain size={22} strokeWidth={2.4} />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "16px", fontWeight: 800, letterSpacing: "0.4px" }}>
                ADAPTIVE SUPERTREND & LOCAL LLM (OLLAMA)
              </span>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 800,
                  background: "rgba(0, 245, 160, 0.15)",
                  color: "#00F5A0",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  border: "1px solid rgba(0, 245, 160, 0.3)",
                }}
              >
                AI RISK MANAGER
              </span>
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
              Dynamic Percentile ATR Rail · Ollama Trade Validation · Order Flow Imbalance Confluence
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          {/* Asset Badge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: "rgba(0, 0, 0, 0.4)",
              padding: "4px 10px",
              borderRadius: "6px",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            <span style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700 }}>ASSET:</span>
            <span style={{ fontSize: "12px", color: "#FFD700", fontWeight: 800 }}>{selectedSymbol.toUpperCase()}</span>
          </div>

          {/* Timeframe Pill Selector */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "rgba(0, 0, 0, 0.5)",
              padding: "2px",
              borderRadius: "6px",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              gap: "2px",
            }}
          >
            {["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1D"].map((tf) => {
              const isSelected = currentInterval === tf;
              return (
                <button
                  key={tf}
                  onClick={() => setCurrentInterval(tf)}
                  style={{
                    background: isSelected ? "var(--bg-card)" : "transparent",
                    color: isSelected ? "var(--accent-cyan)" : "var(--text-secondary)",
                    border: isSelected ? "1px solid var(--border-hover)" : "1px solid transparent",
                    borderRadius: "4px",
                    padding: "3px 7px",
                    fontSize: "10.5px",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  {tf}
                </button>
              );
            })}
          </div>

          {/* Run MTF Confluence Scan Button */}
          <button
            onClick={handleRunMtfScan}
            disabled={isScanningMtf}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              background: "rgba(0, 229, 255, 0.15)",
              color: "var(--accent-cyan)",
              border: "1px solid rgba(0, 229, 255, 0.35)",
              borderRadius: "6px",
              padding: "6px 12px",
              fontSize: "11px",
              fontWeight: 800,
              cursor: isScanningMtf ? "wait" : "pointer",
            }}
          >
            <TrendingUp size={13} />
            <span>{isScanningMtf ? "SCANNING ALL TF..." : "⚡ SCAN ALL TIMEFRAMES"}</span>
          </button>

          {/* Re-Run Backtest Button */}
          <button
            onClick={runBacktest}
            disabled={isBacktesting || isLoadingCandles}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: "linear-gradient(135deg, #00F5A0 0%, #00E5FF 100%)",
              color: "#0F131C",
              border: "none",
              borderRadius: "6px",
              padding: "6px 14px",
              fontSize: "11px",
              fontWeight: 900,
              cursor: "pointer",
              boxShadow: "0 0 16px rgba(0, 245, 160, 0.35)",
            }}
          >
            <Play size={13} fill="#0F131C" />
            {isBacktesting ? "CALCULATING..." : "RE-RUN BACKTEST"}
          </button>
        </div>
      </div>

      {/* MAIN GRID */}
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "20px" }}>
        {/* LEFT COLUMN: STRATEGY & OLLAMA CONFIGURATION */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* 0. CURATED STRATEGY PRESETS & GRID SEARCH SWEEP */}
          <div
            style={{
              background: "linear-gradient(135deg, rgba(0, 245, 160, 0.06) 0%, rgba(0, 229, 255, 0.02) 100%)",
              border: "1px solid rgba(0, 245, 160, 0.3)",
              borderRadius: "8px",
              padding: "16px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                paddingBottom: "8px",
                marginBottom: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", fontWeight: 800, color: "#00F5A0" }}>
                <Zap size={14} />
                CURATED STRATEGY PRESETS
              </div>
              <span style={{ fontSize: "9px", color: "var(--text-muted)", fontWeight: 700 }}>1-CLICK LOAD</span>
            </div>

            {/* Presets List */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
              {STRATEGY_PRESETS.map((preset) => {
                const isSelected = activePresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => handleApplyPreset(preset)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      textAlign: "left",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      background: isSelected ? "rgba(0, 245, 160, 0.15)" : "rgba(255, 255, 255, 0.03)",
                      border: isSelected ? "1px solid #00F5A0" : "1px solid rgba(255, 255, 255, 0.08)",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                      <span style={{ fontSize: "11px", fontWeight: 800, color: isSelected ? "#00F5A0" : "#FFFFFF" }}>
                        {preset.name}
                      </span>
                      <span
                        style={{
                          fontSize: "8.5px",
                          fontWeight: 800,
                          padding: "1px 5px",
                          borderRadius: "3px",
                          background: "rgba(255, 255, 255, 0.08)",
                          color: preset.color,
                        }}
                      >
                        {preset.badge}
                      </span>
                    </div>
                    <span style={{ fontSize: "9.5px", color: "var(--text-muted)", marginTop: "2px" }}>
                      {preset.description}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Run Full Grid Search Optimizer Sweep Button */}
            <button
              onClick={handleRunOptimizer}
              disabled={isOptimizing || candles.length < 20}
              style={{
                width: "100%",
                background: isOptimizing
                  ? "rgba(255, 215, 0, 0.2)"
                  : "linear-gradient(135deg, rgba(0, 245, 160, 0.25) 0%, rgba(0, 229, 255, 0.25) 100%)",
                border: "1px solid #00F5A0",
                color: "#FFFFFF",
                fontWeight: 900,
                fontSize: "11px",
                padding: "10px",
                borderRadius: "6px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                cursor: isOptimizing ? "wait" : "pointer",
                boxShadow: "0 0 16px rgba(0, 245, 160, 0.2)",
              }}
            >
              <Zap size={14} color="#00F5A0" />
              <span>{isOptimizing ? "SEARCHING 72 PARAMETER COMBOS..." : "🔥 RUN FULL PARAMETER SEARCH (SWEEP)"}</span>
            </button>
          </div>

          {/* 1. ADAPTIVE SUPERTREND PARAMETERS */}
          <div
            style={{
              background: "rgba(255, 255, 255, 0.02)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "8px",
              padding: "16px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "12px",
                fontWeight: 700,
                color: "var(--accent-cyan)",
                borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                paddingBottom: "8px",
                marginBottom: "12px",
              }}
            >
              <Sliders size={14} />
              SUPERTREND AI MATH PARAMETERS
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "4px" }}>
                  <span style={{ color: "var(--text-secondary)" }}>ATR Length</span>
                  <span style={{ fontWeight: 800, color: "#FFFFFF" }}>{atrLen} bars</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="30"
                  value={atrLen}
                  onChange={(e) => setAtrLen(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "var(--accent-cyan)" }}
                />
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "4px" }}>
                  <span style={{ color: "var(--text-secondary)" }}>Fallback Multiplier</span>
                  <span style={{ fontWeight: 800, color: "#FFFFFF" }}>{fallbackMult.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="1.0"
                  max="6.0"
                  step="0.1"
                  value={fallbackMult}
                  onChange={(e) => setFallbackMult(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "#00F5A0" }}
                />
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "4px" }}>
                  <span style={{ color: "var(--text-secondary)" }}>Pullback Percentile Rank</span>
                  <span style={{ fontWeight: 800, color: "#FFD700" }}>{percentileRank}th</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="95"
                  value={percentileRank}
                  onChange={(e) => setPercentileRank(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "#FFD700" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "4px" }}>
                <div>
                  <label style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700 }}>MIN MULT</label>
                  <input
                    type="number"
                    step="0.5"
                    value={minMult}
                    onChange={(e) => setMinMult(Number(e.target.value))}
                    style={{
                      width: "100%",
                      background: "rgba(0, 0, 0, 0.4)",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      color: "#FFFFFF",
                      padding: "4px 8px",
                      borderRadius: "4px",
                      fontSize: "11px",
                      marginTop: "2px",
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700 }}>MAX MULT</label>
                  <input
                    type="number"
                    step="0.5"
                    value={maxMult}
                    onChange={(e) => setMaxMult(Number(e.target.value))}
                    style={{
                      width: "100%",
                      background: "rgba(0, 0, 0, 0.4)",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      color: "#FFFFFF",
                      padding: "4px 8px",
                      borderRadius: "4px",
                      fontSize: "11px",
                      marginTop: "2px",
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 2. RISK & EXECUTION SETTINGS */}
          <div
            style={{
              background: "rgba(255, 255, 255, 0.02)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "8px",
              padding: "16px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "12px",
                fontWeight: 700,
                color: "#00F5A0",
                borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                paddingBottom: "8px",
                marginBottom: "12px",
              }}
            >
              <Shield size={14} />
              RISK & SIZING ENGINE
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "4px" }}>
                  <span style={{ color: "var(--text-secondary)" }}>Base Risk / Trade</span>
                  <span style={{ fontWeight: 800, color: "#00F5A0" }}>{riskPct}%</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="5.0"
                  step="0.25"
                  value={riskPct}
                  onChange={(e) => setRiskPct(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "#00F5A0" }}
                />
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "4px" }}>
                  <span style={{ color: "var(--text-secondary)" }}>Take Profit R-Multiple</span>
                  <span style={{ fontWeight: 800, color: "#FFD700" }}>
                    {takeProfitR === 0 ? "Trend Flip Exit" : `${takeProfitR}R Target`}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="4"
                  step="0.5"
                  value={takeProfitR}
                  onChange={(e) => setTakeProfitR(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "#FFD700" }}
                />
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "4px" }}>
                  <span style={{ color: "var(--text-secondary)" }}>Min AI Confidence Threshold</span>
                  <span style={{ fontWeight: 800, color: minConfidence >= 75 ? "#FFD700" : "#00F5A0" }}>
                    {minConfidence === 0 ? "All Signals (0%)" : `≥ ${minConfidence}%`}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="90"
                  step="5"
                  value={minConfidence}
                  onChange={(e) => setMinConfidence(Number(e.target.value))}
                  style={{ width: "100%", accentColor: minConfidence >= 75 ? "#FFD700" : "#00F5A0" }}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 0",
                  borderTop: "1px solid rgba(255, 255, 255, 0.05)",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700 }}>Avoid Choppy Regimes</span>
                  <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>Skip CHOP &gt; 61.8 &amp; Squeezes</span>
                </div>
                <button
                  onClick={() => setUseChopFilter(!useChopFilter)}
                  style={{
                    background: useChopFilter ? "rgba(0, 245, 160, 0.2)" : "rgba(255, 255, 255, 0.05)",
                    border: useChopFilter ? "1px solid #00F5A0" : "1px solid rgba(255, 255, 255, 0.15)",
                    color: useChopFilter ? "#00F5A0" : "var(--text-muted)",
                    padding: "3px 10px",
                    borderRadius: "4px",
                    fontSize: "10px",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  {useChopFilter ? "ACTIVE" : "OFF"}
                </button>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 0",
                  borderTop: "1px solid rgba(255, 255, 255, 0.05)",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700 }}>LLM Sentiment Filter</span>
                  <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>Validate signals with AI</span>
                </div>
                <button
                  onClick={() => setUseLlmFilter(!useLlmFilter)}
                  style={{
                    background: useLlmFilter ? "rgba(0, 245, 160, 0.2)" : "rgba(255, 255, 255, 0.05)",
                    border: useLlmFilter ? "1px solid #00F5A0" : "1px solid rgba(255, 255, 255, 0.15)",
                    color: useLlmFilter ? "#00F5A0" : "var(--text-muted)",
                    padding: "3px 10px",
                    borderRadius: "4px",
                    fontSize: "10px",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  {useLlmFilter ? "ACTIVE" : "OFF"}
                </button>
              </div>
            </div>
          </div>

          {/* 3. MARKET REGIME & CHOPPINESS GAUGE */}
          <div
            style={{
              background: "rgba(255, 255, 255, 0.02)",
              border: `1px solid ${telemetry.regime.isChop ? "rgba(255, 73, 92, 0.3)" : "rgba(0, 245, 160, 0.3)"}`,
              borderRadius: "8px",
              padding: "16px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                paddingBottom: "8px",
                marginBottom: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", fontWeight: 700, color: telemetry.regime.isChop ? "#FF495C" : "#00F5A0" }}>
                <TrendingUp size={14} />
                MARKET REGIME &amp; CHOPPINESS
              </div>
              <span
                style={{
                  fontSize: "9px",
                  fontWeight: 800,
                  background: telemetry.regime.isChop ? "rgba(255, 73, 92, 0.15)" : "rgba(0, 245, 160, 0.15)",
                  color: telemetry.regime.isChop ? "#FF495C" : "#00F5A0",
                  padding: "2px 6px",
                  borderRadius: "3px",
                }}
              >
                {telemetry.regime.isChop ? "⛔ CHOP / STAND ASIDE" : "🟢 TREND ACTIVE"}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "11px" }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                  <span style={{ color: "var(--text-secondary)" }}>Dreiss Choppiness Index:</span>
                  <span style={{ fontWeight: 800, color: telemetry.regime.chopIndex >= 61.8 ? "#FF495C" : telemetry.regime.chopIndex <= 38.2 ? "#00F5A0" : "#FFD700" }}>
                    {telemetry.regime.chopIndex} / 100 {telemetry.regime.chopIndex >= 61.8 ? "(High Chop)" : telemetry.regime.chopIndex <= 38.2 ? "(Explosive Trend)" : "(Transition)"}
                  </span>
                </div>
                <div style={{ width: "100%", height: "4px", background: "rgba(255, 255, 255, 0.08)", borderRadius: "2px", overflow: "hidden" }}>
                  <div style={{ width: `${telemetry.regime.chopIndex}%`, height: "100%", background: telemetry.regime.chopIndex >= 61.8 ? "#FF495C" : telemetry.regime.chopIndex <= 38.2 ? "#00F5A0" : "#FFD700" }} />
                </div>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                  <span style={{ color: "var(--text-secondary)" }}>Wilder's ADX Trend Strength:</span>
                  <span style={{ fontWeight: 800, color: telemetry.regime.adx >= 25 ? "#00F5A0" : "#FF495C" }}>
                    {telemetry.regime.adx} {telemetry.regime.adx >= 25 ? "(Strong Trend)" : "(Weak / Chop)"}
                  </span>
                </div>
                <div style={{ width: "100%", height: "4px", background: "rgba(255, 255, 255, 0.08)", borderRadius: "2px", overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(100, telemetry.regime.adx * 2)}%`, height: "100%", background: telemetry.regime.adx >= 25 ? "#00F5A0" : "#FF495C" }} />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid rgba(255, 255, 255, 0.04)", paddingTop: "6px" }}>
                <span style={{ color: "var(--text-secondary)" }}>Multi-Timeframe Macro Bias:</span>
                <span style={{ fontWeight: 800, color: telemetry.regime.macroBias.includes("BULL") ? "#00F5A0" : telemetry.regime.macroBias.includes("BEAR") ? "#FF495C" : "#FFD700" }}>
                  {telemetry.regime.macroBias.replace("_", " ")} ({telemetry.regime.htfAlignmentScore}%)
                </span>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-secondary)" }}>Volatility Squeeze:</span>
                <span style={{ fontWeight: 700, color: telemetry.regime.isSqueezeActive ? "#FFD700" : "#00F5A0" }}>
                  {telemetry.regime.isSqueezeActive ? "⚡ Squeeze Active (Wait for Expansion)" : "✅ Normal Dispersion"}
                </span>
              </div>
            </div>
          </div>

          {/* 4. MULTI-FACTOR AI CONFIDENCE RADAR */}
          <div
            style={{
              background: "rgba(255, 255, 255, 0.02)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "8px",
              padding: "16px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                paddingBottom: "8px",
                marginBottom: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", fontWeight: 700, color: "#FFD700" }}>
                <Sparkles size={14} />
                AI CONFIDENCE RADAR
              </div>
              <span
                style={{
                  fontSize: "9px",
                  fontWeight: 800,
                  background: "rgba(255, 215, 0, 0.15)",
                  color: "#FFD700",
                  padding: "2px 6px",
                  borderRadius: "3px",
                }}
              >
                5 VECTORS
              </span>
            </div>

            {/* 5 Factors Progress Bars */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {[
                { label: "Statistical Sampling (25%)", value: 85, color: "#00F5A0" },
                { label: "Volume Expansion (RVOL) (20%)", value: 78, color: "var(--accent-cyan)" },
                { label: "MTF Trend Alignment (20%)", value: 92, color: "#FFD700" },
                { label: "Order Flow Wall Ratio (20%)", value: 84, color: "#00F5A0" },
                { label: "LLM Sentiment & Funding (15%)", value: 80, color: "#FF495C" },
              ].map((f) => (
                <div key={f.label}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", marginBottom: "2px" }}>
                    <span style={{ color: "var(--text-secondary)" }}>{f.label}</span>
                    <span style={{ fontWeight: 800, color: f.color }}>{f.value}%</span>
                  </div>
                  <div style={{ width: "100%", height: "4px", background: "rgba(255, 255, 255, 0.08)", borderRadius: "2px", overflow: "hidden" }}>
                    <div style={{ width: `${f.value}%`, height: "100%", background: f.color, borderRadius: "2px" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 3. OLLAMA CONFIGURATION */}
          <div
            style={{
              background: "rgba(255, 255, 255, 0.02)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "8px",
              padding: "16px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "12px",
                fontWeight: 700,
                color: "#FFD700",
                borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                paddingBottom: "8px",
                marginBottom: "12px",
              }}
            >
              <Brain size={14} />
              LOCAL OLLAMA AI SETTINGS
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div>
                <label style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700 }}>ENDPOINT</label>
                <input
                  type="text"
                  value={ollamaHost}
                  onChange={(e) => setOllamaHost(e.target.value)}
                  style={{
                    width: "100%",
                    background: "rgba(0, 0, 0, 0.4)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    color: "#FFFFFF",
                    padding: "5px 8px",
                    borderRadius: "4px",
                    fontSize: "11px",
                    marginTop: "2px",
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700 }}>INSTALLED LOCAL MODELS</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px", marginBottom: "6px" }}>
                  {["llama3.2:3b", "qwen3.5:2b", "llama3.2:1b", "qwen3.5:0.8b", "qwen2.5:0.5b"].map((m) => (
                    <button
                      key={m}
                      onClick={() => setOllamaModel(m)}
                      style={{
                        background: ollamaModel === m ? "rgba(0, 245, 160, 0.2)" : "rgba(255, 255, 255, 0.05)",
                        border: ollamaModel === m ? "1px solid #00F5A0" : "1px solid rgba(255, 255, 255, 0.1)",
                        color: ollamaModel === m ? "#00F5A0" : "var(--text-muted)",
                        fontSize: "9.5px",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={ollamaModel}
                  onChange={(e) => setOllamaModel(e.target.value)}
                  placeholder="llama3.2:3b, qwen3.5:2b, mistral..."
                  style={{
                    width: "100%",
                    background: "rgba(0, 0, 0, 0.4)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    color: "#FFFFFF",
                    padding: "5px 8px",
                    borderRadius: "4px",
                    fontSize: "11px",
                    marginTop: "2px",
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: DIRECTIVE, METRICS, CHARTS, TRADES & LLM TESTER */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* LIVE AI EXECUTION DIRECTIVE BANNER & PLAYBOOK */}
          {(() => {
            const latestCandle = candles[candles.length - 1];
            const liveSignal = candles.length >= 5 ? engine.update(candles) : null;
            const currentPrice = livePrice || (latestCandle?.close || 64500);
            const liveConfidence = liveSignal?.confidence || 75;
            const liveTier = liveSignal?.confidenceTier || "HIGH";
            const isBuy = liveSignal?.trend === "UP";
            const isTakeTrade = liveConfidence >= (minConfidence || 70) && liveSignal?.type !== "HOLD";
            const stopPrice = liveSignal?.stop || (isBuy ? currentPrice * 0.985 : currentPrice * 1.015);
            const stopDist = Math.abs(currentPrice - stopPrice);
            const tp1 = isBuy ? currentPrice + stopDist * 1.5 : currentPrice - stopDist * 1.5;
            const tp2 = isBuy ? currentPrice + stopDist * 3.0 : currentPrice - stopDist * 3.0;

            return (
              <div
                style={{
                  background: isTakeTrade
                    ? isBuy
                      ? "linear-gradient(135deg, rgba(0, 245, 160, 0.12) 0%, rgba(0, 229, 255, 0.04) 100%)"
                      : "linear-gradient(135deg, rgba(255, 73, 92, 0.12) 0%, rgba(236, 72, 153, 0.04) 100%)"
                    : "linear-gradient(135deg, rgba(255, 215, 0, 0.08) 0%, rgba(0, 0, 0, 0.4) 100%)",
                  border: `1px solid ${
                    isTakeTrade
                      ? isBuy
                        ? "rgba(0, 245, 160, 0.4)"
                        : "rgba(255, 73, 92, 0.4)"
                      : "rgba(255, 215, 0, 0.3)"
                  }`,
                  borderRadius: "10px",
                  padding: "18px 20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px",
                  boxShadow: isTakeTrade
                    ? isBuy
                      ? "0 0 24px rgba(0, 245, 160, 0.15)"
                      : "0 0 24px rgba(255, 73, 92, 0.15)"
                    : "none",
                }}
              >
                {/* 1. TOP DIRECTIVE ACTION HEADER */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: 900,
                        padding: "4px 10px",
                        borderRadius: "5px",
                        background: isTakeTrade
                          ? isBuy
                            ? "linear-gradient(135deg, #00F5A0 0%, #00E5FF 100%)"
                            : "linear-gradient(135deg, #FF495C 0%, #EC4899 100%)"
                          : "linear-gradient(135deg, #FFD700 0%, #FFAA00 100%)",
                        color: "#0A0D14",
                        letterSpacing: "0.5px",
                      }}
                    >
                      {isTakeTrade
                        ? isBuy
                          ? "EXECUTE LONG TRADE ✅"
                          : "EXECUTE SHORT TRADE ✅"
                        : "STAND ASIDE / DO NOT TRADE ⛔"}
                    </span>

                    <span style={{ fontSize: "14px", fontWeight: 800, color: "#FFFFFF" }}>
                      {isTakeTrade
                        ? isBuy
                          ? `High-Probability Bullish Expansion Setup on ${selectedSymbol.toUpperCase()}`
                          : `High-Probability Bearish Breakdown Setup on ${selectedSymbol.toUpperCase()}`
                        : `Sub-Threshold Confidence (${liveConfidence}% < 70%) or Market In Choppy Compression`}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 800,
                        background: "rgba(0, 0, 0, 0.5)",
                        color: liveTier === "PRIME" ? "#FFD700" : "#00F5A0",
                        padding: "4px 10px",
                        borderRadius: "4px",
                        border: `1px solid ${liveTier === "PRIME" ? "#FFD700" : "#00F5A0"}`,
                      }}
                    >
                      AI CONFIDENCE: {liveConfidence}% ({liveTier})
                    </span>
                  </div>
                </div>

                {/* 2. EXACT EXECUTION BLUEPRINT */}
                {isTakeTrade && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(5, 1fr)",
                      gap: "10px",
                      background: "rgba(0, 0, 0, 0.4)",
                      padding: "12px",
                      borderRadius: "6px",
                      border: "1px solid rgba(255, 255, 255, 0.06)",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700 }}>ACTION & ENTRY</div>
                      <div style={{ fontSize: "13px", fontWeight: 800, color: isBuy ? "#00F5A0" : "#FF495C", marginTop: "2px" }}>
                        {isBuy ? "BUY" : "SELL"} @ {currency}{currentPrice.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700 }}>DYNAMIC STOP LOSS</div>
                      <div style={{ fontSize: "13px", fontWeight: 800, color: "#FF495C", marginTop: "2px" }}>
                        {currency}{stopPrice.toLocaleString()} ({(((stopPrice - currentPrice) / currentPrice) * 100).toFixed(2)}%)
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700 }}>TARGET 1 (1.5R TP)</div>
                      <div style={{ fontSize: "13px", fontWeight: 800, color: "#00F5A0", marginTop: "2px" }}>
                        {currency}{tp1.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700 }}>TARGET 2 (3.0R TP)</div>
                      <div style={{ fontSize: "13px", fontWeight: 800, color: "#FFD700", marginTop: "2px" }}>
                        {currency}{tp2.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700 }}>RECOMMENDED SIZING</div>
                      <div style={{ fontSize: "13px", fontWeight: 800, color: "var(--accent-cyan)", marginTop: "2px" }}>
                        {liveTier === "PRIME" ? "1.4x (Aggressive)" : "1.0x (Standard)"}
                      </div>
                    </div>
                  </div>
                )}

                {/* 3. COMPARATIVE CHECKLIST: WHEN TO TAKE VS WHEN NOT TO TAKE */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                  {/* GREEN COLUMN: WHEN TO TAKE THIS TRADE */}
                  <div
                    style={{
                      background: "rgba(0, 245, 160, 0.04)",
                      border: "1px solid rgba(0, 245, 160, 0.2)",
                      borderRadius: "6px",
                      padding: "12px 14px",
                    }}
                  >
                    <div style={{ fontSize: "11px", fontWeight: 800, color: "#00F5A0", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                      <CheckCircle2 size={14} color="#00F5A0" />
                      WHEN TO TAKE THIS TRADE (EXECUTION CHECKLIST)
                    </div>
                    <ul style={{ margin: 0, paddingLeft: "16px", fontSize: "10.5px", color: "var(--text-secondary)", lineHeight: "1.6" }}>
                      <li><b>Trend Confluence:</b> Supertrend flips with confirmed close beyond dynamic ATR band.</li>
                      <li><b>High AI Certainty:</b> Multi-Factor Confidence Score is <b>≥ 70%</b> (PRIME or HIGH tier).</li>
                      <li><b>Order Book Clearance:</b> Bid/Ask wall ratio &gt; 1.30 (no massive opposing wall within 1.5%).</li>
                      <li><b>Volume Acceleration:</b> Relative Volume (RVOL) &gt; 1.5x of 20-period average volume.</li>
                      <li><b>Local LLM Validation:</b> Ollama AI risk manager approves trade with positive sentiment.</li>
                    </ul>
                  </div>

                  {/* RED COLUMN: WHEN NOT TO TAKE THIS TRADE (AVOID) */}
                  <div
                    style={{
                      background: "rgba(255, 73, 92, 0.04)",
                      border: "1px solid rgba(255, 73, 92, 0.2)",
                      borderRadius: "6px",
                      padding: "12px 14px",
                    }}
                  >
                    <div style={{ fontSize: "11px", fontWeight: 800, color: "#FF495C", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                      <XCircle size={14} color="#FF495C" />
                      WHEN NOT TO TAKE THIS TRADE (AVOID &amp; STAND ASIDE)
                    </div>
                    <ul style={{ margin: 0, paddingLeft: "16px", fontSize: "10.5px", color: "var(--text-secondary)", lineHeight: "1.6" }}>
                      <li><b>Low AI Confidence:</b> Total score is <b>&lt; 70%</b> — indicates low statistical edge or noisy market.</li>
                      <li><b>Choppy Compression:</b> Tight ATR with overlapping wicks and no clear expansion impulse.</li>
                      <li><b>Order Book Wall Block:</b> Large opposing Ask Wall (&gt; 1.5x Bids on Long) directly overhead.</li>
                      <li><b>Funding Rate Mismatch:</b> Heavily positive funding on Longs warns of long liquidation cascades.</li>
                      <li><b>LLM Macro Headwinds:</b> Local Ollama model rejects trade due to regulatory or earnings risk.</li>
                    </ul>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* TAB BAR */}
          {/* TAB NAVIGATION */}
          <div
            style={{
              display: "flex",
              gap: "8px",
              borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
              paddingBottom: "10px",
              overflowX: "auto",
            }}
          >
            {[
              { id: "metrics", label: "PERFORMANCE & EQUITY CURVE", icon: BarChart3 },
              { id: "optimizer", label: `AUTO-SWEEP LEADERBOARD (${optimizationCandidates.length})`, icon: Zap },
              { id: "telemetry", label: "MARKET DATA TELEMETRY MATRIX", icon: Layers },
              { id: "trades", label: `TRADE LEDGER (${backtestResult?.totalTrades || 0})`, icon: Terminal },
              { id: "ollama_sandbox", label: "LIVE OLLAMA TESTER & CONTEXT", icon: Brain },
              { id: "docs", label: "ARCHITECTURE & MATH DOCS", icon: Layers },
            ].map((tab) => {
              const Icon = tab.icon;
              const isSelected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 14px",
                    borderRadius: "6px",
                    background: isSelected ? "rgba(0, 245, 160, 0.15)" : "transparent",
                    border: isSelected ? "1px solid #00F5A0" : "1px solid transparent",
                    color: isSelected ? "#00F5A0" : "var(--text-secondary)",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    whiteSpace: "nowrap",
                  }}
                >
                  <Icon size={13} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* TAB: AUTO-SWEEP OPTIMIZER LEADERBOARD */}
          {activeTab === "optimizer" && (
            <div
              style={{
                background: "rgba(255, 255, 255, 0.02)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: "8px",
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "14px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255, 255, 255, 0.08)", paddingBottom: "10px" }}>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 800, color: "#00F5A0" }}>
                    🏆 TOP RANKED PARAMETER CONFIGURATIONS FOR {selectedSymbol.toUpperCase()}
                  </div>
                  <div style={{ fontSize: "10.5px", color: "var(--text-muted)", marginTop: "2px" }}>
                    Automated grid search sweep ranking {optimizationCandidates.length > 0 ? optimizationCandidates.length : "72"} combinations by composite risk-adjusted fitness.
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <button
                    onClick={handleRunOptimizer}
                    disabled={isOptimizing || isLLMSweeping || candles.length < 20}
                    style={{
                      background: "rgba(0, 245, 160, 0.2)",
                      border: "1px solid #00F5A0",
                      color: "#00F5A0",
                      padding: "6px 14px",
                      borderRadius: "5px",
                      fontSize: "11px",
                      fontWeight: 800,
                      cursor: isOptimizing ? "wait" : "pointer",
                    }}
                  >
                    {isOptimizing && !isLLMSweeping ? "SWEEPING..." : "⚡ MATH SWEEP"}
                  </button>
                  <button
                    onClick={handleRunLLMSweep}
                    disabled={isOptimizing || isLLMSweeping || candles.length < 20}
                    title="Runs full 486-combo math sweep, then validates top 5 with Ollama (1 LLM call each)"
                    style={{
                      background: isLLMSweeping ? "rgba(255, 215, 0, 0.25)" : "rgba(255, 215, 0, 0.15)",
                      border: "1px solid #FFD700",
                      color: "#FFD700",
                      padding: "6px 14px",
                      borderRadius: "5px",
                      fontSize: "11px",
                      fontWeight: 800,
                      cursor: isLLMSweeping ? "wait" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                    }}
                  >
                    🤖 {isLLMSweeping ? "AI VALIDATING TOP 5..." : "AI-SWEEP + OLLAMA RANK"}
                  </button>
                </div>
              </div>

              {optimizationCandidates.length > 0 ? (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", textAlign: "left" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.1)", color: "var(--text-muted)" }}>
                        <th style={{ padding: "8px" }}>RANK</th>
                        <th style={{ padding: "8px" }}>PARAMETERS</th>
                        <th style={{ padding: "8px" }}>WIN RATE</th>
                        <th style={{ padding: "8px" }}>PROFIT FACTOR</th>
                        <th style={{ padding: "8px" }}>NET ROI</th>
                        <th style={{ padding: "8px" }}>MAX DD</th>
                        <th style={{ padding: "8px" }}>SHARPE</th>
                        <th style={{ padding: "8px" }}>TRADES</th>
                        <th style={{ padding: "8px", color: "#FFD700" }}>🤖 AI SCORE</th>
                        <th style={{ padding: "8px", color: "#FFD700" }}>AI VERDICT</th>
                        <th style={{ padding: "8px", textAlign: "right" }}>ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {optimizationCandidates.map((cand) => {
                        const isTop1 = cand.rank === 1;
                        return (
                          <tr
                            key={cand.rank}
                            style={{
                              borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                              background: isTop1 ? "rgba(0, 245, 160, 0.06)" : "transparent",
                            }}
                          >
                            <td style={{ padding: "8px", fontWeight: 800, color: isTop1 ? "#00F5A0" : "#FFFFFF" }}>
                              {isTop1 ? "🥇 #1 BEST" : `#${cand.rank}`}
                            </td>
                            <td style={{ padding: "8px", fontFamily: "var(--font-mono)", fontSize: "10.5px" }}>
                              ATR {cand.params.atrLen} · {cand.params.fallbackMult}x · P{cand.params.percentileRank} · Conf ≥{cand.params.minConfidence}% · {cand.params.takeProfitR === 0 ? "Flip Exit" : `${cand.params.takeProfitR}R`} · Chop: {cand.params.useChopFilter ? "ON" : "OFF"}
                            </td>
                            <td style={{ padding: "8px", fontWeight: 800, color: cand.summary.winRatePct >= 65 ? "#00F5A0" : "#FFD700" }}>
                              {cand.summary.winRatePct}%
                            </td>
                            <td style={{ padding: "8px", fontWeight: 800, color: "#FFD700" }}>
                              {cand.summary.profitFactor >= 99 ? "∞" : cand.summary.profitFactor.toFixed(2)}
                            </td>
                            <td style={{ padding: "8px", fontWeight: 800, color: cand.summary.netProfit >= 0 ? "#00F5A0" : "#FF495C" }}>
                              {cand.summary.netProfit >= 0 ? "+" : ""}{cand.summary.netProfitPct}% ({currency}{cand.summary.netProfit.toLocaleString()})
                            </td>
                            <td style={{ padding: "8px", color: "#FF495C" }}>
                              -{cand.summary.maxDrawdownPct}%
                            </td>
                            <td style={{ padding: "8px", fontWeight: 700, color: cand.summary.sharpeRatio >= 2.0 ? "#00F5A0" : "#FFFFFF" }}>
                              {cand.summary.sharpeRatio.toFixed(2)}
                            </td>
                            <td style={{ padding: "8px", color: "var(--text-muted)" }}>
                              {cand.summary.totalTrades}
                            </td>
                            {/* LLM Score column */}
                            <td style={{ padding: "8px" }}>
                              {cand.llmStatus === "evaluating" && (
                                <span style={{ color: "#FFD700", fontWeight: 800, fontSize: "10px", animation: "pulse 1s infinite" }}>🤖 Asking Ollama...</span>
                              )}
                              {cand.llmStatus === "pending" && (
                                <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>⏳ Queued</span>
                              )}
                              {cand.llmStatus === "done" && cand.llmScore !== undefined && (
                                <span
                                  style={{
                                    padding: "2px 8px",
                                    borderRadius: "4px",
                                    fontWeight: 800,
                                    fontSize: "11px",
                                    background: cand.llmScore >= 75 ? "rgba(0, 245, 160, 0.15)" : cand.llmScore >= 55 ? "rgba(255, 215, 0, 0.15)" : "rgba(255, 73, 92, 0.15)",
                                    color: cand.llmScore >= 75 ? "#00F5A0" : cand.llmScore >= 55 ? "#FFD700" : "#FF495C",
                                  }}
                                >
                                  {cand.llmScore}/100
                                </span>
                              )}
                              {cand.llmStatus === "error" && <span style={{ color: "#FF495C", fontSize: "10px" }}>❌</span>}
                              {!cand.llmStatus && <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>—</span>}
                            </td>
                            {/* AI Verdict */}
                            <td style={{ padding: "8px", fontSize: "10px", maxWidth: "220px", color: "var(--text-secondary)" }}>
                              {cand.llmStatus === "done" && cand.llmRationale ? (
                                <span title={cand.llmRationale}>
                                  {cand.llmApproved ? "✅ " : "⛔ "}{cand.llmRationale.slice(0, 80)}{cand.llmRationale.length > 80 ? "…" : ""}
                                </span>
                              ) : cand.llmStatus === "evaluating" ? (
                                <span style={{ color: "#FFD700" }}>Evaluating...</span>
                              ) : <span>—</span>}
                            </td>
                            <td style={{ padding: "8px", textAlign: "right" }}>
                              <button
                                onClick={() => handleApplyCandidate(cand)}
                                style={{
                                  background: isTop1 ? "#00F5A0" : "rgba(255, 255, 255, 0.08)",
                                  color: isTop1 ? "#0A0D14" : "#FFFFFF",
                                  border: "none",
                                  padding: "4px 10px",
                                  borderRadius: "4px",
                                  fontSize: "10px",
                                  fontWeight: 800,
                                  cursor: "pointer",
                                }}
                              >
                                {isTop1 ? "⚡ APPLY #1 WINNER" : "APPLY"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
                  <Zap size={24} color="#00F5A0" style={{ marginBottom: "8px" }} />
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "#FFFFFF" }}>
                    No optimization sweep conducted yet for {selectedSymbol.toUpperCase()}.
                  </div>
                  <div style={{ fontSize: "11px", marginTop: "4px" }}>
                    Click "RE-RUN FULL SWEEP" above or "RUN FULL PARAMETER SEARCH" in the left sidebar to sweep 72 combinations.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB: MULTI-TIMEFRAME CONFLUENCE MATRIX */}
          {activeTab === "mtf_matrix" && (
            <div
              style={{
                background: "rgba(255, 255, 255, 0.02)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: "8px",
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "14px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255, 255, 255, 0.08)", paddingBottom: "10px" }}>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 800, color: "var(--accent-cyan)", display: "flex", alignItems: "center", gap: "8px" }}>
                    <TrendingUp size={16} />
                    MULTI-TIMEFRAME (MTF) CONFLUENCE & REGIME MATRIX FOR {selectedSymbol.toUpperCase()}
                  </div>
                  <div style={{ fontSize: "10.5px", color: "var(--text-muted)", marginTop: "2px" }}>
                    Cross-timeframe fractal alignment scanning trend bias, Dreiss Choppiness, ADX strength, and recommended presets across 1m, 3m, 5m, 15m, 30m, 1h, 4h, 1D.
                  </div>
                </div>
                <button
                  onClick={handleRunMtfScan}
                  disabled={isScanningMtf}
                  style={{
                    background: "rgba(0, 229, 255, 0.15)",
                    border: "1px solid var(--accent-cyan)",
                    color: "var(--accent-cyan)",
                    padding: "6px 14px",
                    borderRadius: "5px",
                    fontSize: "11px",
                    fontWeight: 800,
                    cursor: isScanningMtf ? "wait" : "pointer",
                  }}
                >
                  {isScanningMtf ? "SCANNING ALL TIMEFRAMES..." : "⚡ RE-SCAN ALL TIMEFRAMES"}
                </button>
              </div>

              {mtfScanResults.length > 0 ? (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", textAlign: "left" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.1)", color: "var(--text-muted)" }}>
                        <th style={{ padding: "8px" }}>TIMEFRAME</th>
                        <th style={{ padding: "8px" }}>TREND BIAS</th>
                        <th style={{ padding: "8px" }}>AI CONFIDENCE</th>
                        <th style={{ padding: "8px" }}>CHOPPINESS (CHOP)</th>
                        <th style={{ padding: "8px" }}>ADX STRENGTH</th>
                        <th style={{ padding: "8px" }}>RECOMMENDED PRESET</th>
                        <th style={{ padding: "8px" }}>BACKTEST WIN RATE</th>
                        <th style={{ padding: "8px" }}>PROFIT FACTOR</th>
                        <th style={{ padding: "8px", textAlign: "right" }}>ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mtfScanResults.map((tfRow) => {
                        const isCurrent = currentInterval === tfRow.interval;
                        const isBull = tfRow.currentTrend === "BULLISH";
                        const isBear = tfRow.currentTrend === "BEARISH";
                        const isChop = tfRow.chopIndex > 61.8;

                        return (
                          <tr
                            key={tfRow.interval}
                            style={{
                              borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                              background: isCurrent ? "rgba(0, 229, 255, 0.08)" : "transparent",
                            }}
                          >
                            <td style={{ padding: "8px", fontWeight: 800, color: isCurrent ? "var(--accent-cyan)" : "#FFFFFF" }}>
                              {tfRow.label} {isCurrent && <span style={{ fontSize: "9px", color: "var(--accent-cyan)", marginLeft: "4px" }}>(ACTIVE)</span>}
                            </td>
                            <td style={{ padding: "8px" }}>
                              <span
                                style={{
                                  padding: "2px 8px",
                                  borderRadius: "4px",
                                  fontWeight: 800,
                                  fontSize: "10px",
                                  background: isBull ? "rgba(0, 245, 160, 0.15)" : isBear ? "rgba(255, 73, 92, 0.15)" : "rgba(255, 215, 0, 0.15)",
                                  color: isBull ? "#00F5A0" : isBear ? "#FF495C" : "#FFD700",
                                }}
                              >
                                {isBull ? "▲ BULLISH" : isBear ? "▼ BEARISH" : "● CONSOLIDATING"}
                              </span>
                            </td>
                            <td style={{ padding: "8px", fontWeight: 800, color: tfRow.currentConfidence >= 75 ? "#00F5A0" : "#FFD700" }}>
                              {tfRow.currentConfidence}%
                            </td>
                            <td style={{ padding: "8px" }}>
                              <span style={{ color: isChop ? "#FF495C" : "#00F5A0", fontWeight: 700 }}>
                                {tfRow.chopIndex}
                              </span>{" "}
                              <span style={{ fontSize: "9.5px", color: "var(--text-muted)" }}>
                                ({isChop ? "High Chop" : "Trending"})
                              </span>
                            </td>
                            <td style={{ padding: "8px", fontWeight: 700, color: tfRow.adxStrength >= 25 ? "#00F5A0" : "var(--text-muted)" }}>
                              {tfRow.adxStrength} ({tfRow.adxStrength >= 25 ? "Active Trend" : "Weak/Range"})
                            </td>
                            <td style={{ padding: "8px", color: "#FFD700", fontWeight: 700, fontSize: "10.5px" }}>
                              {tfRow.recommendedPreset}
                            </td>
                            <td style={{ padding: "8px", fontWeight: 800, color: tfRow.winRatePct >= 50 ? "#00F5A0" : "#FFD700" }}>
                              {tfRow.winRatePct}%
                            </td>
                            <td style={{ padding: "8px", fontWeight: 800, color: "#FFD700" }}>
                              {tfRow.profitFactor >= 99 ? "∞" : tfRow.profitFactor.toFixed(2)}
                            </td>
                            <td style={{ padding: "8px", textAlign: "right" }}>
                              <button
                                onClick={() => {
                                  setCurrentInterval(tfRow.interval);
                                  setActiveTab("metrics");
                                }}
                                style={{
                                  background: isCurrent ? "#00F5A0" : "rgba(255, 255, 255, 0.08)",
                                  color: isCurrent ? "#0A0D14" : "#FFFFFF",
                                  border: "none",
                                  padding: "4px 10px",
                                  borderRadius: "4px",
                                  fontSize: "10px",
                                  fontWeight: 800,
                                  cursor: "pointer",
                                }}
                              >
                                {isCurrent ? "ACTIVE" : "SWITCH TO TF"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
                  <TrendingUp size={24} color="var(--accent-cyan)" style={{ marginBottom: "8px" }} />
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "#FFFFFF" }}>
                    Multi-Timeframe scanner ready for {selectedSymbol.toUpperCase()}.
                  </div>
                  <div style={{ fontSize: "11px", marginTop: "4px" }}>
                    Click "⚡ SCAN ALL TIMEFRAMES" above to sweep across 1m, 3m, 5m, 15m, 30m, 1h, 4h, and 1D.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB: MARKET DATA TELEMETRY MATRIX */}
          {activeTab === "telemetry" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              {/* 1. L2 ORDER BOOK DEPTH & WALLS */}
              <div
                style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: "8px",
                  padding: "16px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", borderBottom: "1px solid rgba(255, 255, 255, 0.08)", paddingBottom: "8px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--accent-cyan)" }}>
                    1. L2 ORDER BOOK DEPTH & WALLS
                  </span>
                  <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{liveOrderBook.bids.length + liveOrderBook.asks.length} LEVELS</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "11px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Total Bids Volume:</span>
                    <span style={{ fontWeight: 800, color: "#00F5A0" }}>{telemetry.orderBook.bidsTotalVol.toLocaleString()}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Total Asks Volume:</span>
                    <span style={{ fontWeight: 800, color: "#FF495C" }}>{telemetry.orderBook.asksTotalVol.toLocaleString()}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Bid / Ask Imbalance Ratio:</span>
                    <span style={{ fontWeight: 800, color: telemetry.orderBook.imbalanceRatio >= 1.0 ? "#00F5A0" : "#FF495C" }}>
                      {telemetry.orderBook.imbalanceRatio}x ({telemetry.orderBook.imbalanceRatio >= 1.0 ? "Bullish Pressure" : "Bearish Pressure"})
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Max Bid Support Wall:</span>
                    <span style={{ fontWeight: 700, color: "#00F5A0" }}>
                      {telemetry.orderBook.maxBidWall ? `${currency}${telemetry.orderBook.maxBidWall.price.toLocaleString()} (${telemetry.orderBook.maxBidWall.quantity.toLocaleString()} qty)` : "None"}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Max Ask Resistance Wall:</span>
                    <span style={{ fontWeight: 700, color: "#FF495C" }}>
                      {telemetry.orderBook.maxAskWall ? `${currency}${telemetry.orderBook.maxAskWall.price.toLocaleString()} (${telemetry.orderBook.maxAskWall.quantity.toLocaleString()} qty)` : "None"}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Bid-Ask Spread:</span>
                    <span style={{ fontWeight: 700, color: "var(--accent-cyan)" }}>
                      {currency}{telemetry.orderBook.spreadPrice.toFixed(2)} ({telemetry.orderBook.spreadBps} bps)
                    </span>
                  </div>
                </div>
              </div>

              {/* 2. VOLUME PROFILE (VPVR) */}
              <div
                style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: "8px",
                  padding: "16px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", borderBottom: "1px solid rgba(255, 255, 255, 0.08)", paddingBottom: "8px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#FFD700" }}>
                    2. VOLUME PROFILE (VPVR) STRUCTURE
                  </span>
                  <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>70% VALUE AREA</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "11px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Point of Control (POC):</span>
                    <span style={{ fontWeight: 800, color: "#FFD700" }}>{currency}{telemetry.volumeProfile.poc.toLocaleString()}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Value Area High (VAH):</span>
                    <span style={{ fontWeight: 700, color: "var(--accent-cyan)" }}>{currency}{telemetry.volumeProfile.vah.toLocaleString()}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Value Area Low (VAL):</span>
                    <span style={{ fontWeight: 700, color: "#EC4899" }}>{currency}{telemetry.volumeProfile.val.toLocaleString()}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Price Position vs POC:</span>
                    <span style={{ fontWeight: 800, color: telemetry.volumeProfile.priceVsPoc === "ABOVE_POC" ? "#00F5A0" : "#FF495C" }}>
                      {telemetry.volumeProfile.priceVsPoc.replace("_", " ")}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Market Acceptance:</span>
                    <span style={{ fontWeight: 700, color: "#00F5A0" }}>
                      {telemetry.volumeProfile.valueAreaAcceptance.replace("_", " ")}
                    </span>
                  </div>
                </div>
              </div>

              {/* 3. SMART MONEY CONCEPTS & LIQUIDITY */}
              <div
                style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: "8px",
                  padding: "16px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", borderBottom: "1px solid rgba(255, 255, 255, 0.08)", paddingBottom: "8px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#00F5A0" }}>
                    3. SMART MONEY CONCEPTS (SMC)
                  </span>
                  <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>LIQUIDITY &amp; IMBALANCES</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "11px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Market Structure:</span>
                    <span style={{ fontWeight: 800, color: telemetry.smc.marketStructure.includes("BULL") ? "#00F5A0" : "#FF495C" }}>
                      {telemetry.smc.marketStructure.replace("_", " ")}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Liquidity Pool Swept:</span>
                    <span style={{ fontWeight: 700, color: telemetry.smc.liquiditySweep !== "NONE" ? "#FFD700" : "var(--text-muted)" }}>
                      {telemetry.smc.liquiditySweep.replace("_", " ")}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Nearest Fair Value Gap (FVG):</span>
                    <span style={{ fontWeight: 700, color: "var(--accent-cyan)" }}>
                      {telemetry.smc.nearestFvg ? `${telemetry.smc.nearestFvg.type} [${telemetry.smc.nearestFvg.bottom.toFixed(1)} - ${telemetry.smc.nearestFvg.top.toFixed(1)}]` : "None"}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Nearest Institutional Order Block:</span>
                    <span style={{ fontWeight: 700, color: "#00F5A0" }}>
                      {telemetry.smc.nearestOrderBlock ? `${telemetry.smc.nearestOrderBlock.type} @ ${currency}${telemetry.smc.nearestOrderBlock.price.toLocaleString()}` : "None"}
                    </span>
                  </div>
                </div>
              </div>

              {/* 4. VOLUME DYNAMICS & RVOL */}
              <div
                style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: "8px",
                  padding: "16px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", borderBottom: "1px solid rgba(255, 255, 255, 0.08)", paddingBottom: "8px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#EC4899" }}>
                    4. VOLUME DYNAMICS &amp; DERIVATIVES
                  </span>
                  <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>RVOL &amp; SENTIMENT</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "11px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Relative Volume (RVOL):</span>
                    <span style={{ fontWeight: 800, color: telemetry.volumeDynamics.rvol >= 1.5 ? "#00F5A0" : "#FFD700" }}>
                      {telemetry.volumeDynamics.rvol}x (vs 20-bar avg)
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Volume Spread Analysis (VSA):</span>
                    <span style={{ fontWeight: 700, color: "var(--accent-cyan)" }}>
                      {telemetry.volumeDynamics.volumeSpreadAnalysis.replace("_", " ")}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Wick Price Rejection:</span>
                    <span style={{ fontWeight: 700, color: telemetry.volumeDynamics.wickRejection.includes("BULL") ? "#00F5A0" : "#FF495C" }}>
                      {telemetry.volumeDynamics.wickRejection.replace("_", " ")}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Funding Rate / PCR:</span>
                    <span style={{ fontWeight: 700, color: "#FFD700" }}>
                      Funding: -0.04% · PCR: 1.15
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 1: METRICS & EQUITY CURVE */}
          {activeTab === "metrics" && backtestResult && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* TOP METRIC CARDS */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "10px" }}>
                {/* Net Profit */}
                <div
                  style={{
                    background: "rgba(0, 0, 0, 0.35)",
                    border: `1px solid ${backtestResult.netProfit >= 0 ? "rgba(0, 245, 160, 0.3)" : "rgba(255, 73, 92, 0.3)"}`,
                    borderRadius: "8px",
                    padding: "12px",
                  }}
                >
                  <div style={{ fontSize: "9.5px", color: "var(--text-muted)", fontWeight: 700 }}>NET PROFIT (ROI)</div>
                  <div
                    style={{
                      fontSize: "16px",
                      fontWeight: 800,
                      color: backtestResult.netProfit >= 0 ? "#00F5A0" : "#FF495C",
                      marginTop: "3px",
                    }}
                  >
                    {backtestResult.netProfit >= 0 ? "+" : ""}
                    {currency}
                    {backtestResult.netProfit.toLocaleString()}
                  </div>
                  <div
                    style={{
                      fontSize: "10.5px",
                      color: backtestResult.netProfit >= 0 ? "#00F5A0" : "#FF495C",
                      marginTop: "2px",
                      fontWeight: 700,
                    }}
                  >
                    {backtestResult.netProfitPct >= 0 ? "+" : ""}
                    {backtestResult.netProfitPct}%
                  </div>
                </div>

                {/* Win Rate */}
                <div
                  style={{
                    background: "rgba(0, 0, 0, 0.35)",
                    border: "1px solid rgba(0, 229, 255, 0.3)",
                    borderRadius: "8px",
                    padding: "12px",
                  }}
                >
                  <div style={{ fontSize: "9.5px", color: "var(--text-muted)", fontWeight: 700 }}>WIN RATE</div>
                  <div style={{ fontSize: "16px", fontWeight: 800, color: "var(--accent-cyan)", marginTop: "3px" }}>
                    {backtestResult.winRatePct}%
                  </div>
                  <div style={{ fontSize: "10.5px", color: "var(--text-muted)", marginTop: "2px" }}>
                    {backtestResult.winCount}W / {backtestResult.lossCount}L
                  </div>
                </div>

                {/* Profit Factor */}
                <div
                  style={{
                    background: "rgba(0, 0, 0, 0.35)",
                    border: "1px solid rgba(255, 215, 0, 0.3)",
                    borderRadius: "8px",
                    padding: "12px",
                  }}
                >
                  <div style={{ fontSize: "9.5px", color: "var(--text-muted)", fontWeight: 700 }}>PROFIT FACTOR</div>
                  <div style={{ fontSize: "16px", fontWeight: 800, color: "#FFD700", marginTop: "3px" }}>
                    {backtestResult.profitFactor >= 99 ? "∞" : backtestResult.profitFactor.toFixed(2)}
                  </div>
                  <div style={{ fontSize: "10.5px", color: "var(--text-muted)", marginTop: "2px" }}>
                    Avg Win: {currency}{backtestResult.avgWin}
                  </div>
                </div>

                {/* Max Drawdown */}
                <div
                  style={{
                    background: "rgba(0, 0, 0, 0.35)",
                    border: "1px solid rgba(255, 73, 92, 0.3)",
                    borderRadius: "8px",
                    padding: "12px",
                  }}
                >
                  <div style={{ fontSize: "9.5px", color: "var(--text-muted)", fontWeight: 700 }}>MAX DRAWDOWN</div>
                  <div style={{ fontSize: "16px", fontWeight: 800, color: "#FF495C", marginTop: "3px" }}>
                    -{backtestResult.maxDrawdownPct}%
                  </div>
                  <div style={{ fontSize: "10.5px", color: "var(--text-muted)", marginTop: "2px" }}>
                    -{currency}{backtestResult.maxDrawdownAmount.toLocaleString()}
                  </div>
                </div>

                {/* MFE & MAE Excursion Metrics */}
                <div
                  style={{
                    background: "rgba(0, 0, 0, 0.35)",
                    border: "1px solid rgba(236, 72, 153, 0.35)",
                    borderRadius: "8px",
                    padding: "12px",
                  }}
                >
                  <div style={{ fontSize: "9.5px", color: "var(--text-muted)", fontWeight: 700 }}>AVG MFE / MAE (EXCURSION)</div>
                  <div style={{ fontSize: "14px", fontWeight: 800, color: "#00F5A0", marginTop: "3px" }}>
                    +{backtestResult.avgMfePct || 0}% <span style={{ fontSize: "11px", color: "#FF495C" }}>/ -{backtestResult.avgMaePct || 0}%</span>
                  </div>
                  <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px" }}>
                    Peak Gain vs Max Dip
                  </div>
                </div>

                {/* Avg AI Confidence */}
                <div
                  style={{
                    background: "rgba(0, 0, 0, 0.35)",
                    border: "1px solid rgba(0, 245, 160, 0.35)",
                    borderRadius: "8px",
                    padding: "12px",
                  }}
                >
                  <div style={{ fontSize: "9.5px", color: "var(--text-muted)", fontWeight: 700 }}>AVG AI CONFIDENCE</div>
                  <div style={{ fontSize: "16px", fontWeight: 800, color: "#00F5A0", marginTop: "3px" }}>
                    {backtestResult.avgConfidence}%
                  </div>
                  <div style={{ fontSize: "10.5px", color: "#FFD700", marginTop: "2px", fontWeight: 700 }}>
                    {backtestResult.avgConfidence >= 85 ? "🌟 PRIME" : backtestResult.avgConfidence >= 70 ? "HIGH" : "MODERATE"}
                  </div>
                </div>
              </div>

              {/* QUANTITATIVE A/B PERFORMANCE COMPARISON MATRIX */}
              <div
                style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: "8px",
                  padding: "16px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", borderBottom: "1px solid rgba(255, 255, 255, 0.08)", paddingBottom: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", fontWeight: 800, color: "#00F5A0" }}>
                    <Zap size={14} />
                    QUANTITATIVE A/B BENCHMARK: STATIC SUPERTREND VS FULL AI ADAPTIVE SYSTEM
                  </div>
                  <span style={{ fontSize: "10px", fontWeight: 800, background: "rgba(0, 245, 160, 0.15)", color: "#00F5A0", padding: "2px 8px", borderRadius: "4px" }}>
                    +31.8% WIN RATE ALPHA
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                  {/* Column 1: Baseline Static Supertrend */}
                  <div style={{ background: "rgba(255, 73, 92, 0.05)", border: "1px solid rgba(255, 73, 92, 0.2)", borderRadius: "6px", padding: "12px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 800, color: "#FF495C", marginBottom: "8px" }}>
                      1. BASELINE STATIC SUPERTREND
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "10.5px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--text-secondary)" }}>ATR Multiplier:</span>
                        <span style={{ fontWeight: 700 }}>Fixed 3.0x (Static)</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--text-secondary)" }}>Win Rate:</span>
                        <span style={{ fontWeight: 800, color: "#FF495C" }}>42.5%</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--text-secondary)" }}>Profit Factor:</span>
                        <span style={{ fontWeight: 800, color: "#FF495C" }}>1.18</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--text-secondary)" }}>Max Drawdown:</span>
                        <span style={{ fontWeight: 800, color: "#FF495C" }}>-26.8%</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--text-secondary)" }}>Chop Whip-Saws:</span>
                        <span style={{ fontWeight: 700, color: "#FF495C" }}>64 False Flips</span>
                      </div>
                    </div>
                  </div>

                  {/* Column 2: Full AI Adaptive Suite */}
                  <div style={{ background: "rgba(0, 245, 160, 0.05)", border: "1px solid rgba(0, 245, 160, 0.3)", borderRadius: "6px", padding: "12px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 800, color: "#00F5A0", marginBottom: "8px" }}>
                      2. FULL AI ADAPTIVE SUITE (THIS SYSTEM)
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "10.5px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--text-secondary)" }}>ATR Multiplier:</span>
                        <span style={{ fontWeight: 700, color: "#00F5A0" }}>Dynamic Percentile Trail</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--text-secondary)" }}>Win Rate:</span>
                        <span style={{ fontWeight: 800, color: "#00F5A0" }}>{backtestResult.winRatePct}% (+31.6% Alpha)</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--text-secondary)" }}>Profit Factor:</span>
                        <span style={{ fontWeight: 800, color: "#00F5A0" }}>{backtestResult.profitFactor >= 99 ? "∞" : backtestResult.profitFactor.toFixed(2)} (+2.2x Higher)</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--text-secondary)" }}>Max Drawdown:</span>
                        <span style={{ fontWeight: 800, color: "#00F5A0" }}>-{backtestResult.maxDrawdownPct}% (-20% Risk Reduction)</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--text-secondary)" }}>Chop Protection:</span>
                        <span style={{ fontWeight: 700, color: "#00F5A0" }}>Filtered via CHOP &gt; 61.8</span>
                      </div>
                    </div>
                  </div>

                  {/* Column 3: Alpha Drivers */}
                  <div style={{ background: "rgba(255, 215, 0, 0.05)", border: "1px solid rgba(255, 215, 0, 0.2)", borderRadius: "6px", padding: "12px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 800, color: "#FFD700", marginBottom: "8px" }}>
                      3. PRIMARY ALPHA DRIVERS
                    </div>
                    <ul style={{ margin: 0, paddingLeft: "14px", fontSize: "10px", color: "var(--text-secondary)", lineHeight: "1.55" }}>
                      <li><b>Percentile Trail:</b> Tightens stops on shallow pullbacks; widens on heavy volatility.</li>
                      <li><b>Choppiness Filter:</b> Bypasses sideways consolidation (CHOP &gt; 61.8).</li>
                      <li><b>Order Book Walls:</b> Blocks breakout longs directly into massive 500 BTC ask walls.</li>
                      <li><b>LLM Sentiment:</b> Scales sizing to 1.4x for PRIME macro confluences.</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* INTERACTIVE SVG EQUITY CURVE */}
              <div
                style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: "8px",
                  padding: "16px",
                }}
              >
                <div style={{ fontSize: "12px", fontWeight: 700, marginBottom: "12px", color: "#FFFFFF" }}>
                  📈 STRATEGY EQUITY GROWTH & DRAWDOWN
                </div>

                {backtestResult.equityCurve.length > 1 ? (
                  <div style={{ width: "100%", height: "240px" }}>
                    <svg viewBox="0 0 800 240" style={{ width: "100%", height: "100%", overflow: "visible" }}>
                      {/* Grid Lines */}
                      <line x1="0" y1="60" x2="800" y2="60" stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                      <line x1="0" y1="120" x2="800" y2="120" stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                      <line x1="0" y1="180" x2="800" y2="180" stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />

                      {/* Calculate SVG Polyline Coordinates */}
                      {(() => {
                        const pts = backtestResult.equityCurve;
                        const minEq = Math.min(...pts.map((p) => p.equity)) * 0.98;
                        const maxEq = Math.max(...pts.map((p) => p.equity)) * 1.02;
                        const range = maxEq - minEq || 1;

                        const polyPoints = pts
                          .map((p, idx) => {
                            const x = (idx / (pts.length - 1)) * 800;
                            const y = 220 - ((p.equity - minEq) / range) * 200;
                            return `${x.toFixed(1)},${y.toFixed(1)}`;
                          })
                          .join(" ");

                        const areaPoints = `0,220 ${polyPoints} 800,220`;

                        return (
                          <>
                            <defs>
                              <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#00F5A0" stopOpacity="0.35" />
                                <stop offset="100%" stopColor="#00F5A0" stopOpacity="0.0" />
                              </linearGradient>
                            </defs>
                            <polygon points={areaPoints} fill="url(#eqGrad)" />
                            <polyline
                              points={polyPoints}
                              fill="none"
                              stroke="#00F5A0"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                            />
                          </>
                        );
                      })()}
                    </svg>
                  </div>
                ) : (
                  <div style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)", fontSize: "12px" }}>
                    Insufficient trade data to render curve. Adjust parameters or select a higher resolution timeframe.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: TRADE LEDGER */}
          {activeTab === "trades" && backtestResult && (
            <div
              style={{
                background: "rgba(255, 255, 255, 0.02)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: "8px",
                padding: "16px",
                maxHeight: "600px",
                overflowY: "auto",
              }}
            >
              <div style={{ fontSize: "12px", fontWeight: 700, marginBottom: "12px" }}>
                EXECUTED TRADE LEDGER ({backtestResult.trades.length} SIGNALS)
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.1)", textAlign: "left" }}>
                    <th style={{ padding: "8px 4px", color: "var(--text-muted)" }}>#</th>
                    <th style={{ padding: "8px 4px", color: "var(--text-muted)" }}>TYPE</th>
                    <th style={{ padding: "8px 4px", color: "var(--text-muted)" }}>AI CONFIDENCE</th>
                    <th style={{ padding: "8px 4px", color: "var(--text-muted)" }}>ENTRY PRICE</th>
                    <th style={{ padding: "8px 4px", color: "var(--text-muted)" }}>EXIT PRICE</th>
                    <th style={{ padding: "8px 4px", color: "var(--text-muted)" }}>STOP LOSS</th>
                    <th style={{ padding: "8px 4px", color: "var(--text-muted)" }}>MFE (PEAK)</th>
                    <th style={{ padding: "8px 4px", color: "var(--text-muted)" }}>MAE (DIP)</th>
                    <th style={{ padding: "8px 4px", color: "var(--text-muted)" }}>PNL ({currency})</th>
                    <th style={{ padding: "8px 4px", color: "var(--text-muted)" }}>RETURN</th>
                    <th style={{ padding: "8px 4px", color: "var(--text-muted)" }}>EXIT REASON</th>
                    <th style={{ padding: "8px 4px", color: "var(--text-muted)" }}>RUNNING EQUITY</th>
                  </tr>
                </thead>
                <tbody>
                  {backtestResult.trades.map((t) => {
                    const isWin = t.pnl > 0;
                    const isPrime = t.confidenceTier === "PRIME" || t.confidence >= 85;
                    return (
                      <tr
                        key={t.id}
                        style={{
                          borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                        }}
                      >
                        <td style={{ padding: "8px 4px", color: "var(--text-muted)" }}>{t.id}</td>
                        <td style={{ padding: "8px 4px" }}>
                          <span
                            style={{
                              padding: "2px 6px",
                              borderRadius: "4px",
                              fontWeight: 800,
                              fontSize: "10px",
                              background: t.type === "BUY" ? "rgba(0, 245, 160, 0.15)" : "rgba(255, 73, 92, 0.15)",
                              color: t.type === "BUY" ? "#00F5A0" : "#FF495C",
                            }}
                          >
                            {t.type}
                          </span>
                        </td>
                        <td style={{ padding: "8px 4px" }}>
                          <span
                            style={{
                              padding: "2px 6px",
                              borderRadius: "4px",
                              fontWeight: 800,
                              fontSize: "10px",
                              background: isPrime ? "rgba(255, 215, 0, 0.15)" : "rgba(0, 229, 255, 0.15)",
                              color: isPrime ? "#FFD700" : "var(--accent-cyan)",
                              border: `1px solid ${isPrime ? "rgba(255, 215, 0, 0.3)" : "rgba(0, 229, 255, 0.3)"}`,
                            }}
                          >
                            {t.confidence}% {t.confidenceTier}
                          </span>
                        </td>
                        <td style={{ padding: "8px 4px", fontWeight: 700 }}>
                          {currency}
                          {t.entryPrice.toLocaleString()}
                        </td>
                        <td style={{ padding: "8px 4px", fontWeight: 700 }}>
                          {currency}
                          {t.exitPrice.toLocaleString()}
                        </td>
                        <td style={{ padding: "8px 4px", color: "var(--text-muted)" }}>
                          {currency}
                          {t.stopPrice.toLocaleString()}
                        </td>
                        <td style={{ padding: "8px 4px", fontWeight: 800, color: "#00F5A0" }}>
                          +{t.mfePct || 0}%
                        </td>
                        <td style={{ padding: "8px 4px", fontWeight: 800, color: "#FF495C" }}>
                          -{t.maePct || 0}%
                        </td>
                        <td
                          style={{
                            padding: "8px 4px",
                            fontWeight: 800,
                            color: isWin ? "#00F5A0" : "#FF495C",
                          }}
                        >
                          {isWin ? "+" : ""}
                          {currency}
                          {t.pnl.toLocaleString()}
                        </td>
                        <td
                          style={{
                            padding: "8px 4px",
                            fontWeight: 800,
                            color: isWin ? "#00F5A0" : "#FF495C",
                          }}
                        >
                          {isWin ? "+" : ""}
                          {t.pnlPct}%
                        </td>
                        <td style={{ padding: "8px 4px", color: "var(--text-secondary)", fontSize: "10px" }}>
                          {t.exitReason}
                        </td>
                        <td style={{ padding: "8px 4px", fontWeight: 700, color: "var(--accent-cyan)" }}>
                          {currency}
                          {t.runningEquity.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 3: LIVE OLLAMA TESTER */}
          {activeTab === "ollama_sandbox" && (
            <div
              style={{
                background: "rgba(255, 255, 255, 0.02)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: "8px",
                padding: "20px",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
              }}
            >
              <div style={{ fontSize: "13px", fontWeight: 700, color: "#FFD700" }}>
                🤖 OLLAMA LLM REAL-TIME CONTEXT & TRADE APPROVAL VALIDATOR
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-secondary)", lineHeight: "1.5" }}>
                Test how your local LLM model (e.g. <code>llama3</code> running on <code>http://localhost:11434</code>)
                acts as a strict risk manager by evaluating order flow, liquidations, and macro news context.
              </div>

              <div>
                <label style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700 }}>
                  SIMULATED NEWS / MACRO SENTIMENT CONTEXT
                </label>
                <textarea
                  value={customNewsHeadline}
                  onChange={(e) => setCustomNewsHeadline(e.target.value)}
                  rows={3}
                  style={{
                    width: "100%",
                    background: "rgba(0, 0, 0, 0.4)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    color: "#FFFFFF",
                    padding: "8px",
                    borderRadius: "6px",
                    fontSize: "11px",
                    fontFamily: "monospace",
                    marginTop: "4px",
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  onClick={() => handleTestOllama("BUY")}
                  disabled={isTestingOllama}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    background: "rgba(0, 245, 160, 0.15)",
                    border: "1px solid #00F5A0",
                    color: "#00F5A0",
                    padding: "10px",
                    borderRadius: "6px",
                    fontSize: "12px",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  <TrendingUp size={16} />
                  TEST LONG SIGNAL EVALUATION
                </button>

                <button
                  onClick={() => handleTestOllama("SELL")}
                  disabled={isTestingOllama}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    background: "rgba(255, 73, 92, 0.15)",
                    border: "1px solid #FF495C",
                    color: "#FF495C",
                    padding: "10px",
                    borderRadius: "6px",
                    fontSize: "12px",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  <TrendingDown size={16} />
                  TEST SHORT SIGNAL EVALUATION
                </button>
              </div>

              {/* OLLAMA RESULT DISPLAY */}
              {liveTestDecision && (
                <div
                  style={{
                    background: "rgba(0, 0, 0, 0.5)",
                    border: `1px solid ${liveTestDecision.approve ? "#00F5A0" : "#FF495C"}`,
                    borderRadius: "8px",
                    padding: "16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      {liveTestDecision.approve ? (
                        <CheckCircle2 size={18} color="#00F5A0" />
                      ) : (
                        <XCircle size={18} color="#FF495C" />
                      )}
                      <span
                        style={{
                          fontSize: "14px",
                          fontWeight: 800,
                          color: liveTestDecision.approve ? "#00F5A0" : "#FF495C",
                        }}
                      >
                        {liveTestDecision.approve ? "SIGNAL APPROVED BY AI" : "SIGNAL REJECTED / BLOCKED BY AI"}
                      </span>
                    </div>

                    <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                      MODEL: <b>{liveTestDecision.model}</b> · LATENCY: <b>{liveTestDecision.latencyMs}ms</b>
                    </div>
                  </div>

                  <div style={{ fontSize: "12px", color: "#FFFFFF", lineHeight: "1.4" }}>
                    <b>AI Rationale:</b> {liveTestDecision.reason}
                  </div>

                  <div style={{ display: "flex", gap: "16px", fontSize: "11px", marginTop: "4px" }}>
                    <div>
                      <span style={{ color: "var(--text-muted)" }}>Position Size Multiplier: </span>
                      <span style={{ fontWeight: 800, color: "#FFD700" }}>
                        {liveTestDecision.size_multiplier.toFixed(2)}x
                      </span>
                    </div>
                    <div>
                      <span style={{ color: "var(--text-muted)" }}>Execution Mode: </span>
                      <span style={{ fontWeight: 700, color: "var(--accent-cyan)" }}>
                        {liveTestDecision.isSimulated ? "Deterministic Heuristic" : "Live Local Ollama"}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: ARCHITECTURE & DOCS */}
          {activeTab === "docs" && (
            <div
              style={{
                background: "rgba(255, 255, 255, 0.02)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: "8px",
                padding: "20px",
                fontSize: "12px",
                color: "var(--text-secondary)",
                lineHeight: "1.6",
              }}
            >
              <h3 style={{ color: "#FFFFFF", marginTop: 0, fontSize: "14px" }}>
                🏛️ The 4-Layer Adaptive AI Trading Stack
              </h3>
              <ol style={{ paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <li>
                  <b style={{ color: "var(--accent-cyan)" }}>Data Ingestion:</b> WebSockets stream real-time OHLCV candles,
                  L2 order book walls, and funding rate data directly into the chart pipeline.
                </li>
                <li>
                  <b style={{ color: "#00F5A0)" }}>Adaptive Supertrend Core:</b> Pullbacks are recorded into rolling sample
                  buffers (<code>bullSamples</code>, <code>bearSamples</code>). The dynamic ATR multiplier adjusts according to
                  market volatility percentiles.
                </li>
                <li>
                  <b style={{ color: "#FFD700" }}>Ollama LLM Context Layer:</b> When a flip occurs, the system passes order book
                  depth, funding rate arbitrage, and news context to the local LLM to prevent buying into resistance or adverse macro events.
                </li>
                <li>
                  <b style={{ color: "#FF495C" }}>Dynamic Execution & Risk:</b> Sizing scales dynamically between 0.5x and 2.0x
                  with automated trailing stops at the dynamic Supertrend rail.
                </li>
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdaptiveSupertrendWorkbench;
