use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;

use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TransactionSelection {
    transaction: Value,
    block_height: Option<u32>,
    coinbase: bool,
}

pub(crate) async fn transaction(
    State(state): State<AppState>,
    Path(txid): Path<String>,
) -> Result<Json<TransactionSelection>, (StatusCode, Json<Value>)> {
    if txid.len() != 64 || !txid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Expected a full 64-character hexadecimal transaction ID" })),
        ));
    }
    let txid = txid.to_ascii_lowercase();
    // Look up by ID, independently of the dashboard's sliding block window and index backfill.
    let result = tokio::time::timeout(
        Duration::from_secs(15),
        state.rpc.call("getrawtransaction", json!([txid, 1])),
    )
    .await
    .map_err(|_| "Transaction lookup timed out".to_string())
    .and_then(|result| result)
    .and_then(|value| selection_from_transaction(&txid, value));

    result
        .map(Json)
        .map_err(|error| (StatusCode::BAD_GATEWAY, Json(json!({ "error": error }))))
}

fn selection_from_transaction(
    txid: &str,
    transaction: Value,
) -> Result<TransactionSelection, String> {
    if transaction.get("txid").and_then(Value::as_str) != Some(txid) {
        return Err("Zakura returned a different or missing transaction ID".to_string());
    }
    // No height means mempool; -1 means the transaction is in a side-chain block.
    let block_height = transaction
        .get("height")
        .and_then(Value::as_u64)
        .and_then(|height| u32::try_from(height).ok());
    let coinbase = transaction
        .get("vin")
        .and_then(Value::as_array)
        .is_some_and(|inputs| inputs.iter().any(|input| input.get("coinbase").is_some()));
    Ok(TransactionSelection {
        transaction,
        block_height,
        coinbase,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::post, Router};
    use std::sync::Arc;
    use tokio::sync::RwLock;

    #[tokio::test]
    async fn looks_up_permalink_by_id_without_the_dashboard_or_index() {
        let txid = "a1".repeat(32);
        let rpc_app = Router::new().route(
            "/",
            post(|Json(request): Json<Value>| async move {
                assert_eq!(request["method"], "getrawtransaction");
                assert_eq!(request["params"], json!(["a1".repeat(32), 1]));
                Json(json!({
                    "result": { "txid": "a1".repeat(32), "height": 12, "vin": [] },
                    "error": null
                }))
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, rpc_app).await.unwrap() });
        let state = AppState {
            rpc: crate::RpcClient {
                client: reqwest::Client::new(),
                url,
                authorization: None,
            },
            index: Arc::new(RwLock::new(crate::TachyonIndex::default())),
            cache_path: Default::default(),
            epoch_length: crate::DEFAULT_EPOCH_LENGTH,
            block_cadence: Arc::default(),
        };

        let Json(selection) = transaction(State(state.clone()), Path(txid.to_uppercase()))
            .await
            .unwrap();
        assert_eq!(selection.transaction["txid"], txid);
        assert_eq!(selection.block_height, Some(12));
        server.abort();
        let _ = server.await;

        // Validation must reject truncated IDs locally, even with the RPC offline.
        let (status, _) = transaction(State(state.clone()), Path("a1…a1".into()))
            .await
            .unwrap_err();
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let (status, Json(error)) = transaction(State(state), Path(txid)).await.unwrap_err();
        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert!(error["error"]
            .as_str()
            .unwrap()
            .contains("could not reach Zakura"));
    }

    #[test]
    fn preserves_full_transaction_and_confirmed_metadata() {
        let txid = "a1".repeat(32);
        let transaction = json!({
            "txid": txid, "height": 123, "vin": [{ "coinbase": "0101" }],
            "tachyon": { "actions": [{ "cv": "test" }] }
        });
        let selection = selection_from_transaction(&txid, transaction.clone()).unwrap();
        assert_eq!(selection.block_height, Some(123));
        assert!(selection.coinbase);
        assert_eq!(selection.transaction, transaction);
        let json = serde_json::to_value(selection).unwrap();
        assert_eq!(json["blockHeight"], 123);
    }

    #[test]
    fn handles_unconfirmed_transactions() {
        let txid = "a1".repeat(32);
        for height in [Value::Null, json!(-1)] {
            let selection = selection_from_transaction(
                &txid,
                json!({ "txid": txid, "height": height, "vin": [{ "txid": "input" }] }),
            )
            .unwrap();
            assert_eq!(selection.block_height, None);
            assert!(!selection.coinbase);
        }
    }

    #[test]
    fn rejects_mismatched_or_missing_transactions() {
        let txid = "a1".repeat(32);
        for transaction in [Value::Null, json!({ "txid": "b2".repeat(32) })] {
            assert!(selection_from_transaction(&txid, transaction).is_err());
        }
    }
}
