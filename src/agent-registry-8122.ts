import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  Approval as ApprovalEvent,
  ContractMetadataUpdated as ContractMetadataUpdatedEvent,
  MetadataSet as MetadataSetEvent,
  OperatorSet as OperatorSetEvent,
  Registered as RegisteredEvent,
  Transfer as TransferEvent
} from "../generated/AgentRegistry8122/AgentRegistry8122";
import {
  RegistryAgent8122,
  RegistryAgent8122Approval,
  RegistryAgent8122Metadata,
  RegistryAgent8122Operator,
  RegistryAgent8122Transfer,
  RegistryContractMetadata
} from "../generated/schema";

function agentEntityId(registry: Bytes, agentId: BigInt): string {
  return registry.toHexString() + "-" + agentId.toString();
}

export function handleRegistryTransfer(e: TransferEvent): void {
  const registry = e.address;
  const id = e.transaction.hash.toHex() + "-" + e.logIndex.toString();

  const t = new RegistryAgent8122Transfer(id);
  t.registry = registry;
  t.operator = e.params.operator;
  t.from = e.params.from;
  t.to = e.params.to;
  t.agentId = e.params.id;
  t.amount = e.params.amount;
  t.txHash = e.transaction.hash;
  t.blockNumber = e.block.number;
  t.timestamp = e.block.timestamp;
  t.save();

  const aid = agentEntityId(registry, e.params.id);
  let a = RegistryAgent8122.load(aid);
  if (a == null) {
    a = new RegistryAgent8122(aid);
    a.registry = registry;
    a.agentId = e.params.id;
    a.createdAt = e.block.timestamp;
  }
  // Keep last known owner in sync with transfer destination (mint is from=0x0)
  a.owner = e.params.to;
  a.updatedAt = e.block.timestamp;
  a.save();
}

export function handleRegistryRegistered(e: RegisteredEvent): void {
  const registry = e.address;
  const aid = agentEntityId(registry, e.params.agentId);
  let a = RegistryAgent8122.load(aid);
  if (a == null) {
    a = new RegistryAgent8122(aid);
    a.registry = registry;
    a.agentId = e.params.agentId;
    a.createdAt = e.block.timestamp;
  }
  a.owner = e.params.owner;
  a.endpointType = e.params.endpointType;
  a.endpoint = e.params.endpoint;
  a.agentAccount = e.params.agentAccount.equals(Address.zero()) ? null : (e.params.agentAccount as Bytes);
  a.updatedAt = e.block.timestamp;
  a.save();
}

export function handleRegistryMetadataSet(e: MetadataSetEvent): void {
  const registry = e.address;
  const key = e.params.metadataKey;
  const mid = registry.toHexString() + "-" + e.params.tokenId.toString() + "-" + key;

  let m = RegistryAgent8122Metadata.load(mid);
  if (m == null) {
    m = new RegistryAgent8122Metadata(mid);
    m.registry = registry;
    m.agentId = e.params.tokenId;
    m.key = key;
  }
  m.value = e.params.metadataValue;
  m.indexedKey = e.params.indexedMetadataKey.toHexString();
  m.setAt = e.block.timestamp;
  m.txHash = e.transaction.hash;
  m.blockNumber = e.block.number;
  m.timestamp = e.block.timestamp;
  m.save();

  // Keep common fields mirrored on the agent entity (best-effort)
  const aid = agentEntityId(registry, e.params.tokenId);
  const a = RegistryAgent8122.load(aid);
  if (a != null) {
    if (key == "endpoint_type") a.endpointType = m.value.toString();
    else if (key == "endpoint") a.endpoint = m.value.toString();
    else if (key == "agent_account" && m.value.length == 32) {
      // abi.encode(address) is 32 bytes; take last 20 bytes
      const v = m.value;
      a.agentAccount = Bytes.fromUint8Array(v.subarray(12, 32));
    }
    a.updatedAt = e.block.timestamp;
    a.save();
  }
}

export function handleRegistryContractMetadataUpdated(e: ContractMetadataUpdatedEvent): void {
  const registry = e.address;
  const id = registry.toHexString() + "-" + e.params.key;
  let m = RegistryContractMetadata.load(id);
  if (m == null) {
    m = new RegistryContractMetadata(id);
    m.registry = registry;
    m.key = e.params.key;
  }
  m.value = e.params.value;
  m.indexedKey = e.params.indexedKey.toHexString();
  m.updatedAt = e.block.timestamp;
  m.txHash = e.transaction.hash;
  m.blockNumber = e.block.number;
  m.timestamp = e.block.timestamp;
  m.save();
}

export function handleRegistryOperatorSet(e: OperatorSetEvent): void {
  const registry = e.address;
  const id = registry.toHexString() + "-" + e.params.owner.toHexString() + "-" + e.params.spender.toHexString();
  let op = RegistryAgent8122Operator.load(id);
  if (op == null) {
    op = new RegistryAgent8122Operator(id);
    op.registry = registry;
    op.owner = e.params.owner;
    op.operator = e.params.spender;
  }
  op.approved = e.params.approved;
  op.updatedAt = e.block.timestamp;
  op.txHash = e.transaction.hash;
  op.blockNumber = e.block.number;
  op.timestamp = e.block.timestamp;
  op.save();
}

export function handleRegistryApproval(e: ApprovalEvent): void {
  const registry = e.address;
  const id = e.transaction.hash.toHex() + "-" + e.logIndex.toString();
  const a = new RegistryAgent8122Approval(id);
  a.registry = registry;
  a.owner = e.params.owner;
  a.spender = e.params.spender;
  a.agentId = e.params.id;
  a.amount = e.params.amount;
  a.txHash = e.transaction.hash;
  a.blockNumber = e.block.number;
  a.timestamp = e.block.timestamp;
  a.save();
}

