#!/usr/bin/env python3
"""Dopasowuje wygenerowany przez `tauri android init` projekt Android do Anteny.

Uruchamiane w CI po `android init`, przed `android build`:

1. Włącza ruch cleartext (HTTP). 152 z 252 stacji nadaje po http:// i bez tego
   Android zablokowałby je w wersji release (w szablonie Tauri
   `usesCleartextTraffic` jest ustawione na "false").
2. Podpisuje build release kluczem debug, dzięki czemu APK jest instalowalny
   bez dodawania sekretów do repozytorium (przydatne do testów/sideloadu).

Skrypt jest odporny na ponowne uruchomienie (nie dubluje zmian).
"""

from pathlib import Path
import sys

GRADLE = Path("src-tauri/gen/android/app/build.gradle.kts")

CLEARTEXT_OFF = 'manifestPlaceholders["usesCleartextTraffic"] = "false"'
CLEARTEXT_ON = 'manifestPlaceholders["usesCleartextTraffic"] = "true"'
SIGN_LINE = 'signingConfig = signingConfigs.getByName("debug")'
RELEASE_BLOCK = 'getByName("release") {'


def main() -> int:
    if not GRADLE.is_file():
        print(f"BŁĄD: brak {GRADLE} — najpierw uruchom `tauri android init`", file=sys.stderr)
        return 1

    src = GRADLE.read_text(encoding="utf-8")

    if CLEARTEXT_OFF in src:
        src = src.replace(CLEARTEXT_OFF, CLEARTEXT_ON, 1)
        print("OK: usesCleartextTraffic = true")
    elif CLEARTEXT_ON in src:
        print("OK: usesCleartextTraffic już ustawione")
    else:
        print(f"BŁĄD: nie znaleziono {CLEARTEXT_OFF!r}", file=sys.stderr)
        return 1

    release = src.find(RELEASE_BLOCK)
    if release == -1:
        print(f"BŁĄD: nie znaleziono bloku {RELEASE_BLOCK!r}", file=sys.stderr)
        return 1

    if SIGN_LINE not in src[release:]:
        end = src.find("\n", release)
        src = src[: end + 1] + "            " + SIGN_LINE + "\n" + src[end + 1 :]
        print("OK: release podpisywany kluczem debug")
    else:
        print("OK: podpis release już ustawiony")

    GRADLE.write_text(src, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
