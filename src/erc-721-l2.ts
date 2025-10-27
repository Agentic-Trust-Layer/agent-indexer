import { BigInt, Bytes, json, JSONValueKind, Bytes as GraphBytes, ipfs, Value } from "@graphprotocol/graph-ts";

import {
  Transfer as TransferEvent,
  Approval as ApprovalEvent,
  ApprovalForAll as ApprovalForAllEvent,
  UriUpdated as UriUpdatedEvent,
  
} from "../generatedL2/ERC721/ERC721";
import { Account, Collection, Token, Transfer } from "../generatedL2/schema";

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




