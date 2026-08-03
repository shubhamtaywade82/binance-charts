import React, { useState, useEffect } from "react";
import { Play, TrendingUp, TrendingDown, DollarSign, Activity, Shield, RefreshCw } from "lucide-react";

export const FuturesBacktestWorkbench: React.FC<{ symbol: string }> = ({ symbol }) => {
  const [selectedSymbol, setSelectedSymbol] = useState(symbol || "btcusdt");
  const [interval, setInterval] = useState("15m");
  const [leverage, setLeverage] = useState(10);
  const [riskPct, setRiskPct] = useState(2);
  const [takeProfitR, setTakeProfitR] = useState(2.0);
  const [stopLossPct, setStopLossPct] = useState(1.5);
  const [initialBalance, setInitialBalance] = useState(10000);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    setSelectedSymbol(symbol || "btcusdt");
  }, [symbol]);

  const runBacktest = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/futures/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: selectedSymbol,
          interval,
          leverage,
          riskPct,
          takeProfitR,
          stopLossPct,
          initialBalance,
        }),
      });
      const json = await res.json();
      if (json.data) setResult(json.data);
    } catch (e) {
      console.error("Backtest error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runBacktest();
  }, [selectedSymbol, interval, leverage]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "20px" }} className="glass-panel">
      {/* 1. Control Bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
            <Activity size={20} color="var(--accent-green)" />
            Crypto Futures Quantitative Backtest Workbench
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
            Backtest SMC & ICT Smart Money setups on USD-M Futures with leverage & risk controls.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <select
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-color)", color: "#fff", padding: "6px 10px", borderRadius: "6px", fontSize: "12px" }}
          >
            <option value="1m">1m Timeframe</option>
            <option value="5m">5m Timeframe</option>
            <option value="15m">15m Timeframe</option>
            <option value="1h">1h Timeframe</option>
          </select>

          <select
            value={leverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-color)", color: "#fff", padding: "6px 10px", borderRadius: "6px", fontSize: "12px" }}
          >
            <option value={1}>1x Leverage (Spot)</option>
            <option value={5}>5x Leverage</option>
            <option value={10}>10x Leverage</option>
            <option value={20}>20x Leverage</option>
            <option value={50}>50x Leverage</option>
          </select>

          <button
            onClick={runBacktest}
            disabled={loading}
            style={{ background: "var(--accent-green)", color: "#0A0D14", border: "none", padding: "8px 16px", borderRadius: "6px", fontSize: "12px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
            <span>RUN BACKTEST</span>
          </button>
        </div>
      </div>

      {/* 2. Metrics Cards */}
      {result && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
          <div className="glass-card" style={{ padding: "14px", borderRadius: "8px" }}>
            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>NET REALIZED PNL</div>
            <div style={{ fontSize: "20px", fontWeight: 800, color: result.netPnlUsdt >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
              {result.netPnlUsdt >= 0 ? "+" : ""}${result.netPnlUsdt.toLocaleString()}
            </div>
            <div style={{ fontSize: "10px", color: "var(--text-secondary)", marginTop: "4px" }}>
              Final: ${result.finalBalance.toLocaleString()}
            </div>
          </div>

          <div className="glass-card" style={{ padding: "14px", borderRadius: "8px" }}>
            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>WIN RATE</div>
            <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--accent-cyan)" }}>
              {result.winRatePct}%
            </div>
            <div style={{ fontSize: "10px", color: "var(--text-secondary)", marginTop: "4px" }}>
              {result.winnersCount} W / {result.losersCount} L ({result.totalTrades} total)
            </div>
          </div>

          <div className="glass-card" style={{ padding: "14px", borderRadius: "8px" }}>
            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>PROFIT FACTOR</div>
            <div style={{ fontSize: "20px", fontWeight: 800, color: "#FFD700" }}>
              {result.profitFactor}
            </div>
            <div style={{ fontSize: "10px", color: "var(--text-secondary)", marginTop: "4px" }}>
              Gross Win / Gross Loss
            </div>
          </div>

          <div className="glass-card" style={{ padding: "14px", borderRadius: "8px" }}>
            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>MAX DRAWDOWN</div>
            <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--accent-red)" }}>
              -{result.maxDrawdownPct}%
            </div>
            <div style={{ fontSize: "10px", color: "var(--text-secondary)", marginTop: "4px" }}>
              Peak-to-Trough
            </div>
          </div>
        </div>
      )}

      {/* 3. Trade Log Table */}
      {result && result.trades && result.trades.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-secondary)" }}>
            Backtested Futures Trade History ({result.trades.length} trades)
          </div>
          <div style={{ overflowX: "auto", maxHeight: "350px", border: "1px solid var(--border-color)", borderRadius: "8px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", textAlign: "left" }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-muted)", borderBottom: "1px solid var(--border-color)" }}>
                  <th style={{ padding: "10px" }}>ID</th>
                  <th style={{ padding: "10px" }}>SIDE</th>
                  <th style={{ padding: "10px" }}>ENTRY</th>
                  <th style={{ padding: "10px" }}>EXIT</th>
                  <th style={{ padding: "10px" }}>MARGIN</th>
                  <th style={{ padding: "10px" }}>PNL (USDT)</th>
                  <th style={{ padding: "10px" }}>RETURN %</th>
                  <th style={{ padding: "10px" }}>REASON</th>
                </tr>
              </thead>
              <tbody>
                {result.trades.map((t: any) => (
                  <tr key={t.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                    <td style={{ padding: "10px", fontFamily: "var(--font-mono)" }}>{t.id}</td>
                    <td style={{ padding: "10px", fontWeight: 700, color: t.side === "LONG" ? "var(--accent-green)" : "var(--accent-red)" }}>
                      {t.side}
                    </td>
                    <td style={{ padding: "10px", fontFamily: "var(--font-mono)" }}>${t.entryPrice.toLocaleString()}</td>
                    <td style={{ padding: "10px", fontFamily: "var(--font-mono)" }}>${t.exitPrice.toLocaleString()}</td>
                    <td style={{ padding: "10px", fontFamily: "var(--font-mono)" }}>${t.margin.toFixed(2)}</td>
                    <td style={{ padding: "10px", fontWeight: 700, color: t.pnl >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
                      {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
                    </td>
                    <td style={{ padding: "10px", fontWeight: 700, color: t.returnPct >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
                      {t.returnPct >= 0 ? "+" : ""}{t.returnPct}%
                    </td>
                    <td style={{ padding: "10px", fontSize: "11px", color: "var(--text-muted)" }}>{t.exitReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
