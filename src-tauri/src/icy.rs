//! Odczyt metadanych ICY (Icecast/Shoutcast) - czyli tytułu aktualnie
//! grającego utworu. Wykonujemy jedno małe zapytanie TCP na kilkanaście sekund,
//! więc koszt jest pomijalny (brak wątków w tle, brak stałych połączeń).

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

use serde::Serialize;

const UA: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Antena/1.0 Safari/537.36";

#[derive(Serialize)]
pub struct NowPlaying {
    pub title: Option<String>,
    pub station: Option<String>,
}

/// Górny limit czasu całego zapytania - żeby nie wisieć w nieskończoność.
const BUDGET: Duration = Duration::from_secs(7);

struct Deadline(Instant);

impl Deadline {
    fn new(d: Duration) -> Self {
        Deadline(Instant::now() + d)
    }
    fn left(&self) -> Duration {
        self.0.saturating_duration_since(Instant::now())
    }
    fn expired(&self) -> bool {
        self.left().is_zero()
    }
}

/// Pobiera tytuł utworu (i nazwę stacji) ze strumienia ICY.
pub fn fetch(url: &str) -> Option<NowPlaying> {
    let parsed = url::Url::parse(url).ok()?;
    let host = parsed.host_str()?.to_string();
    let port = parsed.port_or_known_default()?;
    let deadline = Deadline::new(BUDGET);

    let mut stream = open(parsed.scheme(), &host, port, deadline.left())?;

    let target = match parsed.query() {
        Some(q) => format!("{}?{}", parsed.path(), q),
        None => parsed.path().to_string(),
    };
    let target = if target.is_empty() { "/".into() } else { target };
    let host_header = if port == 80 || port == 443 {
        host.clone()
    } else {
        format!("{host}:{port}")
    };
    let req = format!(
        "GET {target} HTTP/1.1\r\nHost: {host_header}\r\nUser-Agent: {UA}\r\nAccept: */*\r\nIcy-MetaData: 1\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(req.as_bytes()).ok()?;
    stream.flush().ok()?;

    let mut reader = BufReader::with_capacity(2048, stream);
    let headers = read_headers(&mut reader, &deadline)?;

    let station = headers
        .iter()
        .find(|(k, _)| k == "icy-name")
        .map(|(_, v)| v.trim().to_string())
        .filter(|s| !s.is_empty());

    let metaint = headers
        .iter()
        .find(|(k, _)| k == "icy-metaint")
        .and_then(|(_, v)| v.trim().parse::<usize>().ok());

    let metaint = match metaint {
        Some(m) if m > 0 => m,
        _ => return Some(NowPlaying { title: None, station }),
    };

    let title = read_stream_title(&mut reader, metaint, &deadline);
    Some(NowPlaying { title, station })
}

fn open(scheme: &str, host: &str, port: u16, timeout: Duration) -> Option<Box<dyn ReadWrite>> {
    // próbujemy kolejne adresy (np. IPv6, potem IPv4), aż któreś się połączy
    let addrs: Vec<_> = (host, port).to_socket_addrs().ok()?.collect();
    let tcp = addrs.iter().find_map(|a| TcpStream::connect_timeout(a, timeout).ok())?;
    tcp.set_read_timeout(Some(timeout.max(Duration::from_secs(2)))).ok()?;
    tcp.set_write_timeout(Some(timeout)).ok()?;
    tcp.set_nodelay(true).ok()?;

    if scheme == "https" {
        let connector = native_tls::TlsConnector::builder()
            .danger_accept_invalid_certs(true)
            .build()
            .ok()?;
        let tls = connector.connect(host, tcp).ok()?;
        Some(Box::new(tls))
    } else {
        Some(Box::new(tcp))
    }
}

fn read_headers(r: &mut impl BufRead, deadline: &Deadline) -> Option<Vec<(String, String)>> {
    let mut headers = Vec::new();
    loop {
        if deadline.expired() {
            return None;
        }
        let mut line = String::new();
        if r.read_line(&mut line).ok()? == 0 {
            return None;
        }
        let line = line.trim_end();
        if line.is_empty() {
            return Some(headers);
        }
        if let Some((k, v)) = line.split_once(':') {
            headers.push((k.trim().to_ascii_lowercase(), v.trim().to_string()));
        }
    }
}

fn read_stream_title(r: &mut impl Read, metaint: usize, deadline: &Deadline) -> Option<String> {
    let mut skip = vec![0u8; 8192.min(metaint)];
    let mut left = metaint;
    while left > 0 {
        if deadline.expired() {
            return None;
        }
        let want = left.min(skip.len());
        match r.read(&mut skip[..want]) {
            Ok(0) => return None,
            Ok(n) => left -= n,
            Err(_) => return None,
        }
    }

    let mut len = [0u8; 1];
    r.read_exact(&mut len).ok()?;
    let size = len[0] as usize * 16;
    if size == 0 {
        return None;
    }
    let mut buf = vec![0u8; size];
    r.read_exact(&mut buf).ok()?;

    let raw = String::from_utf8_lossy(&buf);
    parse_stream_title(&raw)
}

/// Wyciąga wartość `StreamTitle='...'` z bloku metadanych.
/// Tolerancyjnie: obsługuje też podwójne cudzysłowy i brak średnika.
fn parse_stream_title(raw: &str) -> Option<String> {
    let start = raw.find("StreamTitle=")? + "StreamTitle=".len();
    let rest = raw[start..].trim_start();
    let first = rest.chars().next()?;

    let (body, stop) = if first == '\'' || first == '"' {
        (&rest[first.len_utf8()..], first)
    } else {
        (rest, ';')
    };

    let end = body.find(stop)?;
    let title = body[..end].trim().trim_end_matches(';').trim();
    if title.is_empty() {
        None
    } else {
        Some(title.to_string())
    }
}

trait ReadWrite: Read + Write {}
impl<T: Read + Write> ReadWrite for T {}

#[cfg(test)]
mod tests {
    use super::parse_stream_title;

    #[test]
    fn typowy_blok_icy() {
        let raw = "StreamTitle='Sylwia Grzeszczak - MANGO';StreamUrl='';";
        assert_eq!(parse_stream_title(raw).as_deref(), Some("Sylwia Grzeszczak - MANGO"));
    }

    #[test]
    fn pusty_tytul() {
        assert_eq!(parse_stream_title("StreamTitle='';"), None);
        assert_eq!(parse_stream_title(""), None);
        assert_eq!(parse_stream_title("StreamUrl='x';"), None);
    }

    #[test]
    fn podwojne_cudzyslowy_i_smieci() {
        let raw = "StreamTitle=\"Radio Zet\";other=1;";
        assert_eq!(parse_stream_title(raw).as_deref(), Some("Radio Zet"));
    }

    #[test]
    fn bez_cudzyslowow() {
        assert_eq!(parse_stream_title("StreamTitle=Antena;").as_deref(), Some("Antena"));
    }
}

