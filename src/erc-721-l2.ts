import { BigInt, Bytes, json, JSONValueKind, ipfs, Value } from "@graphprotocol/graph-ts";
/**
 * Extract CID from various IPFS URI formats
 * Supports: ipfs://CID, https://gateway/ipfs/CID, https://CID.ipfs.gateway, etc.
 * Based on improved extraction logic from IPFS storage implementation
 */
function extractIpfsPath(uri: string): string | null {
  if (!uri || uri.length == 0) return null;
  
  // Handle ipfs://CID[/path]
  if (uri.startsWith("ipfs://")) {
    const cidOnly = uri.substr(7);
    if (!cidOnly || cidOnly.length == 0) return null;
    // Remove query parameters
    const qIdx0 = cidOnly.indexOf("?");
    return qIdx0 >= 0 ? cidOnly.substr(0, qIdx0) : cidOnly;
  }
  
  // For the rest of the parsing, keep the original URI (do NOT treat arbitrary HTTPS URLs as IPFS)
  let cid = uri;
  
  // Handle gateway URLs with /ipfs/ path
  const ipfsPathIdx = cid.indexOf("/ipfs/");
  if (ipfsPathIdx >= 0) {
    const afterPath = cid.substr(ipfsPathIdx + 6);
    // Extract CID (first part before any additional path)
    const parts = afterPath.split("/");
    const firstPart = parts[0];
    if (firstPart && firstPart.length > 0) {
      // Remove query parameters if present
      const qIdx = firstPart.indexOf("?");
      const cleanCid = qIdx >= 0 ? firstPart.substr(0, qIdx) : firstPart;
      // Return CID with remaining path if any
      if (parts.length > 1) {
        const remainingPath = afterPath.substr(cleanCid.length);
        return cleanCid + remainingPath;
      }
      return cleanCid;
    }
  }
  
  // Handle subdomain gateways: https://CID.ipfs.gateway or https://CID.ipfs.gateway/path
  const schemeIdx = uri.indexOf("://");
  if (schemeIdx >= 0) {
    const rest = uri.substr(schemeIdx + 3);
    const slashIdx = rest.indexOf("/");
    const host = slashIdx >= 0 ? rest.substr(0, slashIdx) : rest;
    const afterHost = slashIdx >= 0 ? rest.substr(slashIdx + 1) : "";
    const ipfsDotIdx = host.indexOf(".ipfs.");
    if (ipfsDotIdx > 0) {
      const cidPart = host.substr(0, ipfsDotIdx);
      // Remove query parameters
      const qIdx = cidPart.indexOf("?");
      const cleanCid = qIdx >= 0 ? cidPart.substr(0, qIdx) : cidPart;
      return afterHost.length > 0 ? cleanCid + "/" + afterHost : cleanCid;
    }
    
    // Handle direct gateway URLs without /ipfs/ or .ipfs. subdomain
    // Pattern: https://gateway/CID or https://gateway/CID/path
    if (slashIdx >= 0) {
      const pathAfterSlash = rest.substr(slashIdx + 1);
      // Check if it looks like a CID (alphanumeric, at least 46 chars for v0, or longer for v1)
      const pathParts = pathAfterSlash.split("/");
      const possibleCidWithQuery = pathParts[0];
      const qIdx2 = possibleCidWithQuery.indexOf("?");
      const possibleCid = qIdx2 >= 0 ? possibleCidWithQuery.substr(0, qIdx2) : possibleCidWithQuery;
      // Basic validation: at least 46 characters (v0 CID length)
      if (possibleCid && possibleCid.length >= 46) {
        return pathAfterSlash;
      }
    }
  }
  
  // If there's no scheme, check if it's a bare CID
  if (uri.indexOf("://") < 0 && cid && cid.indexOf("/") < 0) {
    const qIdx3 = cid.indexOf("?");
    const cleanCid = qIdx3 >= 0 ? cid.substr(0, qIdx3) : cid;
    // Basic validation: at least 46 characters (v0 CID length)
    if (cleanCid.length >= 46) {
      return cleanCid;
    }
  }
  
  return null;
}

