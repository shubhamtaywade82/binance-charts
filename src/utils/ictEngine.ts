export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface ICTSession {
  id: string;
  name: string;
  type: "ASIA" | "LONDON" | "NEW_YORK";
  startTime: number;
  endTime: number;
  high: number;
  low: number;
}

export interface ICTSilverBulletWindow {
  id: string;
  name: string;
  type: "LONDON_SB" | "NY_AM_SB" | "NY_PM_SB";
  startTime: number;
  endTime: number;
}

export interface ICTOTEZone {
  swingHigh: number;
  swingLow: number;
  trend: "BULLISH" | "BEARISH";
  fib618: number;
  fib705: number;
  fib790: number;
  startTime: number;
}

export interface ICTJudasSwing {
  id: string;
  type: "BULLISH_JUDAS" | "BEARISH_JUDAS";
  candleTime: number;
  level: number;
  asiaHigh: number;
  asiaLow: number;
}

interface SessionAcc {
  type: "ASIA" | "LONDON" | "NEW_YORK";
  name: string;
  candles: CandleData[];
}

interface SBAcc {
  type: "LONDON_SB" | "NY_AM_SB" | "NY_PM_SB";
  name: string;
  candles: CandleData[];
}

/**
 * Detect ICT Trading Sessions & Kill Zones across intraday candlestick data (UTC).
 * - Asia Session Range: 20:00 - 00:30 UTC (overnight rollover)
 * - London Kill Zone: 07:00 - 10:00 UTC
 * - New York Kill Zone: 12:00 - 15:00 UTC
 */
export function detectICTSessions(candles: CandleData[]): ICTSession[] {
  if (!candles || candles.length === 0) return [];

  const sessions: ICTSession[] = [];
  let currentSession: SessionAcc | null = null;

  const pushCurrentSession = () => {
    if (!currentSession || currentSession.candles.length === 0) return;
    const cList = currentSession.candles;
    sessions.push({
      id: `session-${currentSession.type}-${cList[0].time}`,
      name: currentSession.name,
      type: currentSession.type,
      startTime: cList[0].time,
      endTime: cList[cList.length - 1].time,
      high: Math.max(...cList.map((c: CandleData) => c.high)),
      low: Math.min(...cList.map((c: CandleData) => c.low)),
    });
  };

  candles.forEach((candle) => {
    const date = new Date(candle.time * 1000);
    const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();

    let targetType: "ASIA" | "LONDON" | "NEW_YORK" | null = null;
    let name = "";

    if (utcMinutes >= 1200 || utcMinutes < 30) {
      targetType = "ASIA";
      name = "ASIA RANGE";
    } else if (utcMinutes >= 420 && utcMinutes < 600) {
      targetType = "LONDON";
      name = "LONDON KZ";
    } else if (utcMinutes >= 720 && utcMinutes < 900) {
      targetType = "NEW_YORK";
      name = "NY KZ";
    }

    if (targetType) {
      if (!currentSession || currentSession.type !== targetType) {
        pushCurrentSession();
        currentSession = { type: targetType, name, candles: [candle] };
      } else {
        currentSession.candles.push(candle);
      }
    } else {
      if (currentSession) {
        pushCurrentSession();
        currentSession = null;
      }
    }
  });

  pushCurrentSession();

  return sessions;
}

/**
 * Detect ICT Silver Bullet Windows across intraday candlestick data (UTC).
 * - London Open SB: 08:00 - 09:00 UTC
 * - NY AM SB: 14:00 - 15:00 UTC
 * - NY PM SB: 18:00 - 19:00 UTC
 */
