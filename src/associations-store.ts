import { BigInt, Bytes, crypto, ethereum } from "@graphprotocol/graph-ts";
import {
  RevokeAssociationCall,
  StoreAssociationCall
} from "../generated/AssociationsStore/AssociationsStore";
import { Association, AssociationAccount, AssociationRevocation } from "../generated/schema";

function getOrCreateAssociationAccount(id: Bytes): AssociationAccount {
  let a = AssociationAccount.load(id);
  if (a == null) {
    a = new AssociationAccount(id);
    a.save();
  }
  return a as AssociationAccount;
}

/**
 * Best-effort associationId derivation.
 *
 * We compute keccak256(abi.encode(record)) where:
 * record = (bytes initiator, bytes approver, uint40 validAt, uint40 validUntil, bytes4 interfaceId, bytes data)
 *
 * If the onchain implementation uses a different derivation, `revokeAssociation(associationId, ...)`
 * won’t be able to load the `Association` entity. We still always index revocations separately via
 * `AssociationRevocation`.
 */
function deriveAssociationIdFromRecord(record: ethereum.Tuple): Bytes {
  const encoded = ethereum.encode(ethereum.Value.fromTuple(record));
  // `ethereum.encode` can return null in edge cases; fall back to hashing empty bytes.
  if (!encoded) {
    const empty = Bytes.fromHexString("0x");
    return Bytes.fromByteArray(crypto.keccak256(empty));
  }
  return Bytes.fromByteArray(crypto.keccak256(encoded as Bytes));
}

export function handleStoreAssociation(call: StoreAssociationCall): void {
  const sar = call.inputs.sar;
  const record = sar.record;

  // Build a Tuple matching the record definition for encoding:
  // (bytes initiator, bytes approver, uint40 validAt, uint40 validUntil, bytes4 interfaceId, bytes data)
  const recordTuple = new ethereum.Tuple();
  recordTuple.push(ethereum.Value.fromBytes(record.initiator));
  recordTuple.push(ethereum.Value.fromBytes(record.approver));
  recordTuple.push(ethereum.Value.fromUnsignedBigInt(record.validAt));
  recordTuple.push(ethereum.Value.fromUnsignedBigInt(record.validUntil));
  recordTuple.push(ethereum.Value.fromFixedBytes(record.interfaceId));
  recordTuple.push(ethereum.Value.fromBytes(record.data));

  const associationId = deriveAssociationIdFromRecord(recordTuple);

  const initiatorAccount = getOrCreateAssociationAccount(record.initiator);
  const approverAccount = getOrCreateAssociationAccount(record.approver);

  let association = Association.load(associationId);
  if (association == null) {
    association = new Association(associationId);
    association.createdTxHash = call.transaction.hash;
    association.createdBlockNumber = call.block.number;
    association.createdTimestamp = call.block.timestamp;
  }

  association.initiatorAccount = initiatorAccount.id;
  association.approverAccount = approverAccount.id;

  association.initiator = record.initiator;
  association.approver = record.approver;
  association.validAt = record.validAt;
  association.validUntil = record.validUntil;
  association.interfaceId = record.interfaceId;
  association.data = record.data;

  association.initiatorKeyType = sar.initiatorKeyType;
  association.approverKeyType = sar.approverKeyType;
  association.initiatorSignature = sar.initiatorSignature;
  association.approverSignature = sar.approverSignature;

  // Convention: treat revokedAt == 0 as "not revoked"
  if (sar.revokedAt.equals(BigInt.zero())) association.revokedAt = null;
  else association.revokedAt = sar.revokedAt;

  association.lastUpdatedTxHash = call.transaction.hash;
  association.lastUpdatedBlockNumber = call.block.number;
  association.lastUpdatedTimestamp = call.block.timestamp;

  association.save();
}

export function handleRevokeAssociation(call: RevokeAssociationCall): void {
  const associationId = call.inputs.associationId;
  const revokedAt = call.inputs.revokedAt;

  // Always index the revocation call itself.
  const rid = call.transaction.hash.toHex() + "-" + call.transaction.index.toString();
  const r = new AssociationRevocation(rid);
  r.associationId = associationId;
  r.revokedAt = revokedAt;
  r.txHash = call.transaction.hash;
  r.blockNumber = call.block.number;
  r.timestamp = call.block.timestamp;
  r.save();

  // Best-effort: if we have the association, mark it revoked.
  const assoc = Association.load(associationId);
  if (assoc != null) {
    if (revokedAt.equals(BigInt.zero())) assoc.revokedAt = null;
    else assoc.revokedAt = revokedAt;
    assoc.lastUpdatedTxHash = call.transaction.hash;
    assoc.lastUpdatedBlockNumber = call.block.number;
    assoc.lastUpdatedTimestamp = call.block.timestamp;
    assoc.save();
  }
}


