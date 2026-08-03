import express, { Router, Request, Response } from "express";
import { MarketDataService } from "./services/market-data.service";
import { FuturesBacktestService } from "./services/futures-backtest.service";
import { FuturesAnalyticsService } from "./services/futures-analytics.service";
import { OrderExecutionService } from "./services/order-execution.service";
import { RiskManagementService } from "./services/risk-management.service";
import { TechnicalAnalysisService } from "./services/technical-analysis.service";

export const router = Router();
router.use(express.json({ limit: "50mb" }));
router.use(express.urlencoded({ limit: "50mb", extended: true }));

// 1. Session Info (Binance 24/7 Crypto Futures Market)
router.get("/session-info", (req: Request, res: Response) => {
  res.json({
    status: "success",
    session: {
      isOpen: true,
      exchange: "BINANCE",
      marketType: "CRYPTO_FUTURES_24X7",
      lastCompletedTradingDay: new Date().toISOString().split("T")[0],
    },
  });
});

// 2. Fund Limits & Balance
router.get("/funds", async (req: Request, res: Response) => {
  try {
    const data = await OrderExecutionService.getFunds();
    res.json({ status: "success", data });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// 3. Open Positions
router.get("/positions", async (req: Request, res: Response) => {
  try {
    const data = await OrderExecutionService.listPositions();
    res.json({ status: "success", data });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// 4. Orders
router.get("/orders", async (req: Request, res: Response) => {
  try {
    const data = await OrderExecutionService.listOrders();
    res.json({ status: "success", data });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// 5. Ledger Statement
router.get("/ledger", async (req: Request, res: Response) => {
  try {
    const fromDate = (req.query.fromDate || new Date().toISOString().split("T")[0]) as string;
    const toDate = (req.query.toDate || new Date().toISOString().split("T")[0]) as string;
    const data = await OrderExecutionService.getLedger(fromDate, toDate);
    res.json({ status: "success", data });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// 6. Intraday Candlestick Chart
router.get("/charts/intraday", async (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol || "btcusdt").toString();
    const interval = (req.query.interval || "15m").toString();
    const data = await MarketDataService.fetchIntradayCandles(symbol, interval);
    res.json(data);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// 6b. Historical Intraday Candlestick Chart
router.get("/charts/historical", async (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol || "btcusdt").toString();
    const fromDate = req.query.fromDate ? req.query.fromDate.toString() : undefined;
    const toDate = req.query.toDate ? req.query.toDate.toString() : undefined;
    const interval = (req.query.interval || "15m").toString();
    const data = await MarketDataService.fetchHistoricalCandles(symbol, fromDate, toDate, interval);
    res.json(data);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// 7. Multi-Timeframe Technical Analysis Bias Engine
router.get("/analysis/bias", async (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol || "btcusdt").toString();
    const data = await TechnicalAnalysisService.computeMultiTimeframeBias(symbol);
    res.json({ status: "success", data });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// 8. Crypto Futures Quantitative Backtesting Endpoint
router.post("/futures/backtest", async (req: Request, res: Response) => {
  try {
    const result = await FuturesBacktestService.runBacktest(req.body);
    res.json({ status: "success", data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Crypto Futures Market Intelligence (Open Interest & Funding Rate)
router.get("/futures/intel", async (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol || "btcusdt").toString();
    const data = await FuturesAnalyticsService.getFuturesMarketIntel(symbol);
    res.json({ status: "success", data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Trader Controls (Kill Switch & P&L Exit)
router.get("/trader-controls", async (req: Request, res: Response) => {
  try {
    const status = await RiskManagementService.getTraderControlsStatus();
    res.json({ status: "success", ...status });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

router.post("/trader-controls/killswitch", async (req: Request, res: Response) => {
  try {
    const action = req.body.status === "DEACTIVATE" ? "DEACTIVATE" : "ACTIVATE";
    const result = await RiskManagementService.setKillSwitchStatus(action);
    res.json({ status: "success", result });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});
