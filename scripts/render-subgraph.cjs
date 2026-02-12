const fs = require("fs");
const path = require("path");

function must(obj, keyPath) {
  const parts = keyPath.split(".");
  let cur = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object" || !(p in cur)) {
      throw new Error(`Missing networks.json key: ${keyPath}`);
    }
    cur = cur[p];
  }
  return cur;
}

function renderTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`Missing template var: ${k}`);
    return String(vars[k]);
  });
}

function has(obj, keyPath) {
  const parts = keyPath.split(".");
  let cur = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object" || !(p in cur)) return false;
    cur = cur[p];
  }
  return true;
}

function removeDataSourceByName(manifest, name) {
  const lines = String(manifest || "").split("\n");
  const want = `    name: ${name}`;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("  - kind: ethereum")) continue;
    let ok = false;
    for (let j = i + 1; j < Math.min(lines.length, i + 10); j++) {
      if (lines[j] === want) {
        ok = true;
        break;
      }
      if (lines[j].startsWith("  - kind: ethereum")) break;
    }
    if (ok) {
      start = i;
      break;
    }
  }
  if (start < 0) return manifest;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("  - kind: ethereum")) {
      end = i;
      break;
    }
    // stop before top-level sections like templates:
    if (/^[A-Za-z]/.test(lines[i])) {
      end = i;
      break;
    }
  }

  lines.splice(start, end - start);
  // remove extra blank lines
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n") + "\n";
}

function main() {
  const repoRoot = path.join(__dirname, "..");
  const network = process.argv[2];
  if (!network) {
    console.error("Usage: node scripts/render-subgraph.cjs <network>");
    process.exit(1);
  }

  const networks = JSON.parse(fs.readFileSync(path.join(repoRoot, "networks.json"), "utf8"));
  const tmpl = fs.readFileSync(path.join(repoRoot, "subgraph.template.yaml"), "utf8");

  const vars = {
    NETWORK: network,

    ERC721_ADDRESS: must(networks, `${network}.ERC721.address`),
    ERC721_STARTBLOCK: must(networks, `${network}.ERC721.startBlock`),

    REPUTATION_ADDRESS: must(networks, `${network}.ReputationRegistry.address`),
    REPUTATION_STARTBLOCK: must(networks, `${network}.ReputationRegistry.startBlock`),

    VALIDATION_ADDRESS: must(networks, `${network}.ValidationRegistry.address`),
    VALIDATION_STARTBLOCK: must(networks, `${network}.ValidationRegistry.startBlock`),

    ASSOCIATIONS_ADDRESS: must(networks, `${network}.AssociationsStore.address`),
    ASSOCIATIONS_STARTBLOCK: must(networks, `${network}.AssociationsStore.startBlock`),
  };

  const out = renderTemplate(tmpl, vars);
  let finalOut = out;

  const disableTraces = Boolean(networks?.[network]?.disableTraces);
  if (disableTraces) {
    // Call handlers require trace APIs. Many Linea RPCs disable tracing; remove the call-based datasource.
    finalOut = removeDataSourceByName(finalOut, "AssociationsStore");
  }

  // Optional ERC-8122 AgentRegistry (only added when configured for this network)
  if (has(networks, `${network}.AgentRegistry8122.address`)) {
    const addr = must(networks, `${network}.AgentRegistry8122.address`);
    const startBlock = must(networks, `${network}.AgentRegistry8122.startBlock`);
    finalOut += `\n  - kind: ethereum\n    name: AgentRegistry8122\n    network: ${network}\n    source:\n      address: \"${addr}\"\n      abi: AgentRegistry8122\n      startBlock: ${startBlock}\n    mapping:\n      kind: ethereum/events\n      apiVersion: 0.0.9\n      language: wasm/assemblyscript\n      entities:\n        - RegistryAgent8122\n        - RegistryAgent8122Metadata\n        - RegistryAgent8122Transfer\n        - RegistryAgent8122Operator\n        - RegistryAgent8122Approval\n        - RegistryContractMetadata\n      abis:\n        - name: AgentRegistry8122\n          file: ./abis/AgentRegistry8122.json\n      eventHandlers:\n        - event: Transfer(indexed address,indexed address,indexed address,indexed uint256,uint256)\n          handler: handleRegistryTransfer\n        - event: Approval(indexed address,indexed address,indexed uint256,uint256)\n          handler: handleRegistryApproval\n        - event: OperatorSet(indexed address,indexed address,bool)\n          handler: handleRegistryOperatorSet\n        - event: Registered(indexed uint256,indexed address,string,string,address)\n          handler: handleRegistryRegistered\n        - event: MetadataSet(indexed uint256,indexed string,string,bytes)\n          handler: handleRegistryMetadataSet\n        - event: ContractMetadataUpdated(indexed string,string,bytes)\n          handler: handleRegistryContractMetadataUpdated\n      file: ./src/agent-registry-8122.ts\n`;
  }

  // Optional ERC-8122 AgentRegistry factory (spawns templates for new registries)
  const hasFactory = has(networks, `${network}.AgentRegistry8122Factory.address`);
  if (hasFactory) {
    const addr = must(networks, `${network}.AgentRegistry8122Factory.address`);
    const startBlock = must(networks, `${network}.AgentRegistry8122Factory.startBlock`);
    finalOut += `\n  - kind: ethereum\n    name: AgentRegistryFactory8122\n    network: ${network}\n    source:\n      address: \"${addr}\"\n      abi: AgentRegistryFactory8122\n      startBlock: ${startBlock}\n    mapping:\n      kind: ethereum/events\n      apiVersion: 0.0.9\n      language: wasm/assemblyscript\n      entities:\n        - RegistryAgent8122Deployment\n      abis:\n        - name: AgentRegistryFactory8122\n          file: ./abis/AgentRegistryFactory8122.json\n      eventHandlers:\n        - event: RegistryDeployed(indexed address,indexed address,bytes32)\n          handler: handleRegistryDeployed\n      file: ./src/agent-registry-factory-8122.ts\n`;
  }

  // Templates (dynamic data sources)
  if (hasFactory) {
    finalOut += `\ntemplates:\n  - kind: ethereum\n    name: AgentRegistry8122Template\n    network: ${network}\n    source:\n      abi: AgentRegistry8122\n    mapping:\n      kind: ethereum/events\n      apiVersion: 0.0.9\n      language: wasm/assemblyscript\n      entities:\n        - RegistryAgent8122\n        - RegistryAgent8122Metadata\n        - RegistryAgent8122Transfer\n        - RegistryAgent8122Operator\n        - RegistryAgent8122Approval\n        - RegistryContractMetadata\n      abis:\n        - name: AgentRegistry8122\n          file: ./abis/AgentRegistry8122.json\n      eventHandlers:\n        - event: Transfer(indexed address,indexed address,indexed address,indexed uint256,uint256)\n          handler: handleRegistryTransfer\n        - event: Approval(indexed address,indexed address,indexed uint256,uint256)\n          handler: handleRegistryApproval\n        - event: OperatorSet(indexed address,indexed address,bool)\n          handler: handleRegistryOperatorSet\n        - event: Registered(indexed uint256,indexed address,string,string,address)\n          handler: handleRegistryRegistered\n        - event: MetadataSet(indexed uint256,indexed string,string,bytes)\n          handler: handleRegistryMetadataSet\n        - event: ContractMetadataUpdated(indexed string,string,bytes)\n          handler: handleRegistryContractMetadataUpdated\n      file: ./src/agent-registry-8122.ts\n`;
  }
  const outPath = path.join(repoRoot, `subgraph.${network}.yaml`);
  fs.writeFileSync(outPath, finalOut);
  console.log(`Wrote ${outPath}`);
}

main();

