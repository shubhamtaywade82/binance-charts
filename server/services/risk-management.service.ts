export class RiskManagementService {
  private static killSwitchActive = false;

  public static async getTraderControlsStatus(): Promise<any> {
    return {
      killSwitch: { status: this.killSwitchActive ? "ACTIVE" : "INACTIVE" },
      pnlExit: { maxLoss: -1000, targetProfit: 2500, status: "ACTIVE" },
    };
  }

  public static async setKillSwitchStatus(action: "ACTIVATE" | "DEACTIVATE"): Promise<any> {
    this.killSwitchActive = action === "ACTIVATE";
    return { status: "success", killSwitch: this.killSwitchActive ? "ACTIVE" : "INACTIVE" };
  }
}
