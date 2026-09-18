import type { CardStatement, Transaction } from "@/lib/types";

/** Respuesta de GET /api/cards/statements */
export interface StatementWithTransactions extends CardStatement {
  account_name: string;
  transactions: Transaction[];
  payment: Transaction | null;
}

export interface StatementsResponse {
  statements: StatementWithTransactions[];
}

export const STATEMENT_LABELS: Record<CardStatement["status"], string> = {
  open: "Abierto",
  closed: "Cerrado",
  paid: "Pagado",
};
