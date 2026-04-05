export const POST_GENERATOR_PLAN_TYPE = "post_generator" as const;
export const POST_GENERATOR_MONTHLY_PRICE = 20000;
export const POST_GENERATOR_MONTHLY_CREDITS = 30;
export const POST_GENERATOR_DAILY_LIMIT = 5;

export type PostGeneratorPlanType = typeof POST_GENERATOR_PLAN_TYPE;

export type PostGeneratorSubscriptionLike = {
  startDate?: string | null;
  endDate?: string | null;
  remainingCredits?: number | null;
  dailyUsageCount?: number | null;
  lastUsageDate?: string | null;
};

function getDateParts(date: Date, timeZone = "Asia/Seoul") {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";

  return { year, month, day };
}

export function getKoreaDateString(date = new Date()) {
  const { year, month, day } = getDateParts(date);
  return `${year}-${month}-${day}`;
}

export function addMonthsToKoreaDateString(
  baseDateString: string,
  monthsToAdd: number
) {
  const [year, month, day] = baseDateString.split("-").map(Number);
  const nextDate = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
  nextDate.setUTCMonth(nextDate.getUTCMonth() + monthsToAdd);

  const nextYear = nextDate.getUTCFullYear();
  const nextMonth = String(nextDate.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(nextDate.getUTCDate()).padStart(2, "0");

  return `${nextYear}-${nextMonth}-${nextDay}`;
}

export function isPostGeneratorSubscriptionActive(
  subscription?: PostGeneratorSubscriptionLike | null,
  today = getKoreaDateString()
) {
  if (!subscription?.startDate || !subscription?.endDate) {
    return false;
  }

  return subscription.startDate <= today && subscription.endDate >= today;
}

export function getEffectiveDailyUsageCount(
  subscription?: PostGeneratorSubscriptionLike | null,
  today = getKoreaDateString()
) {
  if (!subscription) {
    return 0;
  }

  if (subscription.lastUsageDate !== today) {
    return 0;
  }

  return Math.max(subscription.dailyUsageCount ?? 0, 0);
}

export function getRemainingDailyGenerationCount(
  subscription?: PostGeneratorSubscriptionLike | null,
  today = getKoreaDateString()
) {
  return Math.max(
    POST_GENERATOR_DAILY_LIMIT - getEffectiveDailyUsageCount(subscription, today),
    0
  );
}

export function getRemainingSubscriptionCredits(
  subscription?: PostGeneratorSubscriptionLike | null
) {
  return Math.max(subscription?.remainingCredits ?? 0, 0);
}
