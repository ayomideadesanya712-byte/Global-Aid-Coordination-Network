import { describe, it, expect, beforeEach } from "vitest";
import { asciiToBytes } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_AID_TYPE = 101;
const ERR_INVALID_LOCATION = 102;
const ERR_INVALID_QUANTITY = 103;
const ERR_INVALID_TIMELINE = 104;
const ERR_INVALID_STATUS = 105;
const ERR_COMMITMENT_ALREADY_EXISTS = 106;
const ERR_COMMITMENT_NOT_FOUND = 107;
const ERR_INVALID_HASH = 111;
const ERR_INVALID_UPDATE_PARAM = 113;
const ERR_MAX_COMMITMENTS_EXCEEDED = 114;
const ERR_AUTHORITY_NOT_VERIFIED = 109;
const ERR_DUPLICATION_DETECTED = 117;

interface Timeline {
  start: number;
  end: number;
}

interface Commitment {
  id: number;
  org: string;
  aidType: number;
  location: string;
  quantity: number;
  timeline: Timeline;
  status: string;
  hash: string;
  timestamp: number;
  verified: boolean;
}

interface CommitmentUpdate {
  updateStatus: string;
  updateVerified: boolean;
  updateTimestamp: number;
  updater: string;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class AidCommitmentLoggerMock {
  state: {
    nextCommitmentId: number;
    maxCommitments: number;
    loggingFee: number;
    authorityContract: string | null;
    commitments: Map<number, Commitment>;
    commitmentUpdates: Map<number, CommitmentUpdate>;
    commitmentsByHash: Map<string, number>;
  } = {
    nextCommitmentId: 0,
    maxCommitments: 100000,
    loggingFee: 100,
    authorityContract: null,
    commitments: new Map(),
    commitmentUpdates: new Map(),
    commitmentsByHash: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  authorities: Set<string> = new Set(["ST1TEST"]);
  stxTransfers: Array<{ amount: number; from: string; to: string | null }> = [];
  duplicationDetector: (aidType: number, location: string, quantity: number, timeline: Timeline) => Result<boolean> = () => ({ ok: true, value: true });
  oracleIntegrator: (id: number, newStatus: string) => Result<boolean> = () => ({ ok: true, value: true });

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextCommitmentId: 0,
      maxCommitments: 100000,
      loggingFee: 100,
      authorityContract: null,
      commitments: new Map(),
      commitmentUpdates: new Map(),
      commitmentsByHash: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.authorities = new Set(["ST1TEST"]);
    this.stxTransfers = [];
    this.duplicationDetector = () => ({ ok: true, value: true });
    this.oracleIntegrator = () => ({ ok: true, value: true });
  }

  isVerifiedAuthority(principal: string): Result<boolean> {
    return { ok: true, value: this.authorities.has(principal) };
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (contractPrincipal === "SP000000000000000000002Q6VF78") {
      return { ok: false, value: false };
    }
    if (this.state.authorityContract !== null) {
      return { ok: false, value: false };
    }
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setLoggingFee(newFee: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    this.state.loggingFee = newFee;
    return { ok: true, value: true };
  }

  logCommitment(
    aidType: number,
    location: string,
    quantity: number,
    timeline: Timeline,
    detailsHash: string
  ): Result<number> {
    if (this.state.nextCommitmentId >= this.state.maxCommitments) return { ok: false, value: ERR_MAX_COMMITMENTS_EXCEEDED };
    if (aidType <= 0 || aidType > 100) return { ok: false, value: ERR_INVALID_AID_TYPE };
    if (!location || location.length > 50) return { ok: false, value: ERR_INVALID_LOCATION };
    if (quantity <= 0) return { ok: false, value: ERR_INVALID_QUANTITY };
    if (timeline.start <= 0 || timeline.end <= timeline.start) return { ok: false, value: ERR_INVALID_TIMELINE };
    if (detailsHash.length !== 64) return { ok: false, value: ERR_INVALID_HASH };
    if (this.state.commitmentsByHash.has(detailsHash)) return { ok: false, value: ERR_COMMITMENT_ALREADY_EXISTS };
    if (!this.duplicationDetector(aidType, location, quantity, timeline).ok) return { ok: false, value: ERR_DUPLICATION_DETECTED };
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };

    this.stxTransfers.push({ amount: this.state.loggingFee, from: this.caller, to: this.state.authorityContract });

    const id = this.state.nextCommitmentId;
    const commitment: Commitment = {
      id,
      org: this.caller,
      aidType,
      location,
      quantity,
      timeline,
      status: "pending",
      hash: detailsHash,
      timestamp: this.blockHeight,
      verified: false,
    };
    this.state.commitments.set(id, commitment);
    this.state.commitmentsByHash.set(detailsHash, id);
    this.state.nextCommitmentId++;
    return { ok: true, value: id };
  }

  getCommitment(id: number): Commitment | null {
    return this.state.commitments.get(id) || null;
  }

  updateCommitment(id: number, newStatus: string, newVerified: boolean): Result<boolean> {
    const commitment = this.state.commitments.get(id);
    if (!commitment) return { ok: false, value: false };
    if (commitment.org !== this.caller) return { ok: false, value: false };
    if (!["pending", "delivered", "disputed", "cancelled"].includes(newStatus)) return { ok: false, value: false };
    if (!this.oracleIntegrator(id, newStatus).ok) return { ok: false, value: false };

    const updated: Commitment = {
      ...commitment,
      status: newStatus,
      verified: newVerified,
      timestamp: this.blockHeight,
    };
    this.state.commitments.set(id, updated);
    this.state.commitmentUpdates.set(id, {
      updateStatus: newStatus,
      updateVerified: newVerified,
      updateTimestamp: this.blockHeight,
      updater: this.caller,
    });
    return { ok: true, value: true };
  }

  getCommitmentCount(): Result<number> {
    return { ok: true, value: this.state.nextCommitmentId };
  }

  checkCommitmentExistence(hash: string): Result<boolean> {
    return { ok: true, value: this.state.commitmentsByHash.has(hash) };
  }
}

describe("AidCommitmentLogger", () => {
  let contract: AidCommitmentLoggerMock;

  beforeEach(() => {
    contract = new AidCommitmentLoggerMock();
    contract.reset();
  });

  it("logs a commitment successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.logCommitment(
      1,
      "SYR-ALE",
      1000,
      { start: 100, end: 200 },
      "a".repeat(64)
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);

    const commitment = contract.getCommitment(0);
    expect(commitment?.aidType).toBe(1);
    expect(commitment?.location).toBe("SYR-ALE");
    expect(commitment?.quantity).toBe(1000);
    expect(commitment?.timeline).toEqual({ start: 100, end: 200 });
    expect(commitment?.status).toBe("pending");
    expect(commitment?.hash).toBe("a".repeat(64));
    expect(commitment?.verified).toBe(false);
    expect(contract.stxTransfers).toEqual([{ amount: 100, from: "ST1TEST", to: "ST2TEST" }]);
  });

