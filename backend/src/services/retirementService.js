// retirementService.js — the Retirement Goal page's brain.
//
// WHAT THIS IS FOR
// A retirement goal is the one number in the app nobody can verify. We cannot
// know when you will stop working, what the market will do, or whether you will
// keep contributing. So this service is built to be USEFUL and HONEST at the
// same time, and those two pull against each other. The rules we settled on:
//
//   1. NEVER a guarantee. The verdict is one of AHEAD / ON_TRACK / BEHIND and
//      the sentence under it says what the number is based on. It never says
//      "you will have X" — only "at the assumptions below, this is what the
//      maths gives you".
//   2. ALWAYS show the return-free line next to the optimistic one. A single
//      optimistic number is how a savings tool becomes a sales tool. Every
//      projection therefore carries `projectedAtZeroReturnMinor` beside the
//      assumed-return figure, and the page prints both.
//   3. The return is an ASSUMPTION, defaulted sensibly, adjustable, and never
//      hidden. It is stored per request, not per account, so we are not quietly
//      guessing on the customer's behalf across sessions.
//   4. The starting pot is REAL money where possible. If the customer holds
//      investments, the projection starts from the live portfolio value and the
//      response says so via `potSource: "PORTFOLIO"`. The manually entered
//      amount is only the fallback, for someone whose savings live somewhere
//      AgbedePay cannot see — and then `potSource` says "MANUAL".
//
// MONEY. Amounts are INTEGER kobo in and out. The projection maths itself is
// done in floating point — a compounded future value has no exact integer form
// — and rounded ONCE at the boundary, to whole kobo. That is the only place in
// this codebase where a float touches a naira amount, and it is a projection,
// not a ledger entry: nothing here is ever stored or moved. See docs/wealth.md.

import * as wealthModel from "../models/wealthModel.js";
import * as userModel from "../models/users.js";
import { getPortfolio } from "./wealthService.js";
import { ApiError, ErrorCodes } from "../utils/errors.js";
import { formatNaira } from "../utils/money.js";

// The default return assumption, and the band we will accept.
//
// 12% p.a. is a blended figure: it sits above where a Nigerian money market
// fund or a treasury bill has typically paid and below the long-run NGX return,
// which is roughly where a mixed portfolio has landed over the long run. It is
// a PLACEHOLDER, not a forecast, and the page labels it as one. 30% is the
// ceiling because anything above it is fantasy dressed as a plan, and a
// projection that always says "on track" is worse than no projection at all.
export const DEFAULT_RETURN_PCT = 12;
export const MAX_RETURN_PCT = 30;

// A target more than 50 years out makes the chart useless and the maths
// meaningless. The table allows target_age up to 100; this service is stricter.
const MAX_MONTHS_AHEAD = 50 * 12;

// The goal form cannot ask for less than this — a retirement pot of ₦10,000 is
// a broken input, not a plan, and the projection below it would be noise.
const MIN_TARGET_MINOR = 100000; // ₦1,000.00

// ============================================================================
// Pure maths. No database, no clock, no globals — so it can be unit tested.
// Every function takes the "as of" date in, because a projection that quietly
// depends on when the test ran is a projection that cannot be tested.
// ============================================================================

// Whole months from `from` to `to`, counted on the CALENDAR, never by dividing
// milliseconds — 30-day months would make "1 January to 1 March" come out as 1
// instead of 2. Returns 0 once the date has passed: you cannot save into next
// month, and reporting a negative horizon would let the maths divide by it.
export function monthsBetween(from, to) {
  const a = new Date(from);
  const b = new Date(to);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  // The target day has not arrived yet this month, so the final month is not
  // complete. 28 Jan -> 28 Feb is 1 month; 28 Jan -> 27 Feb is 0.
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return months > 0 ? months : 0;
}

