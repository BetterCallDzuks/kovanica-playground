import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  ADDRESS_PREFIX,
  CHAIN_IDS,
  encodeAddress,
  TESTNET_ADDRESS_PREFIX,
} from "kovanica-sdk";
import { FeeTiersMultisigPanel } from "../src/components/FeeTiersMultisigPanel";
import {
  encodeMultisigProposalBundle,
  MULTISIG_BUNDLE_FORMAT,
  type PriorityFeeTiersClient,
} from "../src/wallet-interop";

const TESTNET_SIGNER_1 = encodeAddress(new Uint8Array(32).fill(0x11), TESTNET_ADDRESS_PREFIX);
const TESTNET_SIGNER_2 = encodeAddress(new Uint8Array(32).fill(0x22), TESTNET_ADDRESS_PREFIX);
const TESTNET_SIGNER_3 = encodeAddress(new Uint8Array(32).fill(0x33), TESTNET_ADDRESS_PREFIX);
const TESTNET_MULTISIG = encodeAddress(new Uint8Array(32).fill(0x44), TESTNET_ADDRESS_PREFIX);
const TESTNET_UNKNOWN = encodeAddress(new Uint8Array(32).fill(0x99), TESTNET_ADDRESS_PREFIX);
const MAINNET_SIGNER_1 = encodeAddress(new Uint8Array(32).fill(0x11), ADDRESS_PREFIX);

