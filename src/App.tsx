import React, { useEffect, useState } from "react";
import {
  Activity,
  BarChart2,
  Clock,
  DollarSign,
  Layers,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  TrendingUp,
  Zap,
} from "lucide-react";
import { TradingViewChart } from "./components/TradingViewChart";
import { MarketDepthStream } from "./components/MarketDepthStream";
import { FuturesBacktestWorkbench } from "./components/research/FuturesBacktestWorkbench";
import { PositioningAnalyticsView } from "./components/research/PositioningAnalyticsView";

interface TickData {
  symbol: string;
  securityId: string;
  ltp: number;
  change: number;
  pChange: number;
  volume: number;
  bids: Array<{ price: number; quantity: number; orders: number }>;
  asks: Array<{ price: number; quantity: number; orders: number }>;
  timestamp: string;
}

interface SessionInfo {
  isOpen: boolean;
  exchange: string;
  marketType: string;
  lastCompletedTradingDay: string;
}

export function App() {
  const [activeTab, setActiveTab] = useState<"terminal" | "backtest" | "intel" | "bias" | "portfolio">((): any => {
    return (localStorage.getItem("binance_activeTab") as any) || "terminal";
  });
  const [selectedSymbol, setSelectedSymbol] = useState(() => {
    return localStorage.getItem("binance_selectedSymbol") || "btcusdt";
  });
  const [selectedInterval, setSelectedInterval] = useState(() => {
    const saved = localStorage.getItem("binance_selectedInterval");
    return saved && ["1", "5", "15", "30", "60"].includes(saved) ? saved : "15";
  });

  // Collapsible Sidebar States
  const [showLeftSidebar, setShowLeftSidebar] = useState(() => {
    return localStorage.getItem("binance_showLeftSidebar") !== "false";
  });
  const [showDepthPanel, setShowDepthPanel] = useState(() => {
    return localStorage.getItem("binance_showDepthPanel") !== "false";
  });

  // Save selections to localStorage
  useEffect(() => {
    localStorage.setItem("binance_activeTab", activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem("binance_selectedSymbol", selectedSymbol);
  }, [selectedSymbol]);

  useEffect(() => {
    localStorage.setItem("binance_selectedInterval", selectedInterval);
  }, [selectedInterval]);

  useEffect(() => {
    localStorage.setItem("binance_showLeftSidebar", String(showLeftSidebar));
  }, [showLeftSidebar]);

  useEffect(() => {
    localStorage.setItem("binance_showDepthPanel", String(showDepthPanel));
  }, [showDepthPanel]);

  // Real-time tick & depth state
  const [tick, setTick] = useState<TickData | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const wsRef = React.useRef<WebSocket | null>(null);

  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "subscribe", symbol: selectedSymbol }));
    }
  }, [selectedSymbol]);

  // Data states
  const [funds, setFunds] = useState<any>(null);
  const [bias, setBias] = useState<any>(null);
  const [ledger, setLedger] = useState<any>(null);
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const [loading, setLoading] = useState(false);

  // 1. Poll Session Info & Connect WebSocket
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const res = await fetch("/api/session-info");
        const json = await res.json();
        if (json.session) setSession(json.session);
      } catch (e) {
        console.error("Session info fetch error:", e);
      }
    };

    fetchSession();
    const sessionTimer = setInterval(fetchSession, 10000);

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/feed`;
    let ws: WebSocket | null = null;
    let isCleanedUp = false;

    try {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => {
        if (!isCleanedUp) {
          setWsConnected(true);
          ws?.send(JSON.stringify({ type: "subscribe", symbol: selectedSymbol }));
        }
      };
      ws.onmessage = (event) => {
        if (isCleanedUp) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === "tick") {
            setTick(data);
          }
        } catch (e) {}
      };
      ws.onclose = () => {
        if (!isCleanedUp) setWsConnected(false);
      };
      ws.onerror = () => {
        if (!isCleanedUp) setWsConnected(false);
      };
    } catch (e) {
      setWsConnected(false);
    }

    return () => {
      isCleanedUp = true;
      clearInterval(sessionTimer);
      if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        } else {
          ws.onopen = () => ws?.close();
        }
      }
    };
  }, [selectedSymbol]);

  // Fetch tab-specific data on demand (Bias & Portfolio)
  useEffect(() => {
    if (activeTab === "bias") {
      fetchBias();
    } else if (activeTab === "portfolio") {
      fetchPortfolioAndLedger();
    }
  }, [activeTab, selectedSymbol]);

  const fetchBias = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/analysis/bias?symbol=${selectedSymbol}`);
      const json = await res.json();
      if (json.data) setBias(json.data);
    } catch (e) {
    } finally {
      setLoading(false);
    }
  };

  const fetchPortfolioAndLedger = async () => {
    setLoading(true);
    try {
      const fRes = await fetch("/api/funds");
      const fJson = await fRes.json();
      if (fJson.data) setFunds(fJson.data);

      const lRes = await fetch("/api/ledger");
      const lJson = await lRes.json();
      if (lJson.data) setLedger(lJson.data);

      const tcRes = await fetch("/api/trader-controls");
      const tcJson = await tcRes.json();
      if (tcJson.killSwitch) {
        setKillSwitchActive(tcJson.killSwitch.killSwitchStatus === "ACTIVATED");
      }
    } catch (e) {
    } finally {
      setLoading(false);
    }
  };

  const toggleKillSwitch = async () => {
    const nextState = killSwitchActive ? "DEACTIVATE" : "ACTIVATE";
    try {
      const res = await fetch("/api/trader-controls/killswitch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextState }),
      });
      const json = await res.json();
      if (json.status === "success") {
        setKillSwitchActive(!killSwitchActive);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Session badge — Binance USD-M futures trades 24/7
  const badge = { text: "LIVE 24/7 MARKET", class: "bg-green-glow" };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-primary)" }}>
      {/* 1. Header Bar */}
      <header className="glass-panel" style={{ borderRadius: 0, padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border-color)", zIndex: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          {/* Left Sidebar Toggle Button */}
          <button
            onClick={() => setShowLeftSidebar(!showLeftSidebar)}
            className="glass-card"
            title="Toggle Navigation Sidebar"
            style={{ padding: "6px", color: "var(--accent-cyan)", cursor: "pointer", display: "flex", alignItems: "center" }}
          >
            {showLeftSidebar ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: "linear-gradient(135deg, #00F5A0 0%, #00E5FF 100%)", display: "flex", alignItems: "center", justifyContent: "center", color: "#0A0D14" }}>
              <Zap size={20} strokeWidth={2.5} />
            </div>
            <div>
              <div style={{ fontSize: "16px", fontWeight: 700, letterSpacing: "-0.5px" }}>Binance Charts Pro Terminal</div>
              <div style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                binance-client-ts <span style={{ color: "var(--accent-green)" }}>v2.1.0</span>
              </div>
            </div>
          </div>

          {/* Symbol Selector */}
          <div style={{ display: "flex", background: "rgba(255,255,255,0.05)", borderRadius: "8px", padding: "3px" }}>
            {["btcusdt", "ethusdt", "solusdt", "bnbusdt", "xrpusdt", "dogeusdt"].map((sym) => (
              <button
                key={sym}
                onClick={() => setSelectedSymbol(sym)}
                style={{
                  background: selectedSymbol === sym ? "var(--bg-card)" : "transparent",
                  color: selectedSymbol === sym ? "var(--accent-cyan)" : "var(--text-secondary)",
                  border: selectedSymbol === sym ? "1px solid var(--border-hover)" : "none",
                  borderRadius: "5px",
                  padding: "5px 10px",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                  textTransform: "uppercase",
                }}
              >
                {sym}
              </button>
            ))}
          </div>
        </div>

        {/* Right Status Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          {/* Session Badge */}
          <div style={{ padding: "5px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }} className={badge.class}>
            <Clock size={13} />
            <span>{badge.text}</span>
            <span style={{ fontSize: "10px", opacity: 0.8 }} className="mono">
              ({session?.marketType || "CRYPTO_FUTURES_24X7"} · {new Date().toISOString().slice(11, 16)} UTC)
            </span>
          </div>

          {/* WebSocket Badge */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: wsConnected ? "var(--accent-green)" : "var(--accent-red)" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: wsConnected ? "var(--accent-green)" : "var(--accent-red)", boxShadow: wsConnected ? "0 0 10px #00F5A0" : "none" }} />
            <span className="mono">{wsConnected ? "STREAMING" : "OFFLINE"}</span>
          </div>

          {/* 20-Depth Toggle Button */}
          <button
            onClick={() => setShowDepthPanel(!showDepthPanel)}
            className="glass-card"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 12px",
              borderRadius: "6px",
              color: showDepthPanel ? "var(--accent-green)" : "var(--text-secondary)",
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {showDepthPanel ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
            <span>20-DEPTH PANEL</span>
          </button>

          {/* Kill Switch Toggle Button */}
          <button
            onClick={toggleKillSwitch}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 12px",
              borderRadius: "6px",
              background: killSwitchActive ? "rgba(255,73,92,0.2)" : "rgba(255,255,255,0.05)",
              border: killSwitchActive ? "1px solid var(--accent-red)" : "1px solid var(--border-color)",
              color: killSwitchActive ? "var(--accent-red)" : "var(--text-secondary)",
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <Lock size={14} />
            <span>{killSwitchActive ? "KILL ACTIVE" : "TRADER CONTROLS"}</span>
          </button>
        </div>
      </header>

      {/* 2. Main Flex Layout (Left Collapsible Nav + Main Content Area + Right Collapsible 20-Depth) */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left Collapsible Navigation Sidebar */}
        {showLeftSidebar && (
          <aside
            className="glass-panel"
            style={{
              width: "220px",
              borderRadius: 0,
              borderRight: "1px solid var(--border-color)",
              borderTop: "none",
              borderBottom: "none",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              padding: "16px 10px",
              zIndex: 10,
            }}
          >
            <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700, padding: "0 8px 8px 8px", letterSpacing: "0.5px" }}>
              TERMINAL VIEWS
            </div>

            {[
              { id: "terminal", label: "Real-Time Terminal", icon: BarChart2 },
              { id: "backtest", label: "Futures Backtest Workbench", icon: Activity },
              { id: "intel", label: "Futures Intel & OI", icon: Layers },
              { id: "bias", label: "Multi-Timeframe Bias", icon: TrendingUp },
              { id: "portfolio", label: "Account & Ledger", icon: DollarSign },
            ].map((t) => {
              const Icon = t.icon;
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id as any)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    background: isActive ? "rgba(0, 245, 160, 0.1)" : "transparent",
                    color: isActive ? "var(--accent-green)" : "var(--text-secondary)",
                    border: isActive ? "1px solid rgba(0, 245, 160, 0.3)" : "1px solid transparent",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.2s ease",
                  }}
                >
                  <Icon size={16} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </aside>
        )}

        {/* Center Main Dashboard Area */}
        <main style={{ flex: 1, padding: "16px 20px", display: "flex", flexDirection: "column", gap: "16px", overflowX: "hidden", minWidth: 0 }}>

          {/* TAB 1: TERMINAL & CHART WITH OPTIONAL RIGHT 20-DEPTH SIDEBAR */}
          {activeTab === "terminal" && (
            <div style={{ display: "grid", gridTemplateColumns: showDepthPanel ? "minmax(0, 1fr) 380px" : "minmax(0, 1fr)", gap: "16px", flex: 1, minHeight: "520px", minWidth: 0, width: "100%" }}>
              {/* Maximized Chart Canvas */}
              <div className="glass-panel" style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "10px", minWidth: 0, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: "13px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
                    <BarChart2 size={16} color="var(--accent-cyan)" />
                    <span>{selectedSymbol.toUpperCase()} Intraday Candlesticks (Auto-Date Normalization)</span>
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    {["1", "5", "15", "30", "60"].map((m) => (
                      <button
                        key={m}
                        onClick={() => setSelectedInterval(m)}
                        style={{
                          padding: "4px 8px",
                          fontSize: "11px",
                          fontWeight: 600,
                          borderRadius: "4px",
                          background: selectedInterval === m ? "var(--accent-cyan)" : "rgba(255,255,255,0.05)",
                          color: selectedInterval === m ? "#0A0D14" : "var(--text-secondary)",
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        {`${m}m`}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ flex: 1, minHeight: "520px" }}>
                  <TradingViewChart symbol={selectedSymbol} interval={selectedInterval} livePrice={tick?.ltp} tick={tick} />
                </div>
              </div>

              {/* Right Collapsible 20-Depth Panel */}
              {showDepthPanel && (
                <MarketDepthStream bids={tick?.bids || []} asks={tick?.asks || []} symbol={selectedSymbol} />
              )}
            </div>
          )}

          {/* TAB 2: FUTURES BACKTEST WORKBENCH */}
          {activeTab === "backtest" && (
            <FuturesBacktestWorkbench symbol={selectedSymbol} />
          )}

          {/* TAB 3: FUTURES MARKET INTEL & OPEN INTEREST */}
          {activeTab === "intel" && (
            <PositioningAnalyticsView symbol={selectedSymbol} />
          )}

          {/* TAB 4: TECHNICAL ANALYSIS MULTI-TIMEFRAME BIAS ENGINE */}
          {activeTab === "bias" && (
            <div className="glass-panel" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "20px" }}>
              <div style={{ fontSize: "16px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
                <TrendingUp size={18} color="var(--accent-green)" />
                <span>Multi-Timeframe Technical Bias Engine ({selectedSymbol.toUpperCase()})</span>
              </div>

              {loading ? (
                <div style={{ padding: "40px", textAlign: "center", color: "var(--accent-green)" }}>Computing Technical Indicators...</div>
              ) : bias ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "20px" }}>
                  <div className="glass-card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "12px", alignItems: "center", textAlign: "center" }}>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>DIRECTIONAL BIAS</span>
                    <div style={{ fontSize: "24px", fontWeight: 800, textTransform: "uppercase", color: bias.summary?.bias === "bullish" ? "var(--accent-green)" : "var(--accent-red)" }}>
                      {bias.summary?.bias || "NEUTRAL"}
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                      Setup: <span style={{ color: "white", fontWeight: 600 }}>{bias.summary?.setup}</span>
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                      Confidence Score: <span className="mono" style={{ color: "var(--accent-cyan)" }}>{((bias.summary?.confidence || 0) * 100).toFixed(1)}%</span>
                    </div>
                  </div>

                  <div className="glass-card" style={{ padding: "20px" }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "12px" }}>Timeframe Analysis Rationale:</div>
                    <pre className="mono" style={{ fontSize: "11px", color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>
                      {JSON.stringify(bias.rationale || bias, null, 2)}
                    </pre>
                  </div>
                </div>
              ) : (
                <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>Click to load bias analysis</div>
              )}
            </div>
          )}

          {/* TAB 5: PORTFOLIO, FUNDS & LEDGER STATEMENT */}
          {activeTab === "portfolio" && (
            <div className="glass-panel" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "20px" }}>
              <div style={{ fontSize: "16px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
                <DollarSign size={18} color="var(--accent-yellow)" />
                <span>Account Funds, Margins & Ledger Statement</span>
              </div>

              {funds && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
                  <div className="glass-card" style={{ padding: "16px" }}>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>AVAILABLE MARGIN</span>
                    <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--accent-green)" }} className="mono">
                      ${funds.availMargin ? Number(funds.availMargin).toLocaleString("en-US", { minimumFractionDigits: 2 }) : "0.00"} <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>USDT</span>
                    </div>
                  </div>
                  <div className="glass-card" style={{ padding: "16px" }}>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>USED MARGIN</span>
                    <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--accent-cyan)" }} className="mono">
                      ${funds.usedMargin ? Number(funds.usedMargin).toLocaleString("en-US", { minimumFractionDigits: 2 }) : "0.00"} <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>USDT</span>
                    </div>
                  </div>
                  <div className="glass-card" style={{ padding: "16px" }}>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>UNREALIZED P&L</span>
                    <div style={{ fontSize: "20px", fontWeight: 700, color: (funds.unrealizedPnl || 0) >= 0 ? "var(--accent-green)" : "var(--accent-red)" }} className="mono">
                      {Number(funds.unrealizedPnl || 0) >= 0 ? "+" : ""}${Number(funds.unrealizedPnl || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>USDT</span>
                    </div>
                  </div>
                </div>
              )}

              {ledger && (
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "10px" }}>Ledger Transactions (`GET /ledger`):</div>
                  <pre className="mono" style={{ background: "var(--bg-card)", padding: "16px", borderRadius: "8px", fontSize: "11px", color: "var(--text-secondary)", overflowX: "auto" }}>
                    {JSON.stringify(ledger, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
export default App;
