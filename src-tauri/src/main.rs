// Antena - lekkie radio internetowe (Tauri 2 + WebKitGTK)
// Warstwa Rust robi dokładnie dwie rzeczy:
//   1) otwiera okno z interfejsem HTML/CSS/JS,
//   2) na żądanie odczytuje tytuł grającego utworu (metadane ICY).
// Odtwarzanie audio realizuje element <audio>, czyli GStreamer w WebKitGTK.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![now_playing])
        .run(tauri::generate_context!())
        .expect("nie udało się uruchomić aplikacji");
}