describe("FeeTiersMultisigPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("fetches live slow/standard/fast priority fee tiers and populates RBF calculator", async () => {
    const getMempoolStats = vi.fn(async () => ({
      pendingCount: 75,
      totalBytes: 24_000,
      minFeePerByte: 10n,
      p50FeePerByte: 20n,
      p90FeePerByte: 40n,
      maxFeePerByte: 60n,
    }));
    const mockClient: PriorityFeeTiersClient = { getMempoolStats };

    render(
      <FeeTiersMultisigPanel
        client={mockClient}
        selectedChainId={CHAIN_IDS.TESTNET}
        defaultAddress={TESTNET_SIGNER_1}
      />,
    );

    expect(screen.getByTestId("fee-tiers-multisig-readonly-badge").textContent).toContain(
      "READ-ONLY / ZERO SECRETS",
    );

    fireEvent.change(screen.getByTestId("priority-tx-size-input"), {
      target: { value: "200" },
    });
    fireEvent.click(screen.getByTestId("fetch-priority-tiers-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("priority-tiers-result")).toBeTruthy();
    });

    expect(getMempoolStats).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("priority-tiers-source").textContent).toBe("mempool");
    expect(screen.getByTestId("priority-tiers-pending").textContent).toBe("75");
    expect(screen.getByTestId("priority-tiers-congestion").textContent).toBe("moderate");

    // slow: minFeePerByte 10 * 200 = 2000 atoms
    expect(screen.getByTestId("priority-tier-slow").textContent).toContain("2000 atoms");
    // standard: buffered(20, 1.2x) = 24 * 200 = 4800 atoms
    expect(screen.getByTestId("priority-tier-standard").textContent).toContain("4800 atoms");
    // fast: buffered(40, 1.2x) = 48 * 200 = 9600 atoms
    expect(screen.getByTestId("priority-tier-fast").textContent).toContain("9600 atoms");

    // Clicking "Use in RBF" on fast tier populates previous fee with 9600 atoms
    fireEvent.click(screen.getByTestId("use-tier-fast-in-rbf"));
    expect((screen.getByTestId("rbf-previous-fee-input") as HTMLInputElement).value).toBe("9600");
    // Default +15% on 9600 = 9600 + 1440 = 11040
    expect(screen.getByTestId("rbf-bumped-atoms").textContent).toBe("11040 atoms");
    expect(screen.getByTestId("rbf-delta-atoms").textContent).toBe("+1440 atoms");
  });

  it("computes lossless RBF fee bumps in atoms and KVNC across +15%, +25%, and +50% presets", () => {
    const mockClient: PriorityFeeTiersClient = {
      getMempoolStats: vi.fn(),
    };

    render(
      <FeeTiersMultisigPanel
        client={mockClient}
        selectedChainId={CHAIN_IDS.MAINNET}
        defaultAddress={MAINNET_SIGNER_1}
      />,
    );

    // Default: 10000 atoms, +15% -> 11500 atoms (+1500)
    expect(screen.getByTestId("rbf-bumped-atoms").textContent).toBe("11500 atoms");
    expect(screen.getByTestId("rbf-delta-atoms").textContent).toBe("+1500 atoms");

    // Switch to +25% -> 12500 atoms (+2500)
    fireEvent.click(screen.getByTestId("rbf-bump-2500"));
    expect(screen.getByTestId("rbf-bumped-atoms").textContent).toBe("12500 atoms");
    expect(screen.getByTestId("rbf-delta-atoms").textContent).toBe("+2500 atoms");

    // Switch to +50% -> 15000 atoms (+5000)
    fireEvent.click(screen.getByTestId("rbf-bump-5000"));
    expect(screen.getByTestId("rbf-bumped-atoms").textContent).toBe("15000 atoms");
    expect(screen.getByTestId("rbf-delta-atoms").textContent).toBe("+5000 atoms");

    // Switch unit to KVNC: 0.001 KVNC = 1_000_000 atoms, +50% -> 1_500_000 atoms (0.0015 KVNC)
    fireEvent.change(screen.getByTestId("rbf-fee-unit-select"), {
      target: { value: "kvnc" },
    });
    fireEvent.change(screen.getByTestId("rbf-previous-fee-input"), {
      target: { value: "0.001" },
    });
    expect(screen.getByTestId("rbf-previous-atoms").textContent).toBe("1000000 atoms");
    expect(screen.getByTestId("rbf-bumped-atoms").textContent).toBe("1500000 atoms");
    expect(screen.getByTestId("rbf-bumped-kvnc").textContent).toBe("0.0015 KVNC");

    // Invalid input shows error
    fireEvent.change(screen.getByTestId("rbf-previous-fee-input"), {
      target: { value: "not-a-number" },
    });
    expect(screen.getByTestId("rbf-error")).toBeTruthy();
    expect(screen.queryByTestId("rbf-result")).toBeNull();
  });

  it("loads a sample kovanica-multisig-bundle-v1 and inspects quorum progress, valid, unknown, and duplicate approvals", () => {
    const mockClient: PriorityFeeTiersClient = {
      getMempoolStats: vi.fn(),
    };

    render(
      <FeeTiersMultisigPanel
        client={mockClient}
        selectedChainId={CHAIN_IDS.TESTNET}
        defaultAddress={TESTNET_SIGNER_1}
      />,
    );

    expect(screen.getByTestId("multisig-readonly-badge").textContent).toBe(
      "READ-ONLY / ZERO SECRETS",
    );

    // 1. Load sample bundle (2-of-3 with 2 valid approvals)
    fireEvent.click(screen.getByTestId("multisig-load-sample-btn"));
    expect(screen.queryByTestId("multisig-error")).toBeNull();
    expect(screen.getByTestId("multisig-quorum-status").textContent).toBe("QUORUM REACHED");
    expect(screen.getByTestId("multisig-quorum-progress").textContent).toBe("2 / 2");
    expect(screen.getByTestId("multisig-valid-approvals").textContent).toContain(
      "Valid Approvals (2)",
    );

    // 2. Paste custom bundle with 1 valid, 1 duplicate, and 1 unknown approval (threshold 2 -> PENDING)
    const customBundle = encodeMultisigProposalBundle({
      chainId: CHAIN_IDS.TESTNET,
      multisigAddress: TESTNET_MULTISIG,
      proposalId: "prop-mixed-99",
      threshold: 2,
      signers: [TESTNET_SIGNER_1, TESTNET_SIGNER_2, TESTNET_SIGNER_3],
      approvals: [
        { signer: TESTNET_SIGNER_1, signatureHex: `0x${"11".repeat(64)}` },
        { signer: TESTNET_SIGNER_1, signatureHex: `0x${"22".repeat(64)}` },
        { signer: TESTNET_UNKNOWN, signatureHex: `0x${"33".repeat(64)}` },
      ],
      description: "Mixed approvals verification bundle",
    });

    fireEvent.change(screen.getByTestId("multisig-bundle-input"), {
      target: { value: customBundle },
    });
    fireEvent.click(screen.getByTestId("multisig-inspect-btn"));

    expect(screen.queryByTestId("multisig-error")).toBeNull();
    expect(screen.getByTestId("multisig-quorum-status").textContent).toBe(
      "PENDING (1 MORE NEEDED)",
    );
    expect(screen.getByTestId("multisig-quorum-progress").textContent).toBe("1 / 2");
    expect(screen.getByTestId("multisig-proposal-id").textContent).toBe("prop-mixed-99");
    expect(screen.getByTestId("multisig-valid-approvals").textContent).toContain(
      "Valid Approvals (1)",
    );
    expect(screen.getByTestId("multisig-valid-approvals").textContent).toContain(
      TESTNET_SIGNER_1,
    );
    expect(screen.getByTestId("multisig-unknown-approvals").textContent).toContain(
      "Unknown Approvals (1)",
    );
    expect(screen.getByTestId("multisig-unknown-approvals").textContent).toContain(
      TESTNET_UNKNOWN,
    );
    expect(screen.getByTestId("multisig-duplicate-approvals").textContent).toContain(
      "Duplicate Approvals (1)",
    );
    expect(screen.getByTestId("multisig-duplicate-approvals").textContent).toContain(
      TESTNET_SIGNER_1,
    );
  });

  it("rejects multisig bundles containing forbidden secret fields and supports quick bundle builder", () => {
    const mockClient: PriorityFeeTiersClient = {
      getMempoolStats: vi.fn(),
    };

    render(
      <FeeTiersMultisigPanel
        client={mockClient}
        selectedChainId={CHAIN_IDS.TESTNET}
      />,
    );

    const poisonedBundle = JSON.stringify({
      format: MULTISIG_BUNDLE_FORMAT,
      version: 1,
      chainId: CHAIN_IDS.TESTNET,
      multisigAddress: TESTNET_MULTISIG,
      proposalId: "prop-poisoned",
      threshold: 1,
      signers: [TESTNET_SIGNER_1],
      approvals: [],
      description: "Should be rejected",
      privateKey: "0x" + "ff".repeat(32),
    });

    fireEvent.change(screen.getByTestId("multisig-bundle-input"), {
      target: { value: poisonedBundle },
    });
    fireEvent.click(screen.getByTestId("multisig-inspect-btn"));

    expect(screen.queryByTestId("multisig-result")).toBeNull();
    expect(screen.getByTestId("multisig-error").textContent).toMatch(/forbidden|secret|private/i);

    // Quick builder creates a valid bundle and inspects it
    fireEvent.click(screen.getByTestId("multisig-toggle-builder-btn"));
    fireEvent.change(screen.getByTestId("multisig-builder-proposal-id"), {
      target: { value: "prop-built-77" },
    });
    fireEvent.change(screen.getByTestId("multisig-builder-threshold"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByTestId("multisig-build-bundle-btn"));

    expect(screen.queryByTestId("multisig-error")).toBeNull();
    expect(screen.getByTestId("multisig-proposal-id").textContent).toBe("prop-built-77");
    expect(screen.getByTestId("multisig-quorum-progress").textContent).toBe("1 / 2");
  });
});