// Value of `potMinor` after `months` of monthly compounding at `annualPct`,
// with `monthlyMinor` added at the END of each month.
//
// FV = P(1+r)^n + M·((1+r)^n − 1) / r
//
// The r = 0 branch is not an optimisation, it is a correctness requirement:
// ((1+r)^n − 1)/r is 0/0 at r = 0, and without the branch every customer who
// sets the return to zero would get NaN instead of "you save exactly what you
// put in".
export function futureValueMinor({ potMinor, monthlyMinor = 0, annualPct = 0, months = 0 }) {
  if (months <= 0) return potMinor;
  const r = annualPct / 100 / 12;
  if (r === 0) return potMinor + monthlyMinor * months;

  const growth = Math.pow(1 + r, months);
  return potMinor * growth + (monthlyMinor * (growth - 1)) / r;
}

// The monthly contribution that lands EXACTLY on `targetMinor`, given the same
// pot, return and horizon. This is the "what would it take" number that makes
// BEHIND actionable instead of just discouraging.
//
// Returns 0 when the existing pot already grows past the target on its own —
// the honest answer there is "save nothing more", not a negative number. Returns
// null when there is no time left, because the required amount is infinite and
// printing a large number would be worse than admitting it.
export function requiredMonthlyMinor({ potMinor, targetMinor, annualPct = 0, months = 0 }) {
  if (months <= 0) return null;
  const r = annualPct / 100 / 12;
  const grown = futureValueMinor({ potMinor, monthlyMinor: 0, annualPct, months });
  const remaining = targetMinor - grown;
  if (remaining <= 0) return 0;
  if (r === 0) return remaining / months;

  const growth = Math.pow(1 + r, months);
  return (remaining * r) / (growth - 1);
}

// Whole years from an age, and the age a few years on. Used only for labels.
function ageAfter(currentAge, months) {
  return currentAge + Math.floor(months / 12);
}

// The year-by-year series the chart draws.
//
// Capped at 25 points plus the final one. A customer targeting age 100 would
// otherwise get an 80-bar chart nobody can read on a phone, and the extra bars
// carry no information the last one does not.
const MAX_SERIES_POINTS = 25;

function buildSeries({ potMinor, monthlyMinor, annualPct, months, currentAge, targetDate }) {
  const step = 12; // one bar per year
  const points = [];
  const totalYears = Math.ceil(months / step);
  const stride = Math.max(1, Math.ceil(totalYears / MAX_SERIES_POINTS));

  for (let year = 1; year <= totalYears; year += stride) {
    const at = Math.min(year * step, months);
    points.push({
      year,
      months: at,
      age: ageAfter(currentAge, at),
      valueMinor: Math.round(futureValueMinor({ potMinor, monthlyMinor, annualPct, months: at })),
      // What the customer actually put in, so the chart can separate their
      // effort from the market's contribution.
      contributedMinor: potMinor + monthlyMinor * at,
    });
  }

  // Always land on the target date, even when the stride skipped past it.
  const last = points[points.length - 1];
  if (!last || last.months < months) {
    points.push({
      year: totalYears,
      months,
      age: ageAfter(currentAge, months),
      valueMinor: Math.round(futureValueMinor({ potMinor, monthlyMinor, annualPct, months })),
      contributedMinor: potMinor + monthlyMinor * months,
    });
  }

  return {
    points: points.map((p) => ({
      ...p,
      valueNgn: formatNaira(p.valueMinor),
      contributedNgn: formatNaira(p.contributedMinor),
      date: new Date(
        Date.UTC(
          new Date(targetDate).getUTCFullYear(),
          new Date(targetDate).getUTCMonth() + p.months,
          1
        )
      )
        .toISOString()
        .slice(0, 10),
    })),
  };
}

// AHEAD / ON_TRACK / BEHIND / ACHIEVED, from a pot, a target, a contribution and
// the contribution that would be required. One function so the headline verdict
// and the return-free verdict can never be produced by two different pieces of
// logic that happen to agree today.
function classify({ potMinor, targetMinor, monthlyMinor, required, months }) {
  // A horizon that has already passed is BEHIND, but we never ask for a
  // "required contribution" against it: the honest answer there is that no
  // monthly amount can reach a date in the past, which `required = null` says.
  if (months <= 0) return potMinor >= targetMinor ? "ACHIEVED" : "BEHIND";
  if (potMinor >= targetMinor) return "ACHIEVED";
  if (required !== null && monthlyMinor >= required) {
    return monthlyMinor > required ? "AHEAD" : "ON_TRACK";
  }
  return "BEHIND";
}