export function detectSilverBulletWindows(candles: CandleData[]): ICTSilverBulletWindow[] {
  if (!candles || candles.length === 0) return [];

  const windows: ICTSilverBulletWindow[] = [];
  let currentSB: SBAcc | null = null;

  const pushCurrentSB = () => {
    if (!currentSB || currentSB.candles.length === 0) return;
    const cList = currentSB.candles;
    windows.push({
      id: `sb-${currentSB.type}-${cList[0].time}`,
      name: currentSB.name,
      type: currentSB.type,
      startTime: cList[0].time,
      endTime: cList[cList.length - 1].time,
    });
  };

  candles.forEach((candle) => {
    const date = new Date(candle.time * 1000);
    const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();

    let targetType: "LONDON_SB" | "NY_AM_SB" | "NY_PM_SB" | null = null;
    let name = "";

    if (utcMinutes >= 480 && utcMinutes < 540) {
      targetType = "LONDON_SB";
      name = "SILVER BULLET (LDN 🎯)";
    } else if (utcMinutes >= 840 && utcMinutes < 900) {
      targetType = "NY_AM_SB";
      name = "SILVER BULLET (NY AM 🎯)";
    } else if (utcMinutes >= 1080 && utcMinutes < 1140) {
      targetType = "NY_PM_SB";
      name = "SILVER BULLET (NY PM 🎯)";
    }

    if (targetType) {
      if (!currentSB || currentSB.type !== targetType) {
        pushCurrentSB();
        currentSB = { type: targetType, name, candles: [candle] };
      } else {
        currentSB.candles.push(candle);
      }
    } else {
      if (currentSB) {
        pushCurrentSB();
        currentSB = null;
      }
    }
  });

  pushCurrentSB();

  return windows;
}

/**
 * Detect ICT Optimal Trade Entry (OTE Zone: 0.618 - 0.705 ⭐ - 0.790 Fib Retracement Levels).
 */
export function detectICTOTEZone(candles: CandleData[], lookback = 80): ICTOTEZone | null {
  if (!candles || candles.length < 20) return null;

  const slice = candles.slice(-Math.min(candles.length, lookback));
  let maxHigh = -Infinity;
  let minLow = Infinity;
  let highTime = slice[0].time;
  let lowTime = slice[0].time;

  slice.forEach((c) => {
    if (c.high > maxHigh) {
      maxHigh = c.high;
      highTime = c.time;
    }
    if (c.low < minLow) {
      minLow = c.low;
      lowTime = c.time;
    }
  });

  if (maxHigh <= minLow) return null;

  const range = maxHigh - minLow;
  const isBullish = highTime > lowTime;
  const trend = isBullish ? "BULLISH" : "BEARISH";

  let fib618 = 0;
  let fib705 = 0;
  let fib790 = 0;

  if (isBullish) {
    fib618 = maxHigh - range * 0.618;
    fib705 = maxHigh - range * 0.705;
    fib790 = maxHigh - range * 0.790;
  } else {
    fib618 = minLow + range * 0.618;
    fib705 = minLow + range * 0.705;
    fib790 = minLow + range * 0.790;
  }

  const startTime = Math.min(highTime, lowTime);

  return {
    swingHigh: maxHigh,
    swingLow: minLow,
    trend,
    fib618,
    fib705,
    fib790,
    startTime,
  };
}

/**
 * Detect ICT Judas Swings (Session Open False Expansion & Fakeout Traps).
 * Identifies London/NY open wicks piercing Asian Range High/Low that close back inside.
 */
export function detectJudasSwings(candles: CandleData[]): ICTJudasSwing[] {
  if (!candles || candles.length < 15) return [];

  const judasList: ICTJudasSwing[] = [];
  const sessions = detectICTSessions(candles);
  const asiaSessions = sessions.filter((s) => s.type === "ASIA");

  asiaSessions.forEach((asia) => {
    const postAsiaCandles = candles.filter((c) => c.time > asia.endTime);

    postAsiaCandles.forEach((c) => {
      const date = new Date(c.time * 1000);
      const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();

      // Only check during London Open (07:00 - 10:00 UTC) or NY Open (12:00 - 15:00 UTC)
      const isKillZone = (utcMinutes >= 420 && utcMinutes < 600) || (utcMinutes >= 720 && utcMinutes < 900);
      if (!isKillZone) return;

      // Bearish Judas (False Pump): Wick pierces above Asian High, but body closes below
      if (c.high > asia.high && c.close < asia.high) {
        const id = `judas-bear-${asia.id}-${c.time}`;
        if (!judasList.some((j) => j.id === id)) {
          judasList.push({
            id,
            type: "BEARISH_JUDAS",
            candleTime: c.time,
            level: c.high,
            asiaHigh: asia.high,
            asiaLow: asia.low,
          });
        }
      }

      // Bullish Judas (False Dip): Wick pierces below Asian Low, but body closes above
      if (c.low < asia.low && c.close > asia.low) {
        const id = `judas-bull-${asia.id}-${c.time}`;
        if (!judasList.some((j) => j.id === id)) {
          judasList.push({
            id,
            type: "BULLISH_JUDAS",
            candleTime: c.time,
            level: c.low,
            asiaHigh: asia.high,
            asiaLow: asia.low,
          });
        }
      }
    });
  });

  return judasList;
}

