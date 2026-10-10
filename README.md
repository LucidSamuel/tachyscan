# Tachyscan

A Tachyon-flavored block explorer for a NuTachyon-enabled Zakura node. The UI is Preact; a small Rust backend keeps RPC credentials server-side and reads authoritative live Tachyon state from Zakura's `gettachyoninfo` RPC.

## Run it

Requirements: Node.js 22+, Rust 1.97+, and a Zakura node built with the `zcash_unstable="nutachyon"` cfg and PR #795. PR #983 is recommended for the authoritative `gettachyoninfo` endpoint.

```sh
npm install
npm run build

ZAKURA_RPC_URL=http://127.0.0.1:8232 \
  cargo run --release
```

Open <http://127.0.0.1:4141>. Tachyscan prefers the node's authoritative accumulator and retained Tachygram summary when `gettachyoninfo` is available. It also maintains `.tachyscan/index.json` from canonical verbose blocks for the historical footprint chart and as a fallback for nodes without PR #983. Recent transactions are usable while that backfill runs.

Click a transaction (or its linked Tachygram brick) to open `/tx/<full-64-character-txid>`.
These URLs can be copied, bookmarked, opened in a new tab, or refreshed: transaction
details are fetched from Zakura by ID even when the block is no longer on the live
stream's current page. Browser Back/Forward navigates between views. A reverse
proxy should forward `/tx/` as well as `/api/` to Tachyscan; if serving `dist/`
directly, configure an `index.html` fallback for `/tx/` paths.

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

The displayed footprint is the logical 32-byte payload size of the currently retained Tachygrams, rather than RocksDB's engine-dependent on-disk allocation.