// A one-line verdict, and the assumption it rests on, in words the customer
// cannot misread as a promise.
//
// The interesting case is the third argument: the customer is on track ONLY
// because we assumed a return. That is a real and reasonable plan, but it is
// not the same claim as "your savings do this", and the sentence has to say so
// in those words rather than leaving the customer to notice the footnote.
function verdict({ status, statusAtZeroReturn, monthlyNgn, requiredMonthlyNgn, gapNgn, targetNgn, targetAge }) {
  switch (status) {
    case "ACHIEVED":
      return `You are already at your ${targetNgn} target. Nothing left to save for it.`;

    case "AHEAD":
    case "ON_TRACK": {
      if (statusAtZeroReturn === "BEHIND") {
        return (
          `On track at your assumed return, but on savings alone you would be ${gapNgn.replace("-", "")} short. ` +
          `The difference depends on the market delivering.`
        );
      }
      if (monthlyNgn && requiredMonthlyNgn) {
        return `At ${monthlyNgn} a month you land on the ${targetNgn} target around the time you turn ${targetAge}, on savings alone.`;
      }
      return `At this rate you land on the ${targetNgn} target around the time you turn ${targetAge}.`;
    }

    case "BEHIND":
      return `At this rate you fall short of ${targetNgn}. Raising your monthly amount, or retiring later, closes the gap.`;

    default:
      return "Set a target to see where you stand.";
  }
}

