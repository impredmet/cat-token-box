# CAT Token Box

A reference implementation of the `Covenant Attested Token (CAT)` protocol on BTC signet and Fractal, where `OP_CAT` is re-activated.

## Out of the Box

There are three major packages implementing the protocol and tools for `CAT` out of the box.

```bash
packages
├── cli
├── common
├── smartcontracts
```

- `smartcontracts`

Smart contracts implementing the `CAT` protocol written in [sCrypt](https://github.com/sCrypt-Inc/scrypt-ts).

- `cli`

A `Command Line Interface (CLI)` tool that can `deploy` / `mint` / `transfer` `CAT` protocol tokens.

## Prerequisites

- Node.js Environment

Make sure you have `Node.js` >=20 and `yarn` installed.

You can follow the guide [here](https://nodejs.org/en/download/package-manager) to install `Node.js`.

Also, you can check its version use this command:

```bash
node -v
```

Use this command to install `yarn` if it's not installed:

```bash
npm i -g yarn
```

- Full Node
- Postgres Database

## How to Run the Project

### 1. Build the project

Run this command under the project's root directory to build the whole project:

```bash
yarn install && yarn build
```

## 2. Execute `CLI` commands

After the noce syncs up to the latest block, you can execute all kinds of commands provided by the `cli` package to interact with `CAT` protocol tokens. Refer to [this document](./packages/cli/README.md) to see more details.

## Development & Test

Run this command under the root directory to run all tests from these packages:

```bash
turbo test
```
