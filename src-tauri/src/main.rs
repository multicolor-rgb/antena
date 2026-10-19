// Antena - binarka desktopowa. Cała logika (w tym mobilny punkt wejścia)
// znajduje się w bibliotece `antena_lib`, żeby Android mógł załadować ją jako .so.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    antena_lib::run();
}
