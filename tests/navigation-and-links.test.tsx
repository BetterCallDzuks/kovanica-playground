// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "../src/App";

const CANONICAL_ECOSYSTEM_HREFS = [
  "https://kovanica.online",
  "https://testnet.kovanica.online",
  "https://testnet.kovanica.online/explorer",
  "https://testnet.kovanica.online/wallet",
  "https://testnet.kovanica.online/swap",
  "https://testnet.kovanica.online/rwa",
  "https://docs.kovanica.online",
] as const;

const ALLOWED_APP_HREFS = new Set<string>([
  ...CANONICAL_ECOSYSTEM_HREFS,
  "https://github.com/BetterCallDzuks/kovanica-playground",
]);

function mockRpcFetch() {
  globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) || "{}");
    if (body.method === "kovanica_syncStatus") {
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              committedHeight: "100",
              localTipRound: "100",
              peerCount: 3,
              catchingUp: false,
            },
          }),
      };
    }
    if (body.method === "kovanica_getMiningInfo") {
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            error: { code: -32601, message: "Method not found" },
          }),
      };
    }
    return {
      ok: true,
      text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result: null }),
    };
  });
}

describe("Kovanica Playground Navigation, Workspace Sub-Tabs, Presets & Ecosystem Links", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockRpcFetch();
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
  });

  it("switches cleanly across all 4 top-level tabs while keeping panels mounted and toggling hidden state", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("sync-status-badge").textContent).toBe("Synced");
    });

    const rpcTab = screen.getByTestId("tab-rpc-explorer");
    const walletTab = screen.getByTestId("tab-wallet-contracts");
    const wsTab = screen.getByTestId("tab-ws-stream");
    const studioTab = screen.getByTestId("tab-wave-a-studio");

    const walletPanel = screen.getByTestId("wallet-contract-console").parentElement!;
    const studioPanel = screen.getByTestId("wave-a-rwa-studio").parentElement!;
    const wsPanel = screen.getByTestId("ws-subscription-console").parentElement!;
    const rpcPanel = screen.getByText("RPC Explorer").closest("section")!.parentElement!;

    // Default tab is RPC
    expect(rpcPanel.hidden).toBe(false);
    expect(rpcPanel.classList.contains("grid")).toBe(true);
    expect(rpcPanel.classList.contains("hidden")).toBe(false);
    expect(walletPanel.hidden).toBe(true);
    expect(wsPanel.hidden).toBe(true);
    expect(studioPanel.hidden).toBe(true);

    // Switch to Wallet & Contracts
    fireEvent.click(walletTab);
    expect(walletPanel.hidden).toBe(false);
    expect(walletPanel.classList.contains("hidden")).toBe(false);
    expect(rpcPanel.hidden).toBe(true);
    expect(rpcPanel.classList.contains("hidden")).toBe(true);

    // Switch to WS Stream
    fireEvent.click(wsTab);
    expect(wsPanel.hidden).toBe(false);
    expect(wsPanel.classList.contains("hidden")).toBe(false);
    expect(walletPanel.hidden).toBe(true);

    // Switch to Wave A-D & RWA Studio
    fireEvent.click(studioTab);
    expect(studioPanel.hidden).toBe(false);
    expect(studioPanel.classList.contains("hidden")).toBe(false);
    expect(wsPanel.hidden).toBe(true);

    // Switch back to RPC Explorer
    fireEvent.click(rpcTab);
    expect(rpcPanel.hidden).toBe(false);
    expect(rpcPanel.classList.contains("grid")).toBe(true);
    expect(studioPanel.hidden).toBe(true);
  });

  it("switches across all 4 Wallet & Contracts sub-tabs, mounts all 16 tool panels, and preserves state", async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("tab-wallet-contracts"));

    const subtabHd = screen.getByTestId("wallet-subtab-hd-signer");
    const subtabContracts = screen.getByTestId("wallet-subtab-contracts-codegen");
    const subtabStorage = screen.getByTestId("wallet-subtab-storage-logs");
    const subtabVerify = screen.getByTestId("wallet-subtab-verify-diagnostics");

    const groupHd = screen.getByTestId("wallet-panel-group-hd-signer");
    const groupContracts = screen.getByTestId("wallet-panel-group-contracts-codegen");
    const groupStorage = screen.getByTestId("wallet-panel-group-storage-logs");
    const groupVerify = screen.getByTestId("wallet-panel-group-verify-diagnostics");

    // Default sub-tab: HD Wallet & Signer
    expect(subtabHd.getAttribute("aria-selected")).toBe("true");
    expect(groupHd.hidden).toBe(false);
    expect(groupContracts.hidden).toBe(true);
    expect(groupStorage.hidden).toBe(true);
    expect(groupVerify.hidden).toBe(true);

    // Assert all 16 tool panels / 15+ tools are mounted in their expected groups
    expect(groupHd.contains(screen.getByTestId("hd-wallet-panel"))).toBe(true);
    expect(groupHd.contains(screen.getByTestId("native-transfer-signer-panel"))).toBe(true);
    expect(groupHd.contains(screen.getByTestId("universal-tx-airgap-panel"))).toBe(true);
    expect(groupHd.contains(screen.getByTestId("mempool-fee-tier-panel"))).toBe(true);

    expect(groupContracts.contains(screen.getByTestId("wasmi-call-builder-panel"))).toBe(true);
    expect(groupContracts.contains(screen.getByTestId("estimate-call-btn"))).toBe(true);
    expect(groupContracts.contains(screen.getByTestId("queue-batch-call-btn"))).toBe(true);
    expect(groupContracts.contains(screen.getByTestId("estimate-batch-btn"))).toBe(true);
    expect(groupContracts.contains(screen.getByTestId("copy-curl-snippet-btn"))).toBe(true);
    expect(groupContracts.contains(screen.getByTestId("copy-sdk-snippet-btn"))).toBe(true);
    expect(groupContracts.contains(screen.getByTestId("export-batch-presets-btn"))).toBe(true);
    expect(groupContracts.contains(screen.getByTestId("toggle-import-presets-btn"))).toBe(true);
    expect(groupContracts.contains(screen.getByTestId("typed-facades-studio-panel"))).toBe(true);

    expect(groupStorage.contains(screen.getByTestId("storage-slot-studio-panel"))).toBe(true);
    expect(groupStorage.contains(screen.getByTestId("bincode-decoder-panel"))).toBe(true);
    expect(groupStorage.contains(screen.getByTestId("paginated-contract-logs-panel"))).toBe(true);
    expect(groupStorage.contains(screen.getByTestId("log-history-panel"))).toBe(true);

    expect(groupVerify.contains(screen.getByTestId("raw-tx-and-probe-panel"))).toBe(true);
    expect(groupVerify.contains(screen.getByTestId("failover-rpc-probe-panel"))).toBe(true);
    expect(groupVerify.contains(screen.getByTestId("failover-urls-input"))).toBe(true);
    expect(groupVerify.contains(screen.getByTestId("run-failover-probe-btn"))).toBe(true);
    expect(groupVerify.contains(screen.getByTestId("address-and-transfer-panel"))).toBe(true);
    expect(groupVerify.contains(screen.getByTestId("receipt-poller-panel"))).toBe(true);
    expect(groupVerify.contains(screen.getByTestId("jsonrpc-batch-runner-panel"))).toBe(true);
    expect(groupVerify.contains(screen.getByTestId("account-history-watch-only-panel"))).toBe(true);
    expect(groupVerify.contains(screen.getByTestId("fee-tiers-multisig-panel"))).toBe(true);
    expect(groupVerify.contains(screen.getByTestId("golden-vector-selftest-panel"))).toBe(true);

    // State persistence across sub-tabs: edit mnemonic & sign a Native Transfer in Group 1
    const mnemonicInput = document.getElementById("mnemonic-input") as HTMLTextAreaElement;
    const customPhrase =
      "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";
    fireEvent.change(mnemonicInput, { target: { value: customPhrase } });
    expect(mnemonicInput.value).toBe(customPhrase);

    // Restore valid golden mnemonic and sign a transfer
    fireEvent.click(screen.getByRole("button", { name: "Load Golden Vector" }));
    const transferPanel = screen.getByTestId("native-transfer-signer-panel");
    const signTransferBtn = transferPanel.querySelector("button")!;
    fireEvent.click(signTransferBtn);

    expect(screen.getByTestId("wallet-signer-context-strip").textContent).toContain("Signed Transfer");

    // Switch to Group 2 (Contracts & Codegen)
    fireEvent.click(subtabContracts);
    expect(subtabContracts.getAttribute("aria-selected")).toBe("true");
    expect(groupContracts.hidden).toBe(false);
    expect(groupHd.hidden).toBe(true);

    // Switch to Group 3 (Storage & Logs)
    fireEvent.click(subtabStorage);
    expect(subtabStorage.getAttribute("aria-selected")).toBe("true");
    expect(groupStorage.hidden).toBe(false);
    expect(groupContracts.hidden).toBe(true);

    // Switch to Group 4 (Verification & Diagnostics) -> Transfer loader button is available!
    fireEvent.click(subtabVerify);
    expect(subtabVerify.getAttribute("aria-selected")).toBe("true");
    expect(groupVerify.hidden).toBe(false);
    expect(groupStorage.hidden).toBe(true);
    expect(screen.getByTestId("load-signed-transfer-tx-btn")).toBeTruthy();

    // Switch back to Group 1 and verify mnemonic + transfer envelope persisted
    fireEvent.change(mnemonicInput, { target: { value: customPhrase } });
    fireEvent.click(subtabContracts);
    fireEvent.click(subtabHd);
    expect(groupHd.hidden).toBe(false);
    expect((document.getElementById("mnemonic-input") as HTMLTextAreaElement).value).toBe(
      customPhrase,
    );
  });

  it("renders canonical Ecosystem Switcher links, 1-click RPC presets, and preserves Local Default DOM order", async () => {
    const { container } = render(<App />);

    // Verify all 7 ecosystem links in header and footer
    const headerNav = screen.getByTestId("header-ecosystem-links");
    const footerNav = screen.getByTestId("footer-ecosystem-links");
    for (const href of CANONICAL_ECOSYSTEM_HREFS) {
      expect(headerNav.querySelector(`a[href="${href}"]`)).toBeTruthy();
      expect(footerNav.querySelector(`a[href="${href}"]`)).toBeTruthy();
    }

    // Verify every anchor in App targets an allowlisted canonical URL
    const anchors = Array.from(container.querySelectorAll("a"));
    expect(anchors.length).toBeGreaterThanOrEqual(15);
    for (const anchor of anchors) {
      const href = anchor.getAttribute("href");
      expect(href).toBeTruthy();
      expect(ALLOWED_APP_HREFS.has(href!)).toBe(true);
    }

    // Verify #rpc-endpoint-input is immediately followed by the "Local Default" button
    const endpointInput = document.getElementById("rpc-endpoint-input") as HTMLInputElement;
    const nextSiblingBtn = endpointInput.nextElementSibling as HTMLButtonElement | null;
    expect(nextSiblingBtn?.tagName).toBe("BUTTON");
    expect(nextSiblingBtn?.textContent?.trim()).toBe("Local Default");

    // Verify RPC preset buttons update both endpoint URL and Target Network
    const networkSelect = document.getElementById("target-network-select") as HTMLSelectElement;
    fireEvent.click(screen.getByTestId("rpc-preset-mainnet"));
    expect(endpointInput.value).toBe("https://rpc.kovanica.online/rpc");
    expect(networkSelect.value).toBe("1");

    fireEvent.click(screen.getByTestId("rpc-preset-testnet"));
    expect(endpointInput.value).toBe("https://rpc-testnet.kovanica.online/rpc");
    expect(networkSelect.value).toBe("2");

    fireEvent.click(screen.getByTestId("rpc-preset-local"));
    expect(endpointInput.value).toBe("http://127.0.0.1:8545/rpc");
    expect(networkSelect.value).toBe("2");

    // Zero stale/broken org/repo/domain/ticker strings in rendered UI
    const html = container.innerHTML;
    const text = container.textContent ?? "";
    expect(html).not.toContain("KovanicaDAG");
    expect(html).not.toContain("kovanica.org");
    expect(html).not.toContain("api.kovanica.online");
    expect(html).not.toContain(".example");
    expect(text).not.toContain("KUNA");
  });

  it("applies dark-theme tokens to WaveARwaStudio and builds 1-Tx RWA Batch without Node Buffer", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("tab-wave-a-studio"));

    const studio = screen.getByTestId("wave-a-rwa-studio");
    expect(studio.classList.contains("bg-surface")).toBe(true);
    expect(studio.classList.contains("border-border")).toBe(true);

    const select = screen.getByLabelText("RWA Asset Class");
    const input = screen.getByLabelText("RWA Unique ID");
    const button = screen.getByRole("button", { name: /Build 1-Tx RWA Batch/i });

    expect(select.classList.contains("bg-surface-2")).toBe(true);
    expect(select.classList.contains("text-fg")).toBe(true);
    expect(input.classList.contains("bg-surface-2")).toBe(true);
    expect(input.classList.contains("text-fg")).toBe(true);
    expect(button.classList.contains("bg-gold")).toBe(true);

    fireEvent.click(button);
    const out = screen.getByTestId("wave-a-rwa-output").textContent ?? "";
    const parsed = JSON.parse(out);
    expect(parsed.sdkVersion).toBe("v0.9.0");
    expect(parsed.passkeyAddressHex).toMatch(/^0x[0-9a-f]{16}\.\.\.$/);
  });
});
