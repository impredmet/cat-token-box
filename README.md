# CAT Token Box

This version is an update of the [CAT Token Box](https://github.com/CATProtocol/cat-token-box/) to avoid using a tracker (which required syncing transactions through a database). Now, the project connects directly to a Bitcoin node using RPC for transaction handling. Instead of the previous tracker method that required syncing a database of transactions, the node now only needs to sync to the latest block, which is faster as it doesn't involve syncing individual transactions. However, you need to run your own Bitcoin node and ensure it is synced to the latest block.

## Features

- **No more tracker**: Syncs directly with the Bitcoin node for transaction handling, skipping the database sync previously required.
- **Automatic fee fetching**: Fees are fetched directly from the Mempool API.
- **Faster synchronization**: Since the node handles block syncing itself (instead of the previous method where a tracker used a database for transactions), you just need to make sure your node is synced to the latest block.

## Prerequisites

- Node.js (>=20)
- [Set up a Full Bitcoin Node with RPC access](https://github.com/impredmet/cat20-mint-guide): Follow this guide to set up your node on a VPS. It includes a script that handles everything for you. Once you reach step 3.1, your node will be ready, and you can use the VPS IP as the RPC IP for the CLI configuration. The username and password for the node's RPC should remain unchanged from the guide.

## Installation

1. Clone the repository:

```bash
git clone https://github.com/impredmet/cat-token-box.git
cd cat-token-box
```

2. Install the dependencies:

```bash
yarn install
# or
npm install
```

3. Build the project:

```bash
yarn build
# or
npm run build
```

4. Navigate to the CLI package:

```bash
cd packages/cli
```

5. Update the `config.json` file with the correct RPC URL, username, and password of your node.

6. Create a new wallet:

```bash
yarn cli wallet create
# or
npm run cli wallet create
```

7. You can then modify the `wallet.json` with your own mnemonic to import an existing wallet.

## Minting CAT Tokens

Example command to mint a CAT token with an amount of 5:

```bash
yarn cli mint -i 45ee725c2c5993b3e4d308842d87e973bf1951f5f7a804b21e4dd964ecd12d6b_0 5
# or
npm run cli mint -i 45ee725c2c5993b3e4d308842d87e973bf1951f5f7a804b21e4dd964ecd12d6b_0 5
```

### License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

### Contributions

Contributions are welcome! If you have ideas for improvements or new features, feel free to fork the repository and submit a pull request.
