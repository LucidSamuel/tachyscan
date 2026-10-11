use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};
use std::time::Duration;

use crate::AppState;

fn is_hash(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn parse_height(value: &str) -> Option<u32> {
    if value.is_empty()
        || value.len() > 10
        || (value.len() > 1 && value.starts_with('0'))
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    value.parse().ok()
}

pub(crate) async fn block(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let height = parse_height(&id);
    if !is_hash(&id) && height.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Expected a full block hash or a non-negative block height" })),
        ));
    }
    let result = tokio::time::timeout(Duration::from_secs(15), async {
        // Resolve heights once, then query by hash so a reorg cannot silently change the block.
        let hash: String = match height {
            Some(height) => state.rpc.call("getblockhash", json!([height])).await?,
            None => id.to_ascii_lowercase(),
        };
        if !is_hash(&hash) {
            return Err("Zakura returned an invalid block hash".to_string());
        }
        let block = state.rpc.call("getblock", json!([hash, 2])).await?;
        validate_block(&hash, height, block)
    })
    .await
    .map_err(|_| "Block lookup timed out".to_string())
    .and_then(|result| result);

    result
        .map(Json)
        .map_err(|error| (StatusCode::BAD_GATEWAY, Json(json!({ "error": error }))))
}

fn validate_block(hash: &str, height: Option<u32>, block: Value) -> Result<Value, String> {
    let actual_height = block.get("height").and_then(Value::as_u64);
    if block.get("hash").and_then(Value::as_str) != Some(hash)
        || actual_height.is_none_or(|value| u32::try_from(value).is_err())
        || height.is_some_and(|height| actual_height != Some(u64::from(height)))
        || block
            .get("time")
            .and_then(Value::as_u64)
            .is_none_or(|time| u32::try_from(time).is_err())
        || block.get("tx").and_then(Value::as_array).is_none_or(|txs| {
            txs.iter().any(|tx| {
                tx.get("txid")
                    .and_then(Value::as_str)
                    .is_none_or(|id| !is_hash(id))
            })
        })
        || ["previousblockhash", "nextblockhash"].iter().any(|key| {
            block
                .get(key)
                .is_some_and(|value| value.as_str().is_none_or(|hash| !is_hash(hash)))
        })
    {
        return Err("Zakura returned a mismatched or invalid verbose block".to_string());
    }
    // Keep all RPC fields (including Tachyon data) for the JSON explorer, not just the summary.
    Ok(block)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::post, Router};
    use std::sync::Arc;
    use tokio::sync::RwLock;

    fn sample_block() -> Value {
        json!({
            "hash": "ab".repeat(32), "height": 12, "time": 1720000000,
            "confirmations": 4, "size": 1024, "previousblockhash": "cd".repeat(32),
            "tx": [{ "txid": "ef".repeat(32), "tachyon": { "actions": [{ "cv": "test" }] } }],
            "unknownFutureField": { "preserve": true }
        })
    }

    #[test]
    fn validates_identifiers() {
        for id in [
            "",
            "-1",
            "+1",
            "01",
            "1.5",
            "4294967296",
            "a1…a1",
            "1/extra",
        ] {
            assert!(!is_hash(id));
            assert_eq!(parse_height(id), None);
        }
        assert_eq!(parse_height("0"), Some(0));
        assert_eq!(parse_height("4294967295"), Some(u32::MAX));
        assert!(is_hash(&"AB".repeat(32)));
    }

    #[test]
    fn preserves_all_fields_and_rejects_mismatches_or_incomplete_blocks() {
        let hash = "ab".repeat(32);
        let block = sample_block();
        assert_eq!(
            validate_block(&hash, Some(12), block.clone()).unwrap(),
            block
        );
        assert!(validate_block(&hash, Some(13), block.clone()).is_err());
        assert!(validate_block(&"cd".repeat(32), None, block.clone()).is_err());
        for (field, invalid) in [
            ("hash", Value::Null),
            ("height", json!(-1)),
            ("time", json!("bad")),
            ("tx", Value::Null),
            ("tx", json!(["ef".repeat(32)])),
            ("nextblockhash", json!("invalid")),
        ] {
            let mut invalid_block = block.clone();
            invalid_block[field] = invalid;
            assert!(validate_block(&hash, None, invalid_block).is_err());
        }
    }

    #[tokio::test]
    async fn block_api_and_deep_links_work_without_dashboard_or_index() {
        let rpc_app = Router::new().route(
            "/",
            post(|Json(request): Json<Value>| async move {
                match request["method"].as_str().unwrap() {
                    "getblockhash" => {
                        assert_eq!(request["params"], json!([12]));
                        Json(json!({ "result": "ab".repeat(32) }))
                    }
                    "getblock" => {
                        if request["params"][0] == "ff".repeat(32) {
                            return Json(
                                json!({ "error": { "code": -5, "message": "Block not found" } }),
                            );
                        }
                        assert_eq!(request["params"], json!(["ab".repeat(32), 2]));
                        Json(json!({ "result": sample_block() }))
                    }
                    other => panic!("block lookup must not need {other}"),
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let rpc_url = format!("http://{}", listener.local_addr().unwrap());
        let rpc_server = tokio::spawn(async move { axum::serve(listener, rpc_app).await.unwrap() });
        let state = AppState {
            rpc: crate::RpcClient {
                client: reqwest::Client::new(),
                url: rpc_url,
                authorization: None,
            },
            index: Arc::new(RwLock::new(crate::TachyonIndex::default())),
            cache_path: Default::default(),
            epoch_length: crate::DEFAULT_EPOCH_LENGTH,
            block_cadence: Arc::default(),
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            // The checked-in index.html tests deep links without requiring a frontend build.
            axum::serve(listener, crate::app_router(state, "."))
                .await
                .unwrap()
        });
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        for id in ["ab".repeat(32), "AB".repeat(32), "12".to_string()] {
            let response = client
                .get(format!("{url}/api/blocks/{id}"))
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.json::<Value>().await.unwrap(), sample_block());
            for suffix in ["", "/"] {
                let response = client
                    .get(format!("{url}/block/{id}{suffix}"))
                    .send()
                    .await
                    .unwrap();
                assert_eq!(response.status(), StatusCode::OK);
                assert!(response
                    .text()
                    .await
                    .unwrap()
                    .contains("<div id=\"app\"></div>"));
            }
        }
        let response = client
            .get(format!("{url}/api/blocks/invalid"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let response = client
            .get(format!("{url}/api/blocks/{}", "ff".repeat(32)))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        assert!(response.json::<Value>().await.unwrap()["error"]
            .as_str()
            .unwrap()
            .contains("Block not found"));
        rpc_server.abort();
        let _ = rpc_server.await;
        let response = client
            .get(format!("{url}/api/blocks/12"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        server.abort();
        let _ = server.await;
    }
}
