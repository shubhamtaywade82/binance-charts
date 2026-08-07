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
  Wallet,
  Zap,
} from "lucide-react";
import { TradingViewChart, formatPriceDynamic, getPricePrecision } from "./components/TradingViewChart";
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

  // Resizable Right Depth Panel Width — Always resets to default (380px) on page reload/refresh
  const DEFAULT_DEPTH_WIDTH = 380;
  const MIN_DEPTH_WIDTH = 280;
  const MAX_DEPTH_WIDTH = 580;

  const [depthPanelWidth, setDepthPanelWidth] = useState<number>(DEFAULT_DEPTH_WIDTH);
  const [isResizingDepth, setIsResizingDepth] = useState(false);

  const handleDepthMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingDepth(true);
  };

  useEffect(() => {
    if (!isResizingDepth) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      const clamped = Math.min(MAX_DEPTH_WIDTH, Math.max(MIN_DEPTH_WIDTH, newWidth));
      setDepthPanelWidth(clamped);
    };

    const handleMouseUp = () => {
      setIsResizingDepth(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingDepth]);

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
  const [positions, setPositions] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [ledger, setLedger] = useState<any>(null);
  const [portfolioSubTab, setPortfolioSubTab] = useState<"positions" | "orders" | "trades" | "ledger">("positions");
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

  // Fetch tab-specific data on demand & periodic background refresh for funds
  useEffect(() => {
    fetchPortfolioAndLedger(); // Always fetch funds on mount & symbol change for Header Capsule
    if (activeTab === "bias") {
      fetchBias();
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

      const pRes = await fetch("/api/positions");
      const pJson = await pRes.json();
      if (pJson.data) setPositions(Array.isArray(pJson.data) ? pJson.data : []);

      const oRes = await fetch("/api/orders");
      const oJson = await oRes.json();
      if (oJson.data) setOrders(Array.isArray(oJson.data) ? oJson.data : []);

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

  const handleClosePaperPosition = (sym: string) => {
    try {
      const key = "binance_paper_account_" + sym.toLowerCase();
      const raw = localStorage.getItem(key);
      if (raw) {
        const acc = JSON.parse(raw);
        if (acc.open) {
          const pos = acc.open;
          const spot = tick?.ltp || pos.lastPrice || pos.entryPrice;
          const isLong = pos.side === "LONG";
          const pnlVal = (spot - pos.entryPrice) * pos.qty * (isLong ? 1 : -1);
          const pnlPct = ((spot - pos.entryPrice) / pos.entryPrice) * 100 * (isLong ? 1 : -1);

          acc.balance = (acc.balance || 100000) + pnlVal;
          acc.totalTrades = (acc.totalTrades || 0) + 1;
          if (pnlVal >= 0) acc.wins = (acc.wins || 0) + 1;

          acc.history = [
            {
              id: Date.now(),
              symbol: pos.symbol,
              side: pos.side,
              qty: pos.qty,
              entryPrice: pos.entryPrice,
              exitPrice: spot,
              pnl: pnlVal,
              returnPct: pnlPct.toFixed(2),
              exitTime: Date.now(),
              exitReason: "MANUAL_CLOSE",
            },
            ...(acc.history || []),
          ];
          acc.open = null;

          localStorage.setItem(key, JSON.stringify(acc));
          fetchPortfolioAndLedger();
        }
      }
    } catch (e) {
      console.error("Error closing position:", e);
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

  // Calculate Header Account & PnL Metrics — Shared Source of Truth with Account & Ledger Tab
  const accountMetrics = (() => {
    // 1. Prioritize API Funds if loaded
    if (funds && (funds.availMargin !== undefined || funds.balance !== undefined)) {
      const avail = Number(funds.availMargin || funds.balance || 100000);
      const used = Number(funds.usedMargin || 0);
      const unpnl = Number(funds.unrealizedPnl || 0);
      const equity = avail + used + unpnl;
      const realized = Number(funds.realizedPnl || funds.closedPnl || 0);
      return {
        balance: avail + used,
        equity,
        realized,
        openPos: unpnl !== 0 ? { isApi: true } : null,
        unpnl,
        unpnlPct: (avail + used) > 0 ? (unpnl / (avail + used)) * 100 : 0,
      };
    }

    // 2. Fall back to paper account state if API funds not present
    try {
      const raw = localStorage.getItem("binance_paper_account_" + selectedSymbol.toLowerCase()) || localStorage.getItem("binance_paper_account_btcusdt");
      if (raw) {
        const acc = JSON.parse(raw);
        const balance = acc.balance ?? 100000;
        let realized = 0;
        if (acc.history && Array.isArray(acc.history)) {
          realized = acc.history.reduce((sum: number, t: any) => sum + (t.pnl || 0), 0);
        }
        const openPos = acc.open || null;
        let unpnl = 0;
        let unpnlPct = 0;

        if (openPos) {
          const spot = tick?.ltp || openPos.lastPrice || openPos.entryPrice;
          const isLong = openPos.side === "LONG";
          unpnlPct = ((spot - openPos.entryPrice) / openPos.entryPrice) * 100 * (isLong ? 1 : -1);
          unpnl = (spot - openPos.entryPrice) * openPos.qty * (isLong ? 1 : -1);
        }

        const equity = balance + unpnl;
        return { balance, equity, realized, openPos, unpnl, unpnlPct };
      }
    } catch {}
    return { balance: 100000, equity: 100000, realized: 0, openPos: null, unpnl: 0, unpnlPct: 0 };
  })();

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
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {/* Account Equity & PnL Capsule */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "4px 12px",
              borderRadius: "20px",
              background: "rgba(15, 19, 28, 0.85)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.3)",
            }}
          >
            {/* Wallet / Equity */}
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <Wallet size={13} color="var(--accent-cyan)" />
              <span style={{ color: "var(--text-muted)", fontSize: "10px", fontWeight: 700 }}>EQUITY</span>
              <span style={{ color: "#FFFFFF", fontWeight: 800 }}>${formatPriceDynamic(accountMetrics.equity, 2)}</span>
            </div>

            <span style={{ color: "rgba(255, 255, 255, 0.15)" }}>|</span>

            {/* Realized PnL */}
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ color: "var(--text-muted)", fontSize: "10px", fontWeight: 700 }}>REALIZED</span>
              <span style={{ fontWeight: 800, color: accountMetrics.realized >= 0 ? "#00F5A0" : "#FF495C" }}>
                {accountMetrics.realized >= 0 ? "+" : ""}${formatPriceDynamic(accountMetrics.realized, 2)}
              </span>
            </div>

            {/* Active Unrealized PnL */}
            {accountMetrics.openPos && (
              <>
                <span style={{ color: "rgba(255, 255, 255, 0.15)" }}>|</span>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ color: "var(--text-muted)", fontSize: "10px", fontWeight: 700 }}>UNREALIZED</span>
                  <span
                    style={{
                      fontWeight: 800,
                      color: accountMetrics.unpnl >= 0 ? "#00F5A0" : "#FF495C",
                      background: accountMetrics.unpnl >= 0 ? "rgba(0, 245, 160, 0.15)" : "rgba(255, 73, 92, 0.15)",
                      padding: "1px 6px",
                      borderRadius: "4px",
                      border: `1px solid ${accountMetrics.unpnl >= 0 ? "rgba(0, 245, 160, 0.35)" : "rgba(255, 73, 92, 0.35)"}`,
                    }}
                  >
                    {accountMetrics.unpnl >= 0 ? "+" : ""}${formatPriceDynamic(accountMetrics.unpnl, 2)} ({accountMetrics.unpnlPct >= 0 ? "+" : ""}{accountMetrics.unpnlPct.toFixed(2)}%)
                  </span>
                </div>
              </>
            )}
          </div>
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
        {/* Left Collapsible Navigation Sidebar with Smooth Slide Animation */}
        <aside
          style={{
            width: showLeftSidebar ? "200px" : "0px",
            minWidth: showLeftSidebar ? "200px" : "0px",
            opacity: showLeftSidebar ? 1 : 0,
            visibility: showLeftSidebar ? "visible" : "hidden",
            background: "var(--bg-surface)",
            borderRight: showLeftSidebar ? "1px solid var(--border-color)" : "1px solid transparent",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            padding: showLeftSidebar ? "12px 8px" : "12px 0px",
            overflow: "hidden",
            whiteSpace: "nowrap",
            zIndex: 10,
            transition: "all 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700, padding: "0 8px 6px 8px", letterSpacing: "0.5px" }}>
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
                  padding: "8px 10px",
                  borderRadius: "6px",
                  background: isActive ? "rgba(0, 245, 160, 0.1)" : "transparent",
                  color: isActive ? "var(--accent-green)" : "var(--text-secondary)",
                  border: isActive ? "1px solid rgba(0, 245, 160, 0.3)" : "1px solid transparent",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.15s ease",
                }}
              >
                <Icon size={15} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </aside>

        {/* Center Main Dashboard Area */}
        <main style={{ flex: 1, padding: 0, display: "flex", flexDirection: "column", overflowX: "hidden", minWidth: 0 }}>

          {/* TAB 1: TERMINAL & CHART WITH OPTIONAL RIGHT 20-DEPTH SIDEBAR */}
          {activeTab === "terminal" && (
            <div style={{ display: "flex", flex: 1, minHeight: "520px", minWidth: 0, width: "100%", overflow: "hidden" }}>
              {/* Maximized Chart Canvas */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden", background: "#0A0D14" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: "1px solid var(--border-color)", background: "var(--bg-surface)" }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
                    <BarChart2 size={15} color="var(--accent-cyan)" />
                    <span>{selectedSymbol.toUpperCase()} Intraday Candlesticks (Auto-Date Normalization)</span>
                  </div>
                  <div style={{ display: "flex", gap: "4px" }}>
                    {["1", "5", "15", "30", "60"].map((m) => (
                      <button
                        key={m}
                        onClick={() => setSelectedInterval(m)}
                        style={{
                          padding: "3px 7px",
                          fontSize: "10px",
                          fontWeight: 700,
                          borderRadius: "4px",
                          background: selectedInterval === m ? "var(--accent-cyan)" : "rgba(255,255,255,0.06)",
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

              {/* Resizer Handle Bar for Right Depth Panel */}
              {showDepthPanel && (
                <div
                  onMouseDown={handleDepthMouseDown}
                  style={{
                    width: "4px",
                    cursor: "col-resize",
                    background: isResizingDepth ? "var(--accent-cyan)" : "transparent",
                    borderLeft: isResizingDepth ? "1px solid var(--accent-cyan)" : "1px solid transparent",
                    transition: "background 0.15s ease",
                    zIndex: 30,
                    userSelect: "none",
                  }}
                  title="Drag to resize Order Book Microstructure sidebar"
                />
              )}

              {/* Right Collapsible & Resizable 20-Depth Panel with Smooth Slide Animation */}
              <div
                style={{
                  width: showDepthPanel ? `${depthPanelWidth}px` : "0px",
                  minWidth: showDepthPanel ? `${depthPanelWidth}px` : "0px",
                  opacity: showDepthPanel ? 1 : 0,
                  visibility: showDepthPanel ? "visible" : "hidden",
                  overflow: "hidden",
                  transition: isResizingDepth ? "none" : "all 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
                }}
              >
                <MarketDepthStream bids={tick?.bids || []} asks={tick?.asks || []} symbol={selectedSymbol} />
              </div>
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

          {/* TAB 5: PORTFOLIO, POSITIONS, ORDERS & LEDGER DASHBOARD */}
          {activeTab === "portfolio" && (
            <div className="glass-panel" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: "16px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
                  <DollarSign size={18} color="var(--accent-yellow)" />
                  <span>Account Funds, Positions, Orders & Ledger Statement</span>
                </div>
                <button
                  onClick={fetchPortfolioAndLedger}
                  style={{
                    padding: "5px 12px",
                    borderRadius: "6px",
                    background: "rgba(255, 255, 255, 0.08)",
                    border: "1px solid var(--border-color)",
                    color: "var(--accent-cyan)",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Refresh Statement
                </button>
              </div>

              {/* Summary Metric Cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
                <div className="glass-card" style={{ padding: "16px" }}>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 700 }}>AVAILABLE MARGIN</span>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--accent-green)" }} className="mono">
                    ${formatPriceDynamic(accountMetrics.balance, 2)} <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>USDT</span>
                  </div>
                </div>

                <div className="glass-card" style={{ padding: "16px" }}>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 700 }}>ACCOUNT EQUITY</span>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: "#FFFFFF" }} className="mono">
                    ${formatPriceDynamic(accountMetrics.equity, 2)} <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>USDT</span>
                  </div>
                </div>

                <div className="glass-card" style={{ padding: "16px" }}>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 700 }}>REALIZED P&L</span>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: accountMetrics.realized >= 0 ? "var(--accent-green)" : "var(--accent-red)" }} className="mono">
                    {accountMetrics.realized >= 0 ? "+" : ""}${formatPriceDynamic(accountMetrics.realized, 2)} <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>USDT</span>
                  </div>
                </div>

                <div className="glass-card" style={{ padding: "16px" }}>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 700 }}>UNREALIZED P&L</span>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: accountMetrics.unpnl >= 0 ? "var(--accent-green)" : "var(--accent-red)" }} className="mono">
                    {accountMetrics.unpnl >= 0 ? "+" : ""}${formatPriceDynamic(accountMetrics.unpnl, 2)} <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>USDT</span>
                  </div>
                </div>
              </div>

              {/* Sub Navigation Bar */}
              <div style={{ display: "flex", gap: "8px", borderBottom: "1px solid var(--border-color)", paddingBottom: "10px" }}>
                {[
                  { id: "positions", label: `Active Positions (${accountMetrics.openPos ? 1 : positions.length})` },
                  { id: "orders", label: `Open Orders (${orders.length})` },
                  { id: "trades", label: "Executed Trade History" },
                  { id: "ledger", label: "Ledger Transactions" },
                ].map((st) => (
                  <button
                    key={st.id}
                    onClick={() => setPortfolioSubTab(st.id as any)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer",
                      background: portfolioSubTab === st.id ? "rgba(0, 245, 160, 0.15)" : "transparent",
                      color: portfolioSubTab === st.id ? "#00F5A0" : "var(--text-secondary)",
                      border: portfolioSubTab === st.id ? "1px solid rgba(0, 245, 160, 0.4)" : "1px solid transparent",
                    }}
                  >
                    {st.label}
                  </button>
                ))}
              </div>

              {/* SUB-TAB 1: POSITIONS TABLE */}
              {portfolioSubTab === "positions" && (
                <div style={{ overflowX: "auto" }}>
                  {accountMetrics.openPos || positions.length > 0 ? (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                      <thead>
                        <tr style={{ background: "rgba(0,0,0,0.3)", color: "var(--text-muted)", textAlign: "left", fontSize: "10px", fontWeight: 700 }}>
                          <th style={{ padding: "10px" }}>SYMBOL</th>
                          <th style={{ padding: "10px" }}>SIDE</th>
                          <th style={{ padding: "10px", textAlign: "right" }}>QTY</th>
                          <th style={{ padding: "10px", textAlign: "right" }}>ENTRY PRICE</th>
                          <th style={{ padding: "10px", textAlign: "right" }}>CURRENT PRICE</th>
                          <th style={{ padding: "10px", textAlign: "right" }}>STOP LOSS</th>
                          <th style={{ padding: "10px", textAlign: "right" }}>TAKE PROFIT</th>
                          <th style={{ padding: "10px", textAlign: "right" }}>UNREALIZED PnL</th>
                          <th style={{ padding: "10px", textAlign: "center" }}>ACTION</th>
                        </tr>
                      </thead>
                      <tbody>
                        {accountMetrics.openPos && !accountMetrics.openPos.isApi && (() => {
                          const pos = accountMetrics.openPos;
                          const spot = tick?.ltp || pos.lastPrice || pos.entryPrice;
                          const prec = getPricePrecision(pos.entryPrice).precision;
                          const isLong = pos.side === "LONG";
                          const pnlVal = (spot - pos.entryPrice) * pos.qty * (isLong ? 1 : -1);
                          const pnlPct = ((spot - pos.entryPrice) / pos.entryPrice) * 100 * (isLong ? 1 : -1);
                          const isProfit = pnlVal >= 0;

                          return (
                            <tr style={{ borderBottom: "1px solid var(--border-color)", background: "rgba(15, 19, 28, 0.4)" }}>
                              <td style={{ padding: "12px", fontWeight: 800, color: "var(--accent-cyan)" }}>{pos.symbol.toUpperCase()}</td>
                              <td style={{ padding: "12px" }}>
                                <span style={{ padding: "2px 6px", borderRadius: "4px", fontWeight: 700, background: isLong ? "rgba(0, 245, 160, 0.2)" : "rgba(255, 73, 92, 0.2)", color: isLong ? "#00F5A0" : "#FF495C" }}>
                                  {pos.side}
                                </span>
                              </td>
                              <td style={{ padding: "12px", textAlign: "right" }} className="mono">{pos.qty}</td>
                              <td style={{ padding: "12px", textAlign: "right" }} className="mono">${formatPriceDynamic(pos.entryPrice, prec)}</td>
                              <td style={{ padding: "12px", textAlign: "right" }} className="mono">${formatPriceDynamic(spot, prec)}</td>
                              <td style={{ padding: "12px", textAlign: "right", color: "#FF495C" }} className="mono">${formatPriceDynamic(pos.stopPrice, prec)}</td>
                              <td style={{ padding: "12px", textAlign: "right", color: "#00E5FF" }} className="mono">${formatPriceDynamic(pos.targetPrice, prec)}</td>
                              <td style={{ padding: "12px", textAlign: "right", fontWeight: 800, color: isProfit ? "#00F5A0" : "#FF495C" }} className="mono">
                                {isProfit ? "+" : ""}${formatPriceDynamic(pnlVal, 2)} ({isProfit ? "+" : ""}{pnlPct.toFixed(2)}%)
                              </td>
                              <td style={{ padding: "12px", textAlign: "center" }}>
                                <button
                                  onClick={() => handleClosePaperPosition(pos.symbol)}
                                  style={{
                                    padding: "4px 10px",
                                    borderRadius: "4px",
                                    background: "rgba(255, 73, 92, 0.2)",
                                    border: "1px solid rgba(255, 73, 92, 0.5)",
                                    color: "#FF495C",
                                    fontWeight: 700,
                                    fontSize: "11px",
                                    cursor: "pointer",
                                  }}
                                >
                                  CLOSE POSITION
                                </button>
                              </td>
                            </tr>
                          );
                        })()}

                        {positions.map((p: any, idx: number) => (
                          <tr key={idx} style={{ borderBottom: "1px solid var(--border-color)" }}>
                            <td style={{ padding: "12px", fontWeight: 800 }}>{p.symbol}</td>
                            <td style={{ padding: "12px" }}>{p.positionSide || p.side}</td>
                            <td style={{ padding: "12px", textAlign: "right" }} className="mono">{p.positionAmt || p.qty}</td>
                            <td style={{ padding: "12px", textAlign: "right" }} className="mono">${p.entryPrice}</td>
                            <td style={{ padding: "12px", textAlign: "right" }} className="mono">${p.markPrice}</td>
                            <td style={{ padding: "12px", textAlign: "right" }} className="mono">-</td>
                            <td style={{ padding: "12px", textAlign: "right" }} className="mono">-</td>
                            <td style={{ padding: "12px", textAlign: "right", fontWeight: 800, color: (p.unrealizedProfit || 0) >= 0 ? "#00F5A0" : "#FF495C" }} className="mono">
                              ${p.unrealizedProfit}
                            </td>
                            <td style={{ padding: "12px", textAlign: "center" }}>-</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>No active open positions.</div>
                  )}
                </div>
              )}

              {/* SUB-TAB 2: OPEN ORDERS TABLE */}
              {portfolioSubTab === "orders" && (
                <div style={{ overflowX: "auto" }}>
                  {orders.length > 0 ? (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                      <thead>
                        <tr style={{ background: "rgba(0,0,0,0.3)", color: "var(--text-muted)", textAlign: "left", fontSize: "10px", fontWeight: 700 }}>
                          <th style={{ padding: "10px" }}>TIME</th>
                          <th style={{ padding: "10px" }}>SYMBOL</th>
                          <th style={{ padding: "10px" }}>TYPE</th>
                          <th style={{ padding: "10px" }}>SIDE</th>
                          <th style={{ padding: "10px", textAlign: "right" }}>PRICE</th>
                          <th style={{ padding: "10px", textAlign: "right" }}>QTY</th>
                          <th style={{ padding: "10px", textAlign: "right" }}>STATUS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map((o: any, idx: number) => (
                          <tr key={idx} style={{ borderBottom: "1px solid var(--border-color)" }}>
                            <td style={{ padding: "12px" }} className="mono">{new Date(o.time || Date.now()).toLocaleTimeString()}</td>
                            <td style={{ padding: "12px", fontWeight: 800 }}>{o.symbol}</td>
                            <td style={{ padding: "12px" }}>{o.type}</td>
                            <td style={{ padding: "12px", color: o.side === "BUY" ? "#00F5A0" : "#FF495C", fontWeight: 700 }}>{o.side}</td>
                            <td style={{ padding: "12px", textAlign: "right" }} className="mono">${o.price}</td>
                            <td style={{ padding: "12px", textAlign: "right" }} className="mono">{o.origQty || o.qty}</td>
                            <td style={{ padding: "12px", textAlign: "right" }} className="mono">{o.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>No open or pending orders.</div>
                  )}
                </div>
              )}

              {/* SUB-TAB 3: EXECUTED TRADES TABLE */}
              {portfolioSubTab === "trades" && (
                <div style={{ overflowX: "auto" }}>
                  {(() => {
                    const raw = localStorage.getItem("binance_paper_account_" + selectedSymbol.toLowerCase()) || localStorage.getItem("binance_paper_account_btcusdt");
                    const acc = raw ? JSON.parse(raw) : null;
                    const history = acc?.history || [];

                    if (history.length === 0) {
                      return <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>No executed trade history recorded yet.</div>;
                    }

                    return (
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                        <thead>
                          <tr style={{ background: "rgba(0,0,0,0.3)", color: "var(--text-muted)", textAlign: "left", fontSize: "10px", fontWeight: 700 }}>
                            <th style={{ padding: "10px" }}>TIME</th>
                            <th style={{ padding: "10px" }}>SYMBOL</th>
                            <th style={{ padding: "10px" }}>SIDE</th>
                            <th style={{ padding: "10px", textAlign: "right" }}>QTY</th>
                            <th style={{ padding: "10px", textAlign: "right" }}>ENTRY</th>
                            <th style={{ padding: "10px", textAlign: "right" }}>EXIT</th>
                            <th style={{ padding: "10px", textAlign: "right" }}>REALIZED PnL</th>
                            <th style={{ padding: "10px", textAlign: "center" }}>REASON</th>
                          </tr>
                        </thead>
                        <tbody>
                          {history.map((t: any, idx: number) => {
                            const isWin = (t.pnl || 0) >= 0;
                            return (
                              <tr key={idx} style={{ borderBottom: "1px solid var(--border-color)" }}>
                                <td style={{ padding: "12px" }} className="mono">{new Date(t.exitTime || Date.now()).toLocaleTimeString()}</td>
                                <td style={{ padding: "12px", fontWeight: 800, color: "var(--accent-cyan)" }}>{t.symbol?.toUpperCase()}</td>
                                <td style={{ padding: "12px" }}>
                                  <span style={{ padding: "2px 6px", borderRadius: "4px", fontWeight: 700, background: t.side === "LONG" ? "rgba(0, 245, 160, 0.2)" : "rgba(255, 73, 92, 0.2)", color: t.side === "LONG" ? "#00F5A0" : "#FF495C" }}>
                                    {t.side}
                                  </span>
                                </td>
                                <td style={{ padding: "12px", textAlign: "right" }} className="mono">{t.qty}</td>
                                <td style={{ padding: "12px", textAlign: "right" }} className="mono">${formatPriceDynamic(t.entryPrice)}</td>
                                <td style={{ padding: "12px", textAlign: "right" }} className="mono">${formatPriceDynamic(t.exitPrice)}</td>
                                <td style={{ padding: "12px", textAlign: "right", fontWeight: 800, color: isWin ? "#00F5A0" : "#FF495C" }} className="mono">
                                  {isWin ? "+" : ""}${formatPriceDynamic(t.pnl, 2)} ({isWin ? "+" : ""}{t.returnPct}%)
                                </td>
                                <td style={{ padding: "12px", textAlign: "center" }}>
                                  <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}>
                                    {t.exitReason}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    );
                  })()}
                </div>
              )}

              {/* SUB-TAB 4: LEDGER STATEMENT */}
              {portfolioSubTab === "ledger" && (
                <div>
                  {ledger ? (
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "10px" }}>Ledger Transactions (`GET /api/ledger`):</div>
                      <pre className="mono" style={{ background: "var(--bg-card)", padding: "16px", borderRadius: "8px", fontSize: "11px", color: "var(--text-secondary)", overflowX: "auto" }}>
                        {JSON.stringify(ledger, null, 2)}
                      </pre>
                    </div>
                  ) : (
                    <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>No ledger transactions recorded.</div>
                  )}
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
