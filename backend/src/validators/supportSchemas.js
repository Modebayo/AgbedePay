// Validation schema for Help & Support ticket creation.

export const supportTicketSchema = {
  category: ["required", ["enum", ["PAYMENT", "WITHDRAWAL", "KYC", "DISPATCH", "RIDE", "CARD", "OTHER"]]],
  subject: ["required", "string", ["maxLen", 120]],
  message: ["required", "string", ["maxLen", 1000]],
};
