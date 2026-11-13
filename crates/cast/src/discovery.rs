//! Finding Google Cast receivers on the network: mDNS `_googlecast._tcp`.

use std::net::{IpAddr, SocketAddr};

use mdns_sd::ResolvedService;

pub use mdns_sd::{Receiver, ServiceDaemon, ServiceEvent};

pub const SERVICE: &str = "_googlecast._tcp.local.";

/// A receiver: a Chromecast, a TV with Google TV, a Nest Hub…
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    /// Its own id (TXT `id`), the same across restarts and address changes.
    pub id: String,
    /// What the owner called it ("Living Room TV").
    pub name: String,
    /// Its model ("Chromecast", "Google TV Streamer").
    pub model: String,
    #[serde(skip)]
    pub addr: SocketAddr,
}

/// Start looking. Keep the daemon: dropping it stops the search.
pub fn browse() -> Result<(ServiceDaemon, Receiver<ServiceEvent>), String> {
    let daemon = ServiceDaemon::new().map_err(|e| e.to_string())?;
    let events = daemon.browse(SERVICE).map_err(|e| e.to_string())?;
    Ok((daemon, events))
}

/// A resolved service as a receiver; IPv4 first (what every Chromecast answers on).
pub fn device(s: &ResolvedService) -> Option<Device> {
    let mut addrs: Vec<IpAddr> = s.addresses.iter().map(|a| a.to_ip_addr()).collect();
    addrs.sort_by_key(|a| !a.is_ipv4());
    let ip = *addrs.first()?;
    let txt = |k: &str| s.get_property_val_str(k).map(str::to_owned);
    let id = txt("id").unwrap_or_else(|| s.fullname.clone());
    let name =
        txt("fn").filter(|n| !n.is_empty()).unwrap_or_else(|| s.fullname.split('.').next().unwrap_or("TV").to_owned());
    Some(Device { id, name, model: txt("md").unwrap_or_default(), addr: SocketAddr::new(ip, s.port) })
}
