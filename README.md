# Asset-Vault-Arch

This project is a **Bitcoin asset management vault on Arch Network**, handling:
- **BTC**
- **Ordinals**
- **Runes**

It’s a powerful smart contract system with on-chain asset routing, ownership, and treasury logic — written in **Rust** for **Arch VM**.

```md
# 🛡️ Asset Vault on Arch Network

A secure, programmable **Bitcoin asset vault** built for the [Arch Network](https://arch.network/), designed to manage:

- 🟠 **BTC (native)**
- 🟦 **Ordinals (NFTs)**
- 🟡 **Runes (fungible tokens)**

---

## 💡 What is Asset Vault?

Asset Vault is an **on-chain smart contract system** that allows you to:

- Securely store Bitcoin and Bitcoin-based assets (Ordinals & Runes)
- Transfer assets programmatically using Arch instructions
- Route and manage ownership of on-chain funds
- Interface with external wallets (Xverse, Unisat, etc.)
- Build Bitcoin-native DeFi logic on the Arch VM

---

## 🚀 Features

- 🔐 **Vault security**: All assets are held under a smart contract with programmable access
- 💸 **BTC management**: Deposit & withdraw native Bitcoin
- 🖼️ **Ordinal support**: Track & route individual inscriptions
- 💱 **Rune token logic**: Custom token handling via etch and send
- 🧠 **Fully written in Rust** using the Arch SDK
- 📡 **Integrates with the Arch Validator & Bitcoin regtest network**

---

## 📦 Prerequisites

| Tool              | Version/Info            |
|-------------------|-------------------------|
| Rust              | latest stable           |
| Node.js           | 16.x or later (for frontend) |
| Arch Network CLI  | [Install](https://docs.arch.network) |
| Bitcoin Core      | running in `regtest` mode |
| Electrs Indexer   | Arch fork required      |
| Ordinals Wallet   | Unisat, Xverse, or Leather |

---

## 🛠️ Setup Instructions

### 1. Install Rust toolchain

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

---

### 2. Clone this repo

```bash
git clone https://github.com/topnotch1998/Asset-Vault-Arch.git
cd Asset-Vault-Arch
```

---

### 3. Setup Bitcoin Regtest

```bash
# Install Bitcoin Core (if not yet)
sudo pacman -S bitcoin  # for Arch/Manjaro

# Create config
mkdir -p ~/.bitcoin
cat <<EOF > ~/.bitcoin/bitcoin.conf
regtest=1
server=1
rpcuser=bitcoin
rpcpassword=bitcoinpass
rpcallowip=0.0.0.0/0
rpcbind=0.0.0.0
EOF

bitcoind -regtest -daemon
```

---

### 4. Start Electrs

```bash
git clone https://github.com/Arch-Network/electrs.git
cd electrs
cargo build --release

cargo run --release --bin electrs -- -vvvv \
  --daemon-dir ~/.bitcoin \
  --network regtest \
  --cookie bitcoin:bitcoinpass
```

---

### 5. Run Arch Validator

```bash
arch-cli validator-start
```

---

## 🧪 Development & Testing

This vault runs in full sync with Bitcoin regtest, Electrs indexer, and Arch VM.

You can:
- Deploy smart contracts
- Send testnet BTC
- Mint and move Ordinals & Runes
- Simulate vault logic locally

Use `arch-cli` and the project’s Rust codebase to trigger and test actions.

---


## 📚 Resources

- [Arch Network Docs](https://docs.arch.network)
- [Ordinals Protocol](https://docs.ordinals.com/)
- [Runes Protocol Spec](https://docs.ordinals.com/runes.html)
- [BDK (Bitcoin Dev Kit)](https://bitcoindevkit.org)

---

## 🤝 Contributing

1. Fork the project
2. Create a feature branch:  
   `git checkout -b feature/your-feature`
3. Commit your changes:  
   `git commit -m "Add: new feature"`
4. Push to your fork:  
   `git push origin feature/your-feature`
5. Open a Pull Request

---

## 🛡️ License

This project is licensed under the MIT License.  
See the [LICENSE](./LICENSE) file for more details.

---

Built with 🦀 Rust • Powered by 🧠 Arch Network • Designed by 🛠️ [topnotch1998](https://github.com/topnotch1998)
```
