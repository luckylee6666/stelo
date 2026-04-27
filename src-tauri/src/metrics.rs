use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use russh::client::Handle;
use russh::ChannelMsg;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::time::sleep;
use tracing::debug;

use crate::ssh::SshClient;

const CMD: &str = concat!(
    "head -n1 /proc/stat;",
    "cat /proc/loadavg;",
    "awk '/^MemTotal|^MemAvailable/ {print}' /proc/meminfo;",
    "iface=$(ip route show default 2>/dev/null | awk '{print $5; exit}');",
    "cat /sys/class/net/$iface/statistics/rx_bytes 2>/dev/null || echo 0;",
    "cat /sys/class/net/$iface/statistics/tx_bytes 2>/dev/null || echo 0;",
    "sleep 1;",
    "head -n1 /proc/stat;",
    "cat /sys/class/net/$iface/statistics/rx_bytes 2>/dev/null || echo 0;",
    "cat /sys/class/net/$iface/statistics/tx_bytes 2>/dev/null || echo 0"
);

const INTERVAL: Duration = Duration::from_secs(5);
const MAX_FAILS: u32 = 3;

#[derive(Debug, Clone, Serialize)]
pub struct Metrics {
    pub cpu: f64,
    pub mem_used_kb: u64,
    pub mem_total_kb: u64,
    pub load1: f64,
    pub load5: f64,
    pub load15: f64,
    /// 下行字节/秒
    pub net_rx_bps: u64,
    /// 上行字节/秒
    pub net_tx_bps: u64,
}

pub fn spawn(app: AppHandle, handle: Arc<Handle<SshClient>>, session_id: String) {
    tokio::spawn(async move {
        let event = format!("metrics:data:{}", session_id);
        let mut fails = 0u32;
        loop {
            match collect_once(&handle).await {
                Ok(raw) => {
                    fails = 0;
                    if let Some(m) = parse(&raw) {
                        let _ = app.emit(&event, &m);
                    }
                }
                Err(e) => {
                    fails += 1;
                    debug!(
                        "metrics fetch failed ({fails}/{MAX_FAILS}) for {session_id}: {e:?}"
                    );
                    if fails >= MAX_FAILS {
                        break;
                    }
                }
            }
            sleep(INTERVAL).await;
        }
        debug!("metrics task stopped: {session_id}");
    });
}

async fn collect_once(handle: &Arc<Handle<SshClient>>) -> Result<String> {
    let mut ch = handle.channel_open_session().await?;
    ch.exec(false, CMD).await?;
    let mut buf = Vec::new();
    loop {
        match ch.wait().await {
            Some(ChannelMsg::Data { data }) => buf.extend_from_slice(&data[..]),
            Some(ChannelMsg::ExtendedData { data, .. }) => buf.extend_from_slice(&data[..]),
            Some(ChannelMsg::Eof) | Some(ChannelMsg::ExitStatus { .. }) => break,
            None => break,
            _ => {}
        }
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

struct CpuTick {
    total: u64,
    idle: u64,
}

fn parse_cpu(line: &str) -> Option<CpuTick> {
    // cpu  <user> <nice> <system> <idle> <iowait> <irq> <softirq> ...
    let mut parts = line.split_whitespace();
    let tag = parts.next()?;
    if tag != "cpu" {
        return None;
    }
    let nums: Vec<u64> = parts.filter_map(|s| s.parse::<u64>().ok()).collect();
    if nums.len() < 4 {
        return None;
    }
    let total: u64 = nums.iter().sum();
    let idle = nums[3];
    Some(CpuTick { total, idle })
}

fn parse_meminfo_kb(line: &str) -> Option<u64> {
    // "MemTotal:       1234567 kB"
    let mut parts = line.split_whitespace();
    let _ = parts.next()?;
    parts.next()?.parse::<u64>().ok()
}

fn parse_loadavg(line: &str) -> Option<(f64, f64, f64)> {
    let mut parts = line.split_whitespace();
    let a = parts.next()?.parse().ok()?;
    let b = parts.next()?.parse().ok()?;
    let c = parts.next()?.parse().ok()?;
    Some((a, b, c))
}

fn parse(raw: &str) -> Option<Metrics> {
    let lines: Vec<&str> = raw.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.len() < 9 {
        return None;
    }
    let cpu1 = parse_cpu(lines[0])?;
    let load = parse_loadavg(lines[1])?;
    let mem_total = parse_meminfo_kb(lines[2])?;
    let mem_avail = parse_meminfo_kb(lines[3])?;
    let rx1: u64 = lines[4].trim().parse().unwrap_or(0);
    let tx1: u64 = lines[5].trim().parse().unwrap_or(0);
    let cpu2 = parse_cpu(lines[6])?;
    let rx2: u64 = lines[7].trim().parse().unwrap_or(0);
    let tx2: u64 = lines[8].trim().parse().unwrap_or(0);
    let dt = cpu2.total.saturating_sub(cpu1.total);
    let di = cpu2.idle.saturating_sub(cpu1.idle);
    let cpu = if dt > 0 {
        ((dt - di) as f64 / dt as f64) * 100.0
    } else {
        0.0
    };
    Some(Metrics {
        cpu,
        mem_used_kb: mem_total.saturating_sub(mem_avail),
        mem_total_kb: mem_total,
        load1: load.0,
        load5: load.1,
        load15: load.2,
        net_rx_bps: rx2.saturating_sub(rx1),
        net_tx_bps: tx2.saturating_sub(tx1),
    })
}

