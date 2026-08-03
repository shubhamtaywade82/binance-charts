import React, { useState, useEffect } from "react";
import { Activity, TrendingUp, TrendingDown, Layers, PieChart } from "lucide-react";

export const PositioningAnalyticsView: React.FC<{ symbol: string }> = ({ symbol }) => {
  const [intel, setIntel] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchIntel = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/futures/intel?symbol=${symbol}`);
        const json = await res.json();
        if (json.data) setIntel(json.data);
      } catch (e) {
        console.error("Intel fetch error:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchIntel();
  }, [symbol]);

  const longPct = intel?.longShortRatio?.longPct || 54.2;
  const shortPct = intel?.longShortRatio?.shortPct || 45.8;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "20px" }} className="glass-panel">
      <div style={{ fontSize: "16px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
        <Activity size={20} color="var(--accent-cyan)" />
        Futures Open Interest & Funding Rate Intel ({(symbol || "btcusdt").toUpperCase()})
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "14px" }}>
        <div className="glass-card" style={{ padding: "16px", borderRadius: "8px" }}>
          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>OPEN INTEREST (CONTRACTS)</div>
          <div style={{ fontSize: "22px", fontWeight: 800, color: "var(--accent-cyan)" }}>
            {intel ? intel.openInterest.toLocaleString() : "..."}
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "4px" }}>
            Notional: ${intel ? intel.openInterestUsdt.toLocaleString() : "0"} USDT
          </div>
        </div>

        <div className="glass-card" style={{ padding: "16px", borderRadius: "8px" }}>
          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>FUNDING RATE (8h)</div>
          <div style={{ fontSize: "22px", fontWeight: 800, color: (intel?.fundingRatePct || 0) >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
            {intel ? (intel.fundingRatePct >= 0 ? `+${intel.fundingRatePct}%` : `${intel.fundingRatePct}%`) : "..."}
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "4px" }}>
            {(intel?.fundingRatePct || 0) >= 0 ? "Longs pay Shorts" : "Shorts pay Longs"}
          </div>
        </div>

        <div className="glass-card" style={{ padding: "16px", borderRadius: "8px" }}>
          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>LONG / SHORT RATIO</div>
          <div style={{ fontSize: "22px", fontWeight: 800, color: "#FFD700" }}>
            {intel?.longShortRatio?.ratio || 1.18}
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "4px" }}>
            Accounts Ratio
          </div>
        </div>
      </div>

      <div className="glass-card" style={{ padding: "20px", borderRadius: "10px" }}>
        <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "12px" }}>
          Market Sentiment & Positioning Distribution
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", fontWeight: 700 }}>
            <span style={{ color: "var(--accent-green)" }}>LONGS: {longPct}%</span>
            <span style={{ color: "var(--accent-red)" }}>SHORTS: {shortPct}%</span>
          </div>
          <div style={{ height: "10px", width: "100%", background: "var(--accent-red)", borderRadius: "5px", overflow: "hidden", display: "flex" }}>
            <div style={{ width: `${longPct}%`, height: "100%", background: "var(--accent-green)" }} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default PositioningAnalyticsView;
