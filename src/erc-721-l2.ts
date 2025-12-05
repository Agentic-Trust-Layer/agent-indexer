import { BigInt, Bytes, json, JSONValueKind, Bytes as GraphBytes, ipfs, Value } from "@graphprotocol/graph-ts";
/**
 * Extract CID from various IPFS URI formats
 * Supports: ipfs://CID, https://gateway/ipfs/CID, https://CID.ipfs.gateway, etc.
 * Based on improved extraction logic from IPFS storage implementation
 */
function extractIpfsPath(uri: string): string | null {
  if (!uri || uri.length == 0) return null;
  
  // Remove ipfs:// prefix
  let cid = uri.startsWith("ipfs://") ? uri.substr(7) : uri;
  
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
  
  // If we still have the original URI (no scheme), check if it's a bare CID
  if (cid && cid.indexOf("/") < 0) {
    const qIdx3 = cid.indexOf("?");
    const cleanCid = qIdx3 >= 0 ? cid.substr(0, qIdx3) : cid;
    // Basic validation: at least 46 characters (v0 CID length)
    if (cleanCid.length >= 46) {
      return cleanCid;
    }
  }
  
  // If we have a CID with path, return it
  if (cid && cid.length > 0) {
    // Remove query parameters
    const qIdx4 = cid.indexOf("?");
    const cleanCid = qIdx4 >= 0 ? cid.substr(0, qIdx4) : cid;
    return cleanCid;
  }
  
  return null;
}

import {
  Transfer as TransferEvent,
  Approval as ApprovalEvent,
  ApprovalForAll as ApprovalForAllEvent,
  UriUpdated as UriUpdatedEvent,
  MetadataSet as MetadataSetEvent,
  ERC721
} from "../generatedL2/ERC721/ERC721";
import { Account, Collection, Token, Transfer, UriUpdate, TokenMetadata } from "../generatedL2/schema";

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

function fetchAndParseMetadata(token: Token, uri: string | null): void {
  if (uri == null) return;
  
  const uriStr = uri as string;
  token.uri = uriStr;
  const path = extractIpfsPath(uriStr);
  let data = path ? ipfs.cat(path) : null;
  if (data !== null) {
    const raw = data.toString();
    token.metadataJson = raw;
    const obj = json.try_fromString(raw);
    if (!obj.isError) {
      const value = obj.value.toObject();
      const nameVal = value.get("name");
      if (nameVal && !nameVal.isNull() && nameVal.kind == JSONValueKind.STRING) token.agentName = nameVal.toString();
      const descVal = value.get("description");
      if (descVal && !descVal.isNull() && descVal.kind == JSONValueKind.STRING) token.description = descVal.toString();
      const imageVal = value.get("image");
      if (imageVal && !imageVal.isNull() && imageVal.kind == JSONValueKind.STRING) token.image = imageVal.toString();
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
            if (n == "A2A") token.a2aEndpoint = ep;
            else if (n == "ENS") token.ensName = ep;
            else if (n == "agentAccount") token.agentAccount = ep;
            else if (n == "chat") token.set("chatEndpoint", Value.fromString(ep));
          }
        }
      }
    }
  }
}

export function handleTransfer(e: TransferEvent): void {
  const col = getOrCreateCollection(e.address);
  const tokenId = e.params.tokenId.toI64();

  let token = Token.load(tokenId);
  let from = getOrCreateAccount(e.params.from);
  let to = getOrCreateAccount(e.params.to);

  if (token == null) {
    token = new Token(tokenId);
    token.collection = col.id;
    token.mintedAt = e.block.timestamp;
    
    // Fetch URI and metadata for new tokens
    const contract = ERC721.bind(e.address);
    const uriResult = contract.try_tokenURI(e.params.tokenId);
    if (!uriResult.reverted) {
      fetchAndParseMetadata(token, uriResult.value);
    }
  }

  if (from.id != to.id) {
    from.balance = from.balance.minus(BigInt.fromI32(1));
    to.balance = to.balance.plus(BigInt.fromI32(1));
  }

  token.owner = to.id;

  const id = e.transaction.hash.toHex() + "-" + e.logIndex.toString();
  const t = new Transfer(id);
  t.token = token.id;
  t.from = from.id;
  t.to = to.id;
  t.txHash = e.transaction.hash;
  t.blockNumber = e.block.number;
  t.timestamp = e.block.timestamp;

  from.save(); to.save(); (token as Token).save(); (col as Collection).save(); t.save();
}

export function handleApproval(_e: ApprovalEvent): void {}

export function handleApprovalForAll(_e: ApprovalForAllEvent): void {}

export function handleMetadataSet(e: MetadataSetEvent): void {
  const tokenId = e.params.agentId.toI64();
  const key = e.params.key;
  const id = tokenId.toString() + "-" + key;
  
  let metadata = TokenMetadata.load(id);
  if (metadata == null) {
    metadata = new TokenMetadata(id);
    metadata.token = tokenId;
    metadata.key = key;
  }
  
  metadata.value = e.params.value;
  metadata.indexedKey = e.params.indexedKey.toString();
  metadata.setAt = e.block.timestamp;
  metadata.setBy = e.transaction.from;
  metadata.txHash = e.transaction.hash;
  metadata.blockNumber = e.block.number;
  metadata.timestamp = e.block.timestamp;
  
  metadata.save();
}

export function handleUriUpdated(e: UriUpdatedEvent): void {
  const tokenId = e.params.agentId.toI64();
  const id = e.transaction.hash.toHex() + "-" + e.logIndex.toString();
  const u = new UriUpdate(id);
  u.token = tokenId;
  u.newUri = e.params.newUri;
  u.updatedBy = e.params.updatedBy;
  u.txHash = e.transaction.hash;
  u.blockNumber = e.block.number;
  u.timestamp = e.block.timestamp;
  // If ipfs://CID[/path], fetch and store JSON
  const uri = e.params.newUri;
  if (uri != null) {
    const path = extractIpfsPath(uri);
    let data = path ? ipfs.cat(path) : null;
    if (data !== null) {
      u.newUriJson = data.toString();
    }
  }
  u.save();

  let token = Token.load(tokenId);
  if (token != null) {
    fetchAndParseMetadata(token, e.params.newUri);
    token.save();
  }
}