function decodeBase64ToBytes(b64: string): Bytes | null {
  if (!b64 || b64.length == 0) return null;

  let cleaned = "";
  for (let i = 0; i < b64.length; i++) {
    const c = b64.charCodeAt(i);
    const isAZ = c >= 65 && c <= 90;
    const isaz = c >= 97 && c <= 122;
    const is09 = c >= 48 && c <= 57;
    const isPlus = c == 43;
    const isSlash = c == 47;
    const isEq = c == 61;
    if (isAZ || isaz || is09 || isPlus || isSlash || isEq) cleaned += b64.charAt(i);
  }

  if (cleaned.length < 4) return null;
  const len = cleaned.length;
  const pad = (cleaned.charAt(len - 1) == "=" ? 1 : 0) + (cleaned.charAt(len - 2) == "=" ? 1 : 0);
  const outLen = (len / 4) * 3 - pad;
  if (outLen <= 0) return null;

  const out = new Uint8Array(outLen as i32);

  function val(ch: i32): i32 {
    if (ch >= 65 && ch <= 90) return ch - 65;
    if (ch >= 97 && ch <= 122) return ch - 71;
    if (ch >= 48 && ch <= 57) return ch + 4;
    if (ch == 43) return 62;
    if (ch == 47) return 63;
    return -1;
  }

  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = cleaned.charCodeAt(i);
    const c1 = cleaned.charCodeAt(i + 1);
    const c2 = cleaned.charCodeAt(i + 2);
    const c3 = cleaned.charCodeAt(i + 3);

    const v0 = val(c0);
    const v1 = val(c1);
    const v2 = c2 == 61 ? 0 : val(c2);
    const v3 = c3 == 61 ? 0 : val(c3);

    if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) return null;

    const b0: u8 = ((v0 << 2) | (v1 >> 4)) as u8;
    if (o < outLen) out[o++] = b0;

    if (c2 != 61) {
      const b1: u8 = (((v1 & 15) << 4) | (v2 >> 2)) as u8;
      if (o < outLen) out[o++] = b1;
    }

    if (c3 != 61) {
      const b2: u8 = (((v2 & 3) << 6) | v3) as u8;
      if (o < outLen) out[o++] = b2;
    }
  }

  return Bytes.fromUint8Array(out);
}

function tryReadJsonFromAgentURI(uri: string): string | null {
  if (uri.startsWith("data:")) {
    const marker = "base64,";
    const idx = uri.indexOf(marker);
    if (idx >= 0) {
      const b64 = uri.substr(idx + marker.length);
      const bytes = decodeBase64ToBytes(b64);
      return bytes ? (bytes as Bytes).toString() : null;
    }
  }

  const path = extractIpfsPath(uri);
  if (!path) return null;
  const data = ipfs.cat(path as string);
  return data !== null ? data.toString() : null;
}

import {
  Registered as RegisteredEvent,
  Transfer as TransferEvent,
  Approval as ApprovalEvent,
  ApprovalForAll as ApprovalForAllEvent,
  URIUpdated as UriUpdatedEvent,
  MetadataSet as MetadataSetEvent,
  ERC721
} from "../generatedL2/ERC721/ERC721";
import { Account, Agent, AgentMetadata, AgentRegistrationFile, AgentStats, AgentTransfer, AgentURIUpdate, Collection, GlobalStats } from "../generatedL2/schema";

function getOrCreateAccount(addr: Bytes): Account {
  let a = Account.load(addr);
  if (a == null) { a = new Account(addr); a.balance = BigInt.zero(); }
  return a as Account;
}

function getOrCreateCollection(addr: Bytes): Collection {
  let c = Collection.load(addr);
  if (c == null) {
    c = new Collection(addr);
    c.totalSupply = BigInt.zero();
  }
  return c as Collection;
}

