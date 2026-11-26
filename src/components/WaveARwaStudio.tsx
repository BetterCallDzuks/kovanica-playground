import { useState } from "react";
import {
  FIXED_FEE_SCHEDULE,
  PREV_DEPLOYED_CONTRACT,
  SignatureScheme,
  buildApproveAndSwapBatchActions,
  buildBridgeInitCall,
  buildRwaCreateCall,
  buildScheduledRwaDividendJobCall,
  buildSchedulerCreateJobCall,
  chunkRwaAllowlistBatches,
  computeProRataDividends,
  deriveAmmPoolId,
  deriveTypedAddress,
  encodeAddress,
  nextBaseFeePerByte,
  quoteAmmSwapExactIn,
  signBatchTransaction,
} from "kovanica-sdk";

export function WaveARwaStudio() {
  const [assetClass, setAssetClass] = useState<"RE" | "BOND" | "INVOICE" | "COMMODITY" | "FUND" | "OTHER">("RE");
  const [uniqueId, setUniqueId] = useState("tower-12a");
  const [output, setOutput] = useState<string>("");

  const handleSimulateBatch = () => {
    const priv = new Uint8Array(32).fill(7);
    const pub = new Uint8Array(32).fill(0x17);
    const rwaArgs = buildRwaCreateCall({
      name: `RWA ${assetClass} ${uniqueId}`,
      symbol: "RWA1",
      assetClass,
      uniqueId,
      version: 1,
      jurisdiction: "HR",
      metadataHash: new Uint8Array(32).fill(0xab),
      metadataUri: "ipfs://QmExample",
      decimals: 6,
      maxSupply: 1_000_000n,
      initialSupply: 100_000n,
    });
    const batch = signBatchTransaction({
      chainId: 1n,
      senderPrivateKey: priv,
      senderPublicKey: pub,
      nonce: 0n,
      actions: [
        { kind: "deploy", code: new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]) },
        {
          kind: "call",
          contract: PREV_DEPLOYED_CONTRACT,
          method: "rwa_create",
          args: rwaArgs,
          gasLimit: 500_000n,
        },
      ],
      fee: FIXED_FEE_SCHEDULE.deploy + FIXED_FEE_SCHEDULE.rwa_create,
    });
    const nextBase = nextBaseFeePerByte(10n, 960 * 1024);
    const passkeyAddr = deriveTypedAddress(SignatureScheme.Secp256r1WebAuthn, pub);
    const schedBytes = buildSchedulerCreateJobCall({
      targetContract: pub,
      method: "rwa_mint",
      args: new Uint8Array([1, 2, 3]),
      executeAfterHeight: 100n,
      intervalHeights: 2400n,
      maxRuns: 12,
      bountyPerRun: 50_000_000n,
    });
    const bridgeBytes = buildBridgeInitCall({
      wrappedToken: pub,
      assetSymbol: "wUSDC",
      relayers: [pub],
      threshold: 1,
    });
    const tokenA = new Uint8Array(32).fill(0x11);
    const tokenB = new Uint8Array(32).fill(0x22);
    const ammPoolId = deriveAmmPoolId(tokenA, tokenB);
    const ammQuote = quoteAmmSwapExactIn({
      amountIn: 10_000_000n,
      reserveIn: 1_000_000_000n,
      reserveOut: 1_000_000_000n,
      slippageBps: 50,
    });
    const ammBatch = buildApproveAndSwapBatchActions({
      ammContract: pub,
      poolId: ammPoolId,
      tokenIn: tokenA,
      amountIn: 10_000_000n,
      minOut: ammQuote.minAmountOut,
    });
    const holderAddr = encodeAddress(pub);
    const allowlistBatches = chunkRwaAllowlistBatches({
      rwaContract: pub,
      entries: [{ address: holderAddr, allowed: true, kycTier: 2 }],
    });
    const couponPlan = computeProRataDividends({
      totalPayoutAtoms: 1_000_000_000n,
      holders: [{ address: holderAddr, balance: 1_000n }],
    });
    const scheduledDividendBytes = buildScheduledRwaDividendJobCall({
      rwaContract: pub,
      payoutToken: "KVNC",
      totalPayoutAtoms: 1_000_000_000n,
      epochId: 1,
      memo: "Q4 Coupon",
      executeAfterHeight: 100_000n,
      intervalHeights: 21_600n,
      maxRuns: 12,
      bountyPerRun: 50_000_000n,
    });

    setOutput(
      JSON.stringify(
        {
          sdkVersion: "v0.10.0",
          batchTxBytes: batch.rawBytes.length,
          batchFeeAtoms: (FIXED_FEE_SCHEDULE.deploy + FIXED_FEE_SCHEDULE.rwa_create).toString(),
          eip1559NextBaseFeeAtFullBlock: nextBase.toString(),
          passkeyAddressHex: `0x${Array.from(passkeyAddr.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("")}...`,
          schedulerCallBytes: schedBytes.length,
          bridgeInitBytes: bridgeBytes.length,
          ammSwapQuoteOut: ammQuote.amountOut.toString(),
          ammBatchActionCount: ammBatch.length,
          rwaAllowlistBatchCount: allowlistBatches.length,
          rwaDividendDistributedAtoms: couponPlan.distributedAtoms.toString(),
          scheduledDividendJobBytes: scheduledDividendBytes.length,
        },
        null,
        2,
      ),
    );
  };

  return (
    <section
      className="bg-surface rounded-xl border border-border p-6 space-y-4"
      data-testid="wave-a-rwa-studio"
    >
      <div className="border-b border-border pb-3">
        <h3 className="text-base font-semibold text-fg">Wave A–D &amp; KVP-106 RWA Studio</h3>
        <p className="text-xs text-muted mt-0.5">
          Simulate atomic Wave A batches, EIP-1559 fees, WebAuthn passkeys, scheduler, bridge, AMM swaps, and KVP-106 RWA compliance.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="RWA Asset Class"
          value={assetClass}
          onChange={(e) => setAssetClass(e.target.value as typeof assetClass)}
          className="bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-gold"
        >
          <option value="RE">Real Estate (RE)</option>
          <option value="BOND">Bond (BOND)</option>
          <option value="INVOICE">Invoice (INVOICE)</option>
          <option value="COMMODITY">Commodity (COMMODITY)</option>
          <option value="FUND">Fund (FUND)</option>
          <option value="OTHER">Other (OTHER)</option>
        </select>
        <input
          aria-label="RWA Unique ID"
          value={uniqueId}
          onChange={(e) => setUniqueId(e.target.value)}
          className="bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm font-mono text-fg focus:outline-none focus:border-gold"
        />
        <button
          type="button"
          onClick={handleSimulateBatch}
          className="px-4 py-2 bg-gold hover:bg-gold/90 text-bg font-semibold rounded-lg text-sm transition-colors"
        >
          Build 1-Tx RWA Batch
        </button>
      </div>
      {output && (
        <pre
          data-testid="wave-a-rwa-output"
          className="bg-surface-2 p-4 rounded-lg border border-border text-xs font-mono text-fg overflow-x-auto"
        >
          {output}
        </pre>
      )}
    </section>
  );
}
