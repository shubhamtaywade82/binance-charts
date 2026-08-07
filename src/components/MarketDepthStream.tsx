import React from "react";
import { Activity, ArrowDownRight, ArrowUpRight, BarChart2, ShieldAlert } from "lucide-react";
import { formatPriceDynamic, getPricePrecision } from "./TradingViewChart";

interface DepthLevel {
  price: number;
  quantity: number;
  orders: number;
}

interface MarketDepthProps {
  bids: DepthLevel[];
  asks: DepthLevel[];
  symbol: string;
}

export const MarketDepthStream: React.FC<MarketDepthProps> = ({ bids = [], asks = [], symbol }) => {
  // Calculate Totals & Max Quantities for Depth Bar percentage
  const totalBidQty = bids.reduce((sum, b) => sum + (b.quantity || 0), 0);
  const totalAskQty = asks.reduce((sum, a) => sum + (a.quantity || 0), 0);
  const totalQty = totalBidQty + totalAskQty || 1;

  const bidQtyPct = Math.round((totalBidQty / totalQty) * 100);
  const askQtyPct = 100 - bidQtyPct;

  const maxBidQty = Math.max(...bids.map((b) => b.quantity), 1);
  const maxAskQty = Math.max(...asks.map((a) => a.quantity), 1);

  const bestBid = bids[0]?.price || 0;
  const bestAsk = asks[0]?.price || 0;
  const spread = bestAsk > 0 && bestBid > 0 ? Math.max(0, bestAsk - bestBid) : 0;
  const pricePrec = getPricePrecision(bestAsk || bestBid || 1).precision;

  return (
    <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "12px", height: "100%", background: "var(--bg-surface)", borderLeft: "1px solid var(--border-color)", overflow: "hidden", whiteSpace: "nowrap" }}>
      {/* 1. Header & Live Indicator */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", whiteSpace: "nowrap", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", overflow: "hidden" }}>
          <Activity size={18} color="var(--accent-cyan)" style={{ flexShrink: 0 }} />
          <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, letterSpacing: "-0.3px", overflow: "hidden", textOverflow: "ellipsis" }}>
              20-Level Order Book Microstructure
            </div>
            <div style={{ fontSize: "10px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis" }}>
              Real-Time L2 Depth & Liquidity Clusters ({symbol.toUpperCase()})
            </div>
          </div>
        </div>
        <span className="mono" style={{ fontSize: "10px", padding: "3px 7px", borderRadius: "12px", background: "rgba(0,245,160,0.12)", color: "var(--accent-green)", fontWeight: 700, flexShrink: 0 }}>
          LIVE FEED
        </span>
      </div>

      {/* 2. Order Book Imbalance & Spread Bar */}
      <div className="glass-card" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "6px", whiteSpace: "nowrap", overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "10px", fontWeight: 600, whiteSpace: "nowrap", gap: "6px" }}>
          <span style={{ color: "var(--accent-green)", overflow: "hidden", textOverflow: "ellipsis" }} className="mono">
            BUY {bidQtyPct}% ({totalBidQty.toLocaleString("en-IN")})
          </span>
          <span style={{ color: "var(--text-muted)", flexShrink: 0 }} className="mono">
            SPREAD ${formatPriceDynamic(spread, pricePrec)}
          </span>
          <span style={{ color: "var(--accent-red)", overflow: "hidden", textOverflow: "ellipsis", textAlign: "right" }} className="mono">
            SELL {askQtyPct}% ({totalAskQty.toLocaleString("en-IN")})
          </span>
        </div>

        {/* Visual Dual Imbalance Bar */}
        <div style={{ height: "6px", width: "100%", background: "var(--bg-primary)", borderRadius: "3px", overflow: "hidden", display: "flex" }}>
          <div style={{ width: `${bidQtyPct}%`, height: "100%", background: "linear-gradient(90deg, #00F5A0 0%, #00E5FF 100%)", transition: "width 0.3s ease" }} />
          <div style={{ width: `${askQtyPct}%`, height: "100%", background: "linear-gradient(90deg, #FF495C 0%, #FF9800 100%)", transition: "width 0.3s ease" }} />
        </div>
      </div>

      {/* 3. Dual Column Depth Table */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", flex: 1, fontSize: "11px", overflowX: "auto", overflowY: "auto", whiteSpace: "nowrap" }}>
        {/* Bids Side */}
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "36px 1fr 1fr", padding: "5px 6px", color: "var(--text-muted)", fontSize: "9px", fontWeight: 700, borderBottom: "1px solid var(--border-color)", background: "rgba(0,0,0,0.2)", whiteSpace: "nowrap" }}>
            <span>ORD</span>
            <span style={{ textAlign: "right" }}>BID QTY</span>
            <span style={{ textAlign: "right" }}>BID PRICE</span>
          </div>

          {bids.length > 0 ? (
            bids.slice(0, 10).map((b, idx) => {
              const barWidthPct = Math.round((b.quantity / maxBidQty) * 100);
              return (
                <div
                  key={idx}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "36px 1fr 1fr",
                    padding: "5px 6px",
                    position: "relative",
                    borderRadius: "4px",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                  }}
                >
                  {/* Depth Bar Background */}
                  <div
                    style={{
                      position: "absolute",
                      right: 0,
                      top: 0,
                      bottom: 0,
                      width: `${barWidthPct}%`,
                      background: "rgba(0, 245, 160, 0.14)",
                      transition: "width 0.2s ease",
                      pointerEvents: "none",
                    }}
                  />

                  <span style={{ color: "var(--text-muted)", zIndex: 1, overflow: "hidden", textOverflow: "ellipsis" }} className="mono">
                    {b.orders}
                  </span>
                  <span style={{ textAlign: "right", zIndex: 1, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }} className="mono">
                    {b.quantity.toLocaleString("en-IN")}
                  </span>
                  <span style={{ textAlign: "right", zIndex: 1, color: "var(--accent-green)", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }} className="mono">
                    {formatPriceDynamic(b.price, pricePrec)}
                  </span>
                </div>
              );
            })
          ) : (
            <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)" }}>Waiting for live bids...</div>
          )}
        </div>

        {/* Asks Side */}
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 36px", padding: "5px 6px", color: "var(--text-muted)", fontSize: "9px", fontWeight: 700, borderBottom: "1px solid var(--border-color)", background: "rgba(0,0,0,0.2)", whiteSpace: "nowrap" }}>
            <span>ASK PRICE</span>
            <span style={{ textAlign: "right" }}>ASK QTY</span>
            <span style={{ textAlign: "right" }}>ORD</span>
          </div>

          {asks.length > 0 ? (
            asks.slice(0, 10).map((a, idx) => {
              const barWidthPct = Math.round((a.quantity / maxAskQty) * 100);
              return (
                <div
                  key={idx}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 36px",
                    padding: "5px 6px",
                    position: "relative",
                    borderRadius: "4px",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                  }}
                >
                  {/* Depth Bar Background */}
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${barWidthPct}%`,
                      background: "rgba(255, 73, 92, 0.14)",
                      transition: "width 0.2s ease",
                      pointerEvents: "none",
                    }}
                  />

                  <span style={{ color: "var(--accent-red)", zIndex: 1, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }} className="mono">
                    {formatPriceDynamic(a.price, pricePrec)}
                  </span>
                  <span style={{ textAlign: "right", zIndex: 1, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }} className="mono">
                    {a.quantity.toLocaleString("en-IN")}
                  </span>
                  <span style={{ textAlign: "right", zIndex: 1, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis" }} className="mono">
                    {a.orders}
                  </span>
                </div>
              );
            })
          ) : (
            <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)" }}>Waiting for live asks...</div>
          )}
        </div>
      </div>
    </div>
  );
};
export default MarketDepthStream;
