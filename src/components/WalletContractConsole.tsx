import { useState, useMemo } from "react";
import {
  parseKvnc,
  type KovanicaClient,
  KOVANICA_COIN_TYPE,
} from "kovanica-sdk";
import {
  AIRGAP_ENVELOPE_PREFIX,
  buildEscrowCreateCall,
  buildHtlcCreateCall,
  buildNameRegisterCall,
  buildNftMintCall,
  buildPlaygroundCallCurlSnippet,
  buildPlaygroundCallSdkSnippet,
  buildTokenTransferCall,
  buildVaultCreateCall,
  bytesToHex,
  decodeAirgapTxEnvelope,
  decodeContractStateHex,
  DEFAULT_JSONRPC_READ_BATCH_PRESET,
  DEFAULT_LOG_HISTORY_CHUNK_SIZE,
  deriveAccountsFromMnemonic,
  deriveContractStorageSlotHex,
  encodeAirgapTxEnvelope,
  estimateContractCall,
  estimateContractCallBatch,
  executeJsonRpcReadBatch,
  exportContractPresetsJson,
  fetchAndDecodeContractStorageSlot,
  generateMnemonic,
  hexToBytes,
  inspectAddress,
  inspectAnySignedTx,
  inspectRawSignedCallTx,
  inspectRawSignedTransferTx,
  KovanicaDecodeError,
  MAX_JSONRPC_BATCH_SIZE,
  parseImportedContractPresetsJson,
  pollAndDecodeTransactionReceipt,
  probeFailoverRpcEndpoints,
  runContractLogHistoryQuery,
  runGoldenVectorSelfTest,
  runMempoolFeeTierProbe,
  runNodeCapabilityProbe,
  runTypedFacadeRead,
  signAndSerializeTransaction,
  validateMnemonic,
  type AddressInspectionResult,
  type AirgapTxEnvelope,
  type AirgapTxKind,
  type CallTxKind,
  type ContractDecoderKind,
  type ContractLogHistoryQueryResult,
  type ContractLogKind,
  type DerivedAccountInfo,
  type EncodedAirgapTxEnvelope,
  type FailoverRpcProbeResult,
  type InspectedSignedCallTx,
  type InspectedSignedTransferTx,
  type InspectedSignedTxAuto,
  type JsonRpcBatchRequestItem,
  type JsonRpcReadBatchSummary,
  type MempoolFeeTierProbeResult,
  type NodeCapabilityProbeSummary,
  type PollAndDecodeTransactionReceiptResult,
  type PreparedContractCallBatch,
  type PreparedCallTransaction,
  type SelfTestStep,
  type TxKind,
  type TypedFacadeKind,
  type TypedFacadeReadResult,
  type UnsignedTx,
} from "../wallet-interop";

interface Props {
  client: KovanicaClient;
  selectedChainId: number;
  rpcUrl?: string;
}

const GOLDEN_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

