// transfer controller — thin HTTP layer for transaction endpoints.
// All identity comes from req.user (the authed session); there is never a
// client-supplied user/wallet in the request.

import { asyncHandler, ApiError, ErrorCodes } from "../utils/errors.js";
import * as transferService from "../services/transferService.js";

const reqCtx = (req) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get("user-agent") ?? null,
});

const VALID_STATUS = ["SUCCESS", "FAILED", "PENDING", "REVERSED"];
const VALID_TYPES = ["TRANSFER", "REVERSAL", "FUNDING", "SAVINGS_DEPOSIT", "AIRTIME", "BILLS", "WITHDRAWAL", "BETTING", "BANK"];
const VALID_SORTS = ["newest", "oldest", "amount_hi", "amount_lo"];

// Query params travel as strings. Coerce safely; reject anything that isn't a
// positive integer. This is the only place list pagination is massaged.
function positiveInt(value, fallback, max) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new ApiError(400, "Pagination values must be positive integers", ErrorCodes.VALIDATION);
  }
  return max ? Math.min(n, max) : n;
}

function filter(value, allowed) {
  if (value === undefined || value === null || value === "") return null;
  const upper = String(value).toUpperCase();
  const match = allowed.find((a) => String(a).toUpperCase() === upper);
  if (!match) {
    throw new ApiError(400, `Invalid filter value. Allowed: ${allowed.join(", ")}`, ErrorCodes.VALIDATION);
  }
  return match;
}

// Date-range filter: "2026-09-01" means start of that day; "to" means end of it.
// ISO datetimes (2026-09-01T14:00) pass through as-is. Anything unparsable is
// rejected loudly instead of silently returning an empty statement.
function dateBound(value, isTo) {
  if (value === undefined || value === null || value === "") return null;
  let raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    raw += isTo ? "T23:59:59.999" : "T00:00:00";
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, "Invalid date range. Use YYYY-MM-DD.", ErrorCodes.VALIDATION);
  }
  return parsed.toISOString();
}

export const send = asyncHandler(async (req, res) => {
  const data = await transferService.sendMoney({
    ...req.body,
    senderUserId: req.user.id,
    idempotencyKey: req.idempotencyKey,
    ...reqCtx(req),
  });
  res.status(201).json({ success: true, data });
});

export const listBanks = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { banks: transferService.supportedBanks() } });
});

export const verifyBankAccount = asyncHandler(async (req, res) => {
  const data = await transferService.verifyBankAccount(req.user.id, {
    bankName: req.body.bankName,
    accountNumber: req.body.accountNumber,
  });
  res.json({ success: true, data, message: "Account verified." });
});

export const verifyAgbedeAccount = asyncHandler(async (req, res) => {
  const data = await transferService.verifyAgbedeAccount(req.user.id, {
    accountNumber: req.body.accountNumber,
    phone: req.body.phone,
  });
  res.json({ success: true, data, message: "Account verified." });
});

export const sendToBank = asyncHandler(async (req, res) => {
  const data = await transferService.sendToBankMoney({
    ...req.body,
    senderUserId: req.user.id,
    idempotencyKey: req.idempotencyKey,
    ...reqCtx(req),
  });
  res.status(201).json({ success: true, data, message: `Money sent to ${data.account.bankName}.` });
});

export const list = asyncHandler(async (req, res) => {
  const page = positiveInt(req.query.page, 1, null);
  const limit = positiveInt(req.query.limit, 20, 100);
  const status = filter(req.query.status, VALID_STATUS);
  const type = filter(req.query.type, VALID_TYPES);
  const sort = filter(req.query.sort, VALID_SORTS);
  const from = dateBound(req.query.from, false);
  const to = dateBound(req.query.to, true);

  const data = await transferService.listTransactions({
    userId: req.user.id,
    page,
    limit,
    status,
    type,
    sort,
    from,
    to,
  });
  res.json({ success: true, data });
});

export const exportCsv = asyncHandler(async (req, res) => {
  const status = filter(req.query.status, VALID_STATUS);
  const type = filter(req.query.type, VALID_TYPES);
  const sort = filter(req.query.sort, VALID_SORTS);
  const from = dateBound(req.query.from, false);
  const to = dateBound(req.query.to, true);

  const { filename, csv } = await transferService.exportCsvStatement({
    userId: req.user.id,
    status,
    type,
    sort,
    from,
    to,
  });

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
});

export const detail = asyncHandler(async (req, res) => {
  const data = await transferService.getTransactionDetail({
    userId: req.user.id,
    transactionId: req.params.id,
  });
  res.json({ success: true, data });
});

export const receipt = asyncHandler(async (req, res) => {
  const data = await transferService.getReceipt({
    userId: req.user.id,
    transactionId: req.params.id,
  });
  res.json({ success: true, data });
});

export const reverse = asyncHandler(async (req, res) => {
  const data = await transferService.reverseTransfer({
    transactionId: req.params.id,
    userId: req.user.id,
    pin: req.body.pin,
    ...reqCtx(req),
  });
  res.json({ success: true, data });
});