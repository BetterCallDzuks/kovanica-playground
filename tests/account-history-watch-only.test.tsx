import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CHAIN_IDS } from "kovanica-sdk";
import { AccountHistoryWatchOnlyPanel } from "../src/components/AccountHistoryWatchOnlyPanel";
import type { AccountTxHistoryClient, GetTransactionHistoryParams } from "../src/wallet-interop";

const GOLDEN_MAINNET_ADDR =
  "kvncschhpna0ex6cz6vl34n4nr4vdxwtey4alj2qa90d0ms73kqspel0nuhe8dag";
const GOLDEN_TESTNET_ADDR =
  "tkncschhpna0ex6cz6vl34n4nr4vdxwtey4alj2qa90d0ms73kqspel0nuhe8dag";

describe("AccountHistoryWatchOnlyPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("inspects a valid PRO-21 watch-only account and displays network, chainId, and canSign: false", () => {
    const mockClient: AccountTxHistoryClient = {
      getTransactionHistory: vi.fn(),
    };

    render(
      <AccountHistoryWatchOnlyPanel
        client={mockClient}
        selectedChainId={CHAIN_IDS.TESTNET}
        defaultAddress={GOLDEN_TESTNET_ADDR}
      />,
    );

    fireEvent.click(screen.getByTestId("watch-only-inspect-btn"));

    expect(screen.queryByTestId("watch-only-error")).toBeNull();
    expect(screen.getByTestId("watch-only-result")).toBeTruthy();
    expect(screen.getByTestId("watch-only-badge").textContent).toContain("READ-ONLY");
    expect(screen.getByTestId("watch-only-badge").textContent).toContain("canSign: false");
    expect(screen.getByTestId("watch-only-network").textContent).toBe("testnet");
    expect(screen.getByTestId("watch-only-chain-id").textContent).toBe("2");
  });

  it("shows validation error for invalid PRO-21 addresses or chain mismatch", () => {
    const mockClient: AccountTxHistoryClient = {
      getTransactionHistory: vi.fn(),
    };

    render(
      <AccountHistoryWatchOnlyPanel
        client={mockClient}
        selectedChainId={CHAIN_IDS.MAINNET}
      />,
    );

    const addrInput = screen.getByTestId("watch-only-address-input");
    fireEvent.change(addrInput, { target: { value: "0x" + "11".repeat(32) } });
    fireEvent.click(screen.getByTestId("watch-only-inspect-btn"));

    expect(screen.queryByTestId("watch-only-result")).toBeNull();
    expect(screen.getByTestId("watch-only-error").textContent).toBeTruthy();

    // Testnet prefix against Mainnet chainId -> rejected
    fireEvent.change(addrInput, { target: { value: GOLDEN_TESTNET_ADDR } });
    fireEvent.click(screen.getByTestId("watch-only-inspect-btn"));

    expect(screen.queryByTestId("watch-only-result")).toBeNull();
    expect(screen.getByTestId("watch-only-error").textContent).toMatch(/mainnet|prefix|mismatch|invalid/i);
  });

  it("fetches paginated account tx history with direction filtering and lossless KVNC amounts", async () => {
    const calls: GetTransactionHistoryParams[] = [];
    const mockClient: AccountTxHistoryClient = {
      getTransactionHistory: vi.fn(async (params: GetTransactionHistoryParams) => {
        calls.push(params);
        if (!params.cursor) {
          return {
            entries: [
              {
                hash: "0x" + "aa".repeat(32),
                height: "420",
                timestamp: "1750000000000",
                from: GOLDEN_MAINNET_ADDR,
                to: GOLDEN_TESTNET_ADDR,
                amount: "1234567890123456789", // > Number.MAX_SAFE_INTEGER
                fee: "25000",
                kind: "transfer",
                status: "success",
              },
            ],
            next_cursor: "cursor-page-2",
          };
        }
        return {
          entries: [
            {
              hash: "0x" + "bb".repeat(32),
              height: "419",
              timestamp: null,
              from: GOLDEN_MAINNET_ADDR,
              to: null,
              amount: "0",
              fee: "10000",
              kind: "call",
              status: "failed",
            },
          ],
          next_cursor: null,
        };
      }),
    };

    render(
      <AccountHistoryWatchOnlyPanel
        client={mockClient}
        selectedChainId={CHAIN_IDS.MAINNET}
        defaultAddress={GOLDEN_MAINNET_ADDR}
      />,
    );

    // Select direction "sent" and limit 1
    fireEvent.change(screen.getByTestId("tx-history-direction-select"), {
      target: { value: "sent" },
    });
    fireEvent.change(screen.getByTestId("tx-history-limit-input"), {
      target: { value: "1" },
    });

    fireEvent.click(screen.getByTestId("tx-history-fetch-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("tx-history-result")).toBeTruthy();
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      address: GOLDEN_MAINNET_ADDR,
      direction: "sent",
      limit: 1,
    });

    const rowsPage1 = screen.getAllByTestId("tx-history-row");
    expect(rowsPage1).toHaveLength(1);
    expect(rowsPage1[0].textContent).toContain("1234567890.123456789 KVNC");
    expect(rowsPage1[0].textContent).toContain("1234567890123456789 atoms");
    expect(rowsPage1[0].textContent).toContain("0.000025 KVNC");
    expect(screen.getByTestId("tx-history-has-more").textContent).toBe("More pages available");
    expect(screen.getByTestId("tx-history-next-cursor").textContent).toContain("cursor-page-2");

    // Click Load Next Page
    fireEvent.click(screen.getByTestId("tx-history-next-page-btn"));

    await waitFor(() => {
      expect(screen.getAllByTestId("tx-history-row")).toHaveLength(2);
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({
      address: GOLDEN_MAINNET_ADDR,
      direction: "sent",
      limit: 1,
      cursor: "cursor-page-2",
    });

    expect(screen.getByTestId("tx-history-has-more").textContent).toBe("End of history");
    expect(screen.queryByTestId("tx-history-next-page-btn")).toBeNull();
  });
});
