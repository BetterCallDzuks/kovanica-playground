import { useState } from "react";
import {
  FIXED_FEE_SCHEDULE,
  PREV_DEPLOYED_CONTRACT,
  SignatureScheme,
  buildBridgeInitCall,
  buildRwaCreateCall,
  buildSchedulerCreateJobCall,
  deriveTypedAddress,
  nextBaseFeePerByte,
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

    setOutput(
      JSON.stringify(
        {
          batchTxBytes: batch.rawBytes.length,
          batchFeeAtoms: (FIXED_FEE_SCHEDULE.deploy + FIXED_FEE_SCHEDULE.rwa_create).toString(),
          eip1559NextBaseFeeAtFullBlock: nextBase.toString(),
          passkeyAddressHex: `0x${Buffer.from(passkeyAddr).toString("hex").slice(0, 16)}...`,
          schedulerCallBytes: schedBytes.length,
          bridgeInitBytes: bridgeBytes.length,
        },
        null,
        2,
      ),
    );
  };

  return (
    <section className="rounded-lg border p-4 space-y-3" data-testid="wave-a-rwa-studio">
      <h3 className="font-semibold">Wave A–D &amp; KVP-106 RWA Studio</h3>
      <div className="flex gap-2">
        <select
          aria-label="RWA Asset Class"
          value={assetClass}
          onChange={(e) => setAssetClass(e.target.value as typeof assetClass)}
          className="border rounded px-2 py-1 text-sm"
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
          className="border rounded px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={handleSimulateBatch}
          className="border rounded px-3 py-1 text-sm font-medium"
        >
          Build 1-Tx RWA Batch
        </button>
      </div>
      {output && (
        <pre data-testid="wave-a-rwa-output" className="text-xs overflow-x-auto">
          {output}
        </pre>
      )}
    </section>
  );
}
