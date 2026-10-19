import { TransactionBuilder, Networks, StrKey } from "@stellar/stellar-sdk";

const PASS: Record<string, string> = { TESTNET: Networks.TESTNET, PUBLIC: Networks.PUBLIC };

export interface OpSummary { type: string; destination?: string; amount?: string; assetCode?: string }
export interface TxSummary { source: string; fee: string; memo?: string; operations: OpSummary[] }

export function decodeTx(xdr: string, network: "TESTNET" | "PUBLIC"): TxSummary {
  const tx = TransactionBuilder.fromXDR(xdr, PASS[network]!) as any;
  const ops: OpSummary[] = (tx.operations ?? []).map((op: any) => {
    if (op.type === "payment") {
      return { type: "payment", destination: op.destination, amount: op.amount,
               assetCode: op.asset?.isNative?.() ? "XLM" : op.asset?.code };
    }
    return { type: op.type };
  });
  return {
    source: tx.source,
    fee: String(tx.fee),
    memo: (tx.memo && tx.memo.type === "text" && typeof tx.memo.value === "string") ? tx.memo.value : undefined,
    operations: ops,
  };
}

export function localHash(xdr: string, network: "TESTNET" | "PUBLIC"): Buffer {
  return TransactionBuilder.fromXDR(xdr, PASS[network]!).hash();
}

export function isValidStellarAddress(address: string): boolean {
  try { return StrKey.isValidEd25519PublicKey(address); } catch { return false; }
}

// Compare decimal amount strings as integer stroops (7 decimals), avoiding
// float rounding that would let off-by-one-stroop differences pass.
function toStroops(value: string): bigint | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [rawInt, rawFrac = ""] = trimmed.split(".");
  if (rawFrac.length > 7) return null;
  const frac = (rawFrac + "0000000").slice(0, 7);
  return BigInt(rawInt) * 10000000n + BigInt(frac);
}

export function assertPaymentMatches(
  s: TxSummary,
  expect: { destination: string; amount: string; assetCode: string; memo?: string; maxFee?: string },
): void {
  const pays = s.operations.filter((o) => o.type === "payment");
  if (s.operations.length !== 1) {
    const extra = s.operations.filter((o) => o.type !== "payment").map((o) => o.type);
    throw new Error(
      `guard: esperava exatamente 1 operação, encontrei ${s.operations.length}`
      + (extra.length ? ` (operações injectadas: ${extra.join(", ")})` : ""),
    );
  }
  if (pays.length !== 1) {
    throw new Error(`guard: esperava exatamente 1 pagamento, encontrei ${pays.length}`);
  }
  const pay = pays[0]!;
  if (pay.destination !== expect.destination.trim()) {
    throw new Error(`guard: destino divergente (assinaria ${pay.destination}, esperado ${expect.destination})`);
  }
  if (pay.assetCode !== expect.assetCode) {
    throw new Error(`guard: ativo divergente (${pay.assetCode} vs ${expect.assetCode})`);
  }
  if (expect.memo !== undefined) {
    if (s.memo === undefined) {
      throw new Error(`guard: memo ausente (esperado ${expect.memo})`);
    }
    if (s.memo !== expect.memo) {
      throw new Error(`guard: memo divergente (assinaria ${s.memo}, esperado ${expect.memo})`);
    }
  }
  if (expect.maxFee !== undefined) {
    const gotFee = toStrools(s.fee);
    const maxFee = toStrools(expect.maxFee);
    if (gotFee === null || maxFee === null) {
      throw new Error("guard: taxa não numérica");
    }
    if (gotFee > maxFee) {
      throw new Error(`guard: taxa acima do máximo (assinaria ${s.fee}, máximo ${expect.maxFee})`);
    }
  }
  const got = toStrools(pay.amount ?? "");
  const want = toStrools(expect.amount);
  if (got === null || want === null) {
    throw new Error("guard: valor não numérico");
  }
  if (got !== want) {
    throw new Error(`guard: valor divergente (assinaria ${pay.amount}, esperado ${expect.amount})`);
  }
}
