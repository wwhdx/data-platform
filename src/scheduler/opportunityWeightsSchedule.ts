import type { Scheduler } from "./index";
import { calibrateWeights } from "../uode/calibrateOpportunityWeights";
import { listActiveIndustryTags } from "../storage/models/industryTag";

export const OPPORTUNITY_WEIGHTS_TASK_ID = "calibrate-opportunity-weights-global";

export function registerOpportunityWeightsSchedule(scheduler: Scheduler): void {
  const cron = process.env.OPPORTUNITY_WEIGHTS_CRON?.trim() || "0 2 * * 0";
  scheduler.scheduleMaintenance(OPPORTUNITY_WEIGHTS_TASK_ID, cron, async () => {
    await calibrateWeights(null);
    const tags = await listActiveIndustryTags();
    for (const tag of tags) {
      await calibrateWeights(tag);
    }
  });
}
