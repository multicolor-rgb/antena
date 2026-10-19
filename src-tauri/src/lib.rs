// Antena - lekkie radio internetowe (Tauri 2 + WebKitGTK)
// Warstwa Rust robi dokładnie dwie rzeczy:
//   1) otwiera okno z interfejsem HTML/CSS/JS,
//   2) na żądanie odczytuje tytuł aktualnie granego utworu (metadane ICY).
// Odtwarzanie audio realizuje element <audio>, czyli WebKitGTK / WebView.

mod icy;

/// Zwraca tytuł aktualnie granego utworu dla podanego adresu strumienia.
/// Uruchamiane poza wątkiem głównym i tylko wtedy, gdy gra radio.
#[tauri::command]
async fn now_playing(url: String) -> Option<icy::NowPlaying> {
    tauri::async_runtime::spawn_blocking(move || icy::fetch(&url))
        .await
        .ok()
        .flatten()
}

/// Punkt wejścia wspólny dla wszystkich platform.
/// Na Androidzie/iOS `mobile_entry_point` wystawia go jako bibliotekę `.so`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![now_playing])
        .run(tauri::generate_context!())
        .expect("nie udało się uruchomić aplikacji");
}
