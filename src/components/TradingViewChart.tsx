import React, { useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  LineStyle,
  IPriceLine,
  CrosshairMode,
} from "lightweight-charts";
import { Clock, Eye, EyeOff, ChevronDown, ChevronUp, Sliders, Layers } from "lucide-react";
import {
  detectFVGs,
  detectOrderBlocks,
  detectMarketStructure,
  detectLiquidityPools,
  detectPremiumDiscount,
  detectSupplyDemandZones,
  detectTrendlineLiquidity,
  detectCandlestickPatterns,
  FVGPattern,
  OrderBlockPattern,
  MarketStructureBreak,
  LiquidityPoolPattern,
  PremiumDiscountRange,
  SupplyDemandZone,
  TrendlineLiquidity,
  CandlestickPattern,
  CandlestickPatternType,
} from "../utils/smcEngine";

export function getPricePrecision(price: number): { precision: number; minMove: number } {
  const abs = Math.abs(price);
  if (abs === 0) return { precision: 2, minMove: 0.01 };
  if (abs < 0.0001) return { precision: 7, minMove: 0.0000001 };
  if (abs < 0.01) return { precision: 6, minMove: 0.000001 };
  if (abs < 1) return { precision: 5, minMove: 0.00001 };
  if (abs < 10) return { precision: 4, minMove: 0.0001 };
  if (abs < 100) return { precision: 3, minMove: 0.001 };
  return { precision: 2, minMove: 0.01 };
}

export function formatPriceDynamic(price: number | undefined | null, precisionOverride?: number): string {
  if (price === undefined || price === null || isNaN(price)) return "0.00";
  const prec = precisionOverride ?? getPricePrecision(price).precision;
  return price.toLocaleString("en-US", {
    minimumFractionDigits: prec,
    maximumFractionDigits: prec,
  });
}
import {
  detectICTSessions,
  detectSilverBulletWindows,
  detectICTOTEZone,
  detectJudasSwings,
  detectAMDCycles,
  ICTSession,
  ICTSilverBulletWindow,
  ICTOTEZone,
  ICTJudasSwing,
  ICTAMDCycle,
} from "../utils/ictEngine";
import { scanSetups, resampleCandles, SetupSignal, HtfBias } from "../utils/setupScanner";
import {
  PaperAccount,
  createPaperAccount,
  loadPaperAccount,
  savePaperAccount,
  resetPaperAccount,
  paperEquity,
  realizedPnl,
  openPaperPosition,
  markPaperPosition,
  closePaperPosition,
} from "../utils/paperTrader";

export interface CandleTheme {
  id: string;
  name: string;
  upColor: string;
  downColor: string;
  volUpColor: string;
  volDownColor: string;
  priceLineColor: string;
}

export const CandleCountdown = React.memo(function CandleCountdown({ interval }: { interval: string }) {
  const [value, setValue] = useState("00:00");

  useEffect(() => {
    const barSeconds = (parseInt(interval, 10) || 15) * 60;

    const update = () => {
      const nowUnix = Math.floor(Date.now() / 1000);
      const currentBarStart = Math.floor(nowUnix / barSeconds) * barSeconds;
      const nextBarStart = currentBarStart + barSeconds;
      const diff = Math.max(0, nextBarStart - nowUnix);

      const mins = Math.floor(diff / 60).toString().padStart(2, "0");
      const secs = (diff % 60).toString().padStart(2, "0");
      setValue(`${mins}:${secs}`);
    };

    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [interval]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "5px", color: "var(--accent-cyan)" }}>
      <Clock size={11} />
      <span style={{ fontSize: "10px", fontWeight: 700 }}>NEXT</span>
      <span style={{ fontWeight: 800, fontSize: "11px" }}>{value}</span>
    </div>
  );
});

export const CANDLE_THEMES: Record<string, CandleTheme> = {
  emerald: {
    id: "emerald",
    name: "Cyber Emerald",
    upColor: "#00F5A0",
    downColor: "#FF495C",
    volUpColor: "rgba(0, 245, 160, 0.35)",
    volDownColor: "rgba(255, 73, 92, 0.35)",
    priceLineColor: "#00F5A0",
  },
  classic: {
    id: "classic",
    name: "Classic TV",
    upColor: "#089981",
    downColor: "#F23645",
    volUpColor: "rgba(8, 153, 129, 0.35)",
    volDownColor: "rgba(242, 54, 69, 0.35)",
    priceLineColor: "#089981",
  },
  ice: {
    id: "ice",
    name: "Electric Ice",
    upColor: "#00E5FF",
    downColor: "#78909C",
    volUpColor: "rgba(0, 229, 255, 0.35)",
    volDownColor: "rgba(120, 144, 156, 0.35)",
    priceLineColor: "#00E5FF",
  },
  gold: {
    id: "gold",
    name: "Solar Gold",
    upColor: "#FFB800",
    downColor: "#A855F7",
    volUpColor: "rgba(255, 184, 0, 0.35)",
    volDownColor: "rgba(168, 85, 247, 0.35)",
    priceLineColor: "#FFB800",
  },
  neon: {
    id: "neon",
    name: "Midnight Neon",
    upColor: "#3B82F6",
    downColor: "#EC4899",
    volUpColor: "rgba(59, 130, 246, 0.35)",
    volDownColor: "rgba(236, 72, 153, 0.35)",
    priceLineColor: "#3B82F6",
  },
  bw: {
    id: "bw",
    name: "Black & White",
    upColor: "#FFFFFF",
    downColor: "#2A2E39",
    volUpColor: "rgba(255, 255, 255, 0.4)",
    volDownColor: "rgba(67, 70, 81, 0.5)",
    priceLineColor: "#FFFFFF",
  },
};

export interface ChartProps {
  symbol: string;
  interval: string;
  showIndicators?: boolean;
  livePrice?: number;
  customCandles?: any[];
  tick?: any;
}

export interface IndicatorMeta {
  label: string;
  color: string;
  icon?: string;
  get: () => boolean;
  set: (v: boolean) => void;
}

export interface IndicatorSetDef {
  id: string;
  label: string;
  keys: string[];
}

// HTF bias ladder: only Binance kline intervals (1/5/15/30/60m) as bases
const autoHtfMult = (baseMin: number): number => {
  const ladder: Record<number, number> = { 1: 5, 5: 3, 15: 4, 30: 2, 60: 4 };
  return ladder[baseMin] ?? 4;
};

export const sanitizeAndSortCandles = (raw: any[]): any[] => {
  if (!Array.isArray(raw)) return [];
  const valid = raw
    .filter((c) => c && typeof c.time === "number" && !isNaN(c.time) && c.time > 0)
    .map((c) => ({
      time: Math.floor(Number(c.time)),
      open: Number(c.open || 0),
      high: Number(c.high || 0),
      low: Number(c.low || 0),
      close: Number(c.close || 0),
      volume: Number(c.volume || 0),
    }));

  const map = new Map<number, any>();
  for (const c of valid) {
    map.set(c.time, c);
  }
  return Array.from(map.values()).sort((a, b) => a.time - b.time);
};

export type DefaultScaleMode = "last_bars" | "fixed_spacing" | "fit_content";

export interface ChartScaleSettings {
  mode: DefaultScaleMode;
  lastBarsCount: number;
  barSpacing: number;
  rightOffset: number;
  isLogScale: boolean;
  isUserSelectedFitAll?: boolean;
}

const DEFAULT_SCALE_SETTINGS: ChartScaleSettings = {
  mode: "last_bars",
  lastBarsCount: 120,
  barSpacing: 10,
  rightOffset: 8,
  isLogScale: false,
};