export function WalletContractConsole({ client, selectedChainId, rpcUrl }: Props) {
  // Mnemonic state
  const [mnemonic, setMnemonic] = useState<string>(GOLDEN_MNEMONIC);
  const [passphrase, setPassphrase] = useState<string>("");
  const [activeAccountIdx, setActiveAccountIdx] = useState<number>(0);

  // Tx state
  const [txType, setTxType] = useState<
    | "transfer"
    | "token_transfer"
    | "vault_create"
    | "name_register"
    | "htlc_create"
    | "nft_mint"
    | "escrow_create"
  >("transfer");
  const [nonceStr, setNonceStr] = useState<string>("0");
  const [feeStr, setFeeStr] = useState<string>("10000"); // in atoms

  // Transfer fields
  const [recipientInput, setRecipientInput] = useState<string>("");
  const [amountKvncStr, setAmountKvncStr] = useState<string>("1");

  // Contract fields
  const [contractHex, setContractHex] = useState<string>("33".repeat(32));
  const [tokenUnitsStr, setTokenUnitsStr] = useState<string>("100");
  const [lockUntilMsStr, setLockUntilMsStr] = useState<string>(
    (Date.now() + 86400000).toString(),
  );

  // Name Registry fields
  const [nameStr, setNameStr] = useState<string>("alice");
  const [namePubkeyHex, setNamePubkeyHex] = useState<string>("");
  const [relayEndpointsStr, setRelayEndpointsStr] = useState<string>(
    "https://relay1.kovanica.org\nhttps://relay2.kovanica.org",
  );

  // HTLC fields
  const [hashlockHex, setHashlockHex] = useState<string>("11".repeat(32));
  const [timelockStr, setTimelockStr] = useState<string>(
    (Date.now() + 86400000).toString(),
  );
  const [htlcRecipientHex, setHtlcRecipientHex] = useState<string>("");

  // NFT fields
  const [collectionHex, setCollectionHex] = useState<string>("77".repeat(32));
  const [nftToHex, setNftToHex] = useState<string>("");
  const [tokenIdStr, setTokenIdStr] = useState<string>("1");
  const [tokenUriStr, setTokenUriStr] = useState<string>(
    "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  );

  // Escrow fields
  const [escrowPartiesStr, setEscrowPartiesStr] = useState<string>("");
  const [escrowThresholdStr, setEscrowThresholdStr] = useState<string>("2");
  const [escrowAmountStr, setEscrowAmountStr] = useState<string>("1000000000"); // 1 KVNC
  const [escrowDeadlineStr, setEscrowDeadlineStr] = useState<string>(
    (Date.now() + 172800000).toString(),
  );

  // Output state
  const [signedResult, setSignedResult] = useState<{
    sighashHex: string;
    signatureHex: string;
    rawTxHex: string;
    txSize: number;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [broadcastStatus, setBroadcastStatus] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);

  // SDK v0.4.0 Fee & Nonce Estimation state
  const [isEstimating, setIsEstimating] = useState<boolean>(false);
  const [preparedEstimate, setPreparedEstimate] = useState<PreparedCallTransaction | null>(null);

  // Multi-Call Batch Estimator & Code Exporter state
  const [batchQueue, setBatchQueue] = useState<CallTxKind[]>([]);
  const [isEstimatingBatch, setIsEstimatingBatch] = useState<boolean>(false);
  const [batchEstimateResult, setBatchEstimateResult] = useState<PreparedContractCallBatch | null>(null);
  const [activeCodeSnippet, setActiveCodeSnippet] = useState<{
    kind: "curl" | "sdk";
    code: string;
  } | null>(null);
  const [showPresetsPanel, setShowPresetsPanel] = useState<boolean>(false);
  const [presetsJsonInput, setPresetsJsonInput] = useState<string>("");
  const [presetsStatusMsg, setPresetsStatusMsg] = useState<string | null>(null);
  const [presetsErrorMsg, setPresetsErrorMsg] = useState<string | null>(null);

  // SDK v0.4.0 Contract State Bincode Decoder & Live Storage Slot Fetch state
  const [decoderKind, setDecoderKind] = useState<ContractDecoderKind>("name");
  const [storageContractAddr, setStorageContractAddr] = useState<string>("0x" + "33".repeat(32));
  const [customSlotPrefix, setCustomSlotPrefix] = useState<string>("");
  const [slotKeyInput, setSlotKeyInput] = useState<string>("alice");
  const [derivedSlotHex, setDerivedSlotHex] = useState<string | null>(null);
  const [decoderHexInput, setDecoderHexInput] = useState<string>("");
  const [decodedOutput, setDecodedOutput] = useState<string | null>(null);
  const [decoderError, setDecoderError] = useState<string | null>(null);
  const [storageEmptyMsg, setStorageEmptyMsg] = useState<string | null>(null);
  const [isFetchingStorage, setIsFetchingStorage] = useState<boolean>(false);

  // Transaction Receipt Poller & Log Decoder state
  const [receiptTxHash, setReceiptTxHash] = useState<string>("");
  const [receiptDecoderKind, setReceiptDecoderKind] = useState<ContractDecoderKind | "">("name");
  const [isPollingReceipt, setIsPollingReceipt] = useState<boolean>(false);
  const [receiptPollResult, setReceiptPollResult] =
    useState<PollAndDecodeTransactionReceiptResult | null>(null);
  const [receiptPollError, setReceiptPollError] = useState<string | null>(null);

  // JSON-RPC 2.0 Batch Read Runner state
  const [rpcBatchInput, setRpcBatchInput] = useState<string>(() =>
    JSON.stringify(DEFAULT_JSONRPC_READ_BATCH_PRESET, null, 2),
  );
  const [isRunningRpcBatch, setIsRunningRpcBatch] = useState<boolean>(false);
  const [rpcBatchSummary, setRpcBatchSummary] = useState<JsonRpcReadBatchSummary | null>(null);
  const [rpcBatchError, setRpcBatchError] = useState<string | null>(null);

  // Typed Contract Facades Studio state
  const [facadeKind, setFacadeKind] = useState<TypedFacadeKind>("name");
  const [facadeContractInput, setFacadeContractInput] = useState<string>("0x" + "33".repeat(32));
  const [facadeKeyInput, setFacadeKeyInput] = useState<string>("alice");
  const [isReadingFacade, setIsReadingFacade] = useState<boolean>(false);
  const [facadeReadResult, setFacadeReadResult] = useState<TypedFacadeReadResult | null>(null);
  const [facadeReadError, setFacadeReadError] = useState<string | null>(null);

  // Contract Log History Explorer & Failover RPC Probe state
  const [logFromBlockStr, setLogFromBlockStr] = useState<string>("0");
  const [logToBlockStr, setLogToBlockStr] = useState<string>("1000");
  const [logAddressInput, setLogAddressInput] = useState<string>("");
  const [logChunkSizeStr, setLogChunkSizeStr] = useState<string>(
    String(DEFAULT_LOG_HISTORY_CHUNK_SIZE),
  );
  const [logDecoderKind, setLogDecoderKind] = useState<ContractLogKind | "">("");
  const [isQueryingLogs, setIsQueryingLogs] = useState<boolean>(false);
  const [logHistoryResult, setLogHistoryResult] =
    useState<ContractLogHistoryQueryResult | null>(null);
  const [logHistoryError, setLogHistoryError] = useState<string | null>(null);

  const [failoverUrlsInput, setFailoverUrlsInput] = useState<string>(
    () => rpcUrl?.trim() || "http://127.0.0.1:8545/rpc",
  );
  const [isProbingFailover, setIsProbingFailover] = useState<boolean>(false);
  const [failoverProbeResult, setFailoverProbeResult] =
    useState<FailoverRpcProbeResult | null>(null);

  // Raw Wire Tx Decoder & Node Capability Probe state
  const [rawTxHexInput, setRawTxHexInput] = useState<string>("");
  const [rawTxChainIdStr, setRawTxChainIdStr] = useState<string>(() =>
    String(selectedChainId),
  );
  const [rawTxPubkeyHex, setRawTxPubkeyHex] = useState<string>("");
  const [inspectedRawTx, setInspectedRawTx] = useState<InspectedSignedCallTx | null>(null);
  const [rawTxInspectError, setRawTxInspectError] = useState<string | null>(null);

  const [nodeProbeUrlInput, setNodeProbeUrlInput] = useState<string>(
    () => rpcUrl?.trim() || "http://127.0.0.1:8545/rpc",
  );
  const [nodeProbeExpectedChainStr, setNodeProbeExpectedChainStr] = useState<string>("");
  const [isProbingNode, setIsProbingNode] = useState<boolean>(false);
  const [nodeProbeResult, setNodeProbeResult] =
    useState<NodeCapabilityProbeSummary | null>(null);

  // Address Inspector & Transfer Tx Verifier state
  const [addressInspectInput, setAddressInspectInput] = useState<string>("");
  const [addressInspectChainStr, setAddressInspectChainStr] = useState<string>(() =>
    String(selectedChainId),
  );
  const [addressInspectResult, setAddressInspectResult] =
    useState<AddressInspectionResult | null>(null);

  const [transferTxHexInput, setTransferTxHexInput] = useState<string>("");
  const [transferTxChainIdStr, setTransferTxChainIdStr] = useState<string>(() =>
    String(selectedChainId),
  );
  const [transferTxPubkeyHex, setTransferTxPubkeyHex] = useState<string>("");
  const [inspectedTransferTx, setInspectedTransferTx] =
    useState<InspectedSignedTransferTx | null>(null);
  const [transferTxInspectError, setTransferTxInspectError] = useState<string | null>(null);

  // Universal Tx Auto-Decoder & Air-Gap Envelope Studio state
  const [universalTxHexInput, setUniversalTxHexInput] = useState<string>("");
  const [universalTxChainIdStr, setUniversalTxChainIdStr] = useState<string>(() =>
    String(selectedChainId),
  );
  const [universalTxPubkeyHex, setUniversalTxPubkeyHex] = useState<string>("");
  const [inspectedUniversalTx, setInspectedUniversalTx] =
    useState<InspectedSignedTxAuto | null>(null);
  const [universalTxError, setUniversalTxError] = useState<string | null>(null);

  const [wrappedEnvelopeResult, setWrappedEnvelopeResult] =
    useState<EncodedAirgapTxEnvelope | null>(null);
  const [airgapEnvelopeInput, setAirgapEnvelopeInput] = useState<string>("");
  const [airgapExpectedChainStr, setAirgapExpectedChainStr] = useState<string>("");
  const [decodedAirgapResult, setDecodedAirgapResult] = useState<{
    envelope: AirgapTxEnvelope;
    inspectedTx: InspectedSignedTxAuto | null;
  } | null>(null);
  const [airgapDecodeError, setAirgapDecodeError] = useState<string | null>(null);

  // Mempool Fee-Tier Estimator state
  const [isProbingMempoolFees, setIsProbingMempoolFees] = useState<boolean>(false);
  const [mempoolFeeResult, setMempoolFeeResult] =
    useState<MempoolFeeTierProbeResult | null>(null);
  const [mempoolFeeError, setMempoolFeeError] = useState<string | null>(null);

  // Self-test results
  const [selfTestSteps, setSelfTestSteps] = useState<SelfTestStep[] | null>(null);

  const isMnemonicValid = useMemo(() => validateMnemonic(mnemonic), [mnemonic]);

  const accounts: DerivedAccountInfo[] = useMemo(() => {
    if (!isMnemonicValid) return [];
    try {
      return deriveAccountsFromMnemonic(mnemonic, passphrase, 2, selectedChainId);
    } catch {
      return [];
    }
  }, [mnemonic, passphrase, isMnemonicValid, selectedChainId]);

  const activeAccount = accounts[activeAccountIdx] || accounts[0];

  const handleGenerateMnemonic = () => {
    const fresh = generateMnemonic(256);
    setMnemonic(fresh);
    setSignedResult(null);
    setErrorMsg(null);
  };

  const handleLoadGoldenMnemonic = () => {
    setMnemonic(GOLDEN_MNEMONIC);
    setPassphrase("");
    setSignedResult(null);
    setErrorMsg(null);
  };

  const copyToClipboard = (text: string, label: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
    }
    setCopySuccess(label);
    setTimeout(() => setCopySuccess(null), 2000);
  };

  const buildActiveCallKind = (): CallTxKind => {
    if (!activeAccount) {
      throw new Error("No active account available");
    }
    const contract = hexToBytes(contractHex.trim());
    if (txType === "token_transfer") {
      const recipient = accounts[1]?.publicKey || activeAccount.publicKey;
      const units = BigInt(tokenUnitsStr || "0");
      return buildTokenTransferCall(contract, recipient, units);
    }
    if (txType === "vault_create") {
      const beneficiary = accounts[1]?.publicKey || activeAccount.publicKey;
      const atoms = parseKvnc(amountKvncStr || "0");
      const lockUntil = BigInt(lockUntilMsStr || (Date.now() + 86400000).toString());
      return buildVaultCreateCall(contract, beneficiary, atoms, lockUntil);
    }
    if (txType === "name_register") {
      const regPubkey = namePubkeyHex.trim()
        ? hexToBytes(namePubkeyHex.trim())
        : accounts[1]?.publicKey || activeAccount.publicKey;
      const endpoints = relayEndpointsStr
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      return {
        type: "call",
        contract,
        value: 0n,
        method: "name_register",
        args: buildNameRegisterCall(nameStr.trim(), regPubkey, endpoints),
        gasLimit: 100_000n,
      };
    }
    if (txType === "htlc_create") {
      const hashlock = hexToBytes(hashlockHex.trim());
      const timelock = BigInt(timelockStr.trim() || "0");
      const recipient = htlcRecipientHex.trim()
        ? hexToBytes(htlcRecipientHex.trim())
        : accounts[1]?.publicKey || activeAccount.publicKey;
      return {
        type: "call",
        contract,
        value: 0n,
        method: "htlc_create",
        args: buildHtlcCreateCall(hashlock, timelock, recipient),
        gasLimit: 100_000n,
      };
    }
    if (txType === "nft_mint") {
      const collection = hexToBytes(collectionHex.trim());
      const to = nftToHex.trim()
        ? hexToBytes(nftToHex.trim())
        : accounts[1]?.publicKey || activeAccount.publicKey;
      const tokenId = BigInt(tokenIdStr.trim() || "0");
      return {
        type: "call",
        contract,
        value: 0n,
        method: "nft_mint",
        args: buildNftMintCall(collection, to, tokenId, tokenUriStr.trim()),
        gasLimit: 100_000n,
      };
    }
    if (txType === "escrow_create") {
      const rawParties = escrowPartiesStr
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const parties =
        rawParties.length > 0
          ? rawParties.map((p) => hexToBytes(p))
          : [activeAccount.publicKey, accounts[1]?.publicKey || activeAccount.publicKey];
      const threshold = Number(escrowThresholdStr.trim() || "1");
      const amount = BigInt(escrowAmountStr.trim() || "0");
      const deadline = BigInt(escrowDeadlineStr.trim() || "0");
      return {
        type: "call",
        contract,
        value: 0n,
        method: "escrow_create",
        args: buildEscrowCreateCall(parties, threshold, amount, deadline),
        gasLimit: 100_000n,
      };
    }
    throw new Error(`Estimate is only supported for Wasmi contract call actions (got ${txType})`);
  };

  const resolvedRpcUrl = useMemo(() => {
    if (rpcUrl && rpcUrl.trim().length > 0) return rpcUrl.trim();
    const clientUrl = (client as unknown as { url?: string })?.url;
    if (typeof clientUrl === "string" && clientUrl.trim().length > 0) {
      return clientUrl.trim();
    }
    return "http://127.0.0.1:8545/rpc";
  }, [rpcUrl, client]);

  const handleEstimateCall = async () => {
    setErrorMsg(null);
    setPreparedEstimate(null);
    if (!activeAccount) {
      setErrorMsg("No active account available for fee estimation");
      return;
    }
    setIsEstimating(true);
    try {
      const callKind = buildActiveCallKind();
      const prepared = await estimateContractCall(client, callKind, {
        sender: activeAccount.address,
        chainId: selectedChainId,
      });
      setPreparedEstimate(prepared);
      setFeeStr(prepared.fee.toString());
      if (prepared.nonce !== undefined) {
        setNonceStr(prepared.nonce.toString());
      }
    } catch (err: any) {
      setErrorMsg(`Fee estimation failed: ${err?.message || String(err)}`);
    } finally {
      setIsEstimating(false);
    }
  };

  const handleQueueToBatch = () => {
    setErrorMsg(null);
    try {
      const callKind = buildActiveCallKind();
      setBatchQueue((prev) => [...prev, callKind]);
      setBatchEstimateResult(null);
    } catch (err: any) {
      setErrorMsg(`Cannot queue call to batch: ${err?.message || String(err)}`);
    }
  };

  const handleClearBatch = () => {
    setBatchQueue([]);
    setBatchEstimateResult(null);
  };

  const handleEstimateBatch = async () => {
    setErrorMsg(null);
    setBatchEstimateResult(null);
    if (!activeAccount) {
      setErrorMsg("No active account available for batch estimation");
      return;
    }
    setIsEstimatingBatch(true);
    try {
      const callsToEstimate =
        batchQueue.length > 0 ? batchQueue : [buildActiveCallKind()];
      if (batchQueue.length === 0) {
        setBatchQueue(callsToEstimate);
      }
      const batchRes = await estimateContractCallBatch(client, callsToEstimate, {
        sender: activeAccount.address,
        chainId: selectedChainId,
      });
      setBatchEstimateResult(batchRes);
    } catch (err: any) {
      setErrorMsg(`Batch estimation failed: ${err?.message || String(err)}`);
    } finally {
      setIsEstimatingBatch(false);
    }
  };

  const handleExportCurlSnippet = () => {
    setErrorMsg(null);
    try {
      const callKind = buildActiveCallKind();
      const snippet = buildPlaygroundCallCurlSnippet({
        rpcUrl: resolvedRpcUrl,
        call: callKind,
        sender: activeAccount?.address,
      });
      setActiveCodeSnippet({ kind: "curl", code: snippet });
      copyToClipboard(snippet, "curl-snippet");
    } catch (err: any) {
      setErrorMsg(`Failed to generate cURL snippet: ${err?.message || String(err)}`);
    }
  };

  const handleExportSdkSnippet = () => {
    setErrorMsg(null);
    try {
      const callKind = buildActiveCallKind();
      const snippet = buildPlaygroundCallSdkSnippet({
        rpcUrl: resolvedRpcUrl,
        call: callKind,
        sender: activeAccount?.address,
        chainId: selectedChainId,
      });
      setActiveCodeSnippet({ kind: "sdk", code: snippet });
      copyToClipboard(snippet, "sdk-snippet");
    } catch (err: any) {
      setErrorMsg(`Failed to generate SDK snippet: ${err?.message || String(err)}`);
    }
  };

  const handleExportBatchPresets = () => {
    setErrorMsg(null);
    setPresetsErrorMsg(null);
    setPresetsStatusMsg(null);
    try {
      const callsToExport = batchQueue.length > 0 ? batchQueue : [buildActiveCallKind()];
      const json = exportContractPresetsJson(callsToExport);
      setPresetsJsonInput(json);
      setShowPresetsPanel(true);
      copyToClipboard(json, "batch-presets");
      setPresetsStatusMsg(
        `Exported ${callsToExport.length} call preset${callsToExport.length === 1 ? "" : "s"} to JSON.`,
      );
    } catch (err: unknown) {
      setPresetsErrorMsg(
        err instanceof Error ? err.message : String(err),
      );
      setShowPresetsPanel(true);
    }
  };

  const handleImportBatchPresets = () => {
    setPresetsErrorMsg(null);
    setPresetsStatusMsg(null);
    try {
      const imported = parseImportedContractPresetsJson(presetsJsonInput);
      setBatchQueue(imported);
      setBatchEstimateResult(null);
      setPresetsStatusMsg(
        `Imported ${imported.length} call preset${imported.length === 1 ? "" : "s"} into batch queue.`,
      );
    } catch (err: unknown) {
      if (err instanceof KovanicaDecodeError) {
        setPresetsErrorMsg(`[${err.code}] ${err.message}`);
      } else {
        setPresetsErrorMsg(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const handleDecodeState = () => {
    setDecoderError(null);
    setDecodedOutput(null);
    setStorageEmptyMsg(null);
    try {
      const decoded = decodeContractStateHex(decoderKind, decoderHexInput.trim());
      setDecodedOutput(
        JSON.stringify(
          decoded,
          (_key, value) => (typeof value === "bigint" ? value.toString() : value),
          2,
        ),
      );
    } catch (err: unknown) {
      if (err instanceof KovanicaDecodeError) {
        setDecoderError(
          `[${err.code}${err.offset !== undefined ? ` @ byte ${err.offset}` : ""}] ${err.message}`,
        );
      } else {
        setDecoderError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const handleDeriveSlot = () => {
    setDecoderError(null);
    setStorageEmptyMsg(null);
    try {
      const slot = deriveContractStorageSlotHex({
        kind: decoderKind,
        key: slotKeyInput,
        customPrefix: customSlotPrefix,
      });
      setDerivedSlotHex(slot);
    } catch (err: unknown) {
      if (err instanceof KovanicaDecodeError) {
        setDecoderError(`[${err.code}] ${err.message}`);
      } else {
        setDecoderError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const handleFetchAndDecodeStorage = async () => {
    setDecoderError(null);
    setDecodedOutput(null);
    setStorageEmptyMsg(null);
    setIsFetchingStorage(true);
    try {
      const result = await fetchAndDecodeContractStorageSlot(client, {
        contractAddress: storageContractAddr,
        kind: decoderKind,
        key: slotKeyInput,
        customPrefix: customSlotPrefix,
      });
      setDerivedSlotHex(result.slotHex);
      setDecoderHexInput(result.rawStorageHex);
      if (result.isEmpty) {
        setStorageEmptyMsg(
          `Storage slot 0x${result.slotHex} is empty (${result.rawStorageHex}) on contract ${result.contractAddress}.`,
        );
      } else {
        setDecodedOutput(
          JSON.stringify(
            result.decoded,
            (_key, value) => (typeof value === "bigint" ? value.toString() : value),
            2,
          ),
        );
      }
    } catch (err: unknown) {
      if (err instanceof KovanicaDecodeError) {
        setDecoderError(
          `[${err.code}${err.offset !== undefined ? ` @ byte ${err.offset}` : ""}] ${err.message}`,
        );
      } else {
        setDecoderError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setIsFetchingStorage(false);
    }
  };

  const handleSign = () => {
    setErrorMsg(null);
    setSignedResult(null);
    setBroadcastStatus(null);

    if (!activeAccount) {
      setErrorMsg("No active account available for signing");
      return;
    }

    try {
      const nonce = BigInt(nonceStr || "0");
      const fee = BigInt(feeStr || "10000");

      let kind: TxKind;
      if (txType === "transfer") {
        const toPubkey = recipientInput.trim()
          ? accounts[1]?.publicKey // fallback or decoded
          : accounts[1]?.publicKey || activeAccount.publicKey;
        const amountAtoms = parseKvnc(amountKvncStr || "0");
        kind = {
          type: "transfer",
          to: toPubkey,
          amount: amountAtoms,
        };
      } else if (txType === "token_transfer") {
        const contract = hexToBytes(contractHex.trim());
        const recipient = accounts[1]?.publicKey || activeAccount.publicKey;
        const units = BigInt(tokenUnitsStr || "0");
        kind = buildTokenTransferCall(contract, recipient, units);
      } else if (txType === "vault_create") {
        const contract = hexToBytes(contractHex.trim());
        const beneficiary = accounts[1]?.publicKey || activeAccount.publicKey;
        const atoms = parseKvnc(amountKvncStr || "0");
        const lockUntil = BigInt(lockUntilMsStr || (Date.now() + 86400000).toString());
        kind = buildVaultCreateCall(contract, beneficiary, atoms, lockUntil);
      } else if (txType === "name_register") {
        const contract = hexToBytes(contractHex.trim());
        const regPubkey = namePubkeyHex.trim()
          ? hexToBytes(namePubkeyHex.trim())
          : accounts[1]?.publicKey || activeAccount.publicKey;
        const endpoints = relayEndpointsStr
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        const args = buildNameRegisterCall(nameStr.trim(), regPubkey, endpoints);
        kind = {
          type: "call",
          contract,
          value: 0n,
          method: "name_register",
          args,
          gasLimit: 100_000n,
        };
      } else if (txType === "htlc_create") {
        const contract = hexToBytes(contractHex.trim());
        const hashlock = hexToBytes(hashlockHex.trim());
        const timelock = BigInt(timelockStr.trim() || "0");
        const recipient = htlcRecipientHex.trim()
          ? hexToBytes(htlcRecipientHex.trim())
          : accounts[1]?.publicKey || activeAccount.publicKey;
        const args = buildHtlcCreateCall(hashlock, timelock, recipient);
        kind = {
          type: "call",
          contract,
          value: 0n,
          method: "htlc_create",
          args,
          gasLimit: 100_000n,
        };
      } else if (txType === "nft_mint") {
        const contract = hexToBytes(contractHex.trim());
        const collection = hexToBytes(collectionHex.trim());
        const to = nftToHex.trim()
          ? hexToBytes(nftToHex.trim())
          : accounts[1]?.publicKey || activeAccount.publicKey;
        const tokenId = BigInt(tokenIdStr.trim() || "0");
        const args = buildNftMintCall(collection, to, tokenId, tokenUriStr.trim());
        kind = {
          type: "call",
          contract,
          value: 0n,
          method: "nft_mint",
          args,
          gasLimit: 100_000n,
        };
      } else if (txType === "escrow_create") {
        const contract = hexToBytes(contractHex.trim());
        const rawParties = escrowPartiesStr
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        const parties = rawParties.length > 0
          ? rawParties.map((p) => hexToBytes(p))
          : [activeAccount.publicKey, accounts[1]?.publicKey || activeAccount.publicKey];
        const threshold = Number(escrowThresholdStr.trim() || "1");
        const amount = BigInt(escrowAmountStr.trim() || "0");
        const deadline = BigInt(escrowDeadlineStr.trim() || "0");
        const args = buildEscrowCreateCall(parties, threshold, amount, deadline);
        kind = {
          type: "call",
          contract,
          value: 0n,
          method: "escrow_create",
          args,
          gasLimit: 100_000n,
        };
      } else {
        throw new Error(`Unknown transaction type: ${txType}`);
      }

      const tx: UnsignedTx = {
        sender: activeAccount.publicKey,
        nonce,
        kind,
        fee,
      };

      const result = signAndSerializeTransaction(tx, activeAccount.secretKey, selectedChainId);
      setSignedResult({
        sighashHex: result.sighashHex,
        signatureHex: result.signatureHex,
        rawTxHex: result.rawTxHex,
        txSize: result.txSize,
      });
    } catch (err: any) {
      setErrorMsg(err?.message || String(err));
    }
  };

  const handleBroadcast = async () => {
    if (!signedResult?.rawTxHex) return;
    setBroadcastStatus("Broadcasting via kovanica_sendRawTransaction...");
    try {
      const hash = await client.call<string>("kovanica_sendRawTransaction", [
        signedResult.rawTxHex,
      ]);
      setBroadcastStatus(`Broadcast accepted! Transaction hash: ${hash}`);
    } catch (err: any) {
      setBroadcastStatus(`Broadcast error: ${err?.message || String(err)}`);
    }
  };

  const handleProbeMempoolFees = async () => {
    setMempoolFeeError(null);
    setIsProbingMempoolFees(true);
    try {
      const result = await runMempoolFeeTierProbe(client);
      setMempoolFeeResult(result);
    } catch (err: unknown) {
      setMempoolFeeResult(null);
      setMempoolFeeError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsProbingMempoolFees(false);
    }
  };

  const handleRunSelfTest = () => {
    const res = runGoldenVectorSelfTest();
    setSelfTestSteps(res.steps);
  };

  return (
    <div className="flex flex-col gap-6" data-testid="wallet-contract-console">
      {/* Overview Card */}
      <div className="bg-surface rounded-xl border border-border p-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <h2 className="text-base font-semibold text-fg">
              HD Wallet & Wasmi Contract Interoperability
            </h2>
            <p className="text-xs text-muted">
              SLIP-0010 Ed25519 (Coin Type 3007), canonical KVNC/tx/v1 domain tag, and Wasmi ABI
            </p>
          </div>
          <span className="px-2.5 py-1 text-xs font-mono font-semibold rounded-full bg-gold/10 text-gold border border-gold/30">
            PRO-53 & PRO-48 Verified
          </span>
        </div>

        {/* Mnemonic Generation & Input */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <label htmlFor="mnemonic-input" className="text-xs font-semibold text-fg uppercase tracking-wider">
              BIP-39 Mnemonic Phrase (24 Words)
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleLoadGoldenMnemonic}
                className="px-2.5 py-1 text-xs bg-surface-2 hover:bg-border rounded border border-border text-muted hover:text-fg transition-colors"
              >
                Load Golden Vector
              </button>
              <button
                type="button"
                onClick={handleGenerateMnemonic}
                className="px-2.5 py-1 text-xs bg-gold/20 hover:bg-gold/30 rounded border border-gold/40 text-gold transition-colors font-medium"
              >
                Generate Fresh 24 Words
              </button>
            </div>
          </div>

          <textarea
            id="mnemonic-input"
            value={mnemonic}
            onChange={(e) => setMnemonic(e.target.value)}
            rows={2}
            className={`w-full bg-surface-2 border rounded-lg p-3 text-xs font-mono text-fg focus:outline-none ${
              isMnemonicValid ? "border-border focus:border-gold" : "border-red-500"
            }`}
            placeholder="enter 24 english words..."
          />

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span
              className={`font-medium ${
                isMnemonicValid ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {isMnemonicValid
                ? "✓ Valid 24-word BIP-39 mnemonic phrase"
                : "✗ Invalid mnemonic checksum or word count"}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-muted">Passphrase (optional):</span>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="empty"
                className="bg-surface-2 border border-border rounded px-2 py-0.5 text-xs font-mono text-fg"
              />
            </div>
          </div>
        </div>

        {/* Derived Accounts Display */}
        {accounts.length > 0 && (
          <div className="flex flex-col gap-3 mt-2">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
              Derived Multi-Account Hierarchy (SLIP-0010 Coin Type {KOVANICA_COIN_TYPE})
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {accounts.map((acc) => {
                const isActive = activeAccountIdx === acc.accountIndex;
                return (
                  <div
                    key={acc.accountIndex}
                    onClick={() => setActiveAccountIdx(acc.accountIndex)}
                    className={`cursor-pointer rounded-xl border p-4 flex flex-col gap-2 transition-all ${
                      isActive
                        ? "bg-surface-2 border-gold ring-1 ring-gold/40 shadow-sm"
                        : "bg-surface-2/60 border-border hover:border-muted"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-fg">
                        Account #{acc.accountIndex}
                      </span>
                      <span className="text-[11px] font-mono text-gold px-2 py-0.5 rounded bg-gold/10">
                        {acc.path}
                      </span>
                    </div>

                    <div className="flex flex-col gap-1 text-[11px]">
                      <span className="text-muted">Public Key (Ed25519):</span>
                      <span className="font-mono text-fg break-all bg-surface p-1.5 rounded border border-border/60">
                        {acc.publicKeyHex}
                      </span>
                    </div>

                    <div className="flex flex-col gap-1 text-[11px]">
                      <span className="text-muted">
                        Active Network Address (Chain {selectedChainId}):
                      </span>
                      <span className="font-mono text-emerald-400 break-all bg-surface p-1.5 rounded border border-border/60">
                        {acc.address}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-muted pt-1 border-t border-border/40">
                      <span>Mainnet: {acc.mainnetAddress.slice(0, 10)}...{acc.mainnetAddress.slice(-6)}</span>
                      <span>Testnet: {acc.testnetAddress.slice(0, 10)}...{acc.testnetAddress.slice(-6)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Transaction Signing & Wasmi Interop */}
      <div className="bg-surface rounded-xl border border-border p-6 flex flex-col gap-5">
        <h2 className="text-sm font-semibold text-fg border-b border-border pb-3">
          Construct & Sign Canonical Transaction
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              Transaction Action
            </label>
            <select
              value={txType}
              onChange={(e) => setTxType(e.target.value as any)}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-medium text-fg focus:outline-none focus:border-gold"
            >
              <option value="transfer">Native Transfer (KVNC)</option>
              <option value="token_transfer">Wasmi: Token Transfer (token_transfer)</option>
              <option value="vault_create">Wasmi: Timelocked Vault (vault_create)</option>
              <option value="name_register">Wasmi: Name Registry (name_register)</option>
              <option value="htlc_create">Wasmi: Hash Time Locked Contract (htlc_create)</option>
              <option value="nft_mint">Wasmi: NFT Mint (nft_mint)</option>
              <option value="escrow_create">Wasmi: Escrow Create (escrow_create)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              Account Nonce
            </label>
            <input
              type="number"
              value={nonceStr}
              onChange={(e) => setNonceStr(e.target.value)}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              Fee (atoms)
            </label>
            <input
              type="text"
              value={feeStr}
              onChange={(e) => setFeeStr(e.target.value)}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
            />
          </div>
        </div>

        {/* Dynamic Action Parameters */}
        <div className="bg-surface-2/60 p-4 rounded-lg border border-border/80 flex flex-col gap-3">
          {txType === "transfer" && (
            <>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  Recipient (Defaults to Account #1)
                </label>
                <input
                  type="text"
                  value={recipientInput}
                  onChange={(e) => setRecipientInput(e.target.value)}
                  placeholder={accounts[1]?.address || "Recipient kvnc/tknc address"}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  Amount (KVNC)
                </label>
                <input
                  type="text"
                  value={amountKvncStr}
                  onChange={(e) => setAmountKvncStr(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                />
              </div>
            </>
          )}

          {txType === "token_transfer" && (
            <>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  Token Contract Address (32-byte hex)
                </label>
                <input
                  type="text"
                  value={contractHex}
                  onChange={(e) => setContractHex(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  Token Units (u128)
                </label>
                <input
                  type="text"
                  value={tokenUnitsStr}
                  onChange={(e) => setTokenUnitsStr(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                />
              </div>
            </>
          )}

          {txType === "vault_create" && (
            <>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  Vault Contract Address (32-byte hex)
                </label>
                <input
                  type="text"
                  value={contractHex}
                  onChange={(e) => setContractHex(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Deposit Amount (KVNC)
                  </label>
                  <input
                    type="text"
                    value={amountKvncStr}
                    onChange={(e) => setAmountKvncStr(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Lock Until (ms timestamp)
                  </label>
                  <input
                    type="text"
                    value={lockUntilMsStr}
                    onChange={(e) => setLockUntilMsStr(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
              </div>
            </>
          )}

          {txType === "name_register" && (
            <>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  Name Registry Contract Address (32-byte hex)
                </label>
                <input
                  type="text"
                  value={contractHex}
                  onChange={(e) => setContractHex(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Registered Name
                  </label>
                  <input
                    type="text"
                    value={nameStr}
                    onChange={(e) => setNameStr(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Registered Public Key (32-byte hex)
                  </label>
                  <input
                    type="text"
                    value={namePubkeyHex}
                    onChange={(e) => setNamePubkeyHex(e.target.value)}
                    placeholder={accounts[1]?.publicKeyHex || "Defaults to Account #1"}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  Relay Endpoints (one URL per line)
                </label>
                <textarea
                  rows={2}
                  value={relayEndpointsStr}
                  onChange={(e) => setRelayEndpointsStr(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                />
              </div>
            </>
          )}

          {txType === "htlc_create" && (
            <>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  HTLC Contract Address (32-byte hex)
                </label>
                <input
                  type="text"
                  value={contractHex}
                  onChange={(e) => setContractHex(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  Hash Lock (32-byte hex)
                </label>
                <input
                  type="text"
                  value={hashlockHex}
                  onChange={(e) => setHashlockHex(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Timelock Expiry (u64 timestamp/height)
                  </label>
                  <input
                    type="text"
                    value={timelockStr}
                    onChange={(e) => setTimelockStr(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Recipient Public Key (32-byte hex)
                  </label>
                  <input
                    type="text"
                    value={htlcRecipientHex}
                    onChange={(e) => setHtlcRecipientHex(e.target.value)}
                    placeholder={accounts[1]?.publicKeyHex || "Defaults to Account #1"}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
              </div>
            </>
          )}

          {txType === "nft_mint" && (
            <>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  NFT Contract Address (32-byte hex)
                </label>
                <input
                  type="text"
                  value={contractHex}
                  onChange={(e) => setContractHex(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Collection Public Key (32-byte hex)
                  </label>
                  <input
                    type="text"
                    value={collectionHex}
                    onChange={(e) => setCollectionHex(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Recipient / To Public Key (32-byte hex)
                  </label>
                  <input
                    type="text"
                    value={nftToHex}
                    onChange={(e) => setNftToHex(e.target.value)}
                    placeholder={accounts[1]?.publicKeyHex || "Defaults to Account #1"}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Token ID (u128)
                  </label>
                  <input
                    type="text"
                    value={tokenIdStr}
                    onChange={(e) => setTokenIdStr(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-muted mb-1">
                    Token URI
                  </label>
                  <input
                    type="text"
                    value={tokenUriStr}
                    onChange={(e) => setTokenUriStr(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
              </div>
            </>
          )}

          {txType === "escrow_create" && (
            <>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  Escrow Contract Address (32-byte hex)
                </label>
                <input
                  type="text"
                  value={contractHex}
                  onChange={(e) => setContractHex(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  Parties Public Keys (32-byte hexes, one per line or comma-separated)
                </label>
                <textarea
                  rows={2}
                  value={escrowPartiesStr}
                  onChange={(e) => setEscrowPartiesStr(e.target.value)}
                  placeholder={
                    accounts.length >= 2
                      ? `${accounts[0].publicKeyHex}\n${accounts[1].publicKeyHex}`
                      : "Defaults to Account #0 and #1"
                  }
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Threshold (u8)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={255}
                    value={escrowThresholdStr}
                    onChange={(e) => setEscrowThresholdStr(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Amount (atoms)
                  </label>
                  <input
                    type="text"
                    value={escrowAmountStr}
                    onChange={(e) => setEscrowAmountStr(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Deadline (u64 timestamp)
                  </label>
                  <input
                    type="text"
                    value={escrowDeadlineStr}
                    onChange={(e) => setEscrowDeadlineStr(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSign}
            disabled={!isMnemonicValid}
            className="px-5 py-2.5 bg-gold hover:bg-gold/90 text-bg font-semibold rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            Sign & Bincode Serialize
          </button>

          {txType !== "transfer" && (
            <>
              <button
                type="button"
                data-testid="estimate-call-btn"
                onClick={handleEstimateCall}
                disabled={!isMnemonicValid || isEstimating}
                className="px-4 py-2.5 bg-surface-2 hover:bg-border text-fg font-medium rounded-lg text-xs border border-border transition-colors disabled:opacity-50"
              >
                {isEstimating ? "Estimating..." : "Estimate Fee & Nonce (SDK)"}
              </button>

              <button
                type="button"
                data-testid="queue-batch-call-btn"
                onClick={handleQueueToBatch}
                disabled={!isMnemonicValid}
                className="px-3.5 py-2.5 bg-surface-2 hover:bg-border text-fg font-medium rounded-lg text-xs border border-border transition-colors disabled:opacity-50"
              >
                Queue to Batch ({batchQueue.length})
              </button>

              <button
                type="button"
                data-testid="estimate-batch-btn"
                onClick={handleEstimateBatch}
                disabled={!isMnemonicValid || isEstimatingBatch}
                className="px-3.5 py-2.5 bg-gold/20 hover:bg-gold/30 text-gold font-semibold rounded-lg text-xs border border-gold/40 transition-colors disabled:opacity-50"
              >
                {isEstimatingBatch ? "Estimating Batch..." : "Estimate Batch"}
              </button>

              {batchQueue.length > 0 && (
                <button
                  type="button"
                  data-testid="clear-batch-btn"
                  onClick={handleClearBatch}
                  className="px-3 py-2.5 bg-surface-2 hover:bg-border text-muted hover:text-fg font-medium rounded-lg text-xs border border-border transition-colors"
                >
                  Clear Batch
                </button>
              )}

              <button
                type="button"
                data-testid="copy-curl-snippet-btn"
                onClick={handleExportCurlSnippet}
                disabled={!isMnemonicValid}
                className="px-3.5 py-2.5 bg-surface-2 hover:bg-border text-fg font-medium rounded-lg text-xs border border-border transition-colors disabled:opacity-50"
              >
                {copySuccess === "curl-snippet" ? "Copied cURL!" : "Copy JSON-RPC cURL"}
              </button>

              <button
                type="button"
                data-testid="copy-sdk-snippet-btn"
                onClick={handleExportSdkSnippet}
                disabled={!isMnemonicValid}
                className="px-3.5 py-2.5 bg-surface-2 hover:bg-border text-fg font-medium rounded-lg text-xs border border-border transition-colors disabled:opacity-50"
              >
                {copySuccess === "sdk-snippet" ? "Copied SDK!" : "Copy SDK Snippet"}
              </button>

              <button
                type="button"
                data-testid="export-batch-presets-btn"
                onClick={handleExportBatchPresets}
                disabled={!isMnemonicValid}
                className="px-3.5 py-2.5 bg-surface-2 hover:bg-border text-fg font-medium rounded-lg text-xs border border-border transition-colors disabled:opacity-50"
              >
                {copySuccess === "batch-presets" ? "Exported JSON!" : "Export Batch Presets JSON"}
              </button>

              <button
                type="button"
                data-testid="toggle-import-presets-btn"
                onClick={() => {
                  setShowPresetsPanel((prev) => !prev);
                  setPresetsErrorMsg(null);
                }}
                className="px-3.5 py-2.5 bg-surface-2 hover:bg-border text-fg font-medium rounded-lg text-xs border border-border transition-colors"
              >
                Import Presets JSON
              </button>
            </>
          )}
        </div>

        {showPresetsPanel && txType !== "transfer" && (
          <div
            data-testid="presets-json-panel"
            className="bg-surface-2 border border-border rounded-lg p-3.5 flex flex-col gap-2.5 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-fg">
                Batch Call Presets JSON (Export / Import)
              </span>
              <div className="flex items-center gap-3">
                {presetsJsonInput.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={() => copyToClipboard(presetsJsonInput, "batch-presets")}
                    className="text-gold hover:underline font-medium"
                  >
                    Copy JSON
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowPresetsPanel(false)}
                  className="text-muted hover:text-fg"
                >
                  Hide
                </button>
              </div>
            </div>
            <textarea
              data-testid="presets-json-input"
              rows={5}
              value={presetsJsonInput}
              onChange={(e) => setPresetsJsonInput(e.target.value)}
              placeholder='{"version": 1, "presets": [{"contractHex": "...", "method": "...", "argsHex": "...", "value": "0", "gasLimit": "100000"}]}'
              className="w-full bg-surface border border-border/60 rounded p-2.5 font-mono text-[11px] text-fg focus:outline-none focus:border-gold"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="import-presets-apply-btn"
                onClick={handleImportBatchPresets}
                className="px-3.5 py-1.5 bg-gold/20 hover:bg-gold/30 text-gold font-semibold rounded border border-gold/40 transition-colors"
              >
                Load Presets into Batch
              </button>
            </div>
            {presetsStatusMsg && (
              <div
                data-testid="presets-status-msg"
                className="text-xs font-mono text-emerald-400"
              >
                {presetsStatusMsg}
              </div>
            )}
            {presetsErrorMsg && (
              <div
                data-testid="presets-error-msg"
                className="text-xs font-mono text-red-300 bg-red-950/40 border border-red-800/60 rounded p-2"
              >
                {presetsErrorMsg}
              </div>
            )}
          </div>
        )}

        {activeCodeSnippet && txType !== "transfer" && (
          <div
            data-testid="code-exporter-preview"
            className="bg-surface-2 border border-border rounded-lg p-3 flex flex-col gap-2 text-xs"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-fg">
                {activeCodeSnippet.kind === "curl"
                  ? "JSON-RPC cURL Command (kovanica_call)"
                  : "TypeScript kovanica-sdk Snippet (estimateAndBuildCall + dryRunCall)"}
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    copyToClipboard(
                      activeCodeSnippet.code,
                      activeCodeSnippet.kind === "curl" ? "curl-snippet" : "sdk-snippet",
                    )
                  }
                  className="text-gold hover:underline font-medium"
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => setActiveCodeSnippet(null)}
                  className="text-muted hover:text-fg"
                >
                  Hide
                </button>
              </div>
            </div>
            <pre
              data-testid="code-exporter-snippet"
              className="bg-surface border border-border/60 rounded p-2.5 font-mono text-[11px] text-emerald-400 overflow-x-auto"
            >
              {activeCodeSnippet.code}
            </pre>
          </div>
        )}

        {(batchQueue.length > 0 || batchEstimateResult) && txType !== "transfer" && (
          <div
            data-testid="batch-estimator-panel"
            className="bg-surface-2/80 border border-gold/30 rounded-lg p-3.5 flex flex-col gap-2.5 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
              <span className="font-semibold text-fg">
                Multi-Call Batch Estimator ({batchEstimateResult ? batchEstimateResult.calls.length : batchQueue.length} Call{(batchEstimateResult ? batchEstimateResult.calls.length : batchQueue.length) === 1 ? "" : "s"})
              </span>
              {batchEstimateResult && (
                <div
                  data-testid="batch-estimate-totals"
                  className="font-mono flex flex-wrap gap-x-4 gap-y-1 text-muted"
                >
                  <span>
                    Total Size: <strong className="text-fg">{batchEstimateResult.totalEstimatedTxSize}B</strong>
                  </span>
                  <span>
                    Rate: <strong className="text-fg">{batchEstimateResult.feeRatePerByte.toString()} atoms/B</strong>
                  </span>
                  <span>
                    Total Fee (+20%): <strong className="text-gold">{batchEstimateResult.totalFee.toString()} atoms</strong>
                  </span>
                  <span>
                    Total Gas: <strong className="text-fg">{batchEstimateResult.totalGasLimit.toString()}</strong>
                  </span>
                  {batchEstimateResult.startNonce !== undefined && (
                    <span>
                      Start Nonce: <strong className="text-fg">{batchEstimateResult.startNonce.toString()}</strong>
                    </span>
                  )}
                </div>
              )}
            </div>

            {batchEstimateResult ? (
              <div className="flex flex-col gap-1.5 font-mono text-[11px]">
                {batchEstimateResult.calls.map((item: PreparedCallTransaction, idx: number) => (
                  <div
                    key={idx}
                    data-testid={`batch-call-row-${idx}`}
                    className="bg-surface border border-border/60 rounded px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2"
                  >
                    <span className="text-fg font-semibold">
                      #{idx + 1} {item.call.method}
                    </span>
                    <div className="flex flex-wrap gap-x-4 text-muted">
                      <span>
                        Nonce: <strong className="text-fg">{item.nonce !== undefined ? item.nonce.toString() : "—"}</strong>
                      </span>
                      <span>
                        Wire Size: <strong className="text-fg">{item.estimatedTxSize}B</strong>
                      </span>
                      <span>
                        Fee: <strong className="text-gold">{item.fee.toString()} atoms</strong>
                      </span>
                      <span>
                        Gas: <strong className="text-fg">{item.gasLimit.toString()}</strong>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 font-mono text-[11px] text-muted">
                {batchQueue.map((queued, idx) => (
                  <span
                    key={idx}
                    className="bg-surface border border-border/60 rounded px-2 py-1 text-fg"
                  >
                    #{idx + 1} {queued.method} ({bytesToHex(queued.args).slice(0, 12)}...)
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {preparedEstimate && (
          <div
            data-testid="prepared-estimate-summary"
            className="bg-surface-2/80 border border-gold/30 rounded-lg p-3 text-xs font-mono flex flex-wrap gap-x-5 gap-y-1 text-muted"
          >
            <span>
              Size: <strong className="text-fg">{preparedEstimate.estimatedTxSize}B</strong>
            </span>
            {preparedEstimate.feeRatePerByte !== undefined && (
              <span>
                Rate: <strong className="text-fg">{preparedEstimate.feeRatePerByte.toString()} atoms/B</strong>
              </span>
            )}
            <span>
              Fee (+20%): <strong className="text-gold">{preparedEstimate.fee.toString()} atoms</strong>
            </span>
            <span>
              Gas Limit: <strong className="text-fg">{preparedEstimate.gasLimit.toString()}</strong>
            </span>
            {preparedEstimate.nonce !== undefined && (
              <span>
                Nonce: <strong className="text-fg">{preparedEstimate.nonce.toString()}</strong>
              </span>
            )}
          </div>
        )}

        {errorMsg && (
          <div className="text-xs text-red-400 bg-red-950/40 p-3 rounded border border-red-800">
            {errorMsg}
          </div>
        )}

        {/* Signed Output Card */}
        {signedResult && (
          <div className="bg-surface-2 p-4 rounded-lg border border-border flex flex-col gap-3 text-xs">
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <span className="font-semibold text-fg">
                Signed Bincode Envelope ({signedResult.txSize} Bytes)
              </span>
              <span className="font-mono text-gold text-[11px]">Domain: KVNC/tx/v1</span>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-muted">Keyed BLAKE3 Sighash (32 bytes):</span>
              <span className="font-mono text-fg break-all bg-surface p-2 rounded">
                {signedResult.sighashHex}
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-muted">Ed25519 Signature (64 bytes):</span>
              <span className="font-mono text-fg break-all bg-surface p-2 rounded">
                {signedResult.signatureHex}
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-muted">Raw Wire Payload (Bincode Hex):</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(signedResult.rawTxHex, "tx")}
                  className="text-subtle hover:text-fg font-medium"
                >
                  {copySuccess === "tx" ? "Copied!" : "Copy Hex"}
                </button>
              </div>
              <textarea
                readOnly
                value={signedResult.rawTxHex}
                rows={3}
                className="w-full bg-surface p-2 rounded font-mono text-[11px] text-emerald-400 break-all resize-none border border-border/40"
              />
            </div>

            <div className="flex items-center gap-3 mt-2">
              <button
                type="button"
                onClick={handleBroadcast}
                className="px-4 py-1.5 bg-surface-2 hover:bg-border rounded border border-border text-fg font-medium text-xs transition-colors"
              >
                Broadcast to Connected Node (kovanica_sendRawTransaction)
              </button>
              {broadcastStatus && (
                <span className="text-xs text-muted font-mono">{broadcastStatus}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* SDK v0.4.0 Contract State Bincode Decoder & Live Storage Slot Fetch */}
      <div className="bg-surface rounded-xl border border-border p-6 flex flex-col gap-4" data-testid="bincode-decoder-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">
              Contract State Bincode Decoder (SDK v0.4.0)
            </h2>
            <p className="text-xs text-muted">
              Live Storage Slot Fetch (<code className="font-mono text-fg">kovanica_getStorageAt</code>), canonical BLAKE3 slot derivation, and typed Bincode 1.x decoding
            </p>
          </div>
          <span className="px-2 py-0.5 text-[11px] font-mono rounded bg-surface-2 border border-border text-gold">
            kovanica_getStorageAt
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label htmlFor="storage-contract-address" className="block text-xs font-medium text-muted mb-1">
              Contract Address (PRO-21 <code className="font-mono">kvnc...dag</code> / <code className="font-mono">tknc...dag</code> or 32-byte hex)
            </label>
            <input
              id="storage-contract-address"
              data-testid="storage-contract-address"
              type="text"
              value={storageContractAddr}
              onChange={(e) => setStorageContractAddr(e.target.value)}
              placeholder="kvnc...dag or 0x..."
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
            />
          </div>

          <div>
            <label htmlFor="decoder-kind-select" className="block text-xs font-medium text-muted mb-1">
              Contract Record Type & Typed Decoder
            </label>
            <select
              id="decoder-kind-select"
              data-testid="decoder-kind-select"
              value={decoderKind}
              onChange={(e) => setDecoderKind(e.target.value as ContractDecoderKind)}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
            >
              <option value="name">NameRecord — decodeNameRecord (kvnc/v1/name/)</option>
              <option value="htlc">HtlcRecord — decodeHtlcRecord (kvnc/v1/htlc/)</option>
              <option value="escrow">EscrowRecord — decodeEscrowRecord (kvnc/v1/escrow/)</option>
              <option value="vault">VaultRecord — decodeVaultRecord (kvnc/v1/vault/)</option>
              <option value="token_metadata">TokenMetadata — decodeTokenMetadata (kvnc/v1/state)</option>
              <option value="nft_metadata">NftMetadata — decodeNftMetadata (kvnc/v1/state)</option>
              <option value="multisig">MultisigState — decodeMultisigState (kvnc/v1/state)</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label htmlFor="decoder-custom-prefix" className="block text-xs font-medium text-muted mb-1">
              Custom Storage Prefix (optional override)
            </label>
            <input
              id="decoder-custom-prefix"
              data-testid="decoder-custom-prefix"
              type="text"
              value={customSlotPrefix}
              onChange={(e) => setCustomSlotPrefix(e.target.value)}
              placeholder="e.g. kvnc/v1/name/ (defaults to record prefix)"
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
            />
          </div>

          <div className="md:col-span-2 flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[180px]">
              <label htmlFor="decoder-slot-key" className="block text-xs font-medium text-muted mb-1">
                Storage Slot Key (name / 32-byte hex ID; ignored for singleton <code className="font-mono">kvnc/v1/state</code> unless custom prefix set)
              </label>
              <input
                id="decoder-slot-key"
                data-testid="decoder-slot-key"
                type="text"
                value={slotKeyInput}
                onChange={(e) => setSlotKeyInput(e.target.value)}
                placeholder="alice or 64-char hex ID"
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
            </div>
            <button
              type="button"
              data-testid="derive-slot-btn"
              onClick={handleDeriveSlot}
              className="px-3 py-2 bg-surface-2 hover:bg-border border border-border rounded-lg text-xs text-fg font-medium whitespace-nowrap transition-colors"
            >
              Derive Slot
            </button>
            <button
              type="button"
              data-testid="fetch-storage-slot-btn"
              onClick={handleFetchAndDecodeStorage}
              disabled={isFetchingStorage}
              className="px-3.5 py-2 bg-gold hover:bg-gold/90 text-bg rounded-lg text-xs font-semibold whitespace-nowrap transition-colors disabled:opacity-50"
            >
              {isFetchingStorage ? "Fetching Storage..." : "Live Fetch & Decode (kovanica_getStorageAt)"}
            </button>
          </div>
        </div>

        {derivedSlotHex && (
          <div
            data-testid="derived-slot-hex"
            className="bg-surface-2/80 border border-border rounded-lg px-3 py-2 text-xs font-mono text-emerald-400 break-all"
          >
            Derived BLAKE3 Slot (32B): 0x{derivedSlotHex}
          </div>
        )}

        <div>
          <label htmlFor="decoder-hex-input" className="block text-xs font-medium text-muted mb-1">
            Raw Storage Value (Hex)
          </label>
          <textarea
            id="decoder-hex-input"
            data-testid="decoder-hex-input"
            rows={2}
            value={decoderHexInput}
            onChange={(e) => setDecoderHexInput(e.target.value)}
            placeholder="0x..."
            className="w-full bg-surface-2 border border-border rounded-lg p-2.5 text-xs font-mono text-fg focus:outline-none focus:border-gold"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="decode-bincode-btn"
            onClick={handleDecodeState}
            className="px-4 py-2 bg-gold/20 hover:bg-gold/30 rounded-lg border border-gold/40 text-gold text-xs font-semibold transition-colors"
          >
            Decode Bincode State
          </button>
        </div>

        {storageEmptyMsg && (
          <div
            data-testid="storage-empty-msg"
            className="text-xs font-mono text-amber-300 bg-amber-950/30 border border-amber-800/50 rounded-lg p-3"
          >
            {storageEmptyMsg}
          </div>
        )}

        {decoderError && (
          <div
            data-testid="decoder-error-msg"
            className="text-xs font-mono text-red-300 bg-red-950/40 border border-red-800/60 rounded-lg p-3"
          >
            {decoderError}
          </div>
        )}

        {decodedOutput && (
          <pre
            data-testid="decoded-json-output"
            className="bg-surface-2 border border-border rounded-lg p-3 text-xs font-mono text-fg overflow-x-auto"
          >
            {decodedOutput}
          </pre>
        )}
      </div>

      {/* Transaction Receipt Poller & Log Decoder (`kovanica_getTransactionReceipt`) */}
      <div
        className="bg-surface rounded-xl border border-border p-6 flex flex-col gap-4"
        data-testid="receipt-poller-panel"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">
              Transaction Receipt Poller & Log Decoder (kovanica_getTransactionReceipt)
            </h2>
            <p className="text-xs text-muted">
              Poll <code className="font-mono text-fg">kovanica_getTransactionReceipt</code> until finalized and decode emitted Bincode 1.x log payloads
            </p>
          </div>
          <span className="px-2 py-0.5 text-[11px] font-mono rounded bg-surface-2 border border-border text-gold">
            kovanica_getTransactionReceipt
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="md:col-span-2">
            <label
              htmlFor="receipt-tx-hash-input"
              className="block text-xs font-medium text-muted mb-1"
            >
              Transaction Hash (32-byte hex)
            </label>
            <input
              id="receipt-tx-hash-input"
              data-testid="receipt-tx-hash-input"
              type="text"
              value={receiptTxHash}
              onChange={(e) => setReceiptTxHash(e.target.value)}
              placeholder="0x... (64 hex characters)"
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
            />
          </div>

          <div>
            <label
              htmlFor="receipt-decoder-kind-select"
              className="block text-xs font-medium text-muted mb-1"
            >
              Log Bincode Decoder Type (optional)
            </label>
            <select
              id="receipt-decoder-kind-select"
              data-testid="receipt-decoder-kind-select"
              value={receiptDecoderKind}
              onChange={(e) =>
                setReceiptDecoderKind(e.target.value as ContractDecoderKind | "")
              }
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
            >
              <option value="">None (Raw Hex Logs Only)</option>
              <option value="name">NameRecord — decodeNameRecord</option>
              <option value="htlc">HtlcRecord — decodeHtlcRecord</option>
              <option value="escrow">EscrowRecord — decodeEscrowRecord</option>
              <option value="vault">VaultRecord — decodeVaultRecord</option>
              <option value="token_metadata">TokenMetadata — decodeTokenMetadata</option>
              <option value="nft_metadata">NftMetadata — decodeNftMetadata</option>
              <option value="multisig">MultisigState — decodeMultisigState</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="poll-receipt-btn"
            disabled={isPollingReceipt}
            onClick={async () => {
              setReceiptPollError(null);
              setReceiptPollResult(null);
              setIsPollingReceipt(true);
              try {
                const res = await pollAndDecodeTransactionReceipt(client, {
                  txHash: receiptTxHash,
                  decoderKind: receiptDecoderKind || undefined,
                });
                setReceiptPollResult(res);
              } catch (err: unknown) {
                if (err instanceof KovanicaDecodeError) {
                  setReceiptPollError(`[${err.code}] ${err.message}`);
                } else {
                  setReceiptPollError(
                    err instanceof Error ? err.message : String(err),
                  );
                }
              } finally {
                setIsPollingReceipt(false);
              }
            }}
            className="px-4 py-2 bg-gold hover:bg-gold/90 text-bg rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {isPollingReceipt
              ? "Polling Receipt..."
              : "Fetch / Poll Receipt & Decode Logs"}
          </button>
        </div>

        {receiptPollError && (
          <div
            data-testid="receipt-poller-error"
            className="text-xs font-mono text-red-300 bg-red-950/40 border border-red-800/60 rounded-lg p-3"
          >
            {receiptPollError}
          </div>
        )}

        {receiptPollResult && (
          <div
            data-testid="receipt-poller-result"
            className="flex flex-col gap-3 text-xs"
          >
            <div
              data-testid="receipt-poller-summary"
              className="bg-surface-2/80 border border-border rounded-lg p-3 font-mono flex flex-wrap items-center gap-x-5 gap-y-1.5 text-muted"
            >
              <span>
                Status:{" "}
                <strong
                  data-testid="receipt-status-badge"
                  className={
                    receiptPollResult.status === "success"
                      ? "text-emerald-400"
                      : "text-red-400"
                  }
                >
                  {receiptPollResult.status}
                </strong>
              </span>
              <span>
                Gas Used:{" "}
                <strong data-testid="receipt-gas-used" className="text-fg">
                  {receiptPollResult.gasUsed.toString()}
                </strong>
              </span>
              <span>
                Block Hash:{" "}
                <strong
                  data-testid="receipt-block-hash"
                  className="text-fg break-all"
                >
                  {receiptPollResult.blockHash || "—"}
                </strong>
              </span>
              <span>
                Decoded Logs:{" "}
                <strong className="text-gold">
                  {receiptPollResult.decodedLogs.length}
                </strong>
              </span>
            </div>

            {receiptPollResult.decodedLogs.length > 0 && (
              <pre
                data-testid="receipt-decoded-logs"
                className="bg-surface-2 border border-border rounded-lg p-3 text-xs font-mono text-fg overflow-x-auto"
              >
                {JSON.stringify(
                  receiptPollResult.decodedLogs,
                  (_key, value) =>
                    typeof value === "bigint" ? value.toString() : value,
                  2,
                )}
              </pre>
            )}

            {receiptPollResult.decodeErrors.length > 0 && (
              <div
                data-testid="receipt-decode-errors"
                className="text-xs font-mono text-amber-300 bg-amber-950/30 border border-amber-800/50 rounded-lg p-3"
              >
                {receiptPollResult.decodeErrors.map((e) => (
                  <div key={e.logIndex}>
                    Log #{e.logIndex} ({e.decoderKind}): {e.error}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* JSON-RPC 2.0 Batch Read Runner */}
      <div
        className="bg-surface rounded-xl border border-border p-6 flex flex-col gap-4"
        data-testid="jsonrpc-batch-runner-panel"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">
              JSON-RPC 2.0 Batch Read Runner (Single HTTP POST)
            </h2>
            <p className="text-xs text-muted">
              Bundle 1..{MAX_JSONRPC_BATCH_SIZE} allowlisted read-only RPC calls into one{" "}
              <code className="font-mono text-fg">client.callBatch</code> round-trip with per-item error isolation
            </p>
          </div>
          <span className="px-2 py-0.5 text-[11px] font-mono rounded bg-surface-2 border border-border text-gold">
            max {MAX_JSONRPC_BATCH_SIZE} / batch
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="rpc-batch-preset-chain"
            onClick={() => {
              setRpcBatchInput(JSON.stringify(DEFAULT_JSONRPC_READ_BATCH_PRESET, null, 2));
              setRpcBatchError(null);
            }}
            className="px-2.5 py-1 text-xs bg-surface-2 hover:bg-border rounded border border-border text-muted hover:text-fg transition-colors"
          >
            Chain Snapshot (chainId + blockNumber + estimateFee)
          </button>
          <button
            type="button"
            data-testid="rpc-batch-preset-health"
            onClick={() => {
              const healthPreset: JsonRpcBatchRequestItem[] = [
                { method: "kovanica_chainId", params: [] },
                { method: "kovanica_syncStatus", params: [] },
                { method: "kovanica_getMiningInfo", params: [] },
                { method: "kovanica_getDagTips", params: [] },
              ];
              setRpcBatchInput(JSON.stringify(healthPreset, null, 2));
              setRpcBatchError(null);
            }}
            className="px-2.5 py-1 text-xs bg-surface-2 hover:bg-border rounded border border-border text-muted hover:text-fg transition-colors"
          >
            Node Health (chainId + syncStatus + miningInfo + dagTips)
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="jsonrpc-batch-input"
            className="block text-xs font-medium text-muted"
          >
            Batch Requests JSON Array (Read-Only Methods Only)
          </label>
          <textarea
            id="jsonrpc-batch-input"
            data-testid="jsonrpc-batch-input"
            rows={5}
            value={rpcBatchInput}
            onChange={(e) => setRpcBatchInput(e.target.value)}
            className="w-full bg-surface-2 border border-border rounded-lg p-3 text-xs font-mono text-fg focus:outline-none focus:border-gold"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="run-jsonrpc-batch-btn"
            disabled={isRunningRpcBatch}
            onClick={async () => {
              setRpcBatchError(null);
              setRpcBatchSummary(null);
              setIsRunningRpcBatch(true);
              try {
                let parsed: unknown;
                try {
                  parsed = JSON.parse(rpcBatchInput);
                } catch (parseErr: unknown) {
                  throw new KovanicaDecodeError(
                    "INVALID_INPUT",
                    `Malformed batch JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
                    { field: "requests" },
                  );
                }
                const summary = await executeJsonRpcReadBatch(
                  client,
                  parsed as JsonRpcBatchRequestItem[],
                );
                setRpcBatchSummary(summary);
              } catch (err: unknown) {
                if (err instanceof KovanicaDecodeError) {
                  setRpcBatchError(`[${err.code}] ${err.message}`);
                } else {
                  setRpcBatchError(err instanceof Error ? err.message : String(err));
                }
              } finally {
                setIsRunningRpcBatch(false);
              }
            }}
            className="px-4 py-2 bg-gold hover:bg-gold/90 text-bg rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {isRunningRpcBatch
              ? "Running Batch..."
              : "Run JSON-RPC Batch (Single HTTP POST)"}
          </button>
        </div>

        {rpcBatchError && (
          <div
            data-testid="jsonrpc-batch-error"
            className="text-xs font-mono text-red-300 bg-red-950/40 border border-red-800/60 rounded-lg p-3"
          >
            {rpcBatchError}
          </div>
        )}

        {rpcBatchSummary && (
          <div
            data-testid="jsonrpc-batch-result"
            className="flex flex-col gap-3 text-xs"
          >
            <div className="bg-surface-2/80 border border-border rounded-lg p-3 font-mono flex flex-wrap items-center gap-x-5 gap-y-1.5 text-muted">
              <span>
                Total: <strong className="text-fg">{rpcBatchSummary.totalRequests}</strong>
              </span>
              <span>
                OK: <strong className="text-emerald-400">{rpcBatchSummary.succeededCount}</strong>
              </span>
              <span>
                Failed: <strong className="text-red-400">{rpcBatchSummary.failedCount}</strong>
              </span>
              <span>
                Elapsed: <strong className="text-gold">{rpcBatchSummary.elapsedMs} ms</strong>
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {rpcBatchSummary.items.map((item) => (
                <div
                  key={item.index}
                  className={`p-3 rounded-lg border font-mono text-xs flex flex-col gap-1.5 ${
                    item.ok
                      ? "bg-surface-2 border-border text-fg"
                      : "bg-red-950/30 border-red-800/50 text-red-200"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">
                      #{item.index + 1} {item.method}
                    </span>
                    <span
                      className={`text-[11px] uppercase font-bold ${
                        item.ok ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {item.ok ? "OK" : "ERROR"}
                    </span>
                  </div>
                  <pre className="text-[11px] overflow-x-auto text-muted">
                    {JSON.stringify(
                      item.ok ? item.result : item.error,
                      (_key, value) =>
                        typeof value === "bigint" ? value.toString() : value,
                      2,
                    )}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Typed Contract Facades Studio */}
      <div
        className="bg-surface rounded-xl border border-border p-6 flex flex-col gap-4"
        data-testid="typed-facades-studio-panel"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">
              Typed Contract Facades Studio (7 Canonical Clients)
            </h2>
            <p className="text-xs text-muted">
              Invoke <code className="font-mono text-fg">runTypedFacadeRead</code> across NameRegistry, Token, NFT, Escrow, HTLC, Vault, and Multisig SDK clients
            </p>
          </div>
          <span className="px-2 py-0.5 text-[11px] font-mono rounded bg-surface-2 border border-border text-gold">
            7 SDK Facades
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <label
              htmlFor="facade-kind-select"
              className="block text-xs font-medium text-muted mb-1"
            >
              Contract Facade
            </label>
            <select
              id="facade-kind-select"
              data-testid="facade-kind-select"
              value={facadeKind}
              onChange={(e) => {
                setFacadeKind(e.target.value as TypedFacadeKind);
                setFacadeReadResult(null);
                setFacadeReadError(null);
              }}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
            >
              <option value="name">name — NameRegistryClient.getRecord</option>
              <option value="token">token — TokenClient.getMetadata</option>
              <option value="nft">nft — NftClient.getMetadata</option>
              <option value="escrow">escrow — EscrowClient.getEscrow</option>
              <option value="htlc">htlc — HtlcClient.getHtlc</option>
              <option value="vault">vault — VaultClient.getVault</option>
              <option value="multisig">multisig — MultisigClient.getState</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="facade-contract-input"
              className="block text-xs font-medium text-muted mb-1"
            >
              Contract Address (PRO-21 or 32-byte hex)
            </label>
            <input
              id="facade-contract-input"
              data-testid="facade-contract-input"
              type="text"
              value={facadeContractInput}
              onChange={(e) => setFacadeContractInput(e.target.value)}
              placeholder="0x... or kvnc..."
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
            />
          </div>

          <div>
            <label
              htmlFor="facade-key-input"
              className="block text-xs font-medium text-muted mb-1"
            >
              Record Key{" "}
              {facadeKind === "token" || facadeKind === "nft" || facadeKind === "multisig"
                ? "(singleton — not required)"
                : facadeKind === "name"
                  ? "(name string)"
                  : "(32-byte ID hex)"}
            </label>
            <input
              id="facade-key-input"
              data-testid="facade-key-input"
              type="text"
              value={facadeKeyInput}
              onChange={(e) => setFacadeKeyInput(e.target.value)}
              disabled={
                facadeKind === "token" || facadeKind === "nft" || facadeKind === "multisig"
              }
              placeholder={
                facadeKind === "name"
                  ? "alice"
                  : facadeKind === "token" || facadeKind === "nft" || facadeKind === "multisig"
                    ? "Singleton state"
                    : "0x... (64 hex chars)"
              }
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold disabled:opacity-50"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="run-facade-read-btn"
            disabled={isReadingFacade}
            onClick={async () => {
              setFacadeReadError(null);
              setFacadeReadResult(null);
              setIsReadingFacade(true);
              try {
                const res = await runTypedFacadeRead(client, {
                  facade: facadeKind,
                  contract: facadeContractInput,
                  key:
                    facadeKind === "token" ||
                    facadeKind === "nft" ||
                    facadeKind === "multisig"
                      ? undefined
                      : facadeKeyInput,
                });
                setFacadeReadResult(res);
              } catch (err: unknown) {
                if (err instanceof KovanicaDecodeError) {
                  setFacadeReadError(`[${err.code}] ${err.message}`);
                } else {
                  setFacadeReadError(err instanceof Error ? err.message : String(err));
                }
              } finally {
                setIsReadingFacade(false);
              }
            }}
            className="px-4 py-2 bg-gold hover:bg-gold/90 text-bg rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {isReadingFacade ? "Reading Facade..." : "Run Typed Facade Read"}
          </button>
        </div>

        {facadeReadError && (
          <div
            data-testid="facade-read-error"
            className="text-xs font-mono text-red-300 bg-red-950/40 border border-red-800/60 rounded-lg p-3"
          >
            {facadeReadError}
          </div>
        )}

        {facadeReadResult && (
          <div
            data-testid="facade-read-result"
            className="flex flex-col gap-2 text-xs"
          >
            <div className="bg-surface-2/80 border border-border rounded-lg p-3 font-mono flex flex-wrap items-center gap-x-5 gap-y-1 text-muted">
              <span>
                Method: <strong className="text-gold">{facadeReadResult.method}</strong>
              </span>
              <span>
                Status:{" "}
                <strong
                  className={
                    facadeReadResult.found ? "text-emerald-400" : "text-amber-300"
                  }
                >
                  {facadeReadResult.found ? "found" : "empty (null)"}
                </strong>
              </span>
            </div>
            <pre
              data-testid="facade-read-json"
              className="bg-surface-2 border border-border rounded-lg p-3 text-xs font-mono text-fg overflow-x-auto"
            >
              {JSON.stringify(
                facadeReadResult.record,
                (_key, value) =>
                  typeof value === "bigint" ? value.toString() : value,
                2,
              )}
            </pre>
          </div>
        )}
      </div>

      {/* Contract Log History & Failover RPC Panel */}
      <div
        className="bg-surface rounded-xl border border-border p-6 flex flex-col gap-5"
        data-testid="log-history-panel"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">
              Contract Log History &amp; Failover RPC
            </h2>
            <p className="text-xs text-muted">
              Query chunked <code className="font-mono text-fg">kovanica_getLogs</code> history with optional Bincode decoding and probe multi-endpoint RPC failover
            </p>
          </div>
          <span className="px-2 py-0.5 text-[11px] font-mono rounded bg-surface-2 border border-border text-gold">
            Chunked Logs + Failover
          </span>
        </div>

        {/* Chunked Contract Log History Explorer */}
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
            Contract Log History Explorer
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <div>
              <label
                htmlFor="log-from-block-input"
                className="block text-xs font-medium text-muted mb-1"
              >
                From Block
              </label>
              <input
                id="log-from-block-input"
                data-testid="log-from-block-input"
                type="text"
                value={logFromBlockStr}
                onChange={(e) => setLogFromBlockStr(e.target.value)}
                placeholder="0"
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
            </div>

            <div>
              <label
                htmlFor="log-to-block-input"
                className="block text-xs font-medium text-muted mb-1"
              >
                To Block
              </label>
              <input
                id="log-to-block-input"
                data-testid="log-to-block-input"
                type="text"
                value={logToBlockStr}
                onChange={(e) => setLogToBlockStr(e.target.value)}
                placeholder="1000"
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
            </div>

            <div>
              <label
                htmlFor="log-chunk-size-input"
                className="block text-xs font-medium text-muted mb-1"
              >
                Chunk Size
              </label>
              <input
                id="log-chunk-size-input"
                data-testid="log-chunk-size-input"
                type="number"
                min={1}
                value={logChunkSizeStr}
                onChange={(e) => setLogChunkSizeStr(e.target.value)}
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
            </div>

            <div>
              <label
                htmlFor="log-address-input"
                className="block text-xs font-medium text-muted mb-1"
              >
                Contract Address (optional)
              </label>
              <input
                id="log-address-input"
                data-testid="log-address-input"
                type="text"
                value={logAddressInput}
                onChange={(e) => setLogAddressInput(e.target.value)}
                placeholder="0x... or kvnc..."
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
            </div>

            <div>
              <label
                htmlFor="log-decoder-select"
                className="block text-xs font-medium text-muted mb-1"
              >
                Bincode Decoder (optional)
              </label>
              <select
                id="log-decoder-select"
                data-testid="log-decoder-select"
                value={logDecoderKind}
                onChange={(e) => setLogDecoderKind(e.target.value as ContractLogKind | "")}
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              >
                <option value="">Raw logs only</option>
                <option value="name">name</option>
                <option value="htlc">htlc</option>
                <option value="escrow">escrow</option>
                <option value="vault">vault</option>
                <option value="token_metadata">token_metadata</option>
                <option value="token_pool">token_pool</option>
                <option value="nft_metadata">nft_metadata</option>
                <option value="multisig_state">multisig_state</option>
                <option value="multisig_tx">multisig_tx</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="run-log-history-btn"
              disabled={isQueryingLogs}
              onClick={async () => {
                setLogHistoryError(null);
                setLogHistoryResult(null);
                setIsQueryingLogs(true);
                try {
                  const parsedChunk = Number.parseInt(logChunkSizeStr.trim(), 10);
                  const res = await runContractLogHistoryQuery(client, {
                    fromBlock: logFromBlockStr,
                    toBlock: logToBlockStr,
                    address: logAddressInput.trim() || undefined,
                    decoderKind: logDecoderKind || undefined,
                    chunkSize: Number.isFinite(parsedChunk) ? parsedChunk : undefined,
                  });
                  setLogHistoryResult(res);
                } catch (err: unknown) {
                  if (err instanceof KovanicaDecodeError) {
                    setLogHistoryError(`[${err.code}] ${err.message}`);
                  } else {
                    setLogHistoryError(err instanceof Error ? err.message : String(err));
                  }
                } finally {
                  setIsQueryingLogs(false);
                }
              }}
              className="px-4 py-2 bg-gold hover:bg-gold/90 text-bg rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
            >
              {isQueryingLogs ? "Querying Logs..." : "Query Log History"}
            </button>
          </div>

          {logHistoryError && (
            <div
              data-testid="log-history-error"
              className="text-xs font-mono text-red-300 bg-red-950/40 border border-red-800/60 rounded-lg p-3"
            >
              {logHistoryError}
            </div>
          )}

          {logHistoryResult && (
            <div data-testid="log-history-result" className="flex flex-col gap-2 text-xs">
              <div className="bg-surface-2/80 border border-border rounded-lg p-3 font-mono flex flex-wrap items-center gap-x-5 gap-y-1 text-muted">
                <span>
                  Range: <strong className="text-fg">{logHistoryResult.fromBlock}..{logHistoryResult.toBlock}</strong>
                </span>
                <span>
                  Chunks: <strong className="text-gold">{logHistoryResult.chunksQueried}</strong>
                </span>
                <span>
                  Logs: <strong className="text-fg">{logHistoryResult.totalLogs}</strong>
                </span>
                <span>
                  Decoded: <strong className="text-emerald-400">{logHistoryResult.decodedCount}</strong>
                </span>
              </div>
              <pre
                data-testid="log-history-json"
                className="bg-surface-2 border border-border rounded-lg p-3 text-xs font-mono text-fg overflow-x-auto max-h-72"
              >
                {JSON.stringify(logHistoryResult, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Multi-Endpoint Failover RPC Probe */}
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
            Failover RPC Endpoint Probe
          </h3>
          <div>
            <label
              htmlFor="failover-urls-input"
              className="block text-xs font-medium text-muted mb-1"
            >
              RPC Endpoints (comma or newline separated, primary first)
            </label>
            <textarea
              id="failover-urls-input"
              data-testid="failover-urls-input"
              rows={3}
              value={failoverUrlsInput}
              onChange={(e) => setFailoverUrlsInput(e.target.value)}
              placeholder={"https://primary-rpc.example/rpc\nhttps://secondary-rpc.example/rpc"}
              className="w-full bg-surface-2 border border-border rounded-lg p-3 text-xs font-mono text-fg focus:outline-none focus:border-gold"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="run-failover-probe-btn"
              disabled={isProbingFailover}
              onClick={async () => {
                setIsProbingFailover(true);
                setFailoverProbeResult(null);
                try {
                  const res = await probeFailoverRpcEndpoints(failoverUrlsInput);
                  setFailoverProbeResult(res);
                } finally {
                  setIsProbingFailover(false);
                }
              }}
              className="px-4 py-2 bg-gold/20 hover:bg-gold/30 rounded-lg border border-gold/40 text-gold text-xs font-semibold transition-colors disabled:opacity-50"
            >
              {isProbingFailover ? "Probing Endpoints..." : "Probe Failover Endpoints"}
            </button>
          </div>

          {failoverProbeResult && (
            <div data-testid="failover-probe-result" className="flex flex-col gap-2 text-xs">
              <div className="bg-surface-2/80 border border-border rounded-lg p-3 font-mono flex flex-wrap items-center gap-x-5 gap-y-1 text-muted">
                <span>
                  Status:{" "}
                  <strong
                    className={
                      failoverProbeResult.ok ? "text-emerald-400" : "text-red-400"
                    }
                  >
                    {failoverProbeResult.ok ? "OK" : "FAILED"}
                  </strong>
                </span>
                {failoverProbeResult.chainId !== undefined && (
                  <span>
                    Chain ID: <strong className="text-fg">{failoverProbeResult.chainId}</strong>
                  </span>
                )}
                {failoverProbeResult.blockNumber !== undefined && (
                  <span>
                    Block: <strong className="text-gold">{failoverProbeResult.blockNumber}</strong>
                  </span>
                )}
                <span>
                  Failovers: <strong className="text-fg">{failoverProbeResult.failoverEvents.length}</strong>
                </span>
              </div>

              {failoverProbeResult.error && (
                <div className="text-xs font-mono text-red-300 bg-red-950/40 border border-red-800/60 rounded-lg p-3">
                  {failoverProbeResult.error}
                </div>
              )}

              {failoverProbeResult.activeEndpoints.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {failoverProbeResult.activeEndpoints.map((ep, idx) => (
                    <div
                      key={`${ep.url}-${idx}`}
                      className="bg-surface-2 border border-border rounded-lg px-3 py-2 font-mono flex flex-wrap items-center justify-between gap-2"
                    >
                      <span className="text-fg break-all">{ep.url}</span>
                      <div className="flex items-center gap-3 text-[11px]">
                        <span
                          className={
                            ep.healthy ? "text-emerald-400" : "text-red-400"
                          }
                        >
                          {ep.state} ({ep.healthy ? "healthy" : "cooldown"})
                        </span>
                        <span className="text-muted">
                          ok:{ep.totalSuccesses} err:{ep.totalFailures}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Raw Wire Tx Decoder & Node Capability Probe Panel */}
      <div
        className="bg-surface rounded-xl border border-border p-6 flex flex-col gap-5"
        data-testid="raw-tx-and-probe-panel"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">
              Raw Wire Tx Decoder &amp; Node Capability Probe
            </h2>
            <p className="text-xs text-muted">
              Decode signed Call transactions offline with RFC 8032 Ed25519 verification and probe any RPC endpoint for network-tag headers, batch support, and latency
            </p>
          </div>
          <span className="px-2 py-0.5 text-[11px] font-mono rounded bg-surface-2 border border-border text-gold">
            Offline Decode + RPC Probe
          </span>
        </div>

        {/* Offline Raw Wire Tx Decoder */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
              Offline Raw Wire Tx Decoder
            </h3>
            {signedResult?.rawTxHex && (
              <button
                type="button"
                data-testid="load-signed-raw-tx-btn"
                onClick={() => {
                  setRawTxHexInput(signedResult.rawTxHex);
                  setRawTxChainIdStr(String(selectedChainId));
                  setRawTxInspectError(null);
                }}
                className="px-2.5 py-1 text-xs bg-surface-2 hover:bg-border rounded border border-border text-muted hover:text-fg transition-colors"
              >
                Load Last Signed Tx
              </button>
            )}
          </div>

          <textarea
            id="raw-tx-hex-input"
            data-testid="raw-tx-hex-input"
            rows={3}
            value={rawTxHexInput}
            onChange={(e) => setRawTxHexInput(e.target.value)}
            placeholder="Paste raw signed Call transaction hex (0x... or bare hex)..."
            className="w-full bg-surface-2 border border-border rounded-lg p-3 text-xs font-mono text-fg focus:outline-none focus:border-gold"
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div>
              <label
                htmlFor="raw-tx-chain-id-input"
                className="block text-xs font-medium text-muted mb-1"
              >
                Chain ID (for sighash)
              </label>
              <input
                id="raw-tx-chain-id-input"
                data-testid="raw-tx-chain-id-input"
                type="number"
                min={0}
                value={rawTxChainIdStr}
                onChange={(e) => setRawTxChainIdStr(e.target.value)}
                placeholder={String(selectedChainId)}
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
            </div>

            <div className="md:col-span-2">
              <label
                htmlFor="raw-tx-pubkey-input"
                className="block text-xs font-medium text-muted mb-1"
              >
                Signer Public Key Hex Override (optional, defaults to tx sender)
              </label>
              <input
                id="raw-tx-pubkey-input"
                data-testid="raw-tx-pubkey-input"
                type="text"
                value={rawTxPubkeyHex}
                onChange={(e) => setRawTxPubkeyHex(e.target.value)}
                placeholder="64-char hex pubkey (optional)"
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="decode-raw-tx-btn"
              onClick={() => {
                setRawTxInspectError(null);
                setInspectedRawTx(null);
                try {
                  const trimmedChain = rawTxChainIdStr.trim();
                  const parsedChainId =
                    trimmedChain.length > 0 ? BigInt(trimmedChain) : BigInt(selectedChainId);
                  const inspected = inspectRawSignedCallTx(rawTxHexInput, {
                    chainId: parsedChainId,
                    publicKeyHex: rawTxPubkeyHex.trim() || undefined,
                  });
                  setInspectedRawTx(inspected);
                } catch (err: unknown) {
                  if (err instanceof KovanicaDecodeError) {
                    setRawTxInspectError(`[${err.code}] ${err.message}`);
                  } else {
                    setRawTxInspectError(err instanceof Error ? err.message : String(err));
                  }
                }
              }}
              className="px-4 py-2 bg-gold hover:bg-gold/90 text-bg rounded-lg text-xs font-semibold transition-colors"
            >
              Decode &amp; Verify Tx
            </button>
          </div>

          {rawTxInspectError && (
            <div
              data-testid="raw-tx-decode-error"
              className="text-xs font-mono text-red-300 bg-red-950/40 border border-red-800/60 rounded-lg p-3"
            >
              {rawTxInspectError}
            </div>
          )}

          {inspectedRawTx && (
            <div data-testid="raw-tx-decode-result" className="flex flex-col gap-2 text-xs">
              <div className="bg-surface-2/80 border border-border rounded-lg p-3 font-mono flex flex-wrap items-center gap-x-5 gap-y-1 text-muted">
                <span>
                  Signature:{" "}
                  <strong
                    data-testid="raw-tx-sig-status"
                    className={
                      inspectedRawTx.signatureValid ? "text-emerald-400" : "text-red-400"
                    }
                  >
                    {inspectedRawTx.signatureValid ? "VALID" : "INVALID"}
                  </strong>
                </span>
                <span>
                  Method: <strong className="text-gold">{inspectedRawTx.method}</strong>
                </span>
                <span>
                  Nonce: <strong className="text-fg">{inspectedRawTx.nonce}</strong>
                </span>
                <span>
                  Fee: <strong className="text-fg">{inspectedRawTx.fee}</strong>
                </span>
                <span>
                  Size: <strong className="text-fg">{inspectedRawTx.wireSizeBytes}B</strong>
                </span>
              </div>
              <pre
                data-testid="raw-tx-decode-json"
                className="bg-surface-2 border border-border rounded-lg p-3 text-xs font-mono text-fg overflow-x-auto max-h-72"
              >
                {JSON.stringify(inspectedRawTx, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* RPC Node Capability Probe */}
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
            RPC Node Capability Probe
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div className="md:col-span-2">
              <label
                htmlFor="node-probe-url-input"
                className="block text-xs font-medium text-muted mb-1"
              >
                Target RPC Endpoint URL
              </label>
              <input
                id="node-probe-url-input"
                data-testid="node-probe-url-input"
                type="text"
                value={nodeProbeUrlInput}
                onChange={(e) => setNodeProbeUrlInput(e.target.value)}
                placeholder="http://127.0.0.1:8545/rpc"
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
            </div>

            <div>
              <label
                htmlFor="node-probe-expected-chain-input"
                className="block text-xs font-medium text-muted mb-1"
              >
                Expected Chain ID (optional)
              </label>
              <input
                id="node-probe-expected-chain-input"
                data-testid="node-probe-expected-chain-input"
                type="number"
                min={0}
                value={nodeProbeExpectedChainStr}
                onChange={(e) => setNodeProbeExpectedChainStr(e.target.value)}
                placeholder="any"
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="run-node-probe-btn"
              disabled={isProbingNode}
              onClick={async () => {
                setIsProbingNode(true);
                setNodeProbeResult(null);
                try {
                  const trimmedExpected = nodeProbeExpectedChainStr.trim();
                  const expectedChainId =
                    trimmedExpected.length > 0 ? BigInt(trimmedExpected) : undefined;
                  const res = await runNodeCapabilityProbe(nodeProbeUrlInput.trim(), {
                    ...(expectedChainId !== undefined ? { expectedChainId } : {}),
                  });
                  setNodeProbeResult(res);
                } catch (err: unknown) {
                  setNodeProbeResult({
                    ok: false,
                    url: nodeProbeUrlInput.trim(),
                    batchSupported: false,
                    canonicalTagMatch: null,
                    latencyMs: 0,
                    error: err instanceof Error ? err.message : String(err),
                  });
                } finally {
                  setIsProbingNode(false);
                }
              }}
              className="px-4 py-2 bg-gold/20 hover:bg-gold/30 rounded-lg border border-gold/40 text-gold text-xs font-semibold transition-colors disabled:opacity-50"
            >
              {isProbingNode ? "Probing Node..." : "Probe Node Capabilities"}
            </button>
          </div>

          {nodeProbeResult && (
            <div data-testid="node-probe-result" className="flex flex-col gap-2 text-xs">
              <div className="bg-surface-2/80 border border-border rounded-lg p-3 font-mono flex flex-wrap items-center gap-x-5 gap-y-1 text-muted">
                <span>
                  Status:{" "}
                  <strong
                    className={
                      nodeProbeResult.ok ? "text-emerald-400" : "text-red-400"
                    }
                  >
                    {nodeProbeResult.ok ? "OK" : "FAILED"}
                  </strong>
                </span>
                <span>
                  Network Tag:{" "}
                  <strong className="text-fg">
                    {nodeProbeResult.networkTag ?? "—"}
                  </strong>
                  {nodeProbeResult.canonicalTagMatch !== null && (
                    <span
                      className={
                        nodeProbeResult.canonicalTagMatch
                          ? " text-emerald-400"
                          : " text-red-400"
                      }
                    >
                      {" "}
                      ({nodeProbeResult.canonicalTagMatch ? "canonical" : "mismatch"})
                    </span>
                  )}
                </span>
                <span>
                  RPC Version:{" "}
                  <strong className="text-fg">
                    {nodeProbeResult.rpcVersion ?? "—"}
                  </strong>
                </span>
                <span>
                  Batch:{" "}
                  <strong
                    className={
                      nodeProbeResult.batchSupported ? "text-emerald-400" : "text-amber-400"
                    }
                  >
                    {nodeProbeResult.batchSupported ? "Supported" : "Unsupported"}
                  </strong>
                </span>
                <span>
                  Latency:{" "}
                  <strong className="text-gold">{nodeProbeResult.latencyMs} ms</strong>
                </span>
              </div>

              {nodeProbeResult.error && (
                <div className="text-xs font-mono text-red-300 bg-red-950/40 border border-red-800/60 rounded-lg p-3">
                  {nodeProbeResult.error}
                </div>
              )}

              <pre
                data-testid="node-probe-json"
                className="bg-surface-2 border border-border rounded-lg p-3 text-xs font-mono text-fg overflow-x-auto max-h-72"
              >
                {JSON.stringify(nodeProbeResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* Address Inspector & Transfer Tx Verifier Panel */}
      <div
        className="bg-surface rounded-xl border border-border p-6 flex flex-col gap-5"
        data-testid="address-and-transfer-panel"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">
              Address Inspector &amp; Transfer Tx Verifier
            </h2>
            <p className="text-xs text-muted">
              Inspect PRO-21 (kvnc...dag / tknc...dag) or legacy 64-hex addresses against Chain 1/2/3 policy and verify raw signed Transfer transactions offline
            </p>
          </div>
          <span className="px-2 py-0.5 text-[11px] font-mono rounded bg-surface-2 border border-border text-gold">
            PRO-21 + Ed25519
          </span>
        </div>

        {/* Address Inspector */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
              Address Inspector (Chain 1 / 2 / 3 Policy)
            </h3>
            {activeAccount && (
              <button
                type="button"
                data-testid="load-active-address-btn"
                onClick={() => {
                  setAddressInspectInput(activeAccount.address);
                  setAddressInspectChainStr(String(selectedChainId));
                }}
                className="px-2.5 py-1 text-xs bg-surface-2 hover:bg-border rounded border border-border text-muted hover:text-fg transition-colors"
              >
                Use Active Account Address
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div className="md:col-span-2">
              <label
                htmlFor="address-inspect-input"
                className="block text-xs font-medium text-muted mb-1"
              >
                Address (kvnc...dag, tknc...dag, or 64-hex)
              </label>
              <input
                id="address-inspect-input"
                data-testid="address-inspect-input"
                type="text"
                value={addressInspectInput}
                onChange={(e) => setAddressInspectInput(e.target.value)}
                placeholder="kvnc...dag, tknc...dag, or 0x..."
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
            </div>

            <div>
              <label
                htmlFor="address-inspect-chain-select"
                className="block text-xs font-medium text-muted mb-1"
              >
                Chain Policy
              </label>
              <select
                id="address-inspect-chain-select"
                data-testid="address-inspect-chain-select"
                value={addressInspectChainStr}
                onChange={(e) => setAddressInspectChainStr(e.target.value)}
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              >
                <option value="">Any (no chain policy)</option>
                <option value="1">Mainnet (Chain 1)</option>
                <option value="2">Testnet (Chain 2)</option>
                <option value="3">Devnet (Chain 3)</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="inspect-address-btn"
              onClick={() => {
                const expectedChainId =
                  addressInspectChainStr.trim().length > 0
                    ? Number(addressInspectChainStr)
                    : undefined;
                setAddressInspectResult(inspectAddress(addressInspectInput, expectedChainId));
              }}
              className="px-4 py-2 bg-gold hover:bg-gold/90 text-bg rounded-lg text-xs font-semibold transition-colors"
            >
              Inspect Address
            </button>
          </div>

          {addressInspectResult && (
            <div data-testid="address-inspect-result" className="flex flex-col gap-2 text-xs">
              <div className="bg-surface-2/80 border border-border rounded-lg p-3 font-mono flex flex-wrap items-center gap-x-5 gap-y-1 text-muted">
                <span>
                  Valid:{" "}
                  <strong
                    data-testid="address-inspect-valid"
                    className={addressInspectResult.valid ? "text-emerald-400" : "text-red-400"}
                  >
                    {addressInspectResult.valid ? "YES" : "NO"}
                  </strong>
                </span>
                <span>
                  Format: <strong className="text-gold">{addressInspectResult.format}</strong>
                </span>
                <span>
                  Checksum:{" "}
                  <strong
                    className={
                      addressInspectResult.checksumValid ? "text-emerald-400" : "text-red-400"
                    }
                  >
                    {addressInspectResult.checksumValid ? "VALID" : "INVALID"}
                  </strong>
                </span>
                <span>
                  Chain Allowed:{" "}
                  <strong
                    className={
                      addressInspectResult.chainAllowed === null
                        ? "text-muted"
                        : addressInspectResult.chainAllowed
                          ? "text-emerald-400"
                          : "text-red-400"
                    }
                  >
                    {addressInspectResult.chainAllowed === null
                      ? "N/A"
                      : addressInspectResult.chainAllowed
                        ? "ALLOWED"
                        : "REJECTED"}
                  </strong>
                </span>
              </div>

              {addressInspectResult.error && (
                <div className="text-xs font-mono text-red-300 bg-red-950/40 border border-red-800/60 rounded-lg p-3">
                  {addressInspectResult.error}
                </div>
              )}

              <pre
                data-testid="address-inspect-json"
                className="bg-surface-2 border border-border rounded-lg p-3 text-xs font-mono text-fg overflow-x-auto max-h-60"
              >
                {JSON.stringify(addressInspectResult, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Offline Transfer Tx Verifier */}
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
              Offline Signed Transfer Tx Verifier
            </h3>
            {signedResult?.rawTxHex && txType === "transfer" && (
              <button
                type="button"
                data-testid="load-signed-transfer-tx-btn"
                onClick={() => {
                  setTransferTxHexInput(signedResult.rawTxHex);
                  setTransferTxChainIdStr(String(selectedChainId));
                  setTransferTxInspectError(null);
                }}
                className="px-2.5 py-1 text-xs bg-surface-2 hover:bg-border rounded border border-border text-muted hover:text-fg transition-colors"
              >
                Load Last Signed Transfer
              </button>
            )}
          </div>

          <textarea
            id="transfer-tx-hex-input"
            data-testid="transfer-tx-hex-input"
            rows={3}
            value={transferTxHexInput}
            onChange={(e) => setTransferTxHexInput(e.target.value)}
            placeholder="Paste raw signed Transfer transaction hex (0x... or bare 196-byte hex)..."
            className="w-full bg-surface-2 border border-border rounded-lg p-3 text-xs font-mono text-fg focus:outline-none focus:border-gold"
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div>
              <label
                htmlFor="transfer-tx-chain-id-input"
                className="block text-xs font-medium text-muted mb-1"
              >
                Chain ID (for sighash)
              </label>
              <input
                id="transfer-tx-chain-id-input"
                data-testid="transfer-tx-chain-id-input"
                type="number"
                min={0}
                value={transferTxChainIdStr}
                onChange={(e) => setTransferTxChainIdStr(e.target.value)}
                placeholder={String(selectedChainId)}
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
            </div>

            <div className="md:col-span-2">
              <label
                htmlFor="transfer-tx-pubkey-input"
                className="block text-xs font-medium text-muted mb-1"
              >
                Signer Public Key Hex Override (optional, defaults to tx sender)
              </label>
              <input
                id="transfer-tx-pubkey-input"
                data-testid="transfer-tx-pubkey-input"
                type="text"
                value={transferTxPubkeyHex}
                onChange={(e) => setTransferTxPubkeyHex(e.target.value)}
                placeholder="64-char hex pubkey (optional)"
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="decode-transfer-tx-btn"
              onClick={() => {
                setTransferTxInspectError(null);
                setInspectedTransferTx(null);
                try {
                  const trimmedChain = transferTxChainIdStr.trim();
                  const parsedChainId =
                    trimmedChain.length > 0 ? BigInt(trimmedChain) : BigInt(selectedChainId);
                  const inspected = inspectRawSignedTransferTx(transferTxHexInput, {
                    chainId: parsedChainId,
                    publicKeyHex: transferTxPubkeyHex.trim() || undefined,
                  });
                  setInspectedTransferTx(inspected);
                } catch (err: unknown) {
                  if (err instanceof KovanicaDecodeError) {
                    setTransferTxInspectError(`[${err.code}] ${err.message}`);
                  } else {
                    setTransferTxInspectError(err instanceof Error ? err.message : String(err));
                  }
                }
              }}
              className="px-4 py-2 bg-gold/20 hover:bg-gold/30 rounded-lg border border-gold/40 text-gold text-xs font-semibold transition-colors"
            >
              Decode &amp; Verify Transfer Tx
            </button>
          </div>

          {transferTxInspectError && (
            <div
              data-testid="transfer-tx-decode-error"
              className="text-xs font-mono text-red-300 bg-red-950/40 border border-red-800/60 rounded-lg p-3"
            >
              {transferTxInspectError}
            </div>
          )}

          {inspectedTransferTx && (
            <div data-testid="transfer-tx-decode-result" className="flex flex-col gap-2 text-xs">
              <div className="bg-surface-2/80 border border-border rounded-lg p-3 font-mono flex flex-wrap items-center gap-x-5 gap-y-1 text-muted">
                <span>
                  Signature:{" "}
                  <strong
                    data-testid="transfer-tx-sig-status"
                    className={
                      inspectedTransferTx.signatureValid ? "text-emerald-400" : "text-red-400"
                    }
                  >
                    {inspectedTransferTx.signatureValid ? "VALID" : "INVALID"}
                  </strong>
                </span>
                <span>
                  Amount: <strong className="text-gold">{inspectedTransferTx.amount}</strong>
                </span>
                <span>
                  Nonce: <strong className="text-fg">{inspectedTransferTx.nonce}</strong>
                </span>
                <span>
                  Fee: <strong className="text-fg">{inspectedTransferTx.fee}</strong>
                </span>
                <span>
                  Size: <strong className="text-fg">{inspectedTransferTx.wireSizeBytes}B</strong>
                </span>
              </div>
              <pre
                data-testid="transfer-tx-decode-json"
                className="bg-surface-2 border border-border rounded-lg p-3 text-xs font-mono text-fg overflow-x-auto max-h-72"
              >
                {JSON.stringify(inspectedTransferTx, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* Universal Tx Auto-Decoder & Air-Gap Envelope Studio Panel */}
      <div
        className="bg-surface rounded-xl border border-border p-6 flex flex-col gap-5"
        data-testid="universal-tx-airgap-panel"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">
              Universal Tx Auto-Decoder &amp; Air-Gap Envelope Studio
            </h2>
            <p className="text-xs text-muted">
              Auto-decode any signed Transfer or Wasmi Call raw hex, wrap into a{" "}
              <code className="font-mono text-gold">{AIRGAP_ENVELOPE_PREFIX}...</code> air-gap
              envelope, and verify pasted envelopes offline
            </p>
          </div>
          <span className="px-2 py-0.5 text-[11px] font-mono rounded bg-surface-2 border border-border text-gold">
            Auto-Decode + kvnc-tx:v1
          </span>
        </div>

        {/* Auto-Decode & Wrap into Air-Gap Envelope */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
              Auto-Decode Any Signed Tx &amp; Wrap Air-Gap Envelope
            </h3>
            {signedResult?.rawTxHex && (
              <button
                type="button"
                data-testid="load-last-signed-universal-btn"
                onClick={() => {
                  setUniversalTxHexInput(signedResult.rawTxHex);
                  setUniversalTxChainIdStr(String(selectedChainId));
                  setUniversalTxError(null);
                }}
                className="px-2.5 py-1 text-xs bg-surface-2 hover:bg-border rounded border border-border text-muted hover:text-fg transition-colors"
              >
                Load Last Signed Tx
              </button>
            )}
          </div>

          <textarea
            id="universal-tx-hex-input"
            data-testid="universal-tx-hex-input"
            rows={3}
            value={universalTxHexInput}
            onChange={(e) => setUniversalTxHexInput(e.target.value)}
            placeholder="Paste any raw signed Transfer (variant 0) or Wasmi Call (variant 6) hex..."
            className="w-full bg-surface-2 border border-border rounded-lg p-3 text-xs font-mono text-fg focus:outline-none focus:border-gold"
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div>
              <label
                htmlFor="universal-tx-chain-id-input"
                className="block text-xs font-medium text-muted mb-1"
              >
                Chain ID (for sighash &amp; envelope)
              </label>
              <input
                id="universal-tx-chain-id-input"
                data-testid="universal-tx-chain-id-input"
                type="number"
                min={0}
                value={universalTxChainIdStr}
                onChange={(e) => setUniversalTxChainIdStr(e.target.value)}
                placeholder={String(selectedChainId)}
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
            </div>

            <div className="md:col-span-2">
              <label
                htmlFor="universal-tx-pubkey-input"
                className="block text-xs font-medium text-muted mb-1"
              >
                Signer Public Key Hex Override (optional)
              </label>
              <input
                id="universal-tx-pubkey-input"
                data-testid="universal-tx-pubkey-input"
                type="text"
                value={universalTxPubkeyHex}
                onChange={(e) => setUniversalTxPubkeyHex(e.target.value)}
                placeholder="64-char hex pubkey (optional)"
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="universal-auto-decode-btn"
              onClick={() => {
                setUniversalTxError(null);
                setInspectedUniversalTx(null);
                try {
                  const trimmedChain = universalTxChainIdStr.trim();
                  const parsedChainId =
                    trimmedChain.length > 0 ? BigInt(trimmedChain) : BigInt(selectedChainId);
                  const inspected = inspectAnySignedTx(universalTxHexInput, {
                    chainId: parsedChainId,
                    publicKeyHex: universalTxPubkeyHex.trim() || undefined,
                  });
                  setInspectedUniversalTx(inspected);
                } catch (err: unknown) {
                  if (err instanceof KovanicaDecodeError) {
                    setUniversalTxError(`[${err.code}] ${err.message}`);
                  } else {
                    setUniversalTxError(err instanceof Error ? err.message : String(err));
                  }
                }
              }}
              className="px-4 py-2 bg-gold hover:bg-gold/90 text-bg rounded-lg text-xs font-semibold transition-colors"
            >
              Auto-Decode &amp; Verify
            </button>

            <button
              type="button"
              data-testid="wrap-airgap-envelope-btn"
              onClick={() => {
                setUniversalTxError(null);
                setWrappedEnvelopeResult(null);
                try {
                  const trimmedChain = universalTxChainIdStr.trim();
                  const chainIdNum =
                    trimmedChain.length > 0 ? Number(trimmedChain) : selectedChainId;
                  let kind: AirgapTxKind = "raw";
                  let signingHashHex: string | undefined;
                  try {
                    const inspected = inspectAnySignedTx(universalTxHexInput, {
                      chainId: chainIdNum,
                      publicKeyHex: universalTxPubkeyHex.trim() || undefined,
                    });
                    kind = inspected.kind;
                    signingHashHex = inspected.signingHashHex;
                    setInspectedUniversalTx(inspected);
                  } catch {
                    // Fall back to kind: "raw" when wrapping non-standard raw hex
                  }
                  const wrapped = encodeAirgapTxEnvelope({
                    chainId: chainIdNum,
                    kind,
                    rawTxHex: universalTxHexInput.trim(),
                    ...(signingHashHex ? { signingHashHex } : {}),
                  });
                  setWrappedEnvelopeResult(wrapped);
                  setAirgapEnvelopeInput(wrapped.encoded);
                } catch (err: unknown) {
                  if (err instanceof KovanicaDecodeError) {
                    setUniversalTxError(`[${err.code}] ${err.message}`);
                  } else {
                    setUniversalTxError(err instanceof Error ? err.message : String(err));
                  }
                }
              }}
              className="px-4 py-2 bg-gold/20 hover:bg-gold/30 rounded-lg border border-gold/40 text-gold text-xs font-semibold transition-colors"
            >
              Wrap as Air-Gap Envelope
            </button>
          </div>

          {universalTxError && (
            <div
              data-testid="universal-tx-error"
              className="text-xs font-mono text-red-300 bg-red-950/40 border border-red-800/60 rounded-lg p-3"
            >
              {universalTxError}
            </div>
          )}

          {inspectedUniversalTx && (
            <div data-testid="universal-tx-result" className="flex flex-col gap-2 text-xs">
              <div className="bg-surface-2/80 border border-border rounded-lg p-3 font-mono flex flex-wrap items-center gap-x-5 gap-y-1 text-muted">
                <span>
                  Kind:{" "}
                  <strong data-testid="universal-tx-kind" className="text-gold uppercase">
                    {inspectedUniversalTx.kind}
                  </strong>{" "}
                  (v{inspectedUniversalTx.variant})
                </span>
                <span>
                  Signature:{" "}
                  <strong
                    data-testid="universal-tx-sig-status"
                    className={
                      inspectedUniversalTx.signatureValid ? "text-emerald-400" : "text-red-400"
                    }
                  >
                    {inspectedUniversalTx.signatureValid ? "VALID" : "INVALID"}
                  </strong>
                </span>
                <span>
                  Nonce: <strong className="text-fg">{inspectedUniversalTx.nonce}</strong>
                </span>
                <span>
                  Fee: <strong className="text-fg">{inspectedUniversalTx.fee}</strong>
                </span>
                <span>
                  Size: <strong className="text-fg">{inspectedUniversalTx.wireSizeBytes}B</strong>
                </span>
              </div>
              <pre
                data-testid="universal-tx-json"
                className="bg-surface-2 border border-border rounded-lg p-3 text-xs font-mono text-fg overflow-x-auto max-h-64"
              >
                {JSON.stringify(inspectedUniversalTx, null, 2)}
              </pre>
            </div>
          )}

          {wrappedEnvelopeResult && (
            <div data-testid="wrapped-airgap-result" className="flex flex-col gap-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-2/80 border border-border rounded-lg p-3 font-mono text-muted">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span>
                    Chain: <strong className="text-fg">{wrappedEnvelopeResult.envelope.chainId}</strong>
                  </span>
                  <span>
                    Tag:{" "}
                    <strong className="text-gold">
                      {wrappedEnvelopeResult.envelope.networkTag}
                    </strong>
                  </span>
                  <span>
                    Checksum:{" "}
                    <strong className="text-emerald-400">
                      {wrappedEnvelopeResult.envelope.checksumHex}
                    </strong>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard(wrappedEnvelopeResult.encoded, "airgap-envelope")}
                  className="px-2.5 py-1 text-xs bg-surface hover:bg-border rounded border border-border text-fg transition-colors"
                >
                  {copySuccess === "airgap-envelope" ? "Copied!" : "Copy Envelope"}
                </button>
              </div>
              <pre
                data-testid="wrapped-airgap-encoded"
                className="bg-surface-2 border border-border rounded-lg p-3 text-xs font-mono text-fg break-all whitespace-pre-wrap max-h-40 overflow-y-auto"
              >
                {wrappedEnvelopeResult.encoded}
              </pre>
            </div>
          )}
        </div>

        {/* Decode & Verify Pasted Air-Gap Envelope */}
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
            Decode &amp; Verify Pasted Air-Gap Envelope
          </h3>

          <textarea
            id="airgap-envelope-input"
            data-testid="airgap-envelope-input"
            rows={3}
            value={airgapEnvelopeInput}
            onChange={(e) => setAirgapEnvelopeInput(e.target.value)}
            placeholder={`Paste ${AIRGAP_ENVELOPE_PREFIX}<base64url> transport string or raw envelope JSON...`}
            className="w-full bg-surface-2 border border-border rounded-lg p-3 text-xs font-mono text-fg focus:outline-none focus:border-gold"
          />

          <div className="flex flex-wrap items-end gap-3">
            <div className="w-48">
              <label
                htmlFor="airgap-expected-chain-input"
                className="block text-xs font-medium text-muted mb-1"
              >
                Expected Chain ID (optional)
              </label>
              <input
                id="airgap-expected-chain-input"
                data-testid="airgap-expected-chain-input"
                type="number"
                min={0}
                value={airgapExpectedChainStr}
                onChange={(e) => setAirgapExpectedChainStr(e.target.value)}
                placeholder="Any chain"
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
            </div>

            <button
              type="button"
              data-testid="decode-airgap-envelope-btn"
              onClick={() => {
                setAirgapDecodeError(null);
                setDecodedAirgapResult(null);
                try {
                  const trimmedExpected = airgapExpectedChainStr.trim();
                  const expectedChainId =
                    trimmedExpected.length > 0 ? Number(trimmedExpected) : undefined;
                  const envelope = decodeAirgapTxEnvelope(airgapEnvelopeInput, {
                    ...(expectedChainId !== undefined ? { expectedChainId } : {}),
                  });
                  let inspectedTx: InspectedSignedTxAuto | null = null;
                  if (envelope.kind === "transfer" || envelope.kind === "call") {
                    try {
                      inspectedTx = inspectAnySignedTx(envelope.rawTxHex, {
                        chainId: envelope.chainId,
                      });
                    } catch {
                      inspectedTx = null;
                    }
                  }
                  setDecodedAirgapResult({ envelope, inspectedTx });
                } catch (err: unknown) {
                  if (err instanceof KovanicaDecodeError) {
                    setAirgapDecodeError(`[${err.code}] ${err.message}`);
                  } else {
                    setAirgapDecodeError(err instanceof Error ? err.message : String(err));
                  }
                }
              }}
              className="px-4 py-2 bg-gold/20 hover:bg-gold/30 rounded-lg border border-gold/40 text-gold text-xs font-semibold transition-colors"
            >
              Decode &amp; Verify Envelope
            </button>
          </div>

          {airgapDecodeError && (
            <div
              data-testid="airgap-decode-error"
              className="text-xs font-mono text-red-300 bg-red-950/40 border border-red-800/60 rounded-lg p-3"
            >
              {airgapDecodeError}
            </div>
          )}

          {decodedAirgapResult && (
            <div data-testid="airgap-decode-result" className="flex flex-col gap-2 text-xs">
              <div className="bg-surface-2/80 border border-border rounded-lg p-3 font-mono flex flex-wrap items-center gap-x-5 gap-y-1 text-muted">
                <span>
                  Checksum: <strong className="text-emerald-400">VERIFIED</strong> (
                  {decodedAirgapResult.envelope.checksumHex})
                </span>
                <span>
                  Kind:{" "}
                  <strong className="text-gold uppercase">
                    {decodedAirgapResult.envelope.kind}
                  </strong>
                </span>
                <span>
                  Chain: <strong className="text-fg">{decodedAirgapResult.envelope.chainId}</strong>{" "}
                  ({decodedAirgapResult.envelope.networkTag})
                </span>
                {decodedAirgapResult.inspectedTx && (
                  <span>
                    Tx Signature:{" "}
                    <strong
                      className={
                        decodedAirgapResult.inspectedTx.signatureValid
                          ? "text-emerald-400"
                          : "text-red-400"
                      }
                    >
                      {decodedAirgapResult.inspectedTx.signatureValid ? "VALID" : "INVALID"}
                    </strong>
                  </span>
                )}
              </div>
              <pre
                data-testid="airgap-decode-json"
                className="bg-surface-2 border border-border rounded-lg p-3 text-xs font-mono text-fg overflow-x-auto max-h-64"
              >
                {JSON.stringify(decodedAirgapResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* Mempool Fee-Tier Estimator (kovanica_mempoolStats) */}
      <div
        data-testid="mempool-fee-tier-panel"
        className="bg-surface rounded-xl border border-border p-6 flex flex-col gap-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">
              Mempool Fee-Tier Estimator (<code>kovanica_mempoolStats</code>)
            </h2>
            <p className="text-xs text-muted">
              Live economy, standard, and priority fee-per-byte tiers via kovanica-sdk v0.5.0
              (gracefully falls back to <code>kovanica_estimateFee</code> when empty or unsupported)
            </p>
          </div>
          <button
            type="button"
            data-testid="probe-mempool-fees-btn"
            disabled={isProbingMempoolFees}
            onClick={handleProbeMempoolFees}
            className="px-4 py-2 bg-gold/20 hover:bg-gold/30 disabled:opacity-50 rounded-lg border border-gold/40 text-gold text-xs font-semibold transition-colors"
          >
            {isProbingMempoolFees ? "Probing..." : "Refresh Fee Tiers"}
          </button>
        </div>

        {mempoolFeeError && (
          <div
            data-testid="mempool-fee-tier-error"
            className="text-xs font-mono text-red-300 bg-red-950/40 border border-red-800/60 rounded-lg p-3"
          >
            {mempoolFeeError}
          </div>
        )}

        {mempoolFeeResult && (
          <div data-testid="mempool-fee-tier-result" className="flex flex-col gap-3 text-xs">
            <div className="bg-surface-2/80 border border-border rounded-lg p-3 font-mono flex flex-wrap items-center gap-x-5 gap-y-1 text-muted">
              <span>
                Source:{" "}
                <strong data-testid="mempool-fee-source" className="text-gold uppercase">
                  {mempoolFeeResult.source}
                </strong>
              </span>
              <span>
                Pending Txs:{" "}
                <strong className="text-fg">{mempoolFeeResult.pendingCount}</strong>
              </span>
              <span>
                Mempool Size:{" "}
                <strong className="text-fg">{mempoolFeeResult.totalBytes} B</strong>
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-surface-2 border border-border rounded-lg p-3 flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">
                  Economy
                </span>
                <span
                  data-testid="mempool-fee-economy"
                  className="text-sm font-mono font-semibold text-fg"
                >
                  {mempoolFeeResult.economyAtoms} atoms/B
                </span>
              </div>
              <div className="bg-surface-2 border border-gold/40 rounded-lg p-3 flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-wider text-gold font-semibold">
                  Standard
                </span>
                <span
                  data-testid="mempool-fee-standard"
                  className="text-sm font-mono font-semibold text-gold"
                >
                  {mempoolFeeResult.standardAtoms} atoms/B
                </span>
              </div>
              <div className="bg-surface-2 border border-border rounded-lg p-3 flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-wider text-emerald-400 font-semibold">
                  Priority
                </span>
                <span
                  data-testid="mempool-fee-priority"
                  className="text-sm font-mono font-semibold text-emerald-300"
                >
                  {mempoolFeeResult.priorityAtoms} atoms/B
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Self-Test & Invariant Verification Suite */}
      <div className="bg-surface rounded-xl border border-border p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">
              Golden Vector & Consensus Invariant Runner
            </h2>
            <p className="text-xs text-muted">
              Live verification of coin type 3007, Ed25519 curve math, and Wasmi ABI serialization
            </p>
          </div>
          <button
            type="button"
            onClick={handleRunSelfTest}
            className="px-4 py-2 bg-gold/20 hover:bg-gold/30 rounded-lg border border-gold/40 text-gold text-xs font-semibold transition-colors"
          >
            Run Self-Test Suite
          </button>
        </div>

        {selfTestSteps && (
          <div className="flex flex-col gap-2.5">
            {selfTestSteps.map((step, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-lg border text-xs flex items-start justify-between gap-3 ${
                  step.passed
                    ? "bg-emerald-950/20 border-emerald-800/40 text-emerald-300"
                    : "bg-red-950/20 border-red-800/40 text-red-300"
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span>{step.passed ? "✓" : "✗"}</span>
                    <span className="font-semibold">{step.name}</span>
                  </div>
                  {step.actual && (
                    <p className="text-[11px] mt-1 font-mono text-muted">{step.actual}</p>
                  )}
                </div>
                <span className="font-mono text-[11px] uppercase tracking-wider font-bold">
                  {step.passed ? "PASS" : "FAIL"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