  it("rejects duplicate commitment hashes", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.logCommitment(
      1,
      "SYR-ALE",
      1000,
      { start: 100, end: 200 },
      "a".repeat(64)
    );
    const result = contract.logCommitment(
      2,
      "UKR-KIE",
      2000,
      { start: 300, end: 400 },
      "a".repeat(64)
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_COMMITMENT_ALREADY_EXISTS);
  });

  it("rejects non-authorized caller for authority set", () => {
    const result = contract.setAuthorityContract("SP000000000000000000002Q6VF78");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects commitment without authority contract", () => {
    const result = contract.logCommitment(
      1,
      "SYR-ALE",
      1000,
      { start: 100, end: 200 },
      "a".repeat(64)
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AUTHORITY_NOT_VERIFIED);
  });

  it("rejects invalid aid type", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.logCommitment(
      101,
      "SYR-ALE",
      1000,
      { start: 100, end: 200 },
      "a".repeat(64)
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AID_TYPE);
  });

  it("rejects invalid location", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.logCommitment(
      1,
      "a".repeat(51),
      1000,
      { start: 100, end: 200 },
      "a".repeat(64)
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_LOCATION);
  });

  it("updates a commitment successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.logCommitment(
      1,
      "SYR-ALE",
      1000,
      { start: 100, end: 200 },
      "a".repeat(64)
    );
    const result = contract.updateCommitment(0, "delivered", true);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const commitment = contract.getCommitment(0);
    expect(commitment?.status).toBe("delivered");
    expect(commitment?.verified).toBe(true);
    const update = contract.state.commitmentUpdates.get(0);
    expect(update?.updateStatus).toBe("delivered");
    expect(update?.updateVerified).toBe(true);
    expect(update?.updater).toBe("ST1TEST");
  });

  it("rejects update for non-existent commitment", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.updateCommitment(99, "delivered", true);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects update by non-org", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.logCommitment(
      1,
      "SYR-ALE",
      1000,
      { start: 100, end: 200 },
      "a".repeat(64)
    );
    contract.caller = "ST3FAKE";
    const result = contract.updateCommitment(0, "delivered", true);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("sets logging fee successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setLoggingFee(200);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.loggingFee).toBe(200);
    contract.logCommitment(
      1,
      "SYR-ALE",
      1000,
      { start: 100, end: 200 },
      "a".repeat(64)
    );
    expect(contract.stxTransfers).toEqual([{ amount: 200, from: "ST1TEST", to: "ST2TEST" }]);
  });

  it("rejects logging fee change without authority", () => {
    const result = contract.setLoggingFee(200);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("returns correct commitment count", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.logCommitment(
      1,
      "SYR-ALE",
      1000,
      { start: 100, end: 200 },
      "a".repeat(64)
    );
    contract.logCommitment(
      2,
      "UKR-KIE",
      2000,
      { start: 300, end: 400 },
      "b".repeat(64)
    );
    const result = contract.getCommitmentCount();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2);
  });

  it("checks commitment existence correctly", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.logCommitment(
      1,
      "SYR-ALE",
      1000,
      { start: 100, end: 200 },
      "a".repeat(64)
    );
    const result = contract.checkCommitmentExistence("a".repeat(64));
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const result2 = contract.checkCommitmentExistence("b".repeat(64));
    expect(result2.ok).toBe(true);
    expect(result2.value).toBe(false);
  });

  it("rejects commitment with invalid hash length", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.logCommitment(
      1,
      "SYR-ALE",
      1000,
      { start: 100, end: 200 },
      "a".repeat(63)
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_HASH);
  });

  it("rejects commitment with max exceeded", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.state.maxCommitments = 1;
    contract.logCommitment(
      1,
      "SYR-ALE",
      1000,
      { start: 100, end: 200 },
      "a".repeat(64)
    );
    const result = contract.logCommitment(
      2,
      "UKR-KIE",
      2000,
      { start: 300, end: 400 },
      "b".repeat(64)
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_COMMITMENTS_EXCEEDED);
  });

  it("sets authority contract successfully", () => {
    const result = contract.setAuthorityContract("ST2TEST");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.authorityContract).toBe("ST2TEST");
  });

  it("rejects duplication detected", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.duplicationDetector = () => ({ ok: false, value: false });
    const result = contract.logCommitment(
      1,
      "SYR-ALE",
      1000,
      { start: 100, end: 200 },
      "a".repeat(64)
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_DUPLICATION_DETECTED);
  });

  it("rejects oracle invalid update", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.logCommitment(
      1,
      "SYR-ALE",
      1000,
      { start: 100, end: 200 },
      "a".repeat(64)
    );
    contract.oracleIntegrator = () => ({ ok: false, value: false });
    const result = contract.updateCommitment(0, "delivered", true);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });
});