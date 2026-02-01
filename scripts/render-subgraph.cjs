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
  const outPath = path.join(repoRoot, `subgraph.${network}.yaml`);
  fs.writeFileSync(outPath, out);
  console.log(`Wrote ${outPath}`);
}

main();

