use std::{
    collections::{BTreeMap, VecDeque},
    env,
    path::PathBuf,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures::{stream, StreamExt as _, TryStreamExt as _};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::RwLock;
use tower_http::{services::ServeDir, trace::TraceLayer};
use tracing::{info, warn};
use zcash_tachyon::{Anchor, EpochIndex, TachygramSetCommit};

mod blocks;
mod transactions;

const DEFAULT_EPOCH_LENGTH: u32 = zcash_tachyon::constants::EPOCH_SIZE;
const TACHYGRAM_BYTES: u64 = 32;
const MAX_CHART_EPOCHS: u32 = 6;
const DEFAULT_BLOCK_TARGET_SECONDS: u64 = 75;
const BLOCK_CADENCE_SAMPLE_LIMIT: usize = 12;
/// How far behind the tip the index may be for a dashboard request to catch it up inline.
const CATCH_UP_BLOCKS: u32 = 64;

#[derive(Clone)]
struct AppState {
    rpc: RpcClient,
    index: Arc<RwLock<TachyonIndex>>,
    cache_path: PathBuf,
    epoch_length: u32,
    block_cadence: Arc<tokio::sync::Mutex<BlockCadence>>,
    /// Serializes index updates so the background loop and on-demand catch-ups never
    /// apply the same block twice.
    sync_lock: Arc<tokio::sync::Mutex<()>>,
}

#[derive(Clone)]
struct RpcClient {
    client: reqwest::Client,
    url: String,
    authorization: Option<String>,
}

impl RpcClient {
    fn from_env() -> Result<Self, String> {
        let url = env::var("ZAKURA_RPC_URL").map_err(|_| {
            "ZAKURA_RPC_URL must point to a Tachyon-enabled Zakura JSON-RPC endpoint".to_string()
        })?;
        let authorization = match (
            env::var("ZAKURA_RPC_USER").ok(),
            env::var("ZAKURA_RPC_PASSWORD").ok(),
        ) {
            (Some(user), Some(password)) => Some(format!(
                "Basic {}",
                STANDARD.encode(format!("{user}:{password}"))
            )),
            _ => env::var("ZAKURA_RPC_COOKIE")
                .ok()
                .and_then(|path| std::fs::read_to_string(path).ok())
                .map(|cookie| format!("Basic {}", STANDARD.encode(cookie.trim()))),
        };
        Ok(Self {
            client: reqwest::Client::new(),
            url,
            authorization,
        })
    }

    async fn call<T: DeserializeOwned>(&self, method: &str, params: Value) -> Result<T, String> {
        let mut request = self.client.post(&self.url).json(&json!({
            "jsonrpc": "2.0",
            "id": "tachyscan",
            "method": method,
            "params": params,
        }));
        if let Some(authorization) = &self.authorization {
            request = request.header("Authorization", authorization);
        }
        let response = request
            .send()
            .await
            .map_err(|error| format!("could not reach Zakura: {error}"))?;
        if !response.status().is_success() {
            return Err(format!("Zakura RPC returned HTTP {}", response.status()));
        }
        let body: RpcResponse<T> = response
            .json()
            .await
            .map_err(|error| format!("invalid Zakura RPC response: {error}"))?;
        match (body.result, body.error) {
            (Some(result), _) => Ok(result),
            (_, Some(error)) => Err(format!("Zakura RPC {}: {}", error.code, error.message)),
            _ => Err("Zakura RPC returned neither a result nor an error".to_string()),
        }
    }

    async fn block_at(&self, height: u32) -> Result<RpcBlock, String> {
        let hash: String = self.call("getblockhash", json!([height])).await?;
        let mut block: RpcBlock = self.call("getblock", json!([hash, 2])).await?;
        if block.hash.is_empty() {
            block.hash = hash;
        }
        Ok(block)
    }
}

#[derive(Deserialize)]
struct RpcResponse<T> {
    result: Option<T>,
    error: Option<RpcError>,
}

#[derive(Deserialize)]
struct RpcError {
    code: i64,
    message: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct RpcBlock {
    #[serde(default)]
    hash: String,
    height: u32,
    time: i64,
    #[serde(rename(deserialize = "tx", serialize = "transactions"), default)]
    transactions: Vec<Value>,
    #[serde(rename(deserialize = "valuePools"), default, skip_serializing)]
    value_pools: Vec<Value>,
}

impl RpcBlock {
    /// The Tachyon pool balance after this block, when the node reports value pools.
    fn tachyon_pool_zat(&self) -> Option<i64> {
        self.value_pools
            .iter()
            .find(|pool| pool.get("id").and_then(Value::as_str) == Some("tachyon"))
            .and_then(|pool| pool.get("chainValueZat").and_then(Value::as_i64))
    }
}

#[derive(Deserialize)]
struct BlockchainInfo {
    chain: String,
    blocks: u32,
    #[serde(rename = "bestblockhash")]
    best_block_hash: String,
    upgrades: BTreeMap<String, UpgradeInfo>,
}

#[derive(Deserialize)]
struct UpgradeInfo {
    name: String,
    #[serde(rename = "activationheight")]
    activation_height: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TachyonInfo {
    activation_height: u32,
    epoch_length: u32,
    tip_anchor: String,
    retained_tachygram_count: usize,
    tachygram_payload_bytes: u64,
    recent_tachygrams: Vec<RpcRetainedTachygram>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RpcRetainedTachygram {
    tachygram: String,
    revealed_height: u32,
}

#[derive(Debug, Default)]
struct BlockCadence {
    last_height: Option<u32>,
    last_observed_millis: Option<i64>,
    intervals: VecDeque<u64>,
}

impl BlockCadence {
    fn observe(&mut self, height: u32) -> (u64, Option<i64>) {
        match unix_time_millis() {
            Some(now_millis) => self.observe_at(height, now_millis),
            None => (
                self.median_interval()
                    .unwrap_or(DEFAULT_BLOCK_TARGET_SECONDS),
                None,
            ),
        }
    }

    fn observe_at(&mut self, height: u32, now_millis: i64) -> (u64, Option<i64>) {
        if self.last_height != Some(height) {
            if let (Some(previous_height), Some(previous_millis)) =
                (self.last_height, self.last_observed_millis)
            {
                let height_delta = height.saturating_sub(previous_height);
                let elapsed_millis = now_millis.saturating_sub(previous_millis);
                if height_delta > 0 && elapsed_millis > 0 {
                    let elapsed_millis = u64::try_from(elapsed_millis)
                        .expect("positive elapsed milliseconds fit in u64");
                    let interval_seconds = elapsed_millis
                        .div_ceil(u64::from(height_delta))
                        .div_ceil(1_000)
                        .max(1);
                    self.intervals.push_back(interval_seconds);
                    if self.intervals.len() > BLOCK_CADENCE_SAMPLE_LIMIT {
                        self.intervals.pop_front();
                    }
                }
            }
            self.last_height = Some(height);
            self.last_observed_millis = Some(now_millis);
        }

        let target_seconds = self
            .median_interval()
            .unwrap_or(DEFAULT_BLOCK_TARGET_SECONDS);
        let next_block_estimate = self.last_observed_millis.map(|observed_millis| {
            let target_millis =
                i64::try_from(target_seconds.saturating_mul(1_000)).unwrap_or(i64::MAX);
            observed_millis.saturating_add(target_millis)
        });

        (target_seconds, next_block_estimate)
    }

    fn median_interval(&self) -> Option<u64> {
        let mut intervals = self.intervals.iter().copied().collect::<Vec<_>>();
        intervals.sort_unstable();
        intervals.get(intervals.len() / 2).copied()
    }
}

fn unix_time_millis() -> Option<i64> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis();
    i64::try_from(millis).ok()
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TachyonIndex {
    activation_height: Option<u32>,
    scanned_height: Option<u32>,
    scanned_hash: Option<String>,
    anchor: Option<String>,
    tachygrams: BTreeMap<String, u32>,
    footprint_history: Vec<FootprintPoint>,
    status: IndexStatus,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct IndexStatus {
    phase: String,
    scanned_height: Option<u32>,
    target_height: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct FootprintPoint {
    height: u32,
    bytes: u64,
}

#[derive(Deserialize)]
struct DashboardQuery {
    #[serde(default = "default_page")]
    page: u32,
    #[serde(default = "default_limit")]
    limit: u32,
}

fn default_page() -> u32 {
    1
}
fn default_limit() -> u32 {
    8
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DashboardResponse {
    network: String,
    height: u32,
    best_block_hash: String,
    activation_height: u32,
    epoch_length: u32,
    block_target_seconds: u64,
    next_block_estimate: Option<i64>,
    accumulator: Option<String>,
    retained_tachygram_count: usize,
    tachygrams: Vec<TachygramResponse>,
    tachyon_pool_zat: Option<i64>,
    footprint_bytes: u64,
    footprint_history: Vec<FootprintPoint>,
    index: IndexStatus,
    blocks: Vec<RpcBlock>,
    page: u32,
    page_count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TachygramResponse {
    value: String,
    revealed_height: u32,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("tachyscan_server=info".parse().unwrap()),
        )
        .init();

    let rpc = RpcClient::from_env().unwrap_or_else(|error| {
        eprintln!("tachyscan: {error}");
        std::process::exit(2);
    });
    let data_dir = env::var("TACHYSCAN_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(".tachyscan"));
    if let Err(error) = std::fs::create_dir_all(&data_dir) {
        eprintln!(
            "tachyscan: could not create {}: {error}",
            data_dir.display()
        );
        std::process::exit(2);
    }
    let cache_path = data_dir.join("index.json");
    let index = std::fs::read(&cache_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let epoch_length = env::var("TACHYSCAN_EPOCH_LENGTH")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_EPOCH_LENGTH);
    let state = AppState {
        rpc,
        index: Arc::new(RwLock::new(index)),
        cache_path,
        epoch_length,
        block_cadence: Arc::new(tokio::sync::Mutex::new(BlockCadence::default())),
        sync_lock: Arc::default(),
    };

    let sync_state = state.clone();
    tokio::spawn(async move {
        loop {
            if let Err(error) = sync_index(&sync_state).await {
                warn!(%error, "Tachyon index update failed");
                let mut index = sync_state.index.write().await;
                index.status.phase = "error".to_string();
                index.status.message = Some(error);
            }
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });

    let app = app_router(state, "dist");
    let listen = env::var("TACHYSCAN_LISTEN").unwrap_or_else(|_| "127.0.0.1:4141".to_string());
    let listener = tokio::net::TcpListener::bind(&listen)
        .await
        .unwrap_or_else(|error| {
            eprintln!("tachyscan: could not listen on {listen}: {error}");
            std::process::exit(2);
        });
    info!(%listen, "Tachyscan is ready");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown())
        .await
        .unwrap();
}

fn app_router(state: AppState, assets_dir: &str) -> Router {
    let index = PathBuf::from(assets_dir).join("index.html");
    Router::new()
        .route("/api/health", get(health))
        .route("/api/dashboard", get(dashboard))
        .route("/api/transactions/{txid}", get(transactions::transaction))
        .route("/api/blocks/{id}", get(blocks::block))
        .route_service(
            "/block/{id}",
            tower_http::services::ServeFile::new(index.clone()),
        )
        .route_service(
            "/block/{id}/",
            tower_http::services::ServeFile::new(index.clone()),
        )
        .route_service(
            "/tx/{txid}",
            tower_http::services::ServeFile::new(index.clone()),
        )
        .route_service("/tx/{txid}/", tower_http::services::ServeFile::new(index))
        .fallback_service(ServeDir::new(assets_dir).append_index_html_on_directories(true))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn shutdown() {
    let _ = tokio::signal::ctrl_c().await;
}

async fn health() -> &'static str {
    "ok"
}

async fn dashboard(
    State(state): State<AppState>,
    Query(query): Query<DashboardQuery>,
) -> Result<Json<DashboardResponse>, (StatusCode, Json<Value>)> {
    build_dashboard(&state, query)
        .await
        .map(Json)
        .map_err(|error| (StatusCode::BAD_GATEWAY, Json(json!({ "error": error }))))
}

async fn build_dashboard(
    state: &AppState,
    query: DashboardQuery,
) -> Result<DashboardResponse, String> {
    let info: BlockchainInfo = state.rpc.call("getblockchaininfo", json!([])).await?;
    let tachyon_info: Option<TachyonInfo> = state.rpc.call("gettachyoninfo", json!([])).await.ok();
    let activation_height = tachyon_info
        .as_ref()
        .map(|info| info.activation_height)
        .or_else(|| tachyon_activation(&info))
        .ok_or_else(|| {
            "This Zakura node does not advertise a NuTachyon network upgrade".to_string()
        })?;
    let page = query.page.max(1);
    let limit = query.limit.clamp(1, 24);
    let available_blocks = info
        .blocks
        .saturating_sub(activation_height)
        .saturating_add(1);
    let page_count = available_blocks.div_ceil(limit).max(1);
    let page = page.min(page_count);
    let newest = info.blocks.saturating_sub((page - 1).saturating_mul(limit));
    let oldest = newest.saturating_sub(limit - 1).max(activation_height);
    let heights: Vec<u32> = (oldest..=newest).rev().collect();
    let blocks: Vec<RpcBlock> = stream::iter(heights)
        .map(|height| state.rpc.block_at(height))
        .buffered(8)
        .try_collect()
        .await?;

    let (block_target_seconds, next_block_estimate) =
        state.block_cadence.lock().await.observe(info.blocks);

    // Serve the index-derived fields at the tip this response reports. The background
    // loop polls every few seconds, so without this a fresh block leaves the header one
    // block ahead of the tachygrams, activity and footprint beneath it.
    let lag = {
        let index = state.index.read().await;
        match (index.status.phase.as_str(), index.scanned_height) {
            ("ready", Some(scanned)) => info.blocks.saturating_sub(scanned),
            _ => 0,
        }
    };
    if lag > 0 && lag <= CATCH_UP_BLOCKS {
        if let Err(error) = sync_index(state).await {
            warn!(%error, "on-demand Tachyon index catch-up failed");
        }
    }
    let mut index = state.index.read().await.clone();
    if index.status.phase == "ready"
        && index
            .scanned_height
            .is_some_and(|scanned| scanned < info.blocks)
    {
        index.status.phase = "syncing".to_string();
        index.status.target_height = info.blocks;
    }
    let tachyon_pool_zat = match blocks.first() {
        Some(tip) if tip.height == info.blocks => tip.tachyon_pool_zat(),
        _ => state.rpc.block_at(info.blocks).await?.tachyon_pool_zat(),
    };
    let tachygrams = tachyon_info.as_ref().map_or_else(
        || {
            index
                .tachygrams
                .iter()
                .map(|(value, revealed_height)| TachygramResponse {
                    value: value.clone(),
                    revealed_height: *revealed_height,
                })
                .collect::<Vec<_>>()
        },
        |info| {
            info.recent_tachygrams
                .iter()
                .map(|tachygram| TachygramResponse {
                    value: tachygram.tachygram.clone(),
                    revealed_height: tachygram.revealed_height,
                })
                .collect()
        },
    );
    let accumulator = tachyon_info
        .as_ref()
        .map(|info| info.tip_anchor.clone())
        .or(index.anchor);
    let epoch_length = tachyon_info
        .as_ref()
        .map_or(state.epoch_length, |info| info.epoch_length);
    let footprint_bytes = tachyon_info
        .as_ref()
        .map_or(tachygrams.len() as u64 * TACHYGRAM_BYTES, |info| {
            info.tachygram_payload_bytes
        });
    let retained_tachygram_count = tachyon_info
        .as_ref()
        .map_or(tachygrams.len(), |info| info.retained_tachygram_count);

    Ok(DashboardResponse {
        network: info.chain,
        height: info.blocks,
        best_block_hash: info.best_block_hash,
        activation_height,
        epoch_length,
        block_target_seconds,
        next_block_estimate,
        accumulator,
        retained_tachygram_count,
        tachyon_pool_zat,
        footprint_bytes,
        tachygrams,
        footprint_history: index.footprint_history,
        index: index.status,
        blocks,
        page,
        page_count,
    })
}

async fn sync_index(state: &AppState) -> Result<(), String> {
    let _guard = state.sync_lock.lock().await;
    let info: BlockchainInfo = state.rpc.call("getblockchaininfo", json!([])).await?;
    let activation = tachyon_activation(&info)
        .ok_or_else(|| "connected node is not Tachyon-enabled".to_string())?;

    {
        let index = state.index.read().await;
        if index.activation_height != Some(activation) {
            drop(index);
            *state.index.write().await = fresh_index(activation, info.blocks);
        } else if let (Some(height), Some(expected_hash)) =
            (index.scanned_height, index.scanned_hash.as_ref())
        {
            let canonical_hash: String = state.rpc.call("getblockhash", json!([height])).await?;
            if &canonical_hash != expected_hash {
                drop(index);
                warn!(
                    height,
                    "chain reorganization detected; rebuilding Tachyon index"
                );
                *state.index.write().await = fresh_index(activation, info.blocks);
            }
        }
    }

    let start = state
        .index
        .read()
        .await
        .scanned_height
        .map_or(activation, |height| height.saturating_add(1));
    if start > info.blocks {
        let mut index = state.index.write().await;
        index.status = IndexStatus {
            phase: "ready".to_string(),
            scanned_height: index.scanned_height,
            target_height: info.blocks,
            message: None,
        };
        return Ok(());
    }

    {
        let mut index = state.index.write().await;
        index.status = IndexStatus {
            phase: "syncing".to_string(),
            scanned_height: index.scanned_height,
            target_height: info.blocks,
            message: None,
        };
    }

    for chunk_start in (start..=info.blocks).step_by(32) {
        let chunk_end = chunk_start.saturating_add(31).min(info.blocks);
        let blocks: Vec<RpcBlock> = stream::iter(chunk_start..=chunk_end)
            .map(|height| state.rpc.block_at(height))
            .buffered(8)
            .try_collect()
            .await?;
        {
            let mut index = state.index.write().await;
            for block in &blocks {
                apply_block(&mut index, block, activation, state.epoch_length)?;
            }
            index.status.scanned_height = index.scanned_height;
            trim_history(
                &mut index.footprint_history,
                info.blocks,
                state.epoch_length,
            );
            persist_index(&state.cache_path, &index)?;
        }
        tokio::task::yield_now().await;
    }

    let mut index = state.index.write().await;
    index.status = IndexStatus {
        phase: "ready".to_string(),
        scanned_height: index.scanned_height,
        target_height: info.blocks,
        message: None,
    };
    persist_index(&state.cache_path, &index)?;
    Ok(())
}

fn fresh_index(activation: u32, target: u32) -> TachyonIndex {
    TachyonIndex {
        activation_height: Some(activation),
        status: IndexStatus {
            phase: "syncing".to_string(),
            scanned_height: None,
            target_height: target,
            message: None,
        },
        ..TachyonIndex::default()
    }
}

fn apply_block(
    index: &mut TachyonIndex,
    block: &RpcBlock,
    activation: u32,
    epoch_length: u32,
) -> Result<(), String> {
    if block.height < activation {
        return Ok(());
    }
    let pool_height = block.height - activation;
    let epoch = pool_height / epoch_length;
    let mut anchor = match &index.anchor {
        Some(encoded) => Anchor::read(
            hex::decode(encoded)
                .map_err(|error| format!("invalid cached anchor: {error}"))?
                .as_slice(),
        )
        .map_err(|error| format!("invalid cached anchor: {error}"))?,
        None => Anchor::default(),
    };

    if pool_height > 0 && pool_height.is_multiple_of(epoch_length) {
        anchor = anchor
            .next_epoch(EpochIndex(epoch))
            .map_err(|error| format!("block {} epoch transition: {error}", block.height))?;
        let cutoff = block.height.saturating_sub(epoch_length);
        index
            .tachygrams
            .retain(|_, revealed_height| *revealed_height >= cutoff);
    }

    for transaction in &block.transactions {
        let Some(stamp) = transaction.pointer("/tachyon/stamp") else {
            continue;
        };
        if stamp.get("type").and_then(Value::as_str) != Some("proof") {
            continue;
        }
        let encoded = stamp
            .get("tachygramSet")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                format!(
                    "block {} has a proof stamp without tachygramSet",
                    block.height
                )
            })?;
        let bytes = hex::decode(encoded).map_err(|error| {
            format!(
                "block {} has an invalid tachygramSet: {error}",
                block.height
            )
        })?;
        let commitment = TachygramSetCommit::read(bytes.as_slice()).map_err(|error| {
            format!(
                "block {} has a non-canonical tachygramSet: {error}",
                block.height
            )
        })?;
        anchor = anchor
            .next_stamp(EpochIndex(epoch), &commitment)
            .map_err(|error| {
                format!(
                    "block {} accumulator transition failed: {error}",
                    block.height
                )
            })?;
        if let Some(tachygrams) = stamp.get("tachygrams").and_then(Value::as_array) {
            for tachygram in tachygrams.iter().filter_map(Value::as_str) {
                index.tachygrams.insert(tachygram.to_string(), block.height);
            }
        }
    }

    let mut encoded_anchor = Vec::with_capacity(32);
    anchor
        .write(&mut encoded_anchor)
        .map_err(|error| format!("could not encode accumulator: {error}"))?;
    index.anchor = Some(hex::encode(encoded_anchor));
    index.scanned_height = Some(block.height);
    index.scanned_hash = Some(block.hash.clone());
    index.footprint_history.push(FootprintPoint {
        height: block.height,
        bytes: index.tachygrams.len() as u64 * TACHYGRAM_BYTES,
    });
    Ok(())
}

fn tachyon_activation(info: &BlockchainInfo) -> Option<u32> {
    info.upgrades
        .values()
        .find(|upgrade| upgrade.name.to_ascii_lowercase().contains("tachyon"))
        .map(|upgrade| upgrade.activation_height)
}

fn trim_history(history: &mut Vec<FootprintPoint>, tip: u32, epoch_length: u32) {
    let cutoff = tip.saturating_sub(epoch_length.saturating_mul(MAX_CHART_EPOCHS));
    let first_retained = history.partition_point(|point| point.height < cutoff);
    if first_retained > 0 {
        history.drain(..first_retained);
    }
}

fn persist_index(path: &PathBuf, index: &TachyonIndex) -> Result<(), String> {
    let bytes =
        serde_json::to_vec(index).map_err(|error| format!("could not serialize index: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, bytes)
        .map_err(|error| format!("could not write {}: {error}", temporary.display()))?;
    std::fs::rename(&temporary, path)
        .map_err(|error| format!("could not replace {}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_nutachyon_by_name() {
        let info = BlockchainInfo {
            chain: "tachyontestnet".into(),
            blocks: 12,
            best_block_hash: "00".into(),
            upgrades: BTreeMap::from([(
                "c8e71055".into(),
                UpgradeInfo {
                    name: "NuTachyon".into(),
                    activation_height: 7,
                },
            )]),
        };
        assert_eq!(tachyon_activation(&info), Some(7));
    }

    #[test]
    fn deserializes_authoritative_tachyon_info() {
        let info: TachyonInfo = serde_json::from_value(json!({
            "height": 12,
            "activationHeight": 7,
            "epoch": 0,
            "epochLength": 4096,
            "nextEpochHeight": 4103,
            "tipAnchor": "11".repeat(32),
            "retainedTachygramCount": 2,
            "tachygramPayloadBytes": 64,
            "recentTachygrams": [{
                "tachygram": "22".repeat(32),
                "revealedHeight": 12
            }]
        }))
        .unwrap();

        assert_eq!(info.activation_height, 7);
        assert_eq!(info.tip_anchor, "11".repeat(32));
        assert_eq!(info.retained_tachygram_count, 2);
        assert_eq!(info.recent_tachygrams[0].revealed_height, 12);
    }

    #[test]
    fn dashboard_blocks_serialize_transactions_for_the_frontend() {
        let block: RpcBlock = serde_json::from_value(json!({
            "hash": "00",
            "height": 8,
            "time": 1,
            "tx": [{"txid": "11"}]
        }))
        .unwrap();

        let serialized = serde_json::to_value(block).unwrap();

        assert!(serialized.get("tx").is_none());
        assert_eq!(serialized["transactions"][0]["txid"], "11");
    }

    #[tokio::test]
    async fn dashboard_catches_the_index_up_to_the_tip_before_answering() {
        use axum::{routing::post, Json, Router};
        use std::sync::atomic::{AtomicU32, Ordering};

        let tip = Arc::new(AtomicU32::new(8));
        let rpc_tip = tip.clone();
        let rpc_app = Router::new().route(
            "/",
            post(move |Json(request): Json<Value>| {
                let tip = rpc_tip.clone();
                async move {
                    let hash = |height: u32| format!("{height:064x}");
                    match request["method"].as_str().unwrap() {
                        "getblockchaininfo" => Json(json!({ "result": {
                            "chain": "test",
                            "blocks": tip.load(Ordering::SeqCst),
                            "bestblockhash": hash(tip.load(Ordering::SeqCst)),
                            "upgrades": { "c8e71055": { "name": "NuTachyon", "activationheight": 8 } },
                        }})),
                        "getblockhash" => Json(json!({ "result": hash(request["params"][0].as_u64().unwrap() as u32) })),
                        "getblock" => {
                            let height = u32::from_str_radix(request["params"][0].as_str().unwrap(), 16).unwrap();
                            Json(json!({ "result": {
                                "hash": hash(height), "height": height, "time": 1, "tx": [],
                                "valuePools": [{ "id": "tachyon", "chainValueZat": 500 + i64::from(height) }],
                            }}))
                        }
                        "gettachyoninfo" => Json(json!({ "error": { "code": -32601, "message": "unknown" } })),
                        other => panic!("unexpected RPC {other}"),
                    }
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let rpc_url = format!("http://{}", listener.local_addr().unwrap());
        let rpc_server = tokio::spawn(async move { axum::serve(listener, rpc_app).await.unwrap() });
        let cache_path =
            std::env::temp_dir().join(format!("tachyscan-catch-up-{}.json", std::process::id()));
        let state = AppState {
            rpc: RpcClient {
                client: reqwest::Client::new(),
                url: rpc_url,
                authorization: None,
            },
            index: Arc::new(RwLock::new(TachyonIndex::default())),
            cache_path: cache_path.clone(),
            epoch_length: DEFAULT_EPOCH_LENGTH,
            block_cadence: Arc::default(),
            sync_lock: Arc::default(),
        };

        // The background loop has seen the tip at 8 and reports ready.
        sync_index(&state).await.unwrap();
        assert_eq!(state.index.read().await.status.phase, "ready");

        // A block lands before the loop's next pass. The dashboard must not report a tip
        // the index has not reached.
        tip.store(9, Ordering::SeqCst);
        let dashboard = build_dashboard(&state, DashboardQuery { page: 1, limit: 8 })
            .await
            .unwrap();
        assert_eq!(dashboard.height, 9);
        assert_eq!(dashboard.index.phase, "ready");
        assert_eq!(dashboard.index.scanned_height, Some(9));
        assert_eq!(dashboard.footprint_history.last().unwrap().height, 9);
        assert_eq!(dashboard.tachyon_pool_zat, Some(509));

        // Far behind, the request answers immediately and says so instead of catching up.
        tip.store(9 + CATCH_UP_BLOCKS + 1, Ordering::SeqCst);
        let dashboard = build_dashboard(&state, DashboardQuery { page: 1, limit: 8 })
            .await
            .unwrap();
        assert_eq!(dashboard.index.phase, "syncing");
        assert_eq!(dashboard.index.scanned_height, Some(9));
        assert_eq!(dashboard.index.target_height, 9 + CATCH_UP_BLOCKS + 1);

        rpc_server.abort();
        let _ = std::fs::remove_file(cache_path);
    }

    #[test]
    fn block_cadence_uses_wall_clock_height_changes() {
        let mut cadence = BlockCadence::default();

        assert_eq!(cadence.observe_at(100, 1_000), (75, Some(76_000)));
        assert_eq!(cadence.observe_at(101, 7_000), (6, Some(13_000)));
        assert_eq!(cadence.observe_at(101, 10_000), (6, Some(13_000)));
        assert_eq!(cadence.observe_at(103, 15_000), (6, Some(21_000)));
    }

    #[test]
    fn empty_blocks_still_advance_epoch_boundaries() {
        let mut index = fresh_index(7, 15);
        let block = |height| RpcBlock {
            hash: format!("{height:064x}"),
            height,
            time: 0,
            transactions: vec![],
            value_pools: vec![],
        };

        apply_block(&mut index, &block(7), 7, 8).unwrap();
        let epoch_zero_anchor = index.anchor.clone().unwrap();
        apply_block(&mut index, &block(15), 7, 8).unwrap();

        assert_ne!(index.anchor.unwrap(), epoch_zero_anchor);
        assert_eq!(index.scanned_height, Some(15));
    }
}