export const TradingViewChart: React.FC<ChartProps> = ({
  symbol,
  interval,
  showIndicators = true,
  livePrice,
  customCandles,
  tick,
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLazyLoading, setIsLazyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Candle Theme State (persisted to localStorage)
  const [selectedThemeId, setSelectedThemeId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem("chart_candle_theme");
      if (saved && CANDLE_THEMES[saved]) return saved;
    } catch {}
    return "emerald";
  });

  // Hollow Candles Mode State (persisted to localStorage)
  const [isHollowMode, setIsHollowMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem("chart_hollow_candles") === "true";
    } catch {}
    return false;
  });

  const activeTheme = CANDLE_THEMES[selectedThemeId] || CANDLE_THEMES.emerald;
  const activeThemeRef = useRef(activeTheme);
  activeThemeRef.current = activeTheme;

  const isHollowRef = useRef(isHollowMode);
  isHollowRef.current = isHollowMode;

  // Helper to apply candle series options respecting active theme + hollow mode
  const applyCandleSeriesOptions = (theme: CandleTheme, hollow: boolean) => {
    if (!seriesRef.current) return;
    if (hollow) {
      seriesRef.current.applyOptions({
        upColor: "#0F131C", // Hollow transparent body matching background
        downColor: theme.downColor,
        borderVisible: true,
        borderUpColor: theme.upColor,
        borderDownColor: theme.downColor,
        wickUpColor: theme.upColor,
        wickDownColor: theme.downColor,
        priceLineVisible: true,
        priceLineColor: theme.priceLineColor,
      });
    } else {
      seriesRef.current.applyOptions({
        upColor: theme.upColor,
        downColor: theme.downColor,
        borderVisible: false,
        borderUpColor: theme.upColor,
        borderDownColor: theme.downColor,
        wickUpColor: theme.upColor,
        wickDownColor: theme.downColor,
        priceLineVisible: true,
        priceLineColor: theme.priceLineColor,
      });
    }
  };

  // Indicator Management State (SMA 20 & EMA 9) — persisted to localStorage
  const [showIndicatorsPanel, setShowIndicatorsPanel] = useState(false);
  const [indicatorVisibility, setIndicatorVisibility] = useState(() => {
    try {
      const saved = localStorage.getItem("chart_indicator_visibility");
      if (saved) return JSON.parse(saved) as { sma20: boolean; ema9: boolean };
    } catch {}
    return { sma20: true, ema9: true };
  });

  // Scaling & Zoom Settings State (persisted to localStorage)
  const [scaleSettings, setScaleSettings] = useState<ChartScaleSettings>(() => {
    try {
      const saved = localStorage.getItem("chart_scale_settings");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.mode === "fit_content" && !parsed.isUserSelectedFitAll) {
          return DEFAULT_SCALE_SETTINGS;
        }
        return { ...DEFAULT_SCALE_SETTINGS, ...parsed };
      }
    } catch {}
    return DEFAULT_SCALE_SETTINGS;
  });
  const scaleSettingsRef = useRef(scaleSettings);
  scaleSettingsRef.current = scaleSettings;

  const applyScaleSettingsToChart = (settings: ChartScaleSettings) => {
    if (!chartRef.current || !seriesRef.current || allCandlesRef.current.length === 0) return;
    const chart = chartRef.current;
    const timeScale = chart.timeScale();

    try {
      seriesRef.current.priceScale().applyOptions({
        mode: settings.isLogScale ? 1 : 0,
        autoScale: true,
      });
    } catch (e) {
      console.warn("Price scale mode error:", e);
    }

    timeScale.applyOptions({ rightOffset: settings.rightOffset });

    switch (settings.mode) {
      case "fit_content":
        timeScale.fitContent();
        timeScale.applyOptions({ rightOffset: settings.rightOffset });
        break;

      case "last_bars": {
        const totalBars = allCandlesRef.current.length;
        const from = Math.max(0, totalBars - settings.lastBarsCount);
        timeScale.setVisibleLogicalRange({
          from,
          to: totalBars + settings.rightOffset,
        });
        break;
      }

      case "fixed_spacing":
        timeScale.applyOptions({
          barSpacing: settings.barSpacing,
          rightOffset: settings.rightOffset,
        });
        break;
    }
  };

  const updateScaleSettings = (newSettings: Partial<ChartScaleSettings>) => {
    setScaleSettings((prev) => {
      const isUserFitAll = newSettings.mode === "fit_content" ? true : prev.isUserSelectedFitAll;
      const updated = { ...prev, ...newSettings, isUserSelectedFitAll: isUserFitAll };
      localStorage.setItem("chart_scale_settings", JSON.stringify(updated));
      applyScaleSettingsToChart(updated);
      return updated;
    });
  };

  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const smaSeriesRef = useRef<any>(null);
  const emaSeriesRef = useRef<any>(null);
  const lastCandleValRef = useRef<any>(null);
  const allCandlesRef = useRef<any[]>([]);

  // Detection results are cached per candle-data version so the 60fps LERP loop
  // and scroll handlers re-project cached elements instead of re-running all 13
  // detectors on every frame (detectors only depend on candle data, not toggles).
  const smcResultsRef = useRef<any>({ version: "" });
  const htfResultsRef = useRef<any>({ version: "" });
  const drawPendingRef = useRef(false);
  const lastDrawnCandleRef = useRef("");
  const scanVersionRef = useRef("");
  const scanPriceRef = useRef<number | null>(null);
  const lastSignalKeyRef = useRef("");
  const bidLineRef = useRef<IPriceLine | null>(null);
  const askLineRef = useRef<IPriceLine | null>(null);
  const targetBidRef = useRef<number | null>(null);
  const currentVisualBidRef = useRef<number | null>(null);
  const targetAskRef = useRef<number | null>(null);
  const currentVisualAskRef = useRef<number | null>(null);

  const candlesVersion = (candles: any[]) => {
    const last = candles[candles.length - 1];
    return last
      ? `${candles.length}:${last.time}:${last.close}:${last.high}:${last.low}`
      : `${candles.length}:`;
  };

  const getCached = <T,>(key: string, compute: () => T): T => {
    const version = candlesVersion(allCandlesRef.current);
    if (smcResultsRef.current.version !== version) {
      smcResultsRef.current = { version };
    }
    if (smcResultsRef.current[key] === undefined) {
      smcResultsRef.current[key] = compute();
    }
    return smcResultsRef.current[key] as T;
  };

  const latestNCandles = (n: number) => {
    const candles = allCandlesRef.current;
    return candles.length > n ? candles.slice(-n) : candles;
  };

  const getHtfCached = (mult: number, key: string, compute: () => any) => {
    const version = `${candlesVersion(allCandlesRef.current)}|${mult}`;
    if (htfResultsRef.current.version !== version) {
      htfResultsRef.current = { version };
    }
    if (htfResultsRef.current[key] === undefined) {
      htfResultsRef.current[key] = compute();
    }
    return htfResultsRef.current[key];
  };

  const scheduleDraw = () => {
    if (drawPendingRef.current) return;
    drawPendingRef.current = true;
    requestAnimationFrame(() => {
      drawPendingRef.current = false;
      drawSMCBoxes();
    });
  };

  const isFetchingHistoricalRef = useRef(false);

  // Smooth LERP animation refs
  const targetPriceRef = useRef<number | null>(null);
  const currentVisualPriceRef = useRef<number | null>(null);
  const targetVolumeRef = useRef<number | null>(null);
  const currentVisualVolumeRef = useRef<number | null>(null);

  // Toggle Line Indicator Series Visibility dynamically — persists to localStorage
  const toggleIndicator = (key: "sma20" | "ema9") => {
    setIndicatorVisibility((prev) => {
      const nextVal = !prev[key];
      if (key === "sma20" && smaSeriesRef.current) {
        smaSeriesRef.current.applyOptions({ visible: nextVal });
      } else if (key === "ema9" && emaSeriesRef.current) {
        emaSeriesRef.current.applyOptions({ visible: nextVal });
      }
      const next = { ...prev, [key]: nextVal };
      try { localStorage.setItem("chart_indicator_visibility", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // Switch & Persist Candle Theme dynamically (applies to candlesticks + volume series)
  const handleThemeChange = (themeId: string) => {
    const theme = CANDLE_THEMES[themeId];
    if (!theme) return;
    setSelectedThemeId(themeId);
    activeThemeRef.current = theme;
    try { localStorage.setItem("chart_candle_theme", themeId); } catch {}

    applyCandleSeriesOptions(theme, isHollowRef.current);

    if (volumeSeriesRef.current && allCandlesRef.current.length > 0) {
      const updatedVolume = allCandlesRef.current.map((c: any) => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? theme.volUpColor : theme.volDownColor,
      }));
      volumeSeriesRef.current.setData(updatedVolume);
    }
  };

  // SMC Fair Value Gaps (FVG) State
  const [showFVG, setShowFVG] = useState<boolean>(() => {
    try {
      return localStorage.getItem("chart_show_fvg") !== "false";
    } catch {}
    return true;
  });

  const toggleFVG = () => {
    setShowFVG((prev) => {
      const next = !prev;
      try { localStorage.setItem("chart_show_fvg", String(next)); } catch {}
      return next;
    });
  };

  // SMC Order Blocks (OB) State
  const [showOB, setShowOB] = useState<boolean>(() => {
    try {
      return localStorage.getItem("chart_show_ob") !== "false";
    } catch {}
    return true;
  });

  const toggleOB = () => {
    setShowOB((prev) => {
      const next = !prev;
      try { localStorage.setItem("chart_show_ob", String(next)); } catch {}
      return next;
    });
  };

  // SMC Market Structure (BOS & CHoCH) State
  const [showStructure, setShowStructure] = useState<boolean>(() => {
    try {
      return localStorage.getItem("chart_show_structure") !== "false";
    } catch {}
    return true;
  });

  const toggleStructure = () => {
    setShowStructure((prev) => {
      const next = !prev;
      try { localStorage.setItem("chart_show_structure", String(next)); } catch {}
      return next;
    });
  };

  // SMC Liquidity Pools & Sweeps (BSL / SSL) State
  const [showLiquidity, setShowLiquidity] = useState<boolean>(() => {
    try {
      return localStorage.getItem("chart_show_liquidity") !== "false";
    } catch {}
    return true;
  });

  const toggleLiquidity = () => {
    setShowLiquidity((prev) => {
      const next = !prev;
      try { localStorage.setItem("chart_show_liquidity", String(next)); } catch {}
      return next;
    });
  };

  // SMC Premium vs Discount Equilibrium (0.50 Level) State
  const [showEquilibrium, setShowEquilibrium] = useState<boolean>(() => {
    try {
      return localStorage.getItem("chart_show_equilibrium") !== "false";
    } catch {}
    return true;
  });

  const toggleEquilibrium = () => {
    setShowEquilibrium((prev) => {
      const next = !prev;
      try { localStorage.setItem("chart_show_equilibrium", String(next)); } catch {}
      return next;
    });
  };

  // ICT Sessions & Kill Zones (Asia, London, NY) State
  const [showICTSessions, setShowICTSessions] = useState<boolean>(() => {
    try {
      return localStorage.getItem("chart_show_ict_sessions") !== "false";
    } catch {}
    return true;
  });

  const toggleICTSessions = () => {
    setShowICTSessions((prev) => {
      const next = !prev;
      try { localStorage.setItem("chart_show_ict_sessions", String(next)); } catch {}
      return next;
    });
  };

  // ICT Silver Bullet Windows (1-Hour High-Probability Windows) State
  const [showSilverBullet, setShowSilverBullet] = useState<boolean>(() => {
    try {
      return localStorage.getItem("chart_show_silver_bullet") !== "false";
    } catch {}
    return true;
  });

  const toggleSilverBullet = () => {
    setShowSilverBullet((prev) => {
      const next = !prev;
      try { localStorage.setItem("chart_show_silver_bullet", String(next)); } catch {}
      return next;
    });
  };

  // ICT Optimal Trade Entry (OTE 0.618 - 0.705 ⭐ - 0.790) State
  const [showOTE, setShowOTE] = useState<boolean>(() => {
    try {
      return localStorage.getItem("chart_show_ote") !== "false";
    } catch {}
    return true;
  });

  const toggleOTE = () => {
    setShowOTE((prev) => {
      const next = !prev;
      try { localStorage.setItem("chart_show_ote", String(next)); } catch {}
      return next;
    });
  };

  // ICT Judas Swing Alerts (Session Open False Expansion & Fakeout Traps) State
  const [showJudas, setShowJudas] = useState<boolean>(() => {
    try {
      return localStorage.getItem("chart_show_judas") !== "false";
    } catch {}
    return true;
  });

  const toggleJudas = () => {
    setShowJudas((prev) => {
      const next = !prev;
      try { localStorage.setItem("chart_show_judas", String(next)); } catch {}
      return next;
    });
  };

  // ICT AMD Power of 3 (Accumulation → Manipulation → Distribution) State
  const [showAMD, setShowAMD] = useState<boolean>(() => {
    try {
      return localStorage.getItem("chart_show_amd") !== "false";
    } catch {}
    return true;
  });

  const toggleAMD = () => {
    setShowAMD((prev) => {
      const next = !prev;
      try { localStorage.setItem("chart_show_amd", String(next)); } catch {}
      return next;
    });
  };

  // Phase 3 — Supply & Demand Zones (Fresh / Tested origin boxes)
  const [showSD, setShowSD] = useState<boolean>(() => {
    try {
      return localStorage.getItem("chart_show_sd") !== "false";
    } catch {}
    return true;
  });

  const toggleSD = () => {
    setShowSD((prev) => {
      const next = !prev;
      try { localStorage.setItem("chart_show_sd", String(next)); } catch {}
      return next;
    });
  };

  // Phase 3 — Trendline Liquidity (Diagonal Support & Resistance with touch count + breakout)
  const [showTL, setShowTL] = useState<boolean>(() => {
    try {
      return localStorage.getItem("chart_show_tl") !== "false";
    } catch {}
    return true;
  });

  const toggleTL = () => {
    setShowTL((prev) => {
      const next = !prev;
      try { localStorage.setItem("chart_show_tl", String(next)); } catch {}
      return next;
    });
  };

  // Phase 3 — Candlestick Reversal Patterns (Pinbar, Engulfing, Inside Bar)
  const [showCP, setShowCP] = useState<boolean>(() => {
    try {
      return localStorage.getItem("chart_show_cp") !== "false";
    } catch {}
    return true;
  });

  const toggleCP = () => {
    setShowCP((prev) => {
      const next = !prev;
      try { localStorage.setItem("chart_show_cp", String(next)); } catch {}
      return next;
    });
  };

  // Futures Setup Scanner State (persisted to localStorage)
  const [showSetupScan, setShowSetupScan] = useState<boolean>(() => {
    try {
      return localStorage.getItem("chart_show_setup_scan") !== "false";
    } catch {}
    return true;
  });

  const toggleSetupScan = () => {
    setShowSetupScan((prev) => {
      const next = !prev;
      try { localStorage.setItem("chart_show_setup_scan", String(next)); } catch {}
      return next;
    });
  };

  // Futures Setup Scanner Collapsed State & Auto-Collapse Threshold Timer
  const [isScannerCollapsed, setIsScannerCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("chart_scanner_collapsed") === "true";
    } catch {}
    return false;
  });

  const autoCollapseTimerRef = useRef<NodeJS.Timeout | null>(null);

  const startAutoCollapseTimer = (delayMs = 10000) => {
    if (autoCollapseTimerRef.current) clearTimeout(autoCollapseTimerRef.current);
    autoCollapseTimerRef.current = setTimeout(() => {
      setIsScannerCollapsed(true);
      try { localStorage.setItem("chart_scanner_collapsed", "true"); } catch {}
    }, delayMs);
  };

  const clearAutoCollapseTimer = () => {
    if (autoCollapseTimerRef.current) {
      clearTimeout(autoCollapseTimerRef.current);
      autoCollapseTimerRef.current = null;
    }
  };

  const toggleScannerCollapsed = () => {
    setIsScannerCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem("chart_scanner_collapsed", String(next)); } catch {}
      if (!next) {
        startAutoCollapseTimer(10000);
      } else {
        clearAutoCollapseTimer();
      }
      return next;
    });
  };

  // Group Master Toggle Helpers
  const isAnyInd = indicatorVisibility.sma20 || indicatorVisibility.ema9;
  const toggleIndicatorsGroup = () => {
    const nextVal = !isAnyInd;
    if (smaSeriesRef.current) smaSeriesRef.current.applyOptions({ visible: nextVal });
    if (emaSeriesRef.current) emaSeriesRef.current.applyOptions({ visible: nextVal });
    const next = { sma20: nextVal, ema9: nextVal };
    setIndicatorVisibility(next);
    try { localStorage.setItem("chart_indicator_visibility", JSON.stringify(next)); } catch {}
  };

  const isAnySmc = showFVG || showOB || showStructure || showLiquidity || showEquilibrium;
  const smcActiveCount = [showFVG, showOB, showStructure, showLiquidity, showEquilibrium].filter(Boolean).length;
  const toggleSMCGroup = () => {
    const nextVal = !isAnySmc;
    setShowFVG(nextVal);
    setShowOB(nextVal);
    setShowStructure(nextVal);
    setShowLiquidity(nextVal);
    setShowEquilibrium(nextVal);
    try {
      localStorage.setItem("chart_show_fvg", String(nextVal));
      localStorage.setItem("chart_show_ob", String(nextVal));
      localStorage.setItem("chart_show_structure", String(nextVal));
      localStorage.setItem("chart_show_liquidity", String(nextVal));
      localStorage.setItem("chart_show_equilibrium", String(nextVal));
    } catch {}
  };

  const isAnyIct = showICTSessions || showSilverBullet || showOTE || showJudas || showAMD;
  const ictActiveCount = [showICTSessions, showSilverBullet, showOTE, showJudas, showAMD].filter(Boolean).length;
  const toggleICTGroup = () => {
    const nextVal = !isAnyIct;
    setShowICTSessions(nextVal);
    setShowSilverBullet(nextVal);
    setShowOTE(nextVal);
    setShowJudas(nextVal);
    setShowAMD(nextVal);
    try {
      localStorage.setItem("chart_show_ict_sessions", String(nextVal));
      localStorage.setItem("chart_show_silver_bullet", String(nextVal));
      localStorage.setItem("chart_show_ote", String(nextVal));
      localStorage.setItem("chart_show_judas", String(nextVal));
      localStorage.setItem("chart_show_amd", String(nextVal));
    } catch {}
  };

  const isAnyAdv = showSD || showTL || showCP;
  const advActiveCount = [showSD, showTL, showCP].filter(Boolean).length;
  const toggleAdvancedGroup = () => {
    const nextVal = !isAnyAdv;
    setShowSD(nextVal);
    setShowTL(nextVal);
    setShowCP(nextVal);
    try {
      localStorage.setItem("chart_show_sd", String(nextVal));
      localStorage.setItem("chart_show_tl", String(nextVal));
      localStorage.setItem("chart_show_cp", String(nextVal));
    } catch {}
  };

  // ---- Indicator sets: grouped master toggles + independent per-indicator toggles ----
  const persistIndicator = (key: string, value: boolean) => {
    try { localStorage.setItem(key, String(value)); } catch {}
  };

  const INDICATORS: Record<string, IndicatorMeta> = {
    sma20: {
      label: "SMA 20", color: "#00E5FF",
      get: () => indicatorVisibility.sma20,
      set: (v) => { setIndicatorVisibility((prev) => { const next = { ...prev, sma20: v }; try { localStorage.setItem("chart_indicator_visibility", JSON.stringify(next)); } catch {} return next; }); },
    },
    ema9: {
      label: "EMA 9", color: "#FFD700",
      get: () => indicatorVisibility.ema9,
      set: (v) => { setIndicatorVisibility((prev) => { const next = { ...prev, ema9: v }; try { localStorage.setItem("chart_indicator_visibility", JSON.stringify(next)); } catch {} return next; }); },
    },
    fvg: { label: "Fair Value Gaps (FVG)", color: "#00F5A0", get: () => showFVG, set: (v) => { persistIndicator("chart_show_fvg", v); setShowFVG(v); } },
    ob: { label: "Order Blocks (OB)", color: "#FF495C", get: () => showOB, set: (v) => { persistIndicator("chart_show_ob", v); setShowOB(v); } },
    structure: { label: "Market Structure (BOS/CHoCH)", color: "#00F5A0", get: () => showStructure, set: (v) => { persistIndicator("chart_show_structure", v); setShowStructure(v); } },
    liquidity: { label: "Liquidity Pools (BSL/SSL)", color: "#00E5FF", get: () => showLiquidity, set: (v) => { persistIndicator("chart_show_liquidity", v); setShowLiquidity(v); } },
    equilibrium: { label: "Equilibrium (P/D)", color: "#FFD700", get: () => showEquilibrium, set: (v) => { persistIndicator("chart_show_equilibrium", v); setShowEquilibrium(v); } },
    ictSessions: { label: "ICT Kill Zones (Asia/LDN/NY)", color: "#9333EA", get: () => showICTSessions, set: (v) => { persistIndicator("chart_show_ict_sessions", v); setShowICTSessions(v); } },
    silverBullet: { label: "Silver Bullet Windows", color: "#FFD700", get: () => showSilverBullet, set: (v) => { persistIndicator("chart_show_silver_bullet", v); setShowSilverBullet(v); } },
    ote: { label: "Optimal Trade Entry (OTE)", color: "#00E5FF", get: () => showOTE, set: (v) => { persistIndicator("chart_show_ote", v); setShowOTE(v); } },
    judas: { label: "Judas Swing Alerts", color: "#FF495C", get: () => showJudas, set: (v) => { persistIndicator("chart_show_judas", v); setShowJudas(v); } },
    amd: { label: "AMD Power of 3 (A→M→D)", color: "#FFAA00", get: () => showAMD, set: (v) => { persistIndicator("chart_show_amd", v); setShowAMD(v); } },
    sd: { label: "Supply & Demand Zones", color: "#00F5A0", get: () => showSD, set: (v) => { persistIndicator("chart_show_sd", v); setShowSD(v); } },
    tl: { label: "Trendline Liquidity (S/R)", color: "#00F5A0", get: () => showTL, set: (v) => { persistIndicator("chart_show_tl", v); setShowTL(v); } },
    cp: { label: "Candlestick Patterns", color: "#FFD700", icon: "🔨", get: () => showCP, set: (v) => { persistIndicator("chart_show_cp", v); setShowCP(v); } },
  };

  const INDICATOR_SETS: IndicatorSetDef[] = [
    { id: "ma", label: "MOVING AVERAGES", keys: ["sma20", "ema9"] },
    { id: "smc", label: "SMART MONEY CONCEPTS (SMC)", keys: ["fvg", "ob", "structure", "liquidity", "equilibrium"] },
    { id: "ict", label: "ICT", keys: ["ictSessions", "silverBullet", "ote", "judas", "amd"] },
    { id: "pa", label: "PRICE ACTION", keys: ["sd", "tl", "cp"] },
  ];

  const renderIndicatorSet = (set: IndicatorSetDef) => {
    const onCount = set.keys.filter((k) => INDICATORS[k].get()).length;
    const allOn = onCount === set.keys.length;
    return (
      <div key={set.id}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", fontSize: "10px", color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.5px", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "4px", marginTop: "8px" }}>
          <span>{set.label}</span>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "9px", fontWeight: 600, color: allOn ? "var(--accent-green)" : onCount > 0 ? "var(--accent-cyan)" : "var(--text-muted)" }}>
              {onCount}/{set.keys.length}
            </span>
            <button
              onClick={() => set.keys.forEach((k) => INDICATORS[k].set(!allOn))}
              title={allOn ? `Hide all ${set.label}` : `Show all ${set.label}`}
              style={{ background: "transparent", border: "none", color: allOn ? "var(--accent-green)" : "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", padding: "2px" }}
            >
              {allOn ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
          </div>
        </div>
        {set.keys.map((k) => {
          const meta = INDICATORS[k];
          const on = meta.get();
          return (
            <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginTop: "2px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                {meta.icon ? (
                  <span style={{ fontSize: "11px" }}>{meta.icon}</span>
                ) : (
                  <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: meta.color }} />
                )}
                <span style={{ fontSize: "11px", fontWeight: 600, color: on ? "#FFFFFF" : "var(--text-muted)" }}>{meta.label}</span>
              </div>
              <button
                onClick={() => meta.set(!on)}
                title={on ? `Hide ${meta.label}` : `Show ${meta.label}`}
                style={{ background: "transparent", border: "none", color: on ? meta.color : "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", padding: "2px" }}
              >
                {on ? <Eye size={13} /> : <EyeOff size={13} />}
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  // MTF bias timeframe: AUTO uses the Binance ladder, otherwise a multiple of the base interval
  const [biasTfMult, setBiasTfMult] = useState<number | null>(() => {
    try {
      const saved = localStorage.getItem("chart_bias_tf_mult");
      if (saved !== null && saved !== "auto") return Number(saved) || null;
    } catch {}
    return null;
  });

  const changeBiasTf = (mult: number | null) => {
    setBiasTfMult(mult);
    try { localStorage.setItem("chart_bias_tf_mult", mult === null ? "auto" : String(mult)); } catch {}
  };

  const [setupSignal, setSetupSignal] = useState<SetupSignal | null>(null);

  // Auto-Expand on new signal update, then trigger 10s auto-collapse timer
  useEffect(() => {
    if (!setupSignal || !showSetupScan) return;
    setIsScannerCollapsed(false);
    try { localStorage.setItem("chart_scanner_collapsed", "false"); } catch {}
    startAutoCollapseTimer(10000);
  }, [setupSignal]);

  // ---- Paper trading engine state (forward-testing the setup scanner) ----
  const [paperEnabled, setPaperEnabled] = useState(() => {
    try { return localStorage.getItem("binance_paper_enabled") === "1"; } catch { return false; }
  });
  const [paperAccount, setPaperAccount] = useState<PaperAccount>(() => loadPaperAccount(symbol) ?? createPaperAccount(symbol));
  const [paperLog, setPaperLog] = useState<string[]>([]);
  const paperEnabledRef = useRef(paperEnabled);
  useEffect(() => {
    paperEnabledRef.current = paperEnabled;
  }, [paperEnabled]);
  const paperRef = useRef<{ signal: SetupSignal | null; acc: PaperAccount; spot: number }>({
    signal: null,
    acc: paperAccount,
    spot: 0,
  });
  useEffect(() => {
    paperRef.current = {
      signal: setupSignal,
      acc: paperAccount,
      spot: targetPriceRef.current ?? lastCandleValRef.current?.close ?? 0,
    };
    savePaperAccount(paperAccount);
  }, [setupSignal, paperAccount]);

  const togglePaper = () => {
    setPaperEnabled((prev) => {
      const next = !prev;
      try { localStorage.setItem("binance_paper_enabled", next ? "1" : "0"); } catch {}
      return next;
    });
  };

  const resetPaper = () => {
    setPaperAccount(resetPaperAccount(symbol));
    setPaperLog(["Account reset — fresh $100,000 USDT"]);
  };

  const closeOpenPaper = async () => {
    const acc = paperRef.current.acc;
    if (!acc.open) return;
    const exitPrice = paperRef.current.spot || acc.open.lastPrice;
    setPaperAccount((prev) => {
      const { acc: closedAcc, trade } = closePaperPosition(prev, exitPrice, Date.now(), "MANUAL");
      if (trade) {
        logPaper(`MANUAL CLOSE ${trade.side} @ $${trade.exitPrice.toFixed(2)} ${trade.pnl >= 0 ? "+" : ""}$${trade.pnl.toFixed(2)} (${trade.returnPct}%)`);
      }
      return closedAcc;
    });
  };

  // Fresh paper account when switching symbols
  useEffect(() => {
    setPaperAccount(loadPaperAccount(symbol) ?? createPaperAccount(symbol));
    setPaperLog([]);
  }, [symbol]);

  const logPaper = (msg: string) => {
    setPaperLog((prev) => [...prev.slice(-4), msg]);
  };

  const paperTick = async () => {
    const { signal, acc, spot } = paperRef.current;
    const now = Date.now();

    // Quote target: the open position, else the scanner's recommended entry
    const open = acc.open;
    const recommendation = signal?.recommendedEntry;
    const wantOpen = !open && recommendation !== undefined;
    const price = open ? spot || open.lastPrice : recommendation?.entry.price ?? 0;
    if (!price || price <= 0 || (!open && !wantOpen)) return;

    setPaperAccount((prev) => {
      let nextAcc = prev;
      if (prev.open) {
        const { acc: marked, trade } = markPaperPosition(prev, price, now);
        if (trade) {
          const side = `${trade.side} @ $${trade.exitPrice.toFixed(2)}`;
          logPaper(`${trade.exitReason === "STOP" ? "STOP" : "TARGET"} CLOSE ${side} ${trade.pnl >= 0 ? "+" : ""}$${trade.pnl.toFixed(2)} (${trade.returnPct}%)`);
          return marked;
        }
        // Bias flip: close when the scanner emits the opposite direction
        const dir = paperRef.current.signal?.direction;
        const flipped =
          (prev.open.side === "LONG" && dir === "SHORT") ||
          (prev.open.side === "SHORT" && dir === "LONG");
        if (flipped) {
          const { acc: closedAcc, trade: flipTrade } = closePaperPosition(marked, price, now, "FLIP");
          if (flipTrade) {
            logPaper(`FLIP CLOSE ${flipTrade.side} @ $${flipTrade.exitPrice.toFixed(2)} ${flipTrade.pnl >= 0 ? "+" : ""}$${flipTrade.pnl.toFixed(2)} (${flipTrade.returnPct}%)`);
          }
          return closedAcc;
        }
        nextAcc = marked;
      } else if (wantOpen) {
        const opened = openPaperPosition(prev, {
          side: recommendation.side,
          entryPrice: price,
          estimatedEntry: false,
          now,
        });
        if (opened.open) {
          logPaper(
            `OPEN ${opened.open.side} ${symbol.toUpperCase()} @ $${opened.open.entryPrice.toFixed(2)} × ${opened.open.qty} · stop $${opened.open.stopPrice.toFixed(2)} · tgt $${opened.open.targetPrice.toFixed(2)}`
          );
        }
        nextAcc = opened;
      }
      return nextAcc;
    });
  };

  const runSetupScan = () => {
    const price = targetPriceRef.current ?? lastCandleValRef.current?.close;
    if (price === undefined || price === null) return;

    const baseMin = parseInt(interval, 10) || 15;
    const htfMult = biasTfMult ?? autoHtfMult(baseMin);
    const htfMin = htfMult * baseMin;
    const htfLabel = htfMin >= 60 ? `${htfMin / 60}h` : `${htfMin}m`;
    const htfCandles = getHtfCached(htfMult, "candles", () =>
      resampleCandles(allCandlesRef.current, htfMin * 60)
    );
    const htf: HtfBias = {
      tfLabel: htfLabel,
      structure: getHtfCached(htfMult, "structure", () => detectMarketStructure(htfCandles.slice(-1000))),
      amd: getHtfCached(htfMult, "amd", () => detectAMDCycles(htfCandles.slice(-1000))),
      liquidity: getHtfCached(htfMult, "liquidity", () => detectLiquidityPools(htfCandles.slice(-1000))),
      judas: getHtfCached(htfMult, "judas", () => detectJudasSwings(htfCandles.slice(-1000))),
    };

    const signal = scanSetups({
      lastPrice: price,
      fvg: getCached("fvg", () => detectFVGs(allCandlesRef.current)),
      ob: getCached("ob", () => detectOrderBlocks(allCandlesRef.current)),
      structure: getCached("structure", () => detectMarketStructure(latestNCandles(1000))),
      liquidity: getCached("liquidity", () => detectLiquidityPools(latestNCandles(1000))),
      pd: getCached("pd", () => detectPremiumDiscount(allCandlesRef.current)),
      sessions: getCached("sessions", () => detectICTSessions(allCandlesRef.current)),
      sb: getCached("sb", () => detectSilverBulletWindows(allCandlesRef.current)),
      ote: getCached("ote", () => detectICTOTEZone(allCandlesRef.current)),
      judas: getCached("judas", () => detectJudasSwings(allCandlesRef.current)),
      amd: getCached("amd", () => detectAMDCycles(latestNCandles(1000))),
      sd: getCached("sd", () => detectSupplyDemandZones(latestNCandles(1000))),
      tl: getCached("tl", () => detectTrendlineLiquidity(latestNCandles(1000))),
      cp: getCached("cp", () => detectCandlestickPatterns(latestNCandles(1000))),
      htf,
      symbol,
    });
    const key = `${signal.direction}|${signal.bias}|${signal.alignedCount}|${signal.biasTf ?? "ltf"}|${htfMult}|${signal.recommendedEntry?.entry.price ?? ""}`;
    if (key !== lastSignalKeyRef.current) {
      lastSignalKeyRef.current = key;
      setSetupSignal(signal);
    }
  };

  // Poll scan inputs (data version / live price) every 3s; re-emits only on
  // meaningful signal changes so the UI does not re-render every tick
  useEffect(() => {
    if (!showSetupScan) return;
    const scan = () => {
      if (paperEnabledRef.current) paperTick();
      const baseMin = parseInt(interval, 10) || 15;
      const htfMult = biasTfMult ?? autoHtfMult(baseMin);
      const dataKey = `${candlesVersion(allCandlesRef.current)}|${htfMult}`;
      const price = targetPriceRef.current ?? lastCandleValRef.current?.close ?? null;
      if (scanVersionRef.current === dataKey && scanPriceRef.current === price) return;
      scanVersionRef.current = dataKey;
      scanPriceRef.current = price;
      runSetupScan();
    };
    const id = setInterval(scan, 3000);
    scan();
    return () => clearInterval(id);
  }, [showSetupScan, biasTfMult, interval]);

  // Single redraw trigger for every overlay feature toggle (rAF-coalesced)
  useEffect(() => {
    scheduleDraw();
  }, [
    showFVG, showOB, showStructure, showLiquidity, showEquilibrium,
    showICTSessions, showSilverBullet, showOTE, showJudas, showAMD,
    showSD, showTL, showCP,
  ]);

  // Latest overlay visibility flags, read from refs inside drawSMCBoxes so the
  // rAF/scroll/loop closures never render stale toggles
  const smcFlagsRef = useRef({
    fvg: true, ob: true, structure: true, liquidity: true, equilibrium: true,
    ictSessions: true, silverBullet: true, ote: true, judas: true, amd: true,
    sd: true, tl: true, cp: true,
  });
  smcFlagsRef.current = {
    fvg: showFVG,
    ob: showOB,
    structure: showStructure,
    liquidity: showLiquidity,
    equilibrium: showEquilibrium,
    ictSessions: showICTSessions,
    silverBullet: showSilverBullet,
    ote: showOTE,
    judas: showJudas,
    amd: showAMD,
    sd: showSD,
    tl: showTL,
    cp: showCP,
  };

  const smcCanvasRef = useRef<HTMLCanvasElement>(null);

  // Render: FVG + OB + Structure + Liquidity + P/D + Sessions + Silver Bullet + OTE + Judas + AMD + S&D + Trendlines + Candlestick Patterns
  const drawSMCBoxes = () => {
    const canvas = smcCanvasRef.current;
    if (!canvas || !chartRef.current || !seriesRef.current) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = chartContainerRef.current?.clientWidth || canvas.width;
    const height = chartContainerRef.current?.clientHeight || canvas.height;
    const dpr = window.devicePixelRatio || 1;
    const renderWidth = Math.round(width * dpr);
    const renderHeight = Math.round(height * dpr);
    if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
      canvas.width = renderWidth;
      canvas.height = renderHeight;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const timeScale = chartRef.current.timeScale();
    const series = seriesRef.current;

    const maxVisibleX = width - 70; // Hard boundary to prevent elements from bleeding into price scale axis

    // 1. Draw Shaded Valid Active FVG Boxes
    if (smcFlagsRef.current.fvg && allCandlesRef.current.length >= 3) {
      const activeFVGs = getCached("fvg", () => detectFVGs(allCandlesRef.current))
        .filter((f) => !f.mitigated)
        .slice(-4);

      activeFVGs.forEach((fvg) => {
        const yTop = series.priceToCoordinate(fvg.top);
        const yBot = series.priceToCoordinate(fvg.bottom);
        const xStart = timeScale.timeToCoordinate(fvg.startTime);
        const xEnd = timeScale.timeToCoordinate(fvg.endTime);

        if (yTop !== null && yBot !== null) {
          const isBull = fvg.type === "BULLISH";
          const startX = xStart !== null ? Math.max(0, xStart) : 0;
          const endX = xEnd !== null ? Math.min(maxVisibleX, xEnd) : maxVisibleX;
          const boxWidth = endX - startX;

          if (boxWidth <= 5 || startX >= maxVisibleX) return;

          ctx.fillStyle = isBull ? "rgba(0, 245, 160, 0.14)" : "rgba(255, 73, 92, 0.14)";
          ctx.fillRect(startX, yTop, boxWidth, yBot - yTop);

          ctx.strokeStyle = isBull ? "rgba(0, 245, 160, 0.6)" : "rgba(255, 73, 92, 0.6)";
          ctx.lineWidth = 1;
          ctx.strokeRect(startX, yTop, boxWidth, yBot - yTop);

          ctx.fillStyle = isBull ? "#00F5A0" : "#FF495C";
          ctx.font = "bold 9px monospace";
          ctx.fillText(isBull ? "BULL FVG" : "BEAR FVG", startX + 4, yTop + 11);
        }
      });
    }

    // 2. Draw Shaded Valid Active OB Boxes
    if (smcFlagsRef.current.ob && allCandlesRef.current.length >= 5) {
      const activeOBs = getCached("ob", () => detectOrderBlocks(allCandlesRef.current))
        .filter((o) => !o.mitigated)
        .slice(-3);

      activeOBs.forEach((ob) => {
        const yTop = series.priceToCoordinate(ob.top);
        const yBot = series.priceToCoordinate(ob.bottom);
        const xStart = timeScale.timeToCoordinate(ob.startTime);
        const xEnd = timeScale.timeToCoordinate(ob.endTime);

        if (yTop !== null && yBot !== null) {
          const isBull = ob.type === "BULLISH_OB";
          const startX = xStart !== null ? Math.max(0, xStart) : 0;
          const endX = xEnd !== null ? Math.min(maxVisibleX, xEnd) : maxVisibleX;
          const boxWidth = endX - startX;

          if (boxWidth <= 5 || startX >= maxVisibleX) return;

          ctx.fillStyle = isBull ? "rgba(0, 229, 255, 0.18)" : "rgba(236, 72, 153, 0.18)";
          ctx.fillRect(startX, yTop, boxWidth, yBot - yTop);

          ctx.strokeStyle = isBull ? "rgba(0, 229, 255, 0.8)" : "rgba(236, 72, 153, 0.8)";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(startX, yTop, boxWidth, yBot - yTop);

          ctx.fillStyle = isBull ? "#00E5FF" : "#EC4899";
          ctx.font = "bold 9px monospace";
          ctx.fillText(isBull ? "DEMAND OB" : "SUPPLY OB", startX + 4, yTop + 11);
        }
      });
    }

    // 3. Draw Market Structure Lines (Macro/Major BOS & CHoCH + Micro/Internal iBOS & iCHoCH)
    if (smcFlagsRef.current.structure && allCandlesRef.current.length >= 10) {
      const structBreaks = getCached("structure", () => detectMarketStructure(latestNCandles(1000))).slice(-8);

      structBreaks.forEach((sb) => {
        const yLine = series.priceToCoordinate(sb.level);
        const xSwing = timeScale.timeToCoordinate(sb.swingTime);
        const xBreak = timeScale.timeToCoordinate(sb.breakTime);

        if (yLine !== null) {
          const isBull = sb.type.startsWith("BULLISH");
          const isChoch = sb.type.includes("CHOCH");
          const isMajor = sb.category === "MAJOR";

          const startX = xSwing !== null ? Math.max(0, xSwing) : 0;
          const endX = xBreak !== null ? Math.min(maxVisibleX, xBreak) : maxVisibleX;
          const lineWidth = endX - startX;

          if (lineWidth <= 5 || startX >= maxVisibleX) return;

          let strokeColor = isBull ? "#00F5A0" : "#FF495C";
          if (!isMajor) {
            strokeColor = isBull ? "#00E5FF" : "#EC4899";
          }

          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = isMajor ? (isChoch ? 2.0 : 1.5) : (isChoch ? 1.2 : 1.0);

          if (isMajor) {
            ctx.setLineDash(isChoch ? [] : [6, 4]);
          } else {
            ctx.setLineDash(isChoch ? [] : [2, 3]);
          }

          ctx.beginPath();
          ctx.moveTo(startX, yLine);
          ctx.lineTo(endX, yLine);
          ctx.stroke();
          ctx.setLineDash([]);

          let labelText = "";
          if (isMajor) {
            labelText = isChoch ? (isBull ? "MAJOR CHoCH 🟢" : "MAJOR CHoCH 🔴") : (isBull ? "MAJOR BOS 🟢" : "MAJOR BOS 🔴");
          } else {
            labelText = isChoch ? (isBull ? "iCHoCH 🟢" : "iCHoCH 🔴") : (isBull ? "iBOS 🟢" : "iBOS 🔴");
          }

          const centerX = startX + lineWidth / 2;
          const labelY = isBull ? yLine - 5 : yLine + 12;

          ctx.fillStyle = strokeColor;
          ctx.font = isMajor ? "bold 10px monospace" : "bold 9px monospace";
          ctx.textAlign = "center";
          ctx.fillText(labelText, centerX, labelY);
          ctx.textAlign = "left";
        }
      });
    }

    // 4. Draw Liquidity Pools (BSL & SSL) and Sweep Badges
    if (smcFlagsRef.current.liquidity && allCandlesRef.current.length >= 10) {
      const pools = getCached("liquidity", () => detectLiquidityPools(latestNCandles(1000))).slice(-6);

      pools.forEach((pool) => {
        const yLine = series.priceToCoordinate(pool.level);
        const xStart = timeScale.timeToCoordinate(pool.startTime);
        const targetEnd = pool.swept ? (pool.sweepTime || pool.startTime) : allCandlesRef.current[allCandlesRef.current.length - 1].time;
        const xEnd = timeScale.timeToCoordinate(targetEnd);

        if (yLine !== null) {
          const isBSL = pool.type === "BSL";
          const startX = xStart !== null ? Math.max(0, xStart) : 0;
          const endX = xEnd !== null ? Math.min(maxVisibleX, xEnd) : maxVisibleX;
          const lineWidth = endX - startX;

          if (lineWidth <= 5 || startX >= maxVisibleX) return;

          const color = isBSL ? "#00E5FF" : "#EC4899";
          ctx.strokeStyle = color;
          ctx.lineWidth = pool.swept ? 1.5 : 1.0;

          ctx.setLineDash([2, 2]);
          ctx.beginPath();
          ctx.moveTo(startX, yLine);
          ctx.lineTo(endX, yLine);
          ctx.stroke();
          ctx.setLineDash([]);

          const labelText = isBSL
            ? (pool.swept ? "BSL SWEEPT ⚡" : "BSL (Equal Highs)")
            : (pool.swept ? "SSL SWEEPT ⚡" : "SSL (Equal Lows)");
          const centerX = startX + lineWidth / 2;
          const labelY = isBSL ? yLine - 4 : yLine + 11;

          ctx.fillStyle = pool.swept ? (isBSL ? "#00F5A0" : "#FF495C") : color;
          ctx.font = "bold 9px monospace";
          ctx.textAlign = "center";
          ctx.fillText(labelText, centerX, labelY);
          ctx.textAlign = "left";

          if (pool.swept && pool.sweepTime) {
            const xSweep = timeScale.timeToCoordinate(pool.sweepTime);
            if (xSweep !== null && xSweep < maxVisibleX) {
              ctx.fillStyle = isBSL ? "rgba(0, 245, 160, 0.25)" : "rgba(255, 73, 92, 0.25)";
              ctx.fillRect(xSweep - 22, isBSL ? yLine - 22 : yLine + 5, 44, 14);

              ctx.strokeStyle = isBSL ? "#00F5A0" : "#FF495C";
              ctx.lineWidth = 1;
              ctx.strokeRect(xSweep - 22, isBSL ? yLine - 22 : yLine + 5, 44, 14);

              ctx.fillStyle = "#FFFFFF";
              ctx.font = "bold 8px monospace";
              ctx.textAlign = "center";
              ctx.fillText("SWEEPT ⚡", xSweep, isBSL ? yLine - 12 : yLine + 15);
              ctx.textAlign = "left";
            }
          }
        }
      });
    }

    // 5. Draw Premium vs. Discount Equilibrium Zones (0.50 Midline)
    if (smcFlagsRef.current.equilibrium && allCandlesRef.current.length >= 20) {
      const pd = getCached("pd", () => detectPremiumDiscount(allCandlesRef.current));
      if (pd) {
        const yHigh = series.priceToCoordinate(pd.swingHigh);
        const yLow = series.priceToCoordinate(pd.swingLow);
        const yEq = series.priceToCoordinate(pd.equilibrium);
        const xStart = timeScale.timeToCoordinate(pd.startTime);

        if (yHigh !== null && yLow !== null && yEq !== null) {
          const startX = xStart !== null ? Math.max(0, xStart) : 0;
          const boxWidth = Math.max(30, maxVisibleX - startX);

          if (startX < maxVisibleX) {
            // A. Premium Zone (Overvalued / Sell Zone)
            ctx.fillStyle = "rgba(255, 73, 92, 0.05)";
            ctx.fillRect(startX, yHigh, boxWidth, yEq - yHigh);

            // B. Discount Zone (Undervalued / Buy Zone)
            ctx.fillStyle = "rgba(0, 245, 160, 0.05)";
            ctx.fillRect(startX, yEq, boxWidth, yLow - yEq);

            // C. 0.50 Equilibrium Midline
            ctx.strokeStyle = "#FFD700";
            ctx.lineWidth = 1.2;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(startX, yEq);
            ctx.lineTo(maxVisibleX, yEq);
            ctx.stroke();
            ctx.setLineDash([]);

            // Centered Midline Label
            const centerX = startX + boxWidth / 2;
            ctx.fillStyle = "#FFD700";
            ctx.font = "bold 9px monospace";
            ctx.textAlign = "center";
            ctx.fillText("0.50 EQUILIBRIUM", centerX, yEq - 4);

            // Premium & Discount Corner Watermark Tags
            ctx.fillStyle = "rgba(255, 73, 92, 0.7)";
            ctx.font = "bold 9px monospace";
            ctx.textAlign = "right";
            ctx.fillText("PREMIUM (SELL ZONE)", maxVisibleX - 10, yHigh + 14);

            ctx.fillStyle = "rgba(0, 245, 160, 0.7)";
            ctx.fillText("DISCOUNT (BUY ZONE)", maxVisibleX - 10, yLow - 6);
            ctx.textAlign = "left";
          }
        }
      }
    }

    // 6. Draw ICT Sessions & Kill Zones (Asia Range, London KZ, New York KZ)
    if (smcFlagsRef.current.ictSessions && allCandlesRef.current.length >= 10) {
      const sessions = getCached("sessions", () => detectICTSessions(allCandlesRef.current)).slice(-10);

      sessions.forEach((s) => {
        const xStart = timeScale.timeToCoordinate(s.startTime);
        const xEnd = timeScale.timeToCoordinate(s.endTime);

        if (xStart !== null) {
          const startX = Math.max(0, xStart);
          const endX = xEnd !== null ? Math.min(maxVisibleX, xEnd) : maxVisibleX;
          const bandWidth = endX - startX;

          if (bandWidth <= 4 || startX >= maxVisibleX) return;

          let bgStyle = "rgba(147, 51, 234, 0.08)";
          let strokeStyle = "#9333EA";
          let badgeBg = "#9333EA";

          if (s.type === "LONDON") {
            bgStyle = "rgba(0, 229, 255, 0.09)";
            strokeStyle = "#00E5FF";
            badgeBg = "#00E5FF";
          } else if (s.type === "NEW_YORK") {
            bgStyle = "rgba(255, 170, 0, 0.09)";
            strokeStyle = "#FFAA00";
            badgeBg = "#FFAA00";
          }

          ctx.fillStyle = bgStyle;
          ctx.fillRect(startX, 0, bandWidth, height);

          ctx.strokeStyle = strokeStyle;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(startX, 2);
          ctx.lineTo(endX, 2);
          ctx.stroke();

          const centerX = startX + bandWidth / 2;
          ctx.fillStyle = badgeBg;
          ctx.font = "bold 8px monospace";
          ctx.textAlign = "center";
          ctx.fillText(s.name, centerX, 12);
          ctx.textAlign = "left";
        }
      });
    }

    // 7. Draw ICT Silver Bullet Windows (London SB, NY AM SB, NY PM SB)
    if (smcFlagsRef.current.silverBullet && allCandlesRef.current.length >= 10) {
      const sbWindows = getCached("sb", () => detectSilverBulletWindows(allCandlesRef.current)).slice(-6);

      sbWindows.forEach((sb) => {
        const xStart = timeScale.timeToCoordinate(sb.startTime);
        const xEnd = timeScale.timeToCoordinate(sb.endTime);

        if (xStart !== null) {
          const startX = Math.max(0, xStart);
          const endX = xEnd !== null ? Math.min(maxVisibleX, xEnd) : maxVisibleX;
          const bandWidth = endX - startX;

          if (bandWidth <= 4 || startX >= maxVisibleX) return;

          ctx.fillStyle = "rgba(255, 215, 0, 0.12)";
          ctx.fillRect(startX, 0, bandWidth, height);

          ctx.strokeStyle = "rgba(255, 215, 0, 0.8)";
          ctx.lineWidth = 1.2;
          ctx.setLineDash([3, 3]);

          ctx.beginPath();
          ctx.moveTo(startX, 0);
          ctx.lineTo(startX, height);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(endX, 0);
          ctx.lineTo(endX, height);
          ctx.stroke();

          ctx.setLineDash([]);

          const centerX = startX + bandWidth / 2;
          ctx.fillStyle = "rgba(255, 215, 0, 0.25)";
          ctx.fillRect(centerX - 42, 18, 84, 14);

          ctx.strokeStyle = "#FFD700";
          ctx.lineWidth = 1;
          ctx.strokeRect(centerX - 42, 18, 84, 14);

          ctx.fillStyle = "#FFFFFF";
          ctx.font = "bold 8px monospace";
          ctx.textAlign = "center";
          ctx.fillText("SILVER BULLET 🎯", centerX, 28);
          ctx.textAlign = "left";
        }
      });
    }

    // 8. Draw ICT Optimal Trade Entry (OTE Zone: 0.618 - 0.705 ⭐ - 0.790 Fib Levels)
    if (smcFlagsRef.current.ote && allCandlesRef.current.length >= 20) {
      const ote = getCached("ote", () => detectICTOTEZone(allCandlesRef.current));
      if (ote) {
        const y618 = series.priceToCoordinate(ote.fib618);
        const y705 = series.priceToCoordinate(ote.fib705);
        const y790 = series.priceToCoordinate(ote.fib790);
        const xStart = timeScale.timeToCoordinate(ote.startTime);

        if (y618 !== null && y705 !== null && y790 !== null) {
          const startX = xStart !== null ? Math.max(0, xStart) : 0;
          const boxWidth = Math.max(30, maxVisibleX - startX);

          if (startX < maxVisibleX) {
            const topY = Math.min(y618, y790);
            const botY = Math.max(y618, y790);
            const boxHeight = botY - topY;

            ctx.fillStyle = "rgba(0, 229, 255, 0.12)";
            ctx.fillRect(startX, topY, boxWidth, boxHeight);

            ctx.strokeStyle = "rgba(0, 229, 255, 0.6)";
            ctx.lineWidth = 1;
            ctx.strokeRect(startX, topY, boxWidth, boxHeight);

            ctx.strokeStyle = "#FFD700";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(startX, y705);
            ctx.lineTo(maxVisibleX, y705);
            ctx.stroke();

            const centerX = startX + boxWidth / 2;
            ctx.fillStyle = "#FFD700";
            ctx.font = "bold 9px monospace";
            ctx.textAlign = "center";
            ctx.fillText("0.705 SWEET SPOT ⭐", centerX, y705 - 4);

            ctx.fillStyle = "#00E5FF";
            ctx.font = "bold 8px monospace";
            ctx.textAlign = "right";
            ctx.fillText("0.618 OTE", maxVisibleX - 10, y618 - 3);

            ctx.fillStyle = "#EC4899";
            ctx.fillText("0.790 OTE", maxVisibleX - 10, y790 + 10);
            ctx.textAlign = "left";
          }
        }
      }
    }

    // 9. Draw ICT Judas Swing Alert Badges (Session Open False Expansion / Fakeout Traps)
    if (smcFlagsRef.current.judas && allCandlesRef.current.length >= 15) {
      const judasItems = getCached("judas", () => detectJudasSwings(allCandlesRef.current)).slice(-6);

      judasItems.forEach((j) => {
        const yLine = series.priceToCoordinate(j.level);
        const xCandle = timeScale.timeToCoordinate(j.candleTime);

        if (yLine !== null && xCandle !== null && xCandle < maxVisibleX) {
          const isBearJudas = j.type === "BEARISH_JUDAS";
          const tagBg = isBearJudas ? "rgba(255, 73, 92, 0.25)" : "rgba(0, 245, 160, 0.25)";
          const strokeColor = isBearJudas ? "#FF495C" : "#00F5A0";
          const tagY = isBearJudas ? yLine - 22 : yLine + 6;

          ctx.fillStyle = tagBg;
          ctx.fillRect(xCandle - 45, tagY, 90, 15);

          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = 1;
          ctx.strokeRect(xCandle - 45, tagY, 90, 15);

          ctx.fillStyle = "#FFFFFF";
          ctx.font = "bold 8px monospace";
          ctx.textAlign = "center";
          ctx.fillText(
            isBearJudas ? "JUDAS SWEEPT ⚡ (SELL)" : "JUDAS SWEEPT ⚡ (BUY)",
            xCandle,
            tagY + 10
          );
          ctx.textAlign = "left";
        }
      });
    }

    // 10. Draw ICT AMD Power of 3 (Accumulation → Manipulation → Distribution) Cycle Labels
    if (smcFlagsRef.current.amd && allCandlesRef.current.length >= 20) {
      const amdCycles = getCached("amd", () => detectAMDCycles(latestNCandles(1000))).slice(-3);

      amdCycles.forEach((cycle) => {
        const isBull = cycle.trend === "BULLISH";
        const accentColor = isBull ? "#00F5A0" : "#FF495C";

        const xAccumStart = timeScale.timeToCoordinate(cycle.accumStartTime);
        const xAccumEnd = timeScale.timeToCoordinate(cycle.accumEndTime);
        const xManipStart = timeScale.timeToCoordinate(cycle.manipStartTime);
        const xManipEnd = timeScale.timeToCoordinate(cycle.manipEndTime);
        const xDistribStart = timeScale.timeToCoordinate(cycle.distribStartTime);
        const xDistribEnd = timeScale.timeToCoordinate(cycle.distribEndTime);

        const yAccumTop = series.priceToCoordinate(cycle.accumHigh);
        const yAccumBot = series.priceToCoordinate(cycle.accumLow);
        const yManipLevel = series.priceToCoordinate(cycle.manipLevel);
        const yDistribLevel = series.priceToCoordinate(cycle.distribLevel);

        // A — Accumulation box (neutral orange tint)
        if (xAccumStart !== null && xAccumEnd !== null && yAccumTop !== null && yAccumBot !== null) {
          const ax = Math.max(0, xAccumStart);
          const aw = Math.min(maxVisibleX, xAccumEnd) - ax;
          if (aw > 4 && ax < maxVisibleX) {
            ctx.fillStyle = "rgba(255, 170, 0, 0.10)";
            ctx.fillRect(ax, yAccumTop, aw, yAccumBot - yAccumTop);
            ctx.strokeStyle = "rgba(255, 170, 0, 0.6)";
            ctx.lineWidth = 1;
            ctx.strokeRect(ax, yAccumTop, aw, yAccumBot - yAccumTop);
            ctx.fillStyle = "#FFAA00";
            ctx.font = "bold 8px monospace";
            ctx.textAlign = "center";
            ctx.fillText("A (ACCUM)", ax + aw / 2, yAccumTop + 12);
            ctx.textAlign = "left";
          }
        }

        // M — Manipulation wick marker
        if (xManipStart !== null && xManipEnd !== null && yManipLevel !== null) {
          const mx = Math.max(0, xManipStart);
          const mw = Math.min(maxVisibleX, xManipEnd) - mx;
          if (mw > 4 && mx < maxVisibleX) {
            ctx.strokeStyle = isBull ? "rgba(255, 73, 92, 0.7)" : "rgba(0, 245, 160, 0.7)";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(mx, yManipLevel);
            ctx.lineTo(Math.min(maxVisibleX, mx + mw), yManipLevel);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = isBull ? "#FF495C" : "#00F5A0";
            ctx.font = "bold 8px monospace";
            ctx.textAlign = "center";
            ctx.fillText(isBull ? "M (FALSE DIP)" : "M (FALSE PUMP)", mx + mw / 2, yManipLevel + (isBull ? 12 : -4));
            ctx.textAlign = "left";
          }
        }

        // D — Distribution target arrow
        if (xDistribStart !== null && xDistribEnd !== null && yDistribLevel !== null) {
          const dx = Math.max(0, xDistribStart);
          const dw = Math.min(maxVisibleX, xDistribEnd) - dx;
          if (dw > 4 && dx < maxVisibleX) {
            ctx.fillStyle = `${accentColor}22`;
            ctx.fillRect(dx, isBull ? yDistribLevel : yDistribLevel, dw, 20);
            ctx.strokeStyle = accentColor;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(dx, yDistribLevel);
            ctx.lineTo(Math.min(maxVisibleX, dx + dw), yDistribLevel);
            ctx.stroke();
            ctx.fillStyle = accentColor;
            ctx.font = "bold 9px monospace";
            ctx.textAlign = "center";
            ctx.fillText(isBull ? "D (DIST) ▲" : "D (DIST) ▼", dx + dw / 2, yDistribLevel - 4);
            ctx.textAlign = "left";
          }
        }
      });
    }

    // 11. Draw Supply & Demand Zones (Fresh = vivid, Tested = dimmed border)
    if (smcFlagsRef.current.sd && allCandlesRef.current.length >= 10) {
      const sdZones = getCached("sd", () => detectSupplyDemandZones(latestNCandles(1000))).slice(-6);

      sdZones.forEach((zone) => {
        const yTop = series.priceToCoordinate(zone.top);
        const yBot = series.priceToCoordinate(zone.bottom);
        const xStart = timeScale.timeToCoordinate(zone.originTime);
        const xEnd = timeScale.timeToCoordinate(zone.endTime);

        if (yTop === null || yBot === null) return;

        const isDemand = zone.type === "DEMAND";
        const isFresh = zone.strength === "FRESH";

        const startX = xStart !== null ? Math.max(0, xStart) : 0;
        const endX = xEnd !== null ? Math.min(maxVisibleX, xEnd) : maxVisibleX;
        const boxW = endX - startX;

        if (boxW <= 4 || startX >= maxVisibleX) return;

        // Fresh = vivid fill, Tested = semi-transparent with dashed border
        const fillColor = isDemand
          ? (isFresh ? "rgba(0, 245, 160, 0.18)" : "rgba(0, 245, 160, 0.08)")
          : (isFresh ? "rgba(255, 73, 92, 0.18)" : "rgba(255, 73, 92, 0.08)");
        const strokeColor = isDemand
          ? (isFresh ? "#00F5A0" : "rgba(0, 245, 160, 0.45)")
          : (isFresh ? "#FF495C" : "rgba(255, 73, 92, 0.45)");

        ctx.fillStyle = fillColor;
        ctx.fillRect(startX, yTop, boxW, yBot - yTop);

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = isFresh ? 1.5 : 1;
        if (!isFresh) ctx.setLineDash([4, 3]);
        ctx.strokeRect(startX, yTop, boxW, yBot - yTop);
        ctx.setLineDash([]);

        // Label: zone type + strength badge
        const label = isDemand
          ? (isFresh ? "DEMAND 🟢 FRESH" : "DEMAND 🔵 TESTED")
          : (isFresh ? "SUPPLY 🔴 FRESH" : "SUPPLY 🟡 TESTED");

        ctx.fillStyle = isDemand ? (isFresh ? "#00F5A0" : "#00E5FF") : (isFresh ? "#FF495C" : "#FFD700");
        ctx.font = "bold 9px monospace";
        ctx.textAlign = "left";
        ctx.fillText(label, startX + 5, yTop + 12);
      });
    }

    // 12. Draw Trendline Liquidity (Diagonal Support & Resistance with touch count + breakout alerts)
    if (smcFlagsRef.current.tl && allCandlesRef.current.length >= 20) {
      const trendlines = getCached("tl", () => detectTrendlineLiquidity(latestNCandles(1000)));

      trendlines.forEach((tl) => {
        const isRes = tl.type === "RESISTANCE";
        const isActive = tl.status === "ACTIVE";
        const isBroken = tl.status === "BROKEN";
        const isSwept = tl.status === "SWEPT";

        const x1 = timeScale.timeToCoordinate(tl.p1Time);
        const x2 = timeScale.timeToCoordinate(tl.p2Time);
        const y1 = series.priceToCoordinate(tl.p1Price);
        const y2 = series.priceToCoordinate(tl.p2Price);

        if (x1 === null || x2 === null || y1 === null || y2 === null) return;
        if (x1 >= maxVisibleX && x2 >= maxVisibleX) return;

        // Project the line to the latest candle; never anchor on the price axis
        const slope = x2 !== x1 ? (y2 - y1) / (x2 - x1) : 0;
        const latestTime = lastCandleValRef.current?.time ?? allCandlesRef.current[allCandlesRef.current.length - 1]?.time;
        const latestX = latestTime ? timeScale.timeToCoordinate(latestTime) : null;
        const xEnd = latestX === null ? maxVisibleX : Math.min(maxVisibleX, Math.max(x2, latestX));
        const yEnd = y2 + slope * (xEnd - x2);

        const activeColor = isRes ? "#FF495C" : "#00F5A0";
        const strokeColor = isBroken ? "rgba(255,255,255,0.25)" : isSwept ? "#FFD700" : activeColor;

        const xStart = Math.max(0, x1);
        const yStart = x1 < 0 ? y2 + slope * (xStart - x2) : y1;

        ctx.beginPath();
        ctx.moveTo(xStart, yStart);
        ctx.lineTo(xEnd, yEnd);

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = isActive ? (tl.touchCount >= 4 ? 2.0 : 1.5) : 1;
        ctx.setLineDash(isBroken ? [4, 4] : []);
        ctx.stroke();
        ctx.setLineDash([]);

        // Touch count badge at the right end of the line
        const labelX = Math.min(maxVisibleX - 55, xEnd - 4);
        const labelY = yEnd + (isRes ? -6 : 14);

        const statusIcon = isBroken ? " 💥" : isSwept ? " ⚡" : "";
        const label = `${isRes ? "RES" : "SUP"} ×${tl.touchCount}${statusIcon}`;

        ctx.fillStyle = strokeColor;
        ctx.font = `bold ${tl.touchCount >= 4 ? 9 : 8}px monospace`;
        ctx.textAlign = "right";
        ctx.fillText(label, Math.min(maxVisibleX - 6, xEnd), labelY);
        ctx.textAlign = "left";
      });
    }

    // 13. Draw Candlestick Reversal Patterns (Pinbar / Engulfing / Inside Bar)
    if (smcFlagsRef.current.cp && allCandlesRef.current.length >= 5) {
      const cpItems = getCached("cp", () => detectCandlestickPatterns(latestNCandles(1000)));

      cpItems.forEach((cp) => {
        const xC = timeScale.timeToCoordinate(cp.candleTime);
        const yHigh = series.priceToCoordinate(cp.high);
        const yLow = series.priceToCoordinate(cp.low);

        if (xC === null || yHigh === null || yLow === null || xC > maxVisibleX) return;

        const isBull = cp.type.startsWith("BULLISH") || cp.type === "INSIDE_BAR_BULL";
        const isStrong = cp.strength === "STRONG";
        const accentColor = isBull ? "#00F5A0" : "#FF495C";

        // Arrow triangle pointing up (bull) or down (bear)
        const arrowSize = isStrong ? 7 : 5;
        const arrowY = isBull ? yLow + 14 : yHigh - 14;
        const tipY = isBull ? arrowY - arrowSize : arrowY + arrowSize;

        ctx.fillStyle = accentColor;
        ctx.beginPath();
        if (isBull) {
          ctx.moveTo(xC, arrowY - arrowSize); // tip pointing up
          ctx.lineTo(xC - arrowSize, arrowY);
          ctx.lineTo(xC + arrowSize, arrowY);
        } else {
          ctx.moveTo(xC, arrowY + arrowSize); // tip pointing down
          ctx.lineTo(xC - arrowSize, arrowY);
          ctx.lineTo(xC + arrowSize, arrowY);
        }
        ctx.closePath();
        ctx.fill();

        // Pattern label
        const patternLabels: Record<CandlestickPatternType, string> = {
          BULLISH_PINBAR: "🔨 PIN",
          BEARISH_PINBAR: "⭐ PIN",
          BULLISH_ENGULF: "↑ ENGULF",
          BEARISH_ENGULF: "↓ ENGULF",
          INSIDE_BAR_BULL: "◆ IB↑",
          INSIDE_BAR_BEAR: "◆ IB↓",
        };
        const labelText = patternLabels[cp.type] + (isStrong ? "!" : "");
        const labelY2 = isBull ? arrowY + 12 : arrowY - 6;

        ctx.fillStyle = accentColor;
        ctx.font = `${isStrong ? "bold " : ""}8px monospace`;
        ctx.textAlign = "center";
        ctx.fillText(labelText, xC, labelY2);
        ctx.textAlign = "left";
      });
    }
  };

  // Toggle Hollow Candles Mode (persisted to localStorage)
  const toggleHollowMode = () => {
    const nextHollow = !isHollowMode;
    setIsHollowMode(nextHollow);
    isHollowRef.current = nextHollow;
    try { localStorage.setItem("chart_hollow_candles", String(nextHollow)); } catch {}
    applyCandleSeriesOptions(activeThemeRef.current, nextHollow);
  };

  // 1. Initial Chart Render & Authoritative Data Sync
  useEffect(() => {
    if (!chartContainerRef.current) return;

    let chart: any = null;
    let isSubscribed = true;

    isFetchingHistoricalRef.current = false;
    allCandlesRef.current = [];
    lastCandleValRef.current = null;
    targetPriceRef.current = null;
    currentVisualPriceRef.current = null;
    targetVolumeRef.current = null;
    currentVisualVolumeRef.current = null;

    const fetchAndRender = async () => {
      try {
        setIsLoading(true);
        setError(null);

        let candlesArray: any[] = [];
        if (customCandles && customCandles.length > 0) {
          candlesArray = customCandles;
        } else {
          const res = await fetch(
            `/api/charts/intraday?symbol=${encodeURIComponent(symbol)}&interval=${interval}`
          );
          const json = await res.json();
          if (!res.ok || !json.candles || json.candles.length === 0) {
            throw new Error(json.error || "Failed to load candle data");
          }
          candlesArray = json.candles;
        }

        if (!isSubscribed) return;

        const formattedCandles = sanitizeAndSortCandles(candlesArray);
        if (formattedCandles.length === 0) {
          setIsLoading(false);
          return;
        }

        // Only overwrite allCandlesRef on fresh mount (not during reload)
        if (allCandlesRef.current.length === 0) {
          allCandlesRef.current = formattedCandles;
        }

        const formattedVolume = formattedCandles.map((c: any) => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? activeThemeRef.current.volUpColor : activeThemeRef.current.volDownColor,
        }));

        if (!chart) {
          if (chartContainerRef.current) {
            chartContainerRef.current.innerHTML = "";
          }

          chart = createChart(chartContainerRef.current!, {
            layout: {
              background: { type: ColorType.Solid, color: "#0F131C" },
              textColor: "#8E9BAE",
            },
            crosshair: {
              mode: CrosshairMode.Normal,
            },
            width: chartContainerRef.current!.clientWidth,
            height: chartContainerRef.current!.clientHeight || 520,
            grid: {
              vertLines: { color: "rgba(255, 255, 255, 0.05)" },
              horzLines: { color: "rgba(255, 255, 255, 0.05)" },
            },
            timeScale: {
              rightOffset: 5,
              timeVisible: true,
              borderColor: "rgba(255, 255, 255, 0.1)",
            },
            localization: {
              locale: "en-US",
              timeFormatter: (timestamp: number) => {
                const date = new Date(timestamp * 1000);
                return (
                  date.toLocaleTimeString("en-GB", {
                    timeZone: "UTC",
                    hour12: false,
                    hour: "2-digit",
                    minute: "2-digit",
                  }) + " UTC"
                );
              },
              dateFormat: "dd MMM yyyy",
            },
          });

          chartRef.current = chart;

          const candlestickSeries = chart.addSeries(CandlestickSeries, {
            upColor: isHollowRef.current ? "#0F131C" : activeThemeRef.current.upColor,
            downColor: activeThemeRef.current.downColor,
            borderVisible: isHollowRef.current,
            borderUpColor: activeThemeRef.current.upColor,
            borderDownColor: activeThemeRef.current.downColor,
            wickUpColor: activeThemeRef.current.upColor,
            wickDownColor: activeThemeRef.current.downColor,
            priceLineVisible: true,
            priceLineColor: activeThemeRef.current.priceLineColor,
          });

          seriesRef.current = candlestickSeries;

          // Volume Histogram on dedicated volume price scale (Bottom 25% of chart)
          const volumeSeries = chart.addSeries(HistogramSeries, {
            color: "rgba(0, 229, 255, 0.35)",
            priceFormat: { type: "volume" },
            priceScaleId: "volume",
            visible: true,
          });
          volumeSeries.priceScale().applyOptions({
            scaleMargins: { top: 0.75, bottom: 0 },
          });
          volumeSeriesRef.current = volumeSeries;

          candlestickSeries.setData(formattedCandles);
          volumeSeries.setData(formattedVolume);

          // Apply dynamic price precision based on initial candle prices
          if (formattedCandles.length > 0) {
            const samplePrice = formattedCandles[formattedCandles.length - 1].close;
            const { precision, minMove } = getPricePrecision(samplePrice);
            candlestickSeries.applyOptions({
              priceFormat: {
                type: "price",
                precision,
                minMove,
              },
            });
          }

          // Draw 2D SMC Shaded Box Overlays
          scheduleDraw();

          if (showIndicators && formattedCandles.length > 9) {
            // 1. SMA 20
            if (formattedCandles.length > 20) {
              const smaSeries = chart.addSeries(LineSeries, {
                color: "#00E5FF",
                lineWidth: 1.5,
                title: "SMA 20",
                priceLineVisible: false,
                lastValueVisible: false,
                visible: indicatorVisibility.sma20,
              });
              smaSeriesRef.current = smaSeries;

              const smaData = [];
              for (let i = 19; i < formattedCandles.length; i++) {
                const slice = formattedCandles.slice(i - 19, i + 1);
                const avg = slice.reduce((sum: number, x: any) => sum + x.close, 0) / 20;
                smaData.push({ time: formattedCandles[i].time, value: avg });
              }
              smaSeries.setData(smaData);
            }

            // 2. EMA 9
            const emaSeries = chart.addSeries(LineSeries, {
              color: "#FFD700",
              lineWidth: 1.5,
              title: "EMA 9",
              priceLineVisible: false,
              lastValueVisible: false,
              visible: indicatorVisibility.ema9,
            });
            emaSeriesRef.current = emaSeries;

            const k = 2 / (9 + 1);
            let ema = formattedCandles[0].close;
            const emaData = [{ time: formattedCandles[0].time, value: ema }];

            for (let i = 1; i < formattedCandles.length; i++) {
              ema = formattedCandles[i].close * k + ema * (1 - k);
              emaData.push({ time: formattedCandles[i].time, value: Number(ema.toFixed(2)) });
            }
            emaSeries.setData(emaData);
          }

          applyScaleSettingsToChart(scaleSettingsRef.current);

          // Scroll listener for Lazy Loading & SMC Canvas Box redraw on scroll/zoom
          chart.timeScale().subscribeVisibleLogicalRangeChange(async (newRange: any) => {
            scheduleDraw();
            if (!newRange || isFetchingHistoricalRef.current || (customCandles && customCandles.length > 0)) return;

            if (newRange.from < 5) {
              isFetchingHistoricalRef.current = true;
              setIsLazyLoading(true);

              // Use the earliest loaded candle as toDate, go back 90 days (Binance kline limit)
              const earliestTime = allCandlesRef.current.length > 0
                ? allCandlesRef.current[0].time
                : Math.floor(Date.now() / 1000);
              const toDateObj = new Date(earliestTime * 1000);
              const fromDateObj = new Date(earliestTime * 1000);
              fromDateObj.setDate(fromDateObj.getDate() - 90);
              const fmt = (d: Date) => d.toISOString().split("T")[0];

              try {
                const histRes = await fetch(
                  `/api/charts/historical?symbol=${encodeURIComponent(symbol)}&fromDate=${fmt(fromDateObj)}&toDate=${fmt(toDateObj)}&interval=${interval}`
                );
                const histJson = await histRes.json();

                if (histJson.candles && histJson.candles.length > 0 && isSubscribed) {
                  const histCandles = histJson.candles.map((c: any) => ({
                    time: Number(c.time),
                    open: Number(c.open),
                    high: Number(c.high),
                    low: Number(c.low),
                    close: Number(c.close),
                    volume: Number(c.volume || 0),
                  }));

                  const existingTimeSet = new Set(allCandlesRef.current.map((x) => x.time));
                  const uniqueNewHist = histCandles.filter((x: any) => !existingTimeSet.has(x.time));

                  if (uniqueNewHist.length > 0) {
                    const combined = [...uniqueNewHist, ...allCandlesRef.current].sort(
                      (a, b) => a.time - b.time
                    );
                    allCandlesRef.current = combined;

                    const combinedVolume = combined.map((c: any) => ({
                      time: c.time,
                      value: c.volume,
                      color: c.close >= c.open ? activeThemeRef.current.volUpColor : activeThemeRef.current.volDownColor,
                    }));

                    candlestickSeries.setData(combined);
                    volumeSeries.setData(combinedVolume);
                    scheduleDraw();
                  }
                }
              } catch (err) {
                console.error("Lazy load historical error:", err);
              } finally {
                isFetchingHistoricalRef.current = false;
                setIsLazyLoading(false);
              }
            }
          });
        }

        if (formattedCandles.length > 0) {
          const last = { ...formattedCandles[formattedCandles.length - 1] };
          lastCandleValRef.current = last;
          currentVisualPriceRef.current = last.close;
          targetPriceRef.current = last.close;
          currentVisualVolumeRef.current = last.volume;
          targetVolumeRef.current = last.volume;
        }

        setIsLoading(false);
      } catch (err: any) {
        if (isSubscribed) {
          setError(err.message);
          setIsLoading(false);
        }
      }
    };

    fetchAndRender();

    const resizeObserver = new ResizeObserver((entries) => {
      if (chart && entries[0] && entries[0].contentRect) {
        const { width } = entries[0].contentRect;
        if (width > 0) {
          chart.applyOptions({ width });
        }
      }
    });

    if (chartContainerRef.current) {
      resizeObserver.observe(chartContainerRef.current);
    }

    // Periodic 60s Background Reconciliation to ensure all historical candles remain perfectly in sync
    const reconcileTimer = setInterval(async () => {
      if (!isSubscribed || customCandles?.length) return;
      try {
        const res = await fetch(
          `/api/charts/intraday?symbol=${encodeURIComponent(symbol)}&interval=${interval}`
        );
        const json = await res.json();
        if (json?.candles?.length && seriesRef.current) {
          const authoritativeCandles = sanitizeAndSortCandles(json.candles);
          if (authoritativeCandles.length > 0) {
            allCandlesRef.current = authoritativeCandles;

            const formattedVolume = authoritativeCandles.map((c: any) => ({
              time: c.time,
              value: c.volume,
              color: c.close >= c.open ? activeThemeRef.current.volUpColor : activeThemeRef.current.volDownColor,
            }));

            seriesRef.current.setData(authoritativeCandles);
            if (volumeSeriesRef.current) {
              volumeSeriesRef.current.setData(formattedVolume);
            }
            scheduleDraw();
          }
        }
      } catch (e) {}
    }, 60000);

    return () => {
      isSubscribed = false;
      clearInterval(reconcileTimer);
      resizeObserver.disconnect();
      if (chart) {
        chart.remove();
        chartRef.current = null;
      }
    };
  }, [symbol, interval, showIndicators, customCandles]);

  // 3. 60 FPS LERP Animation Loop for Smooth Price Line & Volume Bar Transitions
  // Update target price on livePrice prop changes without resetting RAF loop
  useEffect(() => {
    if (livePrice !== undefined && livePrice !== null) {
      targetPriceRef.current = livePrice;
      if (currentVisualPriceRef.current === null) {
        currentVisualPriceRef.current = livePrice;
      }
    }
  }, [livePrice]);

  // 3. 60 FPS LERP Animation Loop for Smooth Price Line & Volume Bar Transitions
  useEffect(() => {
    const barSeconds = (parseInt(interval, 10) || 15) * 60;
    let animId: number;

    const animateLerp = () => {
      if (
        seriesRef.current &&
        lastCandleValRef.current &&
        targetPriceRef.current !== null &&
        currentVisualPriceRef.current !== null
      ) {
        const nowUnix = Math.floor(Date.now() / 1000);
        const targetBarTime = Math.floor(nowUnix / barSeconds) * barSeconds;
        const lastBarTime = lastCandleValRef.current.time || 0;

        const rawTargetLtp = targetPriceRef.current;

        // Smooth 60 FPS LERP Interpolation (alpha = 0.08 for ~250ms visual gliding)
        const priceDiff = rawTargetLtp - currentVisualPriceRef.current;
        if (Math.abs(priceDiff) > 1e-9) {
          currentVisualPriceRef.current += priceDiff * 0.08;
        } else {
          currentVisualPriceRef.current = rawTargetLtp;
        }

        const displayPrice = currentVisualPriceRef.current;

        // Bar Boundary Protection: Lock closed candle & start NEW forming candle
        if (lastBarTime > 0 && targetBarTime >= lastBarTime + barSeconds) {
          const newCandle = {
            time: targetBarTime,
            open: rawTargetLtp,
            high: rawTargetLtp,
            low: rawTargetLtp,
            close: displayPrice,
            volume: 10,
          };
          currentVisualVolumeRef.current = 10;
          targetVolumeRef.current = 10;
          lastCandleValRef.current = newCandle;

          try {
            seriesRef.current.update(newCandle);
            if (volumeSeriesRef.current) {
              volumeSeriesRef.current.update({
                time: targetBarTime,
                value: 10,
                color: activeThemeRef.current.volUpColor,
              });
            }

            // Reconcile ALL previous candles with the Binance authoritative intraday endpoint 2.5s post-close
            setTimeout(async () => {
              try {
                const res = await fetch(
                  `/api/charts/intraday?symbol=${encodeURIComponent(symbol)}&interval=${interval}`
                );
                const json = await res.json();
                if (json?.candles?.length && seriesRef.current) {
                  const authoritativeCandles = sanitizeAndSortCandles(json.candles);
                  if (authoritativeCandles.length > 0) {
                    allCandlesRef.current = authoritativeCandles;

                    const formattedVolume = authoritativeCandles.map((c: any) => ({
                      time: c.time,
                      value: c.volume,
                      color: c.close >= c.open ? activeThemeRef.current.volUpColor : activeThemeRef.current.volDownColor,
                    }));

                    seriesRef.current.setData(authoritativeCandles);
                    if (volumeSeriesRef.current) {
                      volumeSeriesRef.current.setData(formattedVolume);
                    }
                  }
                }
              } catch (e) {}
            }, 2500);
          } catch (e) {}
        } else {
          // Update active forming candle smoothly: high/low expand gradually with displayPrice
          const activeCandle = { ...lastCandleValRef.current };
          activeCandle.close = displayPrice;
          activeCandle.high = Math.max(activeCandle.high ?? displayPrice, displayPrice);
          activeCandle.low = Math.min(activeCandle.low ?? displayPrice, displayPrice);

          // Volume LERP Step: smooth alpha = 0.08
          if (targetVolumeRef.current !== null && currentVisualVolumeRef.current !== null) {
            const volDiff = targetVolumeRef.current - currentVisualVolumeRef.current;
            if (Math.abs(volDiff) > 0.1) {
              currentVisualVolumeRef.current += volDiff * 0.08;
            } else {
              currentVisualVolumeRef.current = targetVolumeRef.current;
            }
            activeCandle.volume = Math.round(currentVisualVolumeRef.current);
          }

          lastCandleValRef.current = activeCandle;

          try {
            seriesRef.current.update(activeCandle);
            if (volumeSeriesRef.current) {
              volumeSeriesRef.current.update({
                time: activeCandle.time,
                value: activeCandle.volume,
                color: activeCandle.close >= activeCandle.open ? activeThemeRef.current.volUpColor : activeThemeRef.current.volDownColor,
              });
            }
          } catch (e) {}
        }
        const drawnCandle = lastCandleValRef.current;
        const candleKey = drawnCandle ? `${drawnCandle.time}:${drawnCandle.close}:${drawnCandle.high}:${drawnCandle.low}` : "";
        if (candleKey !== lastDrawnCandleRef.current) {
          lastDrawnCandleRef.current = candleKey;
          scheduleDraw();
        }

        // 60 FPS LERP Interpolation for Best Bid Price Line (alpha = 0.08)
        if (targetBidRef.current !== null && currentVisualBidRef.current !== null && seriesRef.current) {
          const bidDiff = targetBidRef.current - currentVisualBidRef.current;
          if (Math.abs(bidDiff) > 1e-9) {
            currentVisualBidRef.current += bidDiff * 0.08;
          } else {
            currentVisualBidRef.current = targetBidRef.current;
          }

          if (!bidLineRef.current) {
            try {
              bidLineRef.current = seriesRef.current.createPriceLine({
                price: currentVisualBidRef.current,
                color: "#00F5A0",
                lineWidth: 1,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: true,
                title: "BID",
              });
            } catch (e) {}
          } else {
            try {
              bidLineRef.current.applyOptions({ price: currentVisualBidRef.current });
            } catch (e) {}
          }
        }

        // 60 FPS LERP Interpolation for Best Ask Price Line (alpha = 0.08)
        if (targetAskRef.current !== null && currentVisualAskRef.current !== null && seriesRef.current) {
          const askDiff = targetAskRef.current - currentVisualAskRef.current;
          if (Math.abs(askDiff) > 1e-9) {
            currentVisualAskRef.current += askDiff * 0.08;
          } else {
            currentVisualAskRef.current = targetAskRef.current;
          }

          const spread = Math.max(0, (currentVisualAskRef.current || 0) - (currentVisualBidRef.current || 0));
          const spreadText = `$${formatPriceDynamic(spread)}`;

          if (!askLineRef.current) {
            try {
              askLineRef.current = seriesRef.current.createPriceLine({
                price: currentVisualAskRef.current,
                color: "#FF495C",
                lineWidth: 1,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: true,
                title: `ASK (SPREAD ${spreadText})`,
              });
            } catch (e) {}
          } else {
            try {
              askLineRef.current.applyOptions({
                price: currentVisualAskRef.current,
                title: `ASK (SPREAD ${spreadText})`,
              });
            } catch (e) {}
          }
        }
      }

      animId = requestAnimationFrame(animateLerp);
    };

    animId = requestAnimationFrame(animateLerp);
    return () => cancelAnimationFrame(animId);
  }, [interval, symbol]);

  // 3. 60 FPS LERP Animation Loop for Smooth Price Line, Bid/Ask Lines & Volume Bar Transitions
  useEffect(() => {
    const rawLtp = livePrice || tick?.ltp || lastCandleValRef.current?.close || 0;
    const rawBid = tick?.bids?.[0]?.price;
    const rawAsk = tick?.asks?.[0]?.price;

    const b = rawBid !== undefined && rawBid > 0 ? rawBid : (rawLtp > 0 ? rawLtp - 0.05 : null);
    const a = rawAsk !== undefined && rawAsk > 0 ? rawAsk : (rawLtp > 0 ? rawLtp + 0.05 : null);

    if (b !== null) {
      targetBidRef.current = b;
      if (currentVisualBidRef.current === null) currentVisualBidRef.current = b;
    }
    if (a !== null) {
      targetAskRef.current = a;
      if (currentVisualAskRef.current === null) currentVisualAskRef.current = a;
    }
  }, [tick, livePrice]);

  // Cleanup price lines on unmount or series reset
  useEffect(() => {
    return () => {
      if (seriesRef.current) {
        if (bidLineRef.current) {
          try { seriesRef.current.removePriceLine(bidLineRef.current); } catch {}
          bidLineRef.current = null;
        }
        if (askLineRef.current) {
          try { seriesRef.current.removePriceLine(askLineRef.current); } catch {}
          askLineRef.current = null;
        }
      }
    };
  }, []);

  const activeLtp = livePrice || tick?.ltp || (lastCandleValRef.current?.close || 0);
  const activeChange = tick?.change !== undefined ? tick.change : 0;
  const activePChange = tick?.pChange !== undefined ? tick.pChange : 0;
  const activeVolume = tick?.volume || 0;
  const activeSymbolName = tick?.symbol || symbol.toUpperCase();
  const tickTimeFormatted = tick?.timestamp
    ? new Date(tick.timestamp).toLocaleTimeString("en-GB", { timeZone: "UTC", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) + " UTC"
    : new Date().toLocaleTimeString("en-GB", { timeZone: "UTC", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) + " UTC";

  const rawBidPrice = tick?.bids?.[0]?.price;
  const rawAskPrice = tick?.asks?.[0]?.price;
  const activeBid = rawBidPrice !== undefined && rawBidPrice > 0 ? rawBidPrice : (activeLtp > 0 ? activeLtp - 0.05 : 0);
  const activeAsk = rawAskPrice !== undefined && rawAskPrice > 0 ? rawAskPrice : (activeLtp > 0 ? activeLtp + 0.05 : 0);
  const activeSpread = Math.max(0, activeAsk - activeBid);
  const activeSpreadPct = activeAsk > 0 ? (activeSpread / activeAsk) * 100 : 0;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: "520px" }}>
      {/* Top Left Overlay Container inside Chart Canvas */}
      <div style={{
        position: "absolute",
        top: "12px",
        left: "12px",
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        fontFamily: "var(--font-mono)",
        fontSize: "12px",
      }}>
        {/* ROW 1: Main Scrip Status Line */}
        <div style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "10px",
          background: "rgba(15, 19, 28, 0.85)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          padding: "6px 14px",
          borderRadius: "8px",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4)",
        }}>
          {/* SYMBOL */}
          <span style={{ fontWeight: 800, color: "var(--accent-cyan)", letterSpacing: "0.3px" }}>{activeSymbolName}</span>

          <span style={{ color: "rgba(255, 255, 255, 0.2)" }}>•</span>

          {/* LIVE PRICE (LTP) */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700 }}>LTP</span>
            <span style={{ fontWeight: 800, color: activeChange >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
              ${formatPriceDynamic(activeLtp)}
            </span>
          </div>

          <span style={{ color: "rgba(255, 255, 255, 0.2)" }}>•</span>

          {/* DAY CHANGE */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700 }}>CHG</span>
            <span style={{ fontWeight: 700, color: activeChange >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
              {activeChange >= 0 ? "+" : ""}{formatPriceDynamic(activeChange)} ({activePChange >= 0 ? "+" : ""}{Number(activePChange).toFixed(2)}%)
            </span>
          </div>

          <span style={{ color: "rgba(255, 255, 255, 0.2)" }}>•</span>

          {/* TOTAL VOLUME */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700 }}>VOL</span>
            <span style={{ fontWeight: 700, color: "#FFFFFF" }}>
              {Number(activeVolume).toLocaleString("en-US")}
            </span>
          </div>

          <span style={{ color: "rgba(255, 255, 255, 0.2)" }}>•</span>

          {/* BID */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700 }}>BID</span>
            <span style={{ fontWeight: 800, color: "#00F5A0" }}>
              ${formatPriceDynamic(activeBid)}
            </span>
          </div>

          <span style={{ color: "rgba(255, 255, 255, 0.2)" }}>•</span>

          {/* ASK */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700 }}>ASK</span>
            <span style={{ fontWeight: 800, color: "#FF495C" }}>
              ${formatPriceDynamic(activeAsk)}
            </span>
          </div>

          <span style={{ color: "rgba(255, 255, 255, 0.2)" }}>•</span>

          {/* SPREAD */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700 }}>SPREAD</span>
            <span style={{ fontWeight: 800, color: "var(--accent-cyan)", background: "rgba(0, 245, 255, 0.12)", padding: "1px 5px", borderRadius: "4px", border: "1px solid rgba(0, 245, 255, 0.3)" }}>
              ${formatPriceDynamic(activeSpread)} ({activeSpreadPct.toFixed(3)}%)
            </span>
          </div>

          <span style={{ color: "rgba(255, 255, 255, 0.2)" }}>•</span>

          {/* LIVE TICK */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700 }}>TICK</span>
            <span style={{ fontSize: "11px", color: "var(--accent-green)", fontWeight: 700 }}>
              {tickTimeFormatted}
            </span>
          </div>

          <span style={{ color: "rgba(255, 255, 255, 0.2)" }}>•</span>

          {/* NEXT CANDLE COUNTDOWN */}
          <CandleCountdown interval={interval} />
        </div>

        {/* ROW 2: Indicators Bar positioned directly below Status Line */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          background: "rgba(15, 19, 28, 0.85)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          padding: "4px 12px",
          borderRadius: "6px",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          width: "fit-content",
        }}>
          {/* INDICATORS DROPDOWN BUTTON */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setShowIndicatorsPanel(!showIndicatorsPanel)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                background: showIndicatorsPanel ? "rgba(0, 229, 255, 0.2)" : "rgba(255, 255, 255, 0.06)",
                color: showIndicatorsPanel ? "var(--accent-cyan)" : "var(--text-secondary)",
                border: showIndicatorsPanel ? "1px solid var(--accent-cyan)" : "1px solid rgba(255, 255, 255, 0.15)",
                padding: "2px 8px",
                borderRadius: "4px",
                fontSize: "11px",
                fontWeight: 700,
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              <Sliders size={11} />
              <span>INDICATORS</span>
              {showIndicatorsPanel ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>

            {/* INDICATORS MANAGEMENT DROPDOWN DRAWER */}
            {showIndicatorsPanel && (
              <div style={{
                position: "absolute",
                top: "28px",
                left: 0,
                zIndex: 30,
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                background: "rgba(15, 19, 28, 0.95)",
                backdropFilter: "blur(14px)",
                WebkitBackdropFilter: "blur(14px)",
                padding: "10px 14px",
                borderRadius: "8px",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
                minWidth: "210px",
                maxHeight: "calc(100vh - 140px)",
                overflowY: "auto",
              }}>
                {renderIndicatorSet(INDICATOR_SETS[0])}

                <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.5px", borderBottom: "1px solid rgba(255, 255, 255, 0.08)", paddingBottom: "4px", marginTop: "6px" }}>
                  CANDLE & VOLUME THEME
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {Object.values(CANDLE_THEMES).map((theme) => {
                    const isSelected = theme.id === selectedThemeId;
                    return (
                      <button
                        key={theme.id}
                        onClick={() => handleThemeChange(theme.id)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "4px 8px",
                          borderRadius: "4px",
                          background: isSelected ? "rgba(255, 255, 255, 0.12)" : "transparent",
                          border: isSelected ? "1px solid rgba(255, 255, 255, 0.25)" : "1px solid transparent",
                          cursor: "pointer",
                          transition: "all 0.2s ease",
                        }}
                      >
                        <span style={{ fontSize: "11px", fontWeight: isSelected ? 700 : 500, color: isSelected ? "#FFFFFF" : "var(--text-secondary)" }}>
                          {theme.name}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: theme.upColor }} />
                          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: theme.downColor }} />
                        </div>
                      </button>
                    );
                  })}
                </div>
                {renderIndicatorSet(INDICATOR_SETS[1])}
                {renderIndicatorSet(INDICATOR_SETS[2])}

                {renderIndicatorSet(INDICATOR_SETS[3])}
                <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.5px", borderBottom: "1px solid rgba(255, 255, 255, 0.08)", paddingBottom: "4px", marginTop: "8px" }}>
                  CANDLE BODY STYLE
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginTop: "2px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: isHollowMode ? "var(--accent-cyan)" : "#FFFFFF" }}>
                    Hollow Candles
                  </span>
                  <button
                    onClick={toggleHollowMode}
                    style={{
                      background: isHollowMode ? "rgba(0, 229, 255, 0.2)" : "rgba(255, 255, 255, 0.06)",
                      border: isHollowMode ? "1px solid var(--accent-cyan)" : "1px solid rgba(255, 255, 255, 0.15)",
                      color: isHollowMode ? "var(--accent-cyan)" : "var(--text-muted)",
                      padding: "2px 8px",
                      borderRadius: "4px",
                      fontSize: "10px",
                      fontWeight: 700,
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                    }}
                  >
                    {isHollowMode ? "HOLLOW" : "FILLED"}
                  </button>
                </div>

                <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.5px", borderBottom: "1px solid rgba(255, 255, 255, 0.08)", paddingBottom: "4px", marginTop: "8px" }}>
                  SETUP TOOLS
                </div>

                {/* Futures Setup Scanner Toggle */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginTop: "2px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: showSetupScan ? "#00F5A0" : "var(--text-muted)" }}>
                    Futures Setup Scanner
                  </span>
                  <button
                    onClick={toggleSetupScan}
                    style={{
                      background: showSetupScan ? "rgba(0, 245, 160, 0.2)" : "rgba(255, 255, 255, 0.06)",
                      border: showSetupScan ? "1px solid #00F5A0" : "1px solid rgba(255, 255, 255, 0.15)",
                      color: showSetupScan ? "#00F5A0" : "var(--text-muted)",
                      padding: "2px 8px",
                      borderRadius: "4px",
                      fontSize: "10px",
                      fontWeight: 700,
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                    }}
                  >
                    {showSetupScan ? "ON" : "OFF"}
                  </button>
                </div>

                {/* Paper Trading Toggle */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginTop: "4px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: paperEnabled ? "#00F5A0" : "var(--text-muted)" }}>
                    Paper Trade (auto-enter)
                  </span>
                  <button
                    onClick={togglePaper}
                    style={{
                      background: paperEnabled ? "rgba(0, 245, 160, 0.2)" : "rgba(255, 255, 255, 0.06)",
                      border: paperEnabled ? "1px solid #00F5A0" : "1px solid rgba(255, 255, 255, 0.15)",
                      color: paperEnabled ? "#00F5A0" : "var(--text-muted)",
                      padding: "2px 8px",
                      borderRadius: "4px",
                      fontSize: "10px",
                      fontWeight: 700,
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                    }}
                  >
                    {paperEnabled ? "ON" : "OFF"}
                  </button>
                </div>

                {/* MTF Bias Timeframe Selector */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginTop: "4px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "#FFFFFF" }}>Bias Timeframe</span>
                  <select
                    value={biasTfMult === null ? "auto" : String(biasTfMult)}
                    onChange={(e) => changeBiasTf(e.target.value === "auto" ? null : Number(e.target.value))}
                    style={{
                      background: "rgba(255, 255, 255, 0.06)",
                      color: "var(--accent-cyan)",
                      border: "1px solid rgba(255, 255, 255, 0.15)",
                      borderRadius: "4px",
                      padding: "2px 6px",
                      fontSize: "10px",
                      fontWeight: 700,
                      fontFamily: "var(--font-mono)",
                      cursor: "pointer",
                    }}
                  >
                    {(() => {
                      const baseMin = parseInt(interval, 10) || 15;
                      const options: { mult: number | null; label: string }[] = [
                        { mult: null, label: `AUTO (${autoHtfMult(baseMin) * baseMin}m)` },
                        ...[2, 3, 4, 6, 12].map((m) => ({ mult: m, label: `${m * baseMin}m (${m}×)` })),
                      ];
                      return options.map((o) => (
                        <option key={o.label} value={o.mult === null ? "auto" : String(o.mult)}>
                          {o.label}
                        </option>
                      ));
                    })()}
                  </select>
                </div>

                {/* DEFAULT SCALE & ZOOM SETTINGS SECTION */}
                <div style={{
                  fontSize: "10px",
                  color: "var(--text-muted)",
                  fontWeight: 700,
                  letterSpacing: "0.5px",
                  borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                  paddingBottom: "4px",
                  marginTop: "8px"
                }}>
                  DEFAULT SCALE & ZOOM
                </div>

                {/* Default Mode Selector */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginTop: "2px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "#FFFFFF" }}>Zoom Mode</span>
                  <select
                    value={scaleSettings.mode}
                    onChange={(e) => updateScaleSettings({ mode: e.target.value as DefaultScaleMode })}
                    style={{
                      background: "rgba(255, 255, 255, 0.06)",
                      color: "var(--accent-cyan)",
                      border: "1px solid rgba(255, 255, 255, 0.15)",
                      borderRadius: "4px",
                      padding: "2px 6px",
                      fontSize: "10px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    <option value="last_bars">Last N Bars (Default)</option>
                    <option value="fixed_spacing">Fixed Bar Width</option>
                    <option value="fit_content">Fit All 500+ Bars (Zoom Out)</option>
                  </select>
                </div>

                {/* Last N Bars Count */}
                {scaleSettings.mode === "last_bars" && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                    <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Visible Bars</span>
                    <input
                      type="number"
                      min={20}
                      max={500}
                      step={10}
                      value={scaleSettings.lastBarsCount}
                      onChange={(e) => updateScaleSettings({ lastBarsCount: Math.max(10, Number(e.target.value)) })}
                      style={{
                        width: "55px",
                        background: "rgba(255, 255, 255, 0.08)",
                        color: "#FFF",
                        border: "1px solid rgba(255, 255, 255, 0.15)",
                        borderRadius: "4px",
                        padding: "2px 4px",
                        fontSize: "10px",
                      }}
                    />
                  </div>
                )}

                {/* Fixed Bar Spacing */}
                {scaleSettings.mode === "fixed_spacing" && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                    <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Bar Width (px)</span>
                    <input
                      type="number"
                      min={2}
                      max={50}
                      value={scaleSettings.barSpacing}
                      onChange={(e) => updateScaleSettings({ barSpacing: Math.max(2, Number(e.target.value)) })}
                      style={{
                        width: "55px",
                        background: "rgba(255, 255, 255, 0.08)",
                        color: "#FFF",
                        border: "1px solid rgba(255, 255, 255, 0.15)",
                        borderRadius: "4px",
                        padding: "2px 4px",
                        fontSize: "10px",
                      }}
                    />
                  </div>
                )}

                {/* Right Margin Offset */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                  <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Right Margin (Bars)</span>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    value={scaleSettings.rightOffset}
                    onChange={(e) => updateScaleSettings({ rightOffset: Math.max(0, Number(e.target.value)) })}
                    style={{
                      width: "55px",
                      background: "rgba(255, 255, 255, 0.08)",
                      color: "#FFF",
                      border: "1px solid rgba(255, 255, 255, 0.15)",
                      borderRadius: "4px",
                      padding: "2px 4px",
                      fontSize: "10px",
                    }}
                  />
                </div>

                {/* Logarithmic Scale Toggle */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginTop: "2px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: scaleSettings.isLogScale ? "var(--accent-cyan)" : "var(--text-muted)" }}>
                    Log Scale (LOG)
                  </span>
                  <button
                    onClick={() => updateScaleSettings({ isLogScale: !scaleSettings.isLogScale })}
                    style={{
                      background: scaleSettings.isLogScale ? "rgba(0, 229, 255, 0.2)" : "rgba(255, 255, 255, 0.06)",
                      border: scaleSettings.isLogScale ? "1px solid var(--accent-cyan)" : "1px solid rgba(255, 255, 255, 0.15)",
                      color: scaleSettings.isLogScale ? "var(--accent-cyan)" : "var(--text-muted)",
                      padding: "2px 8px",
                      borderRadius: "4px",
                      fontSize: "10px",
                      fontWeight: 700,
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                    }}
                  >
                    {scaleSettings.isLogScale ? "ON" : "OFF"}
                  </button>
                </div>
              </div>
            )}
          </div>

          <span style={{ color: "rgba(255, 255, 255, 0.2)" }}>•</span>

          {/* GROUP 1: MOVING AVERAGES */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: isAnyInd ? "#00E5FF" : "var(--text-muted)" }} />
            <span style={{ fontSize: "10px", fontWeight: 700, color: isAnyInd ? "#00E5FF" : "var(--text-muted)" }}>MA (2)</span>
            <button
              onClick={toggleIndicatorsGroup}
              style={{ background: "transparent", border: "none", color: isAnyInd ? "var(--accent-cyan)" : "var(--text-muted)", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}
              title={isAnyInd ? "Hide All Moving Averages" : "Show All Moving Averages"}
            >
              {isAnyInd ? <Eye size={11} /> : <EyeOff size={11} />}
            </button>
          </div>

          <span style={{ color: "rgba(255, 255, 255, 0.2)" }}>•</span>

          {/* GROUP 2: SMC ENGINE */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: isAnySmc ? "#00F5A0" : "var(--text-muted)" }} />
            <span style={{ fontSize: "10px", fontWeight: 700, color: isAnySmc ? "#00F5A0" : "var(--text-muted)" }}>
              SMC ({smcActiveCount}/5)
            </span>
            <button
              onClick={toggleSMCGroup}
              style={{ background: "transparent", border: "none", color: isAnySmc ? "#00F5A0" : "var(--text-muted)", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}
              title={isAnySmc ? "Hide All SMC Overlay Tools" : "Show All SMC Overlay Tools"}
            >
              {isAnySmc ? <Eye size={11} /> : <EyeOff size={11} />}
            </button>
          </div>

          <span style={{ color: "rgba(255, 255, 255, 0.2)" }}>•</span>

          {/* GROUP 3: ICT ENGINE */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: isAnyIct ? "#9333EA" : "var(--text-muted)" }} />
            <span style={{ fontSize: "10px", fontWeight: 700, color: isAnyIct ? "#9333EA" : "var(--text-muted)" }}>
              ICT ({ictActiveCount}/5)
            </span>
            <button
              onClick={toggleICTGroup}
              style={{ background: "transparent", border: "none", color: isAnyIct ? "#9333EA" : "var(--text-muted)", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}
              title={isAnyIct ? "Hide All ICT Tools & Windows" : "Show All ICT Tools & Windows"}
            >
              {isAnyIct ? <Eye size={11} /> : <EyeOff size={11} />}
            </button>
          </div>

          <span style={{ color: "rgba(255, 255, 255, 0.2)" }}>•</span>

          {/* GROUP 4: ADVANCED TOOLS */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: isAnyAdv ? "#FFD700" : "var(--text-muted)" }} />
            <span style={{ fontSize: "10px", fontWeight: 700, color: isAnyAdv ? "#FFD700" : "var(--text-muted)" }}>
              ADVANCED ({advActiveCount}/3)
            </span>
            <button
              onClick={toggleAdvancedGroup}
              style={{ background: "transparent", border: "none", color: isAnyAdv ? "#FFD700" : "var(--text-muted)", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}
              title={isAnyAdv ? "Hide All Supply/Demand & Pattern Tools" : "Show All Supply/Demand & Pattern Tools"}
            >
              {isAnyAdv ? <Eye size={11} /> : <EyeOff size={11} />}
            </button>
          </div>
        </div>
      </div>





      {/* Loading Overlay */}
      {isLoading && (
        <div style={{
          position: "absolute",
          inset: 0,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(15, 19, 28, 0.8)",
          color: "var(--accent-cyan)",
          fontFamily: "var(--font-mono)",
          fontSize: "14px"
        }}>
          Loading Real-Time Chart...
        </div>
      )}

      {/* Lazy Loading Indicator */}
      {isLazyLoading && (
        <div style={{
          position: "absolute",
          top: "40px",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 15,
          background: "rgba(0, 229, 255, 0.2)",
          color: "var(--accent-cyan)",
          padding: "4px 12px",
          borderRadius: "4px",
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          border: "1px solid var(--accent-cyan)"
        }}>
          Loading historical candles...
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div style={{
          position: "absolute",
          inset: 0,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(15, 19, 28, 0.9)",
          color: "var(--accent-red)",
          fontFamily: "var(--font-mono)",
          fontSize: "13px",
          padding: "20px",
          textAlign: "center"
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Futures Setup Scanner Panel - Positioned Top Right with Auto-Expand on Signal & Auto-Collapse Timer */}
      {showSetupScan && setupSignal && (
        <div
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.opacity = "0.25";
            clearAutoCollapseTimer();
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.opacity = "0.85";
            if (!isScannerCollapsed) startAutoCollapseTimer(5000);
          }}
          style={{
            position: "absolute",
            top: "12px",
            right: "75px",
            zIndex: 20,
            pointerEvents: "auto",
            width: isScannerCollapsed ? "auto" : "320px",
            maxHeight: "calc(100% - 24px)",
            overflowY: "auto",
            background: "rgba(15, 19, 28, 0.6)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            border: "1px solid rgba(255, 255, 255, 0.14)",
            borderRadius: "8px",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
            padding: isScannerCollapsed ? "5px 10px" : "8px 12px",
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            color: "#8E9BAE",
            opacity: 0.85,
            transition: "all 0.2s ease-in-out",
          }}
        >
          {/* Collapsible Header Bar */}
          <div
            onClick={toggleScannerCollapsed}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
              marginBottom: isScannerCollapsed ? "0px" : "6px",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontWeight: 700, letterSpacing: "0.5px", fontSize: "9px", color: "var(--text-muted)" }}>
                SETUP SCANNER{setupSignal.biasTf ? ` · ${setupSignal.biasTf}` : ""}
              </span>
              {setupSignal.direction === "LONG" && (
                <span style={{ fontWeight: 800, fontSize: "11px", color: "#00F5A0" }}>LONG</span>
              )}
              {setupSignal.direction === "SHORT" && (
                <span style={{ fontWeight: 800, fontSize: "11px", color: "#FF495C" }}>SHORT</span>
              )}
              {setupSignal.direction === "NO_TRADE" && (
                <span style={{ fontWeight: 700, fontSize: "10px", color: "#8E9BAE" }}>NO TRADE</span>
              )}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); toggleScannerCollapsed(); }}
              style={{ background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}
              title={isScannerCollapsed ? "Expand Setup Scanner Details" : "Collapse Setup Scanner Details"}
            >
              {isScannerCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
            </button>
          </div>

          {/* Expanded Panel Content */}
          {!isScannerCollapsed && (
            <>
              <div style={{ display: "flex", gap: "12px", marginBottom: "6px" }}>
                <span>
                  BIAS{" "}
                  <span style={{
                    fontWeight: 700,
                    color: setupSignal.bias === "bullish" ? "#00F5A0" : setupSignal.bias === "bearish" ? "#FF495C" : "#8E9BAE",
                  }}>
                    {setupSignal.bias.toUpperCase()}
                  </span>{" "}
                  ({setupSignal.biasFactors.filter((f) => f.vote === "bullish").length}B/
                  {setupSignal.biasFactors.filter((f) => f.vote === "bearish").length}S)
                </span>
                <span>
                  CONFLUENCE{" "}
                  <span style={{ fontWeight: 700, color: setupSignal.alignedCount >= 3 ? "var(--accent-cyan)" : "#8E9BAE" }}>
                    {setupSignal.alignedCount}/6
                  </span>
                </span>
              </div>

              {setupSignal.recommendedEntry && (
                <div style={{
                  marginBottom: "6px",
                  padding: "6px 8px",
                  borderRadius: "6px",
                  background: setupSignal.recommendedEntry.side === "LONG" ? "rgba(0, 245, 160, 0.08)" : "rgba(255, 73, 92, 0.08)",
                  border: `1px solid ${setupSignal.recommendedEntry.side === "LONG" ? "rgba(0, 245, 160, 0.35)" : "rgba(255, 73, 92, 0.35)"}`,
                }}>
                  <div style={{ fontWeight: 800, fontSize: "13px", color: setupSignal.recommendedEntry.side === "LONG" ? "#00F5A0" : "#FF495C" }}>
                    {setupSignal.recommendedEntry.side} {setupSignal.recommendedEntry.symbol} @ ${setupSignal.recommendedEntry.entry.price.toFixed(2)}{" "}
                    <span style={{ fontWeight: 600, fontSize: "10px", opacity: 0.8 }}>· {setupSignal.recommendedEntry.entry.label}</span>
                  </div>
                  <div style={{ fontSize: "9px", color: "#8E9BAE", marginTop: "1px", wordBreak: "break-word" }}>{setupSignal.recommendedEntry.entry.rationale}</div>
                  <div style={{ fontSize: "9px", color: "#6B7A90", marginTop: "3px", wordBreak: "break-word" }}>
                    STOP ${setupSignal.recommendedEntry.stop.price.toFixed(2)} ({setupSignal.recommendedEntry.stop.rationale}) · TARGET ${setupSignal.recommendedEntry.target.price.toFixed(2)} ({setupSignal.recommendedEntry.target.rationale})
                  </div>
                </div>
              )}

              {[...setupSignal.biasFactors, ...setupSignal.confluence].map((f) => (
                <div key={f.name} style={{ display: "flex", alignItems: "flex-start", gap: "6px", padding: "2px 0" }}>
                  <span style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    marginTop: "3px",
                    flexShrink: 0,
                    background: f.vote === "bullish" ? "#00F5A0" : f.vote === "bearish" ? "#FF495C" : "#3A4356",
                  }} />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "3px", flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, color: f.vote === "bullish" ? "#00F5A0" : f.vote === "bearish" ? "#FF495C" : "#6B7A90", flexShrink: 0 }}>
                      {f.name}{f.tf ? ` · ${f.tf}` : ""}:
                    </span>
                    <span style={{ color: "#8E9BAE", wordBreak: "break-word" }}>{f.detail}</span>
                  </div>
                </div>
              ))}
              {setupSignal.notes.length > 0 && (
                <div style={{ marginTop: "6px", borderTop: "1px solid rgba(255, 255, 255, 0.08)", paddingTop: "5px", color: "#6B7A90" }}>
                  {setupSignal.notes.map((n, i) => (
                    <div key={i} style={{ padding: "1px 0", lineHeight: 1.4 }}>{n}</div>
                  ))}
                </div>
              )}

              {paperEnabled && paperAccount && (
                <div style={{ marginTop: "6px", borderTop: "1px solid rgba(255, 255, 255, 0.08)", paddingTop: "5px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 700, letterSpacing: "0.5px", fontSize: "9px", color: "var(--text-muted)" }}>
                      PAPER TRADE · {symbol.toUpperCase()}
                    </span>
                    <span style={{ display: "flex", gap: "4px" }}>
                      {paperAccount.open && (
                        <button
                          onClick={closeOpenPaper}
                          style={{
                            background: "rgba(255, 73, 92, 0.15)",
                            border: "1px solid rgba(255, 73, 92, 0.4)",
                            color: "#FF495C",
                            padding: "1px 6px",
                            borderRadius: "4px",
                            fontSize: "9px",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          CLOSE
                        </button>
                      )}
                      <button
                        onClick={resetPaper}
                        style={{
                          background: "rgba(255, 255, 255, 0.06)",
                          border: "1px solid rgba(255, 255, 255, 0.15)",
                          color: "var(--text-muted)",
                          padding: "1px 6px",
                          borderRadius: "4px",
                          fontSize: "9px",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        RESET
                      </button>
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "10px", fontSize: "9px", marginTop: "3px", color: "#8E9BAE" }}>
                    <span>
                      EQUITY{" "}
                      <span style={{ fontWeight: 700, color: "#FFFFFF" }}>${paperEquity(paperAccount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                    </span>
                    <span>
                      REALIZED{" "}
                      <span style={{ fontWeight: 700, color: realizedPnl(paperAccount) >= 0 ? "#00F5A0" : "#FF495C" }}>
                        {realizedPnl(paperAccount) >= 0 ? "+" : ""}${realizedPnl(paperAccount).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </span>
                    </span>
                    <span>
                      W {paperAccount.wins} / L {paperAccount.totalTrades - paperAccount.wins}
                    </span>
                  </div>
                  {paperAccount.open ? (
                    <div style={{ marginTop: "3px", fontSize: "9px", color: "#FFFFFF" }}>
                      OPEN {paperAccount.open.side} {paperAccount.open.symbol.toUpperCase()} × {paperAccount.open.qty} @ ${paperAccount.open.entryPrice.toFixed(2)}
                      {paperAccount.open.estimatedEntry ? " (EST)" : ""} → ${paperAccount.open.lastPrice.toFixed(2)}{" "}
                      <span style={{ color: paperAccount.open.lastPrice >= paperAccount.open.entryPrice ? (paperAccount.open.side === "LONG" ? "#00F5A0" : "#FF495C") : (paperAccount.open.side === "LONG" ? "#FF495C" : "#00F5A0") }}>
                        ({(((paperAccount.open.lastPrice - paperAccount.open.entryPrice) / paperAccount.open.entryPrice) * 100 * (paperAccount.open.side === "LONG" ? 1 : -1)).toFixed(1)}%)
                      </span>
                      <div style={{ color: "#6B7A90" }}>
                        STOP ${paperAccount.open.stopPrice.toFixed(2)} · TGT ${paperAccount.open.targetPrice.toFixed(2)} · MAE {paperAccount.open.maePct}% · MFE {paperAccount.open.mfePct}%
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginTop: "3px", fontSize: "9px", color: "#6B7A90" }}>STANDBY — waiting for scanner signal</div>
                  )}
                  {paperLog.length > 0 && (
                    <div style={{ marginTop: "3px", borderTop: "1px solid rgba(255, 255, 255, 0.06)", paddingTop: "3px", fontSize: "9px", color: "#6B7A90", lineHeight: 1.5 }}>
                      {paperLog.map((l, i) => (
                        <div key={i}>{l}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 2D Shaded SMC Overlay Canvas */}
      <canvas
        ref={smcCanvasRef}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 10,
        }}
      />

      {/* TRADINGVIEW-STYLE BOTTOM RIGHT QUICK SCALE OVERLAY */}
      <div style={{
        position: "absolute",
        bottom: "32px",
        right: "75px",
        zIndex: 15,
        display: "flex",
        gap: "4px",
        background: "rgba(15, 19, 28, 0.85)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        padding: "2px 4px",
        borderRadius: "4px",
        border: "1px solid rgba(255, 255, 255, 0.12)",
      }}>
        {/* LOG Scale Button */}
        <button
          title="Toggle Logarithmic Scale"
          onClick={() => updateScaleSettings({ isLogScale: !scaleSettings.isLogScale })}
          style={{
            background: scaleSettings.isLogScale ? "var(--accent-cyan)" : "transparent",
            color: scaleSettings.isLogScale ? "#0F131C" : "var(--text-muted)",
            border: "none",
            borderRadius: "3px",
            fontSize: "10px",
            fontWeight: 800,
            padding: "2px 6px",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          LOG
        </button>

        {/* Reset/Auto Scale Button */}
        <button
          title="Reset Scale to Default Setting"
          onClick={() => applyScaleSettingsToChart(scaleSettings)}
          style={{
            background: "transparent",
            color: "var(--text-secondary)",
            border: "none",
            borderRadius: "3px",
            fontSize: "10px",
            fontWeight: 800,
            padding: "2px 6px",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          AUTO
        </button>
      </div>

      {/* Canvas Container */}
      <div ref={chartContainerRef} style={{ width: "100%", height: "100%", minHeight: "520px" }} />
    </div>
  );
};