function fetchAndParseMetadata(agent: Agent, uri: string | null, ts: BigInt): void {
  if (uri == null) return;
  
  const uriStr = uri as string;
  agent.agentURI = uriStr;

  const agentIdStr = agent.id;
  let reg = AgentRegistrationFile.load(agentIdStr);
  if (reg == null) {
    reg = new AgentRegistrationFile(agentIdStr);
    reg.agent = agent.id;
    reg.supportedTrust = [];
  }
  reg.agentURI = uriStr;
  reg.updatedAt = ts;

  const raw = tryReadJsonFromAgentURI(uriStr);
  if (raw !== null) {
    reg.raw = raw as string;
    agent.metadataJson = raw as string;

    const obj = json.try_fromString(raw as string);
    if (!obj.isError) {
      const value = obj.value.toObject();

      const typeVal = value.get("type");
      if (typeVal && !typeVal.isNull() && typeVal.kind == JSONValueKind.STRING) reg.type = typeVal.toString();
      const nameVal = value.get("name");
      if (nameVal && !nameVal.isNull() && nameVal.kind == JSONValueKind.STRING) {
        agent.name = nameVal.toString();
        reg.name = nameVal.toString();
      }
      const descVal = value.get("description");
      if (descVal && !descVal.isNull() && descVal.kind == JSONValueKind.STRING) {
        agent.description = descVal.toString();
        reg.description = descVal.toString();
      }
      const imageVal = value.get("image");
      if (imageVal && !imageVal.isNull() && imageVal.kind == JSONValueKind.STRING) {
        agent.image = imageVal.toString();
        reg.image = imageVal.toString();
      }

      const supportedTrustVal = value.get("supportedTrust");
      if (supportedTrustVal && supportedTrustVal.kind == JSONValueKind.ARRAY) {
        const arr = supportedTrustVal.toArray();
        const trusts = new Array<string>();
        for (let i = 0; i < arr.length; i++) {
          const v = arr[i];
          if (v.kind == JSONValueKind.STRING) trusts.push(v.toString());
        }
        reg.supportedTrust = trusts;
      }
      const endpointsVal = value.get("endpoints");
      if (endpointsVal && endpointsVal.kind == JSONValueKind.ARRAY) {
        const arr = endpointsVal.toArray();
        for (let i = 0; i < arr.length; i++) {
          const item = arr[i].toObject();
          const name = item.get("name");
          const endpoint = item.get("endpoint");
          if (name && endpoint && name.kind == JSONValueKind.STRING && endpoint.kind == JSONValueKind.STRING) {
            const n = name.toString();
            const ep = endpoint.toString();
            if (n == "A2A") { agent.a2aEndpoint = ep; reg.a2aEndpoint = ep; }
            else if (n == "ENS") { agent.ensName = ep; reg.ensName = ep; }
            // agentWallet is a reserved on-chain metadata key (not an endpoint); ignore old agentAccount endpoint.
            else if (n == "chat") { agent.set("chatEndpoint", Value.fromString(ep)); reg.chatEndpoint = ep; }
          }
        }
      }
    }
  }

  reg.save();
  agent.registration = reg.id;
}

function getOrCreateGlobalStats(ts: BigInt): GlobalStats {
  let g = GlobalStats.load("global");
  if (g == null) {
    g = new GlobalStats("global");
    g.totalAgents = BigInt.zero();
    g.totalFeedback = BigInt.zero();
    g.totalValidations = BigInt.zero();
    g.tags = [];
  }
  g.updatedAt = ts;
  return g as GlobalStats;
}

function getOrCreateAgentStats(agentId: BigInt, ts: BigInt): AgentStats {
  const id = agentId.toString();
  let s = AgentStats.load(id);
  if (s == null) {
    s = new AgentStats(id);
    s.agent = id;
    s.totalFeedback = BigInt.zero();
    s.totalValidations = BigInt.zero();
    s.tags = [];
    s.lastActivity = ts;
  }
  s.updatedAt = ts;
  s.lastActivity = ts;
  return s as AgentStats;
}

