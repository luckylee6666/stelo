use std::sync::Arc;

use dashmap::DashMap;
use once_cell::sync::Lazy;
use tokio::sync::Notify;

/// 长任务取消注册表：sftp upload / download / upload_dir 等支持中途中断。
///
/// 用法：
/// 1. 前端生成 UUID 当 `task_id`，调用 sftp_upload(task_id, ...) 时传入
/// 2. 后端任务开始时 `register(task_id)` 拿到 Arc<Notify>，在 loop 里 select! 监听
/// 3. 用户点 cancel 按钮 → 前端 invoke "task_cancel(task_id)" → 后端 notify_waiters
/// 4. 任务正常结束 / 异常结束 / 被 cancel → unregister(task_id)
static REGISTRY: Lazy<DashMap<String, Arc<Notify>>> = Lazy::new(DashMap::new);

/// 注册任务，返回 cancel notify。同 task_id 重复注册会覆盖（前一个旧任务也能被新 cancel 触发）。
pub fn register(task_id: &str) -> Arc<Notify> {
    let n = Arc::new(Notify::new());
    REGISTRY.insert(task_id.to_string(), n.clone());
    n
}

/// 任务结束时清理。
pub fn unregister(task_id: &str) {
    REGISTRY.remove(task_id);
}

/// 取消指定任务。如果 task_id 不存在（可能已结束），静默成功。
pub fn cancel(task_id: &str) -> bool {
    if let Some(n) = REGISTRY.get(task_id) {
        n.notify_waiters();
        true
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn register_and_cancel_roundtrip() {
        let n = register("t1");
        let waiter = n.clone();
        let h = tokio::spawn(async move {
            waiter.notified().await;
            "cancelled"
        });
        // 给 spawn 一点时间进入 await
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        assert!(cancel("t1"));
        let r = h.await.unwrap();
        assert_eq!(r, "cancelled");
        unregister("t1");
    }

    #[test]
    fn cancel_unknown_returns_false() {
        assert!(!cancel("never-registered"));
    }
}
