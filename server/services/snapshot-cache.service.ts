import fs from "fs";
import path from "path";
import { FuturesBacktestService } from "./futures-backtest.service";

const SNAPSHOTS_DIR = path.resolve(process.cwd(), "server/data/historical_snapshots");

export class SnapshotCacheService {
  private static ensureStorageDir() {
    if (!fs.existsSync(SNAPSHOTS_DIR)) {
      fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    }
  }

  public static listCachedSessions(): any[] {
    this.ensureStorageDir();
    const files = fs.readdirSync(SNAPSHOTS_DIR);
    const sessions: any[] = [];

    for (const file of files) {
      if (file.endsWith(".json")) {
        try {
          const filePath = path.join(SNAPSHOTS_DIR, file);
          const raw = fs.readFileSync(filePath, "utf-8");
          const data = JSON.parse(raw);
          if (data && data.symbol) {
            sessions.push({
              file,
              symbol: data.symbol,
              date: data.date || "2026-07-31",
            });
          }
        } catch (err: any) {}
      }
    }

    return sessions;
  }
}