export interface ICTAMDCycle {
  id: string;
  trend: "BULLISH" | "BEARISH";
  accumStartTime: number;
  accumEndTime: number;
  accumHigh: number;
  accumLow: number;
  manipStartTime: number;
  manipEndTime: number;
  manipLevel: number;
  distribStartTime: number;
  distribEndTime: number;
  distribLevel: number;
}

/**
 * Detect ICT AMD (Power of 3) Cycles: Accumulation → Manipulation → Distribution.
 * Uses intraday UTC session windows:
 * - Accumulation: Asia Session Range (20:00 - 00:30 UTC)
 * - Manipulation (Judas Swing): London Open false move (07:00 - 09:00 UTC)
 * - Distribution: True directional move (09:00 - 15:00 UTC)
 */
export function detectAMDCycles(candles: CandleData[]): ICTAMDCycle[] {
  if (!candles || candles.length < 20) return [];

  const cycles: ICTAMDCycle[] = [];

  // Group candles by calendar day (UTC)
  const dayMap = new Map<string, CandleData[]>();
  candles.forEach((c) => {
    const date = new Date(c.time * 1000);
    const dayKey = date.toISOString().slice(0, 10);
    if (!dayMap.has(dayKey)) dayMap.set(dayKey, []);
    dayMap.get(dayKey)!.push(c);
  });

  dayMap.forEach((dayCandles, dayKey) => {
    const accumCandles = dayCandles.filter((c) => {
      const utcMins = toUTCMinutes(c.time);
      return utcMins >= 1200 || utcMins < 30; // 20:00 - 00:30 (rollover)
    });
    const manipCandles = dayCandles.filter((c) => {
      const utcMins = toUTCMinutes(c.time);
      return utcMins >= 420 && utcMins < 540; // 07:00 - 09:00
    });
    const distribCandles = dayCandles.filter((c) => {
      const utcMins = toUTCMinutes(c.time);
      return utcMins >= 540 && utcMins < 900; // 09:00 - 15:00
    });

    if (accumCandles.length < 2 || manipCandles.length < 1 || distribCandles.length < 1) return;

    const accumHigh = Math.max(...accumCandles.map((c) => c.high));
    const accumLow = Math.min(...accumCandles.map((c) => c.low));

    // Manipulation: false expansion vs accumulation range
    const manipHigh = Math.max(...manipCandles.map((c) => c.high));
    const manipLow = Math.min(...manipCandles.map((c) => c.low));

    const distribClose = distribCandles[distribCandles.length - 1].close;
    const distribOpen = distribCandles[0].open;

    // Bullish AMD: Manipulation sweeps below accum low, distribution closes above accum high
    if (manipLow < accumLow && distribClose > accumHigh) {
      cycles.push({
        id: `amd-bull-${dayKey}`,
        trend: "BULLISH",
        accumStartTime: accumCandles[0].time,
        accumEndTime: accumCandles[accumCandles.length - 1].time,
        accumHigh,
        accumLow,
        manipStartTime: manipCandles[0].time,
        manipEndTime: manipCandles[manipCandles.length - 1].time,
        manipLevel: manipLow,
        distribStartTime: distribCandles[0].time,
        distribEndTime: distribCandles[distribCandles.length - 1].time,
        distribLevel: distribClose,
      });
    }

    // Bearish AMD: Manipulation sweeps above accum high, distribution closes below accum low
    if (manipHigh > accumHigh && distribClose < accumLow) {
      cycles.push({
        id: `amd-bear-${dayKey}`,
        trend: "BEARISH",
        accumStartTime: accumCandles[0].time,
        accumEndTime: accumCandles[accumCandles.length - 1].time,
        accumHigh,
        accumLow,
        manipStartTime: manipCandles[0].time,
        manipEndTime: manipCandles[manipCandles.length - 1].time,
        manipLevel: manipHigh,
        distribStartTime: distribCandles[0].time,
        distribEndTime: distribCandles[distribCandles.length - 1].time,
        distribLevel: distribClose,
      });
    }
  });

  return cycles.sort((a, b) => a.accumStartTime - b.accumStartTime);
}

function toUTCMinutes(unixSec: number): number {
  const date = new Date(unixSec * 1000);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}
