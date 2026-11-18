/** Feature pack: importing this module registers every extra action, public action, hook and report. */
import { lockCollections } from "./shared.js";
import "./commerce.js";
import "./engines.js";
import "./engage.js";
import "./jobs.js";
import "./growth.js";

lockCollections([
  "outbox", "files", "paymentLinks", "holds", "tcsPayers", "flightOrders", "policies", "claims", "calls", "chatThreads", "amendments", "commissions", "customerSessions", "automationRuns",
]);

export { createLink, settlePaymentLink, proposalAmount } from "./commerce.js";
export { afterConfirm, roomsLeft, premiumOf } from "./engines.js";
export { recordCall, queueCampaign, parseItineraryText, type CallInput } from "./engage.js";
export { runJobs, findFollowUps, runFollowUps } from "./jobs.js";
export { seedPlus } from "./seedPlus.js";
export { runAutomations, eventsFromWrites, proratedSpend, normaliseLostReason, PAYMENT_LINK_TRIGGERS, SOURCE_LABEL, SMS_COST } from "./growth.js";
export { AUTOMATION_TEMPLATES } from "./growthRecipes.js";
export { appLink, checkUpload } from "./shared.js";
export type * from "./growthTypes.js";
