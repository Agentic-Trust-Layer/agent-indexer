import { BigInt, Bytes, json, JSONValueKind, Bytes as GraphBytes, ipfs } from "@graphprotocol/graph-ts";
function extractIpfsPath(uri: string): string | null {
  if (uri.startsWith("ipfs://")) return uri.replace("ipfs://", "");
  const ipfsIdx = uri.indexOf("/ipfs/");
  if (ipfsIdx >= 0) {
    return uri.substr(ipfsIdx + 6);
  }
  // Subdomain gateways: https://<cid>.ipfs.<domain>/<optional path>
  const schemeIdx = uri.indexOf("://");
  if (schemeIdx >= 0) {
    const rest = uri.substr(schemeIdx + 3);
    const slashIdx = rest.indexOf("/");
    const host = slashIdx >= 0 ? rest.substr(0, slashIdx) : rest;
    const afterHost = slashIdx >= 0 ? rest.substr(slashIdx + 1) : "";
    const ipfsDotIdx = host.indexOf(".ipfs.");
    if (ipfsDotIdx > 0) {
      const cid = host.substr(0, ipfsDotIdx);
      return afterHost.length > 0 ? cid + "/" + afterHost : cid;
    }
  }
  return null;
}
import {
  Transfer as TransferEvent,
  Approval as ApprovalEvent,
  ApprovalForAll as ApprovalForAllEvent,
  UriUpdated as UriUpdatedEvent,
  
} from "../generated/ERC721/ERC721";
import { Account, Collection, Token, Transfer, UriUpdate } from "../generated/schema";

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

export function handleTransfer(e: TransferEvent): void {
  const col = getOrCreateCollection(e.address);
  const tokenId = e.params.tokenId.toString();

  let token = Token.load(tokenId);
  let from = getOrCreateAccount(e.params.from);
  let to = getOrCreateAccount(e.params.to);

  if (token == null) {
    token = new Token(tokenId);
    token.collection = col.id;
    token.mintedAt = e.block.timestamp;
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

export function handleUriUpdated(e: UriUpdatedEvent): void {
  const tokenId = e.params.agentId.toString();
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
    token.uri = e.params.newUri;
    // Also store JSON on token if available
    const uri2 = e.params.newUri;
    if (uri2 != null) {
      const path2 = extractIpfsPath(uri2);
      let data2 = path2 ? ipfs.cat(path2) : null;
    if (data2 !== null) {
        const raw = data2.toString();
        token.metadataJson = raw;
        const obj = json.try_fromString(raw);
        if (!obj.isError) {
          const value = obj.value.toObject();
          const nameVal = value.get("name");
          if (nameVal && !nameVal.isNull()) token.agentName = nameVal.toString();
          const descVal = value.get("description");
          if (descVal && !descVal.isNull()) token.description = descVal.toString();
          const imageVal = value.get("image");
          if (imageVal && !imageVal.isNull()) token.image = imageVal.toString();
          const endpointsVal = value.get("endpoints");
          if (endpointsVal && endpointsVal.kind == JSONValueKind.ARRAY) {
            const arr = endpointsVal.toArray();
            for (let i = 0; i < arr.length; i++) {
              const item = arr[i].toObject();
              const name = item.get("name");
              const endpoint = item.get("endpoint");
              if (name && endpoint) {
                const n = name.toString();
                const ep = endpoint.toString();
                if (n == "A2A") token.a2aEndpoint = ep;
                else if (n == "ENS") token.ensName = ep;
                else if (n == "agentAccount") token.agentAccount = ep;
              }
            }
          }
        }
      }
    }
    token.save();
  }
}


