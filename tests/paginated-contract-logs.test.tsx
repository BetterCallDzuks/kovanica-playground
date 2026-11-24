import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  DEFAULT_CONTRACT_LOGS_MAX_PAGES as SDK_MAX_PAGES,
  DEFAULT_CONTRACT_LOGS_MAX_SPAN as SDK_MAX_SPAN,
  DEFAULT_CONTRACT_LOGS_PAGE_LIMIT as SDK_PAGE_LIMIT,
  formatContractLogCursor as sdkFormatContractLogCursor,
  parseContractLogCursor as sdkParseContractLogCursor,
  queryContractLogsPaginated as sdkQueryContractLogsPaginated,
} from "kovanica-sdk";
import { PaginatedContractLogsPanel } from "../src/components/PaginatedContractLogsPanel";
import {
  DEFAULT_CONTRACT_LOGS_MAX_PAGES,
  DEFAULT_CONTRACT_LOGS_MAX_SPAN,
  DEFAULT_CONTRACT_LOGS_PAGE_LIMIT,
  bytesToHex,
  concat,
  encodeBincodeStringVec,
  formatContractLogCursor,
  hexToBytes,
  parseContractLogCursor,
  queryContractLogsPaginated,
  type PaginatedGetLogsRpcFilter,
  type PaginatedLogsClient,
} from "../src/wallet-interop";

const GOLDEN_CONTRACT_ADDR =
  "kvncschhpna0ex6cz6vl34n4nr4vdxwtey4alj2qa90d0ms73kqspel0nuhe8dag";

describe("SDK v0.7.0 Paginated Contract Logs Re-exports & Cursor Utilities", () => {
  it("re-exports v0.7.0 paginated contract log helpers and constants identically from wallet-interop", () => {
    expect(queryContractLogsPaginated).toBe(sdkQueryContractLogsPaginated);
    expect(parseContractLogCursor).toBe(sdkParseContractLogCursor);
    expect(formatContractLogCursor).toBe(sdkFormatContractLogCursor);
    expect(DEFAULT_CONTRACT_LOGS_MAX_SPAN).toBe(SDK_MAX_SPAN);
    expect(DEFAULT_CONTRACT_LOGS_MAX_PAGES).toBe(SDK_MAX_PAGES);
    expect(DEFAULT_CONTRACT_LOGS_PAGE_LIMIT).toBe(SDK_PAGE_LIMIT);
    expect(DEFAULT_CONTRACT_LOGS_MAX_SPAN).toBe(500);
    expect(DEFAULT_CONTRACT_LOGS_MAX_PAGES).toBe(20);
    expect(DEFAULT_CONTRACT_LOGS_PAGE_LIMIT).toBe(200);
  });

  it("formats and parses contract log cursors losslessly", () => {
    const formatted = formatContractLogCursor(123456789012345n, 42n);
    expect(formatted).toBe("123456789012345:42");
    expect(parseContractLogCursor(formatted)).toEqual({
      height: 123456789012345n,
      logIndex: 42n,
    });
  });
});