export function handleTransfer(e: TransferEvent): void {
  const col = getOrCreateCollection(e.address);
  const agentIdI64 = e.params.tokenId.toI64();
  const agentIdStr = e.params.tokenId.toString();

  let agent = Agent.load(agentIdStr);
  let from = getOrCreateAccount(e.params.from);
  let to = getOrCreateAccount(e.params.to);

  if (agent == null) {
    agent = new Agent(agentIdStr);
    agent.collection = col.id;
    agent.mintedAt = e.block.timestamp;
    
    // Prefer indexing agentURI via Registered(agentId, agentURI, owner) event.

    const stats = getOrCreateAgentStats(e.params.tokenId, e.block.timestamp);
    stats.agent = agent.id;
    agent.stats = stats.id;
    stats.save();

    const g = getOrCreateGlobalStats(e.block.timestamp);
    g.totalAgents = g.totalAgents.plus(BigInt.fromI32(1));
    g.save();
  }

  if (from.id != to.id) {
    from.balance = from.balance.minus(BigInt.fromI32(1));
    to.balance = to.balance.plus(BigInt.fromI32(1));
  }

  agent.owner = to.id;

  const id = e.transaction.hash.toHex() + "-" + e.logIndex.toString();
  const t = new AgentTransfer(id);
  t.agent = agent.id;
  t.from = from.id;
  t.to = to.id;
  t.txHash = e.transaction.hash;
  t.blockNumber = e.block.number;
  t.timestamp = e.block.timestamp;

  from.save(); to.save(); (agent as Agent).save(); (col as Collection).save(); t.save();
}

export function handleRegistered(e: RegisteredEvent): void {
  const agentIdI64 = e.params.agentId.toI64();
  const agentIdStr = e.params.agentId.toString();
  let agent = Agent.load(agentIdStr);
  if (agent == null) {
    agent = new Agent(agentIdStr);
    agent.collection = e.address;
    agent.mintedAt = e.block.timestamp;
  }

  const owner = getOrCreateAccount(e.params.owner);
  agent.owner = owner.id;

  fetchAndParseMetadata(agent as Agent, e.params.agentURI, e.block.timestamp);

  const stats = getOrCreateAgentStats(e.params.agentId, e.block.timestamp);
  stats.agent = (agent as Agent).id;
  (agent as Agent).stats = stats.id;
  stats.save();

  const g = getOrCreateGlobalStats(e.block.timestamp);
  g.save();

  owner.save();
  (agent as Agent).save();
}

export function handleApproval(_e: ApprovalEvent): void {}

export function handleApprovalForAll(_e: ApprovalForAllEvent): void {}

export function handleMetadataSet(e: MetadataSetEvent): void {
  const agentIdStr = e.params.agentId.toString();
  const key = e.params.metadataKey;
  const id = agentIdStr + "-" + key;
  
  let metadata = AgentMetadata.load(id);
  if (metadata == null) {
    metadata = new AgentMetadata(id);
    metadata.agent = agentIdStr;
    metadata.key = key;
  }
  
  metadata.value = e.params.metadataValue;
  metadata.indexedKey = e.params.indexedMetadataKey.toHexString();
  metadata.setAt = e.block.timestamp;
  metadata.setBy = e.transaction.from;
  metadata.txHash = e.transaction.hash;
  metadata.blockNumber = e.block.number;
  metadata.timestamp = e.block.timestamp;
  
  metadata.save();

  if (key == "agentWallet") {
    let agent = Agent.load(agentIdStr);
    if (agent != null) {
      const v = e.params.metadataValue;
      if (v.length == 20) agent.agentWallet = v;
      else agent.agentWallet = null;
      agent.save();
    }
  }
}

export function handleUriUpdated(e: UriUpdatedEvent): void {
  const agentIdStr = e.params.agentId.toString();
  const id = e.transaction.hash.toHex() + "-" + e.logIndex.toString();
  const u = new AgentURIUpdate(id);
  u.agent = agentIdStr;
  u.newAgentURI = e.params.newURI;
  u.updatedBy = e.params.updatedBy;
  u.txHash = e.transaction.hash;
  u.blockNumber = e.block.number;
  u.timestamp = e.block.timestamp;
  // If ipfs://CID[/path], fetch and store JSON
  const uri = e.params.newURI;
  const path = extractIpfsPath(uri);
  let data = path ? ipfs.cat(path) : null;
  if (data !== null) {
    u.newAgentURIJson = data.toString();
  }
  u.save();

  let agent = Agent.load(agentIdStr);
  if (agent != null) {
    fetchAndParseMetadata(agent, e.params.newURI, e.block.timestamp);
    agent.save();
  }
}