// The whole projection, from a goal row plus the pot it starts from.
//
// `potMinor` and `potSource` are passed in rather than read here so this stays a
// pure function of its inputs.
export function projectGoal({
  goal,
  potMinor,
  potSource,
  expectedAnnualReturnPct = DEFAULT_RETURN_PCT,
  asOf = new Date(),
}) {
  const months = monthsBetween(asOf, goal.target_date);
  const targetMinor = Number(goal.target_amount_minor);
  const monthlyMinor = Number(goal.monthly_contribution_minor);
  const currentAge = Number(goal.current_age);

  const projected = Math.round(
    futureValueMinor({ potMinor, monthlyMinor, annualPct: expectedAnnualReturnPct, months })
  );
  const noReturn = Math.round(futureValueMinor({ potMinor, monthlyMinor, annualPct: 0, months }));

  // Required contributions are computed TWICE, under both assumptions, so the
  // two verdicts below can never be derived from different maths.
  const required = requiredMonthlyMinor({
    potMinor,
    targetMinor,
    annualPct: expectedAnnualReturnPct,
    months,
  });
  const requiredAtZeroReturn = requiredMonthlyMinor({
    potMinor,
    targetMinor,
    annualPct: 0,
    months,
  });

  // The gap is measured against the HONEST number (no assumed return), not the
  // optimistic one. A customer told they are "on track" only because we assumed
  // 12% is a customer we have not actually helped.
  const gapMinor = noReturn - targetMinor;
  const progressPct =
    targetMinor > 0 ? Math.round((potMinor / targetMinor) * 1000) / 10 : null;

  // Two verdicts, always both. `status` is the headline and answers "on the
  // assumption I have been shown"; `statusAtZeroReturn` answers "on my own
  // savings". Collapsing them into one number is exactly the dishonesty this
  // page exists to avoid, and where they disagree `statusNeedsGrowth` is true
  // and the UI says so in words.
  const status = classify({ potMinor, targetMinor, monthlyMinor, required, months });
  const statusAtZeroReturn = classify({
    potMinor,
    targetMinor,
    monthlyMinor,
    required: requiredAtZeroReturn,
    months,
  });

  const series = buildSeries({
    potMinor,
    monthlyMinor,
    annualPct: expectedAnnualReturnPct,
    months,
    currentAge,
    targetDate: goal.target_date,
  });

  const monthlyNgn = formatNaira(monthlyMinor);

  return {
    asOf: new Date(asOf).toISOString().slice(0, 10),
    potMinor,
    potNgn: formatNaira(potMinor),
    potSource,
    targetMinor,
    targetNgn: formatNaira(targetMinor),
    progressPct,
    monthlyMinor,
    monthlyNgn,
    expectedAnnualReturnPct,
    monthsRemaining: months,
    yearsRemaining: months > 0 ? Math.round((months / 12) * 10) / 10 : 0,
    ageAtTarget: ageAfter(currentAge, months),
    projectedMinor: projected,
    projectedNgn: formatNaira(projected),
    projectedAtZeroReturnMinor: noReturn,
    projectedAtZeroReturnNgn: formatNaira(noReturn),
    // Growth attributable to the assumption, not to the customer. The page
    // shows this so the assumed return is never invisible.
    assumedGrowthMinor: projected - noReturn,
    assumedGrowthNgn: formatNaira(projected - noReturn),
    requiredMonthlyMinor: required === null ? null : Math.round(required),
    requiredMonthlyNgn: required === null ? null : formatNaira(Math.round(required)),
    requiredMonthlyAtZeroReturnMinor:
      requiredAtZeroReturn === null ? null : Math.round(requiredAtZeroReturn),
    requiredMonthlyAtZeroReturnNgn:
      requiredAtZeroReturn === null ? null : formatNaira(Math.round(requiredAtZeroReturn)),
    gapMinor,
    gapNgn: formatNaira(gapMinor),
    status,
    statusAtZeroReturn,
    // TRUE when the headline verdict exists only because of the assumed return.
    statusNeedsGrowth: status !== "ACHIEVED" && statusAtZeroReturn === "BEHIND",
    verdict: verdict({
      status,
      statusAtZeroReturn,
      monthlyNgn,
      requiredMonthlyNgn: required === null ? null : formatNaira(Math.round(required)),
      gapNgn: formatNaira(Math.abs(gapMinor)),
      targetNgn: formatNaira(targetMinor),
      targetAge: Number(goal.target_age),
    }),
    series: series.points,
  };
}

// ============================================================================
// The goal itself
// ============================================================================

// Age today from a date of birth, or null when we do not know it.
//
// The DOB wins over anything the client sends. `current_age` is stored in the
// goal row and the row has a CHECK that the target age is above it, so a
// spoofed age that disagrees with the DOB would corrupt every projection built
// on that row. Where the DOB is unknown (no KYC yet) we have to take the
// customer's word for it, and the response records which happened.
export function ageFromDateOfBirth(dateOfBirth, asOf = new Date()) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;

  let age = asOf.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = asOf.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && asOf.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age >= 0 && age <= 120 ? age : null;
}

function toApiGoal(goal) {
  return {
    id: goal.id,
    name: goal.name,
    targetAge: Number(goal.target_age),
    currentAge: Number(goal.current_age),
    targetAmountMinor: Number(goal.target_amount_minor),
    targetAmountNgn: formatNaira(Number(goal.target_amount_minor)),
    currentAmountMinor: Number(goal.current_amount_minor),
    currentAmountNgn: formatNaira(Number(goal.current_amount_minor)),
    monthlyContributionMinor: Number(goal.monthly_contribution_minor),
    monthlyContributionNgn: formatNaira(Number(goal.monthly_contribution_minor)),
    targetDate: goal.target_date,
    status: goal.status,
    createdAt: goal.created_at,
    updatedAt: goal.updated_at,
  };
}