describe("PaginatedContractLogsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("executes a multi-chunk query with PRO-21 contract address & topic filter and renders telemetry", async () => {
    const capturedFilters: PaginatedGetLogsRpcFilter[] = [];
    const mockClient: PaginatedLogsClient = {
      getLogs: vi.fn(async (filter: PaginatedGetLogsRpcFilter) => {
        capturedFilters.push(filter);
        if (filter.fromBlock === "0x0") {
          return [
            {
              address: GOLDEN_CONTRACT_ADDR,
              topics: ["0x" + "11".repeat(32)],
              data: "0xdeadbeef",
              blockNumber: "0x10",
              logIndex: "0x0",
              transactionHash: "0x" + "aa".repeat(32),
            },
          ];
        }
        return [
          {
            address: GOLDEN_CONTRACT_ADDR,
            topics: ["0x" + "11".repeat(32)],
            data: "0xcafebabe",
            blockNumber: "0x200",
            logIndex: "0x1",
            transactionHash: "0x" + "bb".repeat(32),
          },
        ];
      }),
    };

    render(
      <PaginatedContractLogsPanel
        client={mockClient}
        defaultContractAddress={GOLDEN_CONTRACT_ADDR}
      />,
    );

    fireEvent.change(screen.getByTestId("paginated-logs-from-block-input"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByTestId("paginated-logs-to-block-input"), {
      target: { value: "999" },
    });
    fireEvent.change(screen.getByTestId("paginated-logs-max-span-input"), {
      target: { value: "500" },
    });
    fireEvent.change(screen.getByTestId("paginated-logs-topic-input"), {
      target: { value: "0x" + "11".repeat(32) },
    });

    fireEvent.click(screen.getByTestId("paginated-logs-query-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("paginated-logs-result")).toBeTruthy();
    });

    expect(capturedFilters).toHaveLength(2);
    expect(capturedFilters[0]).toMatchObject({
      fromBlock: "0x0",
      toBlock: "0x1f3",
      address: GOLDEN_CONTRACT_ADDR,
      topics: ["0x" + "11".repeat(32)],
    });
    expect(capturedFilters[1]).toMatchObject({
      fromBlock: "0x1f4",
      toBlock: "0x3e7",
      address: GOLDEN_CONTRACT_ADDR,
      topics: ["0x" + "11".repeat(32)],
    });

    expect(screen.getByTestId("paginated-logs-count").textContent).toBe("2");
    expect(screen.getByTestId("paginated-logs-chunks-scanned").textContent).toBe("2");
    expect(screen.getByTestId("paginated-logs-pages-fetched").textContent).toBe("2");
    expect(screen.getByTestId("paginated-logs-next-cursor").textContent).toBe("null");
    expect(screen.getByTestId("paginated-logs-has-more").textContent).toBe("Complete");
    expect(screen.queryByTestId("paginated-logs-next-page-btn")).toBeNull();

    const rows = screen.getAllByTestId("paginated-log-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("0xdeadbeef");
    expect(rows[1].textContent).toContain("0xcafebabe");
  });

  it("decodes Bincode contract logs inline when decode toggle is enabled", async () => {
    const pkA = hexToBytes("aa".repeat(32));
    const pkB = hexToBytes("bb".repeat(32));
    const nameBytes = concat([
      pkA,
      pkB,
      encodeBincodeStringVec(["https://relay1.kovanica.org"]),
    ]);

    const mockClient: PaginatedLogsClient = {
      getLogs: vi.fn(async () => [
        {
          address: GOLDEN_CONTRACT_ADDR,
          topics: ["name_register"],
          data: `0x${bytesToHex(nameBytes)}`,
          blockNumber: "0x2a",
          logIndex: "0x0",
          transactionHash: "0x" + "cc".repeat(32),
        },
      ]),
    };

    render(
      <PaginatedContractLogsPanel
        client={mockClient}
        defaultContractAddress={GOLDEN_CONTRACT_ADDR}
      />,
    );

    fireEvent.change(screen.getByTestId("paginated-logs-from-block-input"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByTestId("paginated-logs-to-block-input"), {
      target: { value: "100" },
    });

    fireEvent.click(screen.getByTestId("paginated-logs-decode-toggle"));
    fireEvent.change(screen.getByTestId("paginated-logs-kind-select"), {
      target: { value: "name" },
    });

    fireEvent.click(screen.getByTestId("paginated-logs-query-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("paginated-log-decoded-badge")).toBeTruthy();
    });

    expect(screen.getByTestId("paginated-log-decoded-badge").textContent).toContain("decoded: name");
    const decodedJson = screen.getByTestId("paginated-log-decoded-json").textContent ?? "";
    expect(decodedJson).toContain("aa".repeat(32));
    expect(decodedJson).toContain("https://relay1.kovanica.org");
  });

  it("resumes pagination via Load Next Page cursor button and accumulates logs & counters", async () => {
    const capturedFilters: PaginatedGetLogsRpcFilter[] = [];
    const mockClient: PaginatedLogsClient = {
      getLogs: vi.fn(async (filter: PaginatedGetLogsRpcFilter) => {
        capturedFilters.push(filter);
        if (!filter.cursor) {
          return {
            logs: [
              {
                address: GOLDEN_CONTRACT_ADDR,
                data: "0x01",
                blockNumber: "0xa",
                logIndex: "0x0",
                transactionHash: "0x" + "11".repeat(32),
              },
            ],
            nextCursor: "10:0",
          };
        }
        return {
          logs: [
            {
              address: GOLDEN_CONTRACT_ADDR,
              data: "0x02",
              blockNumber: "0xb",
              logIndex: "0x1",
              transactionHash: "0x" + "22".repeat(32),
            },
          ],
          nextCursor: null,
        };
      }),
    };

    render(
      <PaginatedContractLogsPanel
        client={mockClient}
        defaultContractAddress={GOLDEN_CONTRACT_ADDR}
      />,
    );

    fireEvent.change(screen.getByTestId("paginated-logs-from-block-input"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByTestId("paginated-logs-to-block-input"), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByTestId("paginated-logs-max-pages-input"), {
      target: { value: "1" },
    });

    fireEvent.click(screen.getByTestId("paginated-logs-query-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("paginated-logs-next-page-btn")).toBeTruthy();
    });

    expect(capturedFilters).toHaveLength(1);
    expect(capturedFilters[0].cursor).toBeUndefined();
    expect(screen.getByTestId("paginated-logs-count").textContent).toBe("1");
    expect(screen.getByTestId("paginated-logs-chunks-scanned").textContent).toBe("1");
    expect(screen.getByTestId("paginated-logs-pages-fetched").textContent).toBe("1");
    expect(screen.getByTestId("paginated-logs-next-cursor").textContent).toBe("10:0");
    expect(screen.getByTestId("paginated-logs-has-more").textContent).toBe("More pages available");

    // Click Load Next Page to resume with cursor "10:0"
    fireEvent.click(screen.getByTestId("paginated-logs-next-page-btn"));

    await waitFor(() => {
      expect(screen.getAllByTestId("paginated-log-row")).toHaveLength(2);
    });

    expect(capturedFilters).toHaveLength(2);
    expect(capturedFilters[1].cursor).toBe("10:0");
    expect(screen.getByTestId("paginated-logs-count").textContent).toBe("2");
    expect(screen.getByTestId("paginated-logs-chunks-scanned").textContent).toBe("2");
    expect(screen.getByTestId("paginated-logs-pages-fetched").textContent).toBe("2");
    expect(screen.getByTestId("paginated-logs-next-cursor").textContent).toBe("null");
    expect(screen.getByTestId("paginated-logs-has-more").textContent).toBe("Complete");
    expect(screen.queryByTestId("paginated-logs-next-page-btn")).toBeNull();
  });

  it("shows validation error when fromBlock > toBlock", async () => {
    const mockClient: PaginatedLogsClient = {
      getLogs: vi.fn(),
    };

    render(<PaginatedContractLogsPanel client={mockClient} />);

    fireEvent.change(screen.getByTestId("paginated-logs-from-block-input"), {
      target: { value: "500" },
    });
    fireEvent.change(screen.getByTestId("paginated-logs-to-block-input"), {
      target: { value: "100" },
    });

    fireEvent.click(screen.getByTestId("paginated-logs-query-btn"));

    expect(screen.getByTestId("paginated-logs-error").textContent).toContain("fromBlock (500) must be <= toBlock (100)");
    expect(mockClient.getLogs).not.toHaveBeenCalled();
  });
});
