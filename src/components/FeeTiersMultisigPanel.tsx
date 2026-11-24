import { useMemo, useState } from "react";
import {
  ADDRESS_PREFIX,
  CHAIN_IDS,
  encodeAddress,
  TESTNET_ADDRESS_PREFIX,
} from "kovanica-sdk";
import {
  checkMultisigQuorum,
  computeRbfFeeBump,
  decodeMultisigProposalBundle,
  encodeMultisigProposalBundle,
  estimatePriorityFeeTiers,
  formatKvnc,
  MULTISIG_BUNDLE_FORMAT,
  parseKvnc,
  type DecodedMultisigProposalBundle,
  type MultisigBundleChainId,
  type PriorityFeeTiersClient,
  type PriorityFeeTiersEstimate,
  type RbfFeeBumpResult,
} from "../wallet-interop";

export interface FeeTiersMultisigPanelProps {
  client: PriorityFeeTiersClient;
  selectedChainId: number;
  defaultAddress?: string;
}

type FeeUnit = "atoms" | "kvnc";

const RBF_PRESETS: readonly { label: string; bumpBps: number }[] = [
  { label: "+15%", bumpBps: 1_500 },
  { label: "+25%", bumpBps: 2_500 },
  { label: "+50%", bumpBps: 5_000 },
];

function resolveBundleChainId(chainId: number): MultisigBundleChainId {
  if (
    chainId === CHAIN_IDS.MAINNET ||
    chainId === CHAIN_IDS.TESTNET ||
    chainId === CHAIN_IDS.DEVNET
  ) {
    return chainId;
  }
  return CHAIN_IDS.TESTNET;
}

function makeDeterministicPro21(seedByte: number, chainId: MultisigBundleChainId): string {
  const pubkey = new Uint8Array(32).fill(seedByte);
  const prefix =
    chainId === CHAIN_IDS.TESTNET ? TESTNET_ADDRESS_PREFIX : ADDRESS_PREFIX;
  return encodeAddress(pubkey, prefix);
}

function buildSampleMultisigBundleJson(
  chainId: MultisigBundleChainId,
  defaultAddress?: string,
): string {
  const multisigAddress = makeDeterministicPro21(0x44, chainId);
  const signer1 = defaultAddress?.trim()
    ? defaultAddress.trim()
    : makeDeterministicPro21(0x11, chainId);
  const signer2 = makeDeterministicPro21(0x22, chainId);
  const signer3 = makeDeterministicPro21(0x33, chainId);

  // Fallback to deterministic signer1 if defaultAddress does not match chain prefix
  const buildWithSigners = (s1: string): string =>
    encodeMultisigProposalBundle({
      chainId,
      multisigAddress,
      proposalId: "prop-2026-001",
      threshold: 2,
      signers: [s1, signer2, signer3],
      approvals: [
        {
          signer: s1,
          signatureHex: `0x${"aa".repeat(64)}`,
          signedAtMs: 1750000000000,
        },
        {
          signer: signer2,
          signatureHex: `0x${"bb".repeat(64)}`,
          signedAtMs: 1750000005000,
        },
      ],
      description: "Treasury transfer — 2-of-3 air-gapped multisig proposal",
    });

  let encoded: string;
  try {
    encoded = buildWithSigners(signer1);
  } catch {
    encoded = buildWithSigners(makeDeterministicPro21(0x11, chainId));
  }
  return JSON.stringify(JSON.parse(encoded), null, 2);
}

