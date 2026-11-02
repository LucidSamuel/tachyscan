# Tachyscan

The faucet now solves an Equihash(96,5) puzzle in a browser Worker before
requesting a new payment. Its gold-to-teal activity bar shows elapsed time and
search activity, supports cancellation, and respects reduced-motion settings.
Deploy the matching `tachyon-faucet` service alongside this frontend. Configure
`pow_difficulty_bits` (default 7) and `pow_challenge_seconds` (default 600) in the
faucet service; no Zakura changes or database reset are needed. Existing private
claim recovery and note downloads do not require another puzzle.

A Tachyon-flavored block explorer for a NuTachyon-enabled Zakura node. The UI is Preact; a small Rust backend keeps RPC credentials server-side and reads authoritative live Tachyon state from Zakura's `gettachyoninfo` RPC.

## Run it

Requirements: Node.js 22+, Rust 1.97+, and a Zakura node built with the `zcash_unstable="nutachyon"` cfg and PR #795. PR #983 is recommended for the authoritative `gettachyoninfo` endpoint.

```sh
npm install
npm run build

ZAKURA_RPC_URL=http://127.0.0.1:8232 \
  cargo run --release
```

Open <http://127.0.0.1:4141>. Tachyscan prefers the node's authoritative accumulator when `gettachyoninfo` is available. It also maintains `.tachyscan/index.json` from canonical verbose blocks as a fallback for nodes without PR #983. Recent transactions are usable while that backfill runs.

The navigation bar links **Explorer** (`/`), **Faucet** (`/faucet`), and
**Tutorial** (`/tutorial`). Faucet connects to the separate `tachyon-faucet`
service; Tutorial links to the Tachyon guide in the
[zcash-devtool README](https://github.com/S1nus/zcash-devtool/tree/c/tachyon-zakura#readme).
Both pages can open independently of
the explorer's node connection. The explorer keeps
the transaction type key above its stream; block and transaction detail pages
remain under Explorer. Forward `/faucet` and `/tutorial` to Tachyscan as well,
or configure an `index.html` fallback if serving `dist/` separately.

Click a transaction to open `/tx/<full-64-character-txid>`.
These URLs can be copied, bookmarked, opened in a new tab, or refreshed: transaction
details are fetched from Zakura by ID even when the block is no longer on the live
stream's current page. Browser Back/Forward navigates between views. A reverse
proxy should forward `/tx/` as well as `/api/` to Tachyscan; if serving `dist/`
directly, configure an `index.html` fallback for `/tx/` paths.

Block headers and the tip height link to `/block/<full-64-character-block-hash>`.
Block pages show metadata, Tachyon transaction/action counts, linked transactions,
previous/next blocks, and the full collapsible/copyable block JSON. They also accept
`/block/<height>`; hash URLs identify the specific block even across a reorg.
Forward `/block/` to Tachyscan too (or use an `index.html` fallback when serving the
frontend separately). Direct links do not depend on the live stream's current page.

The transaction page includes an interactive JSON explorer. Expand individual
objects, arrays, and long strings, or use **Fold all** / **Unfold all**. **Copy JSON**
copies the full, pretty-printed transaction, including folded values; clipboard
access requires HTTPS (or localhost) and browser permission.

For frontend development, run the API and Vite separately:

```sh
ZAKURA_RPC_URL=http://127.0.0.1:8232 cargo run
npm run dev
```

Vite serves the UI at <http://127.0.0.1:5173> and proxies `/api` to the backend.

## Faucet

Run the Python service from the sibling `tachyon-faucet` repository on
`127.0.0.1:4142`. Its README includes wallet setup, systemd, and nginx examples.
In production, proxy `/api/faucet/` to that service while keeping other `/api/`
requests on Tachyscan's Rust backend. Vite already has both routes configured;
add `http://localhost:5173` to the faucet's `allowed_origins` for development.

The page accepts a Tachyon payment key, displays the server's global cooldown,
and downloads the recipient's note JSON. Amount and cooldown are configured on
the service, not in the frontend. Defaults are 0.01 testnet ZEC and five minutes.
The same-tab claim survives refreshes via a private session-storage token;
download the receipt before closing the tab. No wallet keys or RPC credentials
belong in the frontend. Without the service, claiming stays disabled.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ZAKURA_RPC_URL` | required | Zakura JSON-RPC URL |
| `ZAKURA_RPC_USER` / `ZAKURA_RPC_PASSWORD` | unset | Basic RPC credentials |
| `ZAKURA_RPC_COOKIE` | unset | Path to a Zakura cookie-auth file |
| `TACHYSCAN_LISTEN` | `127.0.0.1:4141` | Explorer listen address |
| `TACHYSCAN_DATA_DIR` | `.tachyscan` | Persistent accumulator index |
| `TACHYSCAN_EPOCH_LENGTH` | `4096` | Override only for a Tachyon build using `test-epoch-size` |
| `RUST_LOG` | `tachyscan_server=info` | Backend logging filter |