// Guard rails that a schema cannot express, because they compare two fields or
// compare the request against the calendar.
function assertCoherent({ name, targetAge, currentAge, targetAmountMinor, targetDate, asOf }) {
  if (targetAge <= currentAge) {
    throw new ApiError(
      400,
      `Your target age (${targetAge}) must be later than your current age (${currentAge})`,
      ErrorCodes.VALIDATION
    );
  }
  if (targetAmountMinor < MIN_TARGET_MINOR) {
    throw new ApiError(
      400,
      `Pick a target of at least ${formatNaira(MIN_TARGET_MINOR)}`,
      ErrorCodes.VALIDATION
    );
  }
  if (monthsBetween(asOf, targetDate) <= 0) {
    throw new ApiError(400, "Your target date is in the past", ErrorCodes.VALIDATION);
  }
  if (monthsBetween(asOf, targetDate) > MAX_MONTHS_AHEAD) {
    throw new ApiError(
      400,
      "Pick a target less than 50 years away",
      ErrorCodes.VALIDATION
    );
  }
  // A name is for the customer's own reference, but a wall of spaces is not a
  // name. Trim before it reaches the table.
  if (name.trim().length === 0) {
    throw new ApiError(400, "Give your goal a name", ErrorCodes.VALIDATION);
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

// The pot the projection starts from.
//
// Preference order, and the reason for it: if the customer holds investments,
// their LIVE portfolio value is money AgbedePay can actually see and value today,
// so it beats a number they typed months ago. Only when there is no portfolio do
// we fall back to the amount on the goal — which is the only way someone whose
// savings sit in a bank or a pension with an employer can use this page at all.
async function resolvePot({ userId, goal }) {
  const portfolio = await getPortfolio({ userId });
  const portfolioValueMinor = portfolio.totals.valueMinor;

  if (portfolioValueMinor > 0) {
    return {
      potMinor: portfolioValueMinor,
      potSource: "PORTFOLIO",
      portfolio,
    };
  }
  return {
    potMinor: Number(goal?.current_amount_minor ?? 0),
    potSource: goal ? "MANUAL" : "NONE",
    portfolio,
  };
}

export async function getSummary({ userId, expectedAnnualReturnPct = DEFAULT_RETURN_PCT, asOf = new Date() }) {
  const [goal, user] = await Promise.all([
    wealthModel.findCurrentGoalForUser(userId),
    userModel.findUserWithKyc(userId),
  ]);

  const { potMinor, potSource, portfolio } = await resolvePot({ userId, goal });
  const knownAge = ageFromDateOfBirth(user?.date_of_birth, asOf);

  // No goal yet: still return the live pot and the age we know, so the create
  // form opens pre-filled with something true rather than a blank page.
  if (!goal) {
    return {
      goal: null,
      projection: null,
      currentAge: knownAge,
      ageSource: knownAge === null ? "UNKNOWN" : "DATE_OF_BIRTH",
      hasDateOfBirth: Boolean(user?.date_of_birth),
      portfolioValueMinor: portfolio.totals.valueMinor,
      portfolioValueNgn: portfolio.totals.valueNgn,
      assumptions: {
        expectedAnnualReturnPct,
        defaultReturnPct: DEFAULT_RETURN_PCT,
        maxReturnPct: MAX_RETURN_PCT,
        compounding: "monthly",
      },
    };
  }

  return {
    goal: toApiGoal(goal),
    projection: projectGoal({
      goal,
      potMinor,
      potSource,
      expectedAnnualReturnPct,
      asOf,
    }),
    // The age on the goal row can drift from the DOB as the years pass, so the
    // page shows the age we would use today, not the one frozen at creation.
    currentAge: knownAge ?? Number(goal.current_age),
    ageSource: knownAge === null ? "GOAL" : "DATE_OF_BIRTH",
    hasDateOfBirth: Boolean(user?.date_of_birth),
    portfolioValueMinor: portfolio.totals.valueMinor,
    portfolioValueNgn: portfolio.totals.valueNgn,
    assumptions: {
      expectedAnnualReturnPct,
      defaultReturnPct: DEFAULT_RETURN_PCT,
      maxReturnPct: MAX_RETURN_PCT,
      compounding: "monthly",
    },
  };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

// Only one live goal per person. See the note on findCurrentGoalForUser.
export async function createGoal({
  userId,
  name,
  targetAge,
  currentAge: claimedAge,
  targetAmountMinor,
  currentAmountMinor = 0,
  monthlyContributionMinor = 0,
  targetDate,
  asOf = new Date(),
}) {
  const user = await userModel.findUserWithKyc(userId);
  const fromDob = ageFromDateOfBirth(user?.date_of_birth, asOf);
  const currentAge = fromDob ?? claimedAge;

  // Body coherence BEFORE the conflict check. A request that is both malformed
  // and conflicting should be told what is wrong with the request, not that
  // somebody else got there first — otherwise the 409 hides a bug the caller
  // can actually fix.
  assertCoherent({ name, targetAge, currentAge, targetAmountMinor, targetDate, asOf });

  // Only one live goal per person. See the note on findCurrentGoalForUser.
  const existing = await wealthModel.findCurrentGoalForUser(userId);
  if (existing && existing.status === "ACTIVE") {
    throw new ApiError(
      409,
      "You already have an active retirement goal. Edit it instead.",
      "GOAL_EXISTS"
    );
  }

  const goal = await wealthModel.createGoal({
    userId,
    name: name.trim(),
    targetAge,
    currentAge,
    targetAmountMinor,
    currentAmountMinor,
    monthlyContributionMinor,
    targetDate,
  });

  return { goal: toApiGoal(goal), ageSource: fromDob === null ? "CLAIMED" : "DATE_OF_BIRTH" };
}

export async function updateGoal({
  userId,
  goalId,
  name,
  targetAge,
  targetAmountMinor,
  currentAmountMinor,
  monthlyContributionMinor,
  targetDate,
  asOf = new Date(),
}) {
  // Ownership IS the security, same as a sell: a goal id belonging to someone
  // else is a 404, not a 403, so this endpoint cannot be used to probe which
  // goal ids exist.
  const goal = await wealthModel.findGoalById(goalId);
  if (!goal || goal.user_id !== userId) {
    throw new ApiError(404, "Retirement goal not found", "GOAL_NOT_FOUND");
  }
  if (goal.status === "CLOSED") {
    throw new ApiError(400, "This goal is closed. Create a new one instead.", "GOAL_CLOSED");
  }

  const merged = {
    name: name ?? goal.name,
    targetAge: targetAge ?? Number(goal.target_age),
    targetAmountMinor: targetAmountMinor ?? Number(goal.target_amount_minor),
    targetDate: targetDate ?? goal.target_date,
  };
  assertCoherent({ ...merged, currentAge: Number(goal.current_age), asOf });

  // A PATCH that rewrites nothing must not answer 200. Either the client
  // changed nothing on purpose, or it sent a field name this endpoint does not
  // accept — and both deserve to be told so rather than looking like a save.
  const patch = {
    name: name === undefined ? undefined : name.trim(),
    targetAge: targetAge === undefined ? undefined : targetAge,
    targetAmountMinor: targetAmountMinor === undefined ? undefined : targetAmountMinor,
    currentAmountMinor: currentAmountMinor === undefined ? undefined : currentAmountMinor,
    monthlyContributionMinor:
      monthlyContributionMinor === undefined ? undefined : monthlyContributionMinor,
    targetDate: targetDate === undefined ? undefined : targetDate,
  };
  if (Object.values(patch).every((v) => v === undefined)) {
    throw new ApiError(400, "Nothing to update", ErrorCodes.VALIDATION);
  }

  const saved = await wealthModel.updateGoal(goalId, patch);

  return { goal: toApiGoal(saved) };
}

export async function closeGoal({ userId, goalId }) {
  const goal = await wealthModel.findGoalById(goalId);
  if (!goal || goal.user_id !== userId) {
    throw new ApiError(404, "Retirement goal not found", "GOAL_NOT_FOUND");
  }
  return { goal: toApiGoal(await wealthModel.closeGoal(goalId)) };
}