export function FeeTiersMultisigPanel({
  client,
  selectedChainId,
  defaultAddress,
}: FeeTiersMultisigPanelProps) {
  // --- Section 1: Priority Fee Tiers & RBF Fee Bump Lab ---
  const [txSizeBytesStr, setTxSizeBytesStr] = useState<string>("250");
  const [isFetchingTiers, setIsFetchingTiers] = useState<boolean>(false);
  const [tiersEstimate, setTiersEstimate] = useState<PriorityFeeTiersEstimate | null>(null);
  const [tiersError, setTiersError] = useState<string | null>(null);

  const [previousFeeInput, setPreviousFeeInput] = useState<string>("10000");
  const [feeUnit, setFeeUnit] = useState<FeeUnit>("atoms");
  const [selectedBumpBps, setSelectedBumpBps] = useState<number>(1_500);

  const rbfComputation = useMemo<{
    result: RbfFeeBumpResult | null;
    error: string | null;
  }>(() => {
    const trimmed = previousFeeInput.trim();
    if (trimmed.length === 0) {
      return { result: null, error: "Enter a previous fee in atoms or KVNC" };
    }
    try {
      let previousFeeAtoms: bigint;
      if (feeUnit === "atoms") {
        if (!/^\d+$/.test(trimmed)) {
          throw new Error("Previous fee in atoms must be a non-negative integer");
        }
        previousFeeAtoms = BigInt(trimmed);
      } else {
        previousFeeAtoms = parseKvnc(trimmed);
      }
      const result = computeRbfFeeBump(previousFeeAtoms, {
        bumpBps: selectedBumpBps,
      });
      return { result, error: null };
    } catch (err: unknown) {
      return {
        result: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [previousFeeInput, feeUnit, selectedBumpBps]);

  const handleFetchPriorityTiers = async () => {
    setTiersError(null);
    const trimmedSize = txSizeBytesStr.trim();
    if (!/^\d+$/.test(trimmedSize) || BigInt(trimmedSize) < 1n) {
      setTiersError("Tx size must be a positive integer (>= 1 byte)");
      return;
    }

    setIsFetchingTiers(true);
    try {
      const estimate = await estimatePriorityFeeTiers(client, {
        txSizeBytes: BigInt(trimmedSize),
      });
      setTiersEstimate(estimate);
    } catch (err: unknown) {
      setTiersEstimate(null);
      setTiersError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsFetchingTiers(false);
    }
  };

  // --- Section 2: Air-Gapped Multisig Quorum Inspector ---
  const [bundleJsonInput, setBundleJsonInput] = useState<string>("");
  const [decodedBundle, setDecodedBundle] = useState<DecodedMultisigProposalBundle | null>(
    null,
  );
  const [bundleError, setBundleError] = useState<string | null>(null);

  // Quick builder state
  const [showBuilder, setShowBuilder] = useState<boolean>(false);
  const [builderProposalId, setBuilderProposalId] = useState<string>("prop-2026-001");
  const [builderThreshold, setBuilderThreshold] = useState<string>("2");
  const [builderDescription, setBuilderDescription] = useState<string>(
    "Air-gapped multisig treasury disbursement",
  );

  const inspectBundleText = (rawText: string) => {
    setBundleError(null);
    const trimmed = rawText.trim();
    if (trimmed.length === 0) {
      setDecodedBundle(null);
      setBundleError(`Paste or build a ${MULTISIG_BUNDLE_FORMAT} JSON bundle to inspect`);
      return;
    }
    try {
      const decoded = decodeMultisigProposalBundle(trimmed);
      // Cross-verify quorum summary explicitly via checkMultisigQuorum
      const quorum = checkMultisigQuorum({
        signers: decoded.bundle.signers,
        approvals: decoded.bundle.approvals.map((entry) => entry.signer),
        threshold: decoded.bundle.threshold,
      });
      setDecodedBundle({ bundle: decoded.bundle, quorum });
    } catch (err: unknown) {
      setDecodedBundle(null);
      setBundleError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleLoadSampleBundle = () => {
    const chainId = resolveBundleChainId(selectedChainId);
    const sampleJson = buildSampleMultisigBundleJson(chainId, defaultAddress);
    setBundleJsonInput(sampleJson);
    inspectBundleText(sampleJson);
  };

  const handleBuildBundle = () => {
    setBundleError(null);
    const chainId = resolveBundleChainId(selectedChainId);
    const parsedThreshold = Number.parseInt(builderThreshold.trim(), 10);
    if (!Number.isSafeInteger(parsedThreshold) || parsedThreshold < 1 || parsedThreshold > 3) {
      setBundleError("Builder threshold must be an integer between 1 and 3");
      return;
    }
    try {
      const s1 = makeDeterministicPro21(0x11, chainId);
      const s2 = makeDeterministicPro21(0x22, chainId);
      const s3 = makeDeterministicPro21(0x33, chainId);
      const encoded = encodeMultisigProposalBundle({
        chainId,
        multisigAddress: makeDeterministicPro21(0x44, chainId),
        proposalId: builderProposalId.trim() || "prop-2026-001",
        threshold: parsedThreshold,
        signers: [s1, s2, s3],
        approvals: [
          {
            signer: s1,
            signatureHex: `0x${"11".repeat(64)}`,
            signedAtMs: 1750000000000,
          },
        ],
        description:
          builderDescription.trim() || "Air-gapped multisig treasury disbursement",
      });
      const pretty = JSON.stringify(JSON.parse(encoded), null, 2);
      setBundleJsonInput(pretty);
      inspectBundleText(pretty);
    } catch (err: unknown) {
      setBundleError(err instanceof Error ? err.message : String(err));
    }
  };

  const progressPct = decodedBundle
    ? Math.min(
        100,
        Math.round(
          (decodedBundle.quorum.approvedCount / decodedBundle.quorum.threshold) * 100,
        ),
      )
    : 0;

  return (
    <div
      data-testid="fee-tiers-multisig-panel"
      className="bg-surface rounded-xl border border-border p-6 flex flex-col gap-6"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <h2 className="text-sm font-semibold text-fg">
            Fee Tiers &amp; Multisig Quorum
          </h2>
          <p className="text-xs text-muted">
            Estimate <code>slow</code>/<code>standard</code>/<code>fast</code> priority fee tiers,
            compute lossless RBF bumps, and inspect air-gapped{" "}
            <code>{MULTISIG_BUNDLE_FORMAT}</code> bundles
          </p>
        </div>
        <span
          data-testid="fee-tiers-multisig-readonly-badge"
          className="px-2.5 py-1 rounded bg-amber-950/60 border border-amber-700/60 text-amber-300 text-[11px] font-mono font-semibold"
        >
          READ-ONLY / ZERO SECRETS
        </span>
      </div>

      {/* Section 1: RBF & Priority Fee Lab */}
      <div
        data-testid="priority-fee-rbf-section"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
            RBF &amp; Priority Fee Lab
          </h3>
          <div className="flex items-center gap-2">
            <label
              htmlFor="priority-tx-size-input"
              className="text-xs text-muted"
            >
              Tx Size (B):
            </label>
            <input
              id="priority-tx-size-input"
              data-testid="priority-tx-size-input"
              type="number"
              min={1}
              value={txSizeBytesStr}
              onChange={(e) => setTxSizeBytesStr(e.target.value)}
              className="w-24 bg-surface-2 border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono text-fg focus:outline-none focus:border-gold"
            />
            <button
              type="button"
              data-testid="fetch-priority-tiers-btn"
              disabled={isFetchingTiers}
              onClick={handleFetchPriorityTiers}
              className="px-3 py-1.5 bg-gold/20 hover:bg-gold/30 disabled:opacity-50 rounded-lg border border-gold/40 text-gold text-xs font-semibold transition-colors"
            >
              {isFetchingTiers ? "Fetching..." : "Fetch Priority Tiers"}
            </button>
          </div>
        </div>

        {tiersError && (
          <div
            data-testid="priority-tiers-error"
            className="text-xs font-mono text-red-300 bg-red-950/40 border border-red-800/60 rounded-lg p-3"
          >
            {tiersError}
          </div>
        )}

        {tiersEstimate && (
          <div data-testid="priority-tiers-result" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono text-muted bg-surface-2/80 border border-border rounded-lg px-3 py-2">
              <span>
                Source:{" "}
                <strong data-testid="priority-tiers-source" className="text-fg uppercase">
                  {tiersEstimate.source}
                </strong>
              </span>
              <span>
                Pending:{" "}
                <strong data-testid="priority-tiers-pending" className="text-fg">
                  {tiersEstimate.pendingCount}
                </strong>
              </span>
              <span>
                Congestion:{" "}
                <strong
                  data-testid="priority-tiers-congestion"
                  className={
                    tiersEstimate.congestionLevel === "high"
                      ? "text-red-300 uppercase"
                      : tiersEstimate.congestionLevel === "moderate"
                        ? "text-amber-300 uppercase"
                        : "text-emerald-400 uppercase"
                  }
                >
                  {tiersEstimate.congestionLevel}
                </strong>
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(["slow", "standard", "fast"] as const).map((tierName) => {
                const tier = tiersEstimate[tierName];
                const accent =
                  tierName === "fast"
                    ? "text-emerald-300"
                    : tierName === "standard"
                      ? "text-gold"
                      : "text-fg";
                return (
                  <div
                    key={tierName}
                    data-testid={`priority-tier-${tierName}`}
                    className="bg-surface-2 border border-border rounded-lg p-3 flex flex-col gap-1.5 font-mono"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] uppercase tracking-wider font-semibold text-muted">
                        {tier.tier}
                      </span>
                      <span className="text-[11px] text-muted">
                        ~{tier.estimatedInclusionBlocks} block
                        {tier.estimatedInclusionBlocks === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className={`text-sm font-semibold ${accent}`}>
                      {tier.feeAtoms.toString()} atoms
                    </div>
                    <div className="text-[11px] text-muted">
                      {tier.feeKvnc} KVNC · {tier.feePerByte.toString()} atoms/B
                    </div>
                    <button
                      type="button"
                      data-testid={`use-tier-${tierName}-in-rbf`}
                      onClick={() => {
                        setFeeUnit("atoms");
                        setPreviousFeeInput(tier.feeAtoms.toString());
                      }}
                      className="mt-1 px-2 py-1 text-[11px] bg-surface hover:bg-border rounded border border-border text-fg transition-colors text-left w-fit"
                    >
                      Use in RBF
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* RBF Fee Bump Calculator */}
        <div
          data-testid="rbf-calculator-box"
          className="bg-surface-2/60 border border-border rounded-lg p-4 flex flex-col gap-3"
        >
          <div className="text-xs font-semibold text-fg">
            Replace-By-Fee (RBF) Bump Calculator (<code>computeRbfFeeBump</code>)
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-5">
              <label
                htmlFor="rbf-previous-fee-input"
                className="block text-xs font-medium text-muted mb-1"
              >
                Previous Fee
              </label>
              <input
                id="rbf-previous-fee-input"
                data-testid="rbf-previous-fee-input"
                type="text"
                value={previousFeeInput}
                onChange={(e) => setPreviousFeeInput(e.target.value)}
                placeholder={feeUnit === "atoms" ? "10000" : "0.00001"}
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
            </div>

            <div className="md:col-span-3">
              <label
                htmlFor="rbf-fee-unit-select"
                className="block text-xs font-medium text-muted mb-1"
              >
                Unit
              </label>
              <select
                id="rbf-fee-unit-select"
                data-testid="rbf-fee-unit-select"
                value={feeUnit}
                onChange={(e) => setFeeUnit(e.target.value as FeeUnit)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              >
                <option value="atoms">atoms</option>
                <option value="kvnc">KVNC</option>
              </select>
            </div>

            <div className="md:col-span-4">
              <span className="block text-xs font-medium text-muted mb-1">
                Bump Preset
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {RBF_PRESETS.map((preset) => {
                  const active = selectedBumpBps === preset.bumpBps;
                  return (
                    <button
                      key={preset.bumpBps}
                      type="button"
                      data-testid={`rbf-bump-${preset.bumpBps}`}
                      onClick={() => setSelectedBumpBps(preset.bumpBps)}
                      className={`px-2 py-2 rounded-lg border text-xs font-mono font-semibold transition-colors ${
                        active
                          ? "bg-gold/25 border-gold text-gold"
                          : "bg-surface border-border text-muted hover:text-fg"
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {rbfComputation.error && (
            <div
              data-testid="rbf-error"
              className="text-xs font-mono text-red-300 bg-red-950/40 border border-red-800/60 rounded-lg p-2.5"
            >
              {rbfComputation.error}
            </div>
          )}

          {rbfComputation.result && (
            <div
              data-testid="rbf-result"
              className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-surface border border-border rounded-lg p-3 font-mono text-xs"
            >
              <div>
                <div className="text-[11px] text-muted">Previous Fee</div>
                <div data-testid="rbf-previous-atoms" className="text-fg font-semibold">
                  {rbfComputation.result.previousFee.toString()} atoms
                </div>
                <div className="text-[11px] text-muted">
                  {formatKvnc(rbfComputation.result.previousFee)} KVNC
                </div>
              </div>

              <div>
                <div className="text-[11px] text-muted">
                  Bumped Fee (+{(rbfComputation.result.bumpBps / 100).toFixed(0)}%)
                </div>
                <div data-testid="rbf-bumped-atoms" className="text-gold font-semibold">
                  {rbfComputation.result.bumpedFee.toString()} atoms
                </div>
                <div data-testid="rbf-bumped-kvnc" className="text-[11px] text-muted">
                  {formatKvnc(rbfComputation.result.bumpedFee)} KVNC
                </div>
              </div>

              <div>
                <div className="text-[11px] text-muted">Delta</div>
                <div data-testid="rbf-delta-atoms" className="text-emerald-400 font-semibold">
                  +{rbfComputation.result.delta.toString()} atoms
                </div>
                <div className="text-[11px] text-muted">
                  +{formatKvnc(rbfComputation.result.delta)} KVNC
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Section 2: Air-Gapped Multisig Quorum Inspector */}
      <div
        data-testid="multisig-quorum-inspector-section"
        className="flex flex-col gap-3 border-t border-border pt-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
              Air-Gapped Multisig Quorum Inspector
            </h3>
            <span
              data-testid="multisig-readonly-badge"
              className="px-2 py-0.5 rounded bg-amber-950/60 border border-amber-700/60 text-amber-300 text-[10px] font-mono font-semibold"
            >
              READ-ONLY / ZERO SECRETS
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="multisig-toggle-builder-btn"
              onClick={() => setShowBuilder((prev) => !prev)}
              className="px-2.5 py-1 text-xs bg-surface-2 hover:bg-border rounded-lg border border-border text-fg transition-colors"
            >
              {showBuilder ? "Hide Builder" : "Build Bundle"}
            </button>
            <button
              type="button"
              data-testid="multisig-load-sample-btn"
              onClick={handleLoadSampleBundle}
              className="px-2.5 py-1 text-xs bg-surface-2 hover:bg-border rounded-lg border border-border text-fg transition-colors"
            >
              Load Sample Bundle
            </button>
          </div>
        </div>

        {showBuilder && (
          <div
            data-testid="multisig-builder-form"
            className="bg-surface-2/70 border border-border rounded-lg p-3 grid grid-cols-1 md:grid-cols-12 gap-3 items-end"
          >
            <div className="md:col-span-3">
              <label
                htmlFor="multisig-builder-proposal-id"
                className="block text-xs font-medium text-muted mb-1"
              >
                Proposal ID
              </label>
              <input
                id="multisig-builder-proposal-id"
                data-testid="multisig-builder-proposal-id"
                type="text"
                value={builderProposalId}
                onChange={(e) => setBuilderProposalId(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
            </div>

            <div className="md:col-span-2">
              <label
                htmlFor="multisig-builder-threshold"
                className="block text-xs font-medium text-muted mb-1"
              >
                Threshold (1-3)
              </label>
              <input
                id="multisig-builder-threshold"
                data-testid="multisig-builder-threshold"
                type="number"
                min={1}
                max={3}
                value={builderThreshold}
                onChange={(e) => setBuilderThreshold(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
            </div>

            <div className="md:col-span-5">
              <label
                htmlFor="multisig-builder-description"
                className="block text-xs font-medium text-muted mb-1"
              >
                Description
              </label>
              <input
                id="multisig-builder-description"
                data-testid="multisig-builder-description"
                type="text"
                value={builderDescription}
                onChange={(e) => setBuilderDescription(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs text-fg focus:outline-none focus:border-gold"
              />
            </div>

            <div className="md:col-span-2">
              <button
                type="button"
                data-testid="multisig-build-bundle-btn"
                onClick={handleBuildBundle}
                className="w-full px-3 py-1.5 bg-gold/20 hover:bg-gold/30 rounded-lg border border-gold/40 text-gold text-xs font-semibold transition-colors"
              >
                Encode Bundle
              </button>
            </div>
          </div>
        )}

        <div>
          <label
            htmlFor="multisig-bundle-input"
            className="block text-xs font-medium text-muted mb-1"
          >
            Multisig Proposal Bundle JSON (<code>{MULTISIG_BUNDLE_FORMAT}</code>)
          </label>
          <textarea
            id="multisig-bundle-input"
            data-testid="multisig-bundle-input"
            rows={6}
            value={bundleJsonInput}
            onChange={(e) => setBundleJsonInput(e.target.value)}
            placeholder={`{\n  "format": "${MULTISIG_BUNDLE_FORMAT}",\n  "version": 1,\n  ...\n}`}
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="multisig-inspect-btn"
            onClick={() => inspectBundleText(bundleJsonInput)}
            className="px-4 py-2 bg-gold/20 hover:bg-gold/30 rounded-lg border border-gold/40 text-gold text-xs font-semibold transition-colors"
          >
            Inspect Bundle &amp; Check Quorum
          </button>
          {bundleJsonInput.length > 0 && (
            <button
              type="button"
              data-testid="multisig-clear-btn"
              onClick={() => {
                setBundleJsonInput("");
                setDecodedBundle(null);
                setBundleError(null);
              }}
              className="px-3 py-2 bg-surface-2 hover:bg-border rounded-lg border border-border text-xs text-muted transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {bundleError && (
          <div
            data-testid="multisig-error"
            className="text-xs font-mono text-red-300 bg-red-950/40 border border-red-800/60 rounded-lg p-3"
          >
            {bundleError}
          </div>
        )}

        {decodedBundle && (
          <div
            data-testid="multisig-result"
            className="bg-surface-2/80 border border-border rounded-lg p-4 flex flex-col gap-3 text-xs font-mono"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  data-testid="multisig-quorum-status"
                  className={`px-2 py-0.5 rounded font-semibold ${
                    decodedBundle.quorum.quorumReached
                      ? "bg-emerald-950/60 border border-emerald-700/60 text-emerald-300"
                      : "bg-amber-950/60 border border-amber-700/60 text-amber-300"
                  }`}
                >
                  {decodedBundle.quorum.quorumReached
                    ? "QUORUM REACHED"
                    : `PENDING (${decodedBundle.quorum.remainingNeeded} MORE NEEDED)`}
                </span>
                <span data-testid="multisig-quorum-progress" className="text-fg font-semibold">
                  {decodedBundle.quorum.approvedCount} / {decodedBundle.quorum.threshold}
                </span>
                <span className="text-muted">
                  ({decodedBundle.quorum.uniqueSigners.length} unique signers)
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                <span>
                  Chain: <strong className="text-fg">{decodedBundle.bundle.chainId}</strong>
                </span>
                <span>
                  Proposal:{" "}
                  <strong data-testid="multisig-proposal-id" className="text-fg">
                    {decodedBundle.bundle.proposalId}
                  </strong>
                </span>
                <span>
                  Format: <strong className="text-fg">{decodedBundle.bundle.format}</strong>
                </span>
              </div>
            </div>

            {/* Quorum Progress Bar */}
            <div className="w-full h-2 bg-surface rounded-full overflow-hidden border border-border">
              <div
                className={`h-full transition-all ${
                  decodedBundle.quorum.quorumReached ? "bg-emerald-400" : "bg-gold"
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>

            <div className="text-[11px] text-muted break-all">
              Multisig Address:{" "}
              <span className="text-fg">{decodedBundle.bundle.multisigAddress}</span>
              {decodedBundle.bundle.description && (
                <>
                  {" "}
                  · Description:{" "}
                  <span className="text-fg">{decodedBundle.bundle.description}</span>
                </>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-border/60">
              <div
                data-testid="multisig-valid-approvals"
                className="bg-surface border border-border rounded-lg p-2.5 flex flex-col gap-1"
              >
                <div className="text-[11px] font-semibold text-emerald-400">
                  Valid Approvals ({decodedBundle.quorum.validApprovals.length})
                </div>
                {decodedBundle.quorum.validApprovals.length === 0 ? (
                  <div className="text-[11px] text-muted">None</div>
                ) : (
                  decodedBundle.quorum.validApprovals.map((addr) => (
                    <div key={addr} className="text-[11px] text-fg break-all">
                      {addr}
                    </div>
                  ))
                )}
              </div>

              <div
                data-testid="multisig-unknown-approvals"
                className="bg-surface border border-border rounded-lg p-2.5 flex flex-col gap-1"
              >
                <div className="text-[11px] font-semibold text-red-300">
                  Unknown Approvals ({decodedBundle.quorum.unknownApprovals.length})
                </div>
                {decodedBundle.quorum.unknownApprovals.length === 0 ? (
                  <div className="text-[11px] text-muted">None</div>
                ) : (
                  decodedBundle.quorum.unknownApprovals.map((addr) => (
                    <div key={addr} className="text-[11px] text-red-200 break-all">
                      {addr}
                    </div>
                  ))
                )}
              </div>

              <div
                data-testid="multisig-duplicate-approvals"
                className="bg-surface border border-border rounded-lg p-2.5 flex flex-col gap-1"
              >
                <div className="text-[11px] font-semibold text-amber-300">
                  Duplicate Approvals ({decodedBundle.quorum.duplicateApprovals.length})
                </div>
                {decodedBundle.quorum.duplicateApprovals.length === 0 ? (
                  <div className="text-[11px] text-muted">None</div>
                ) : (
                  decodedBundle.quorum.duplicateApprovals.map((addr) => (
                    <div key={addr} className="text-[11px] text-amber-200 break-all">
                      {addr}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
