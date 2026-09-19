#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
if [[ "${1:-}" == "--help" ]]; then
  printf 'Мастер установки ИнТехТранспорт для Ubuntu Server.\nЗапуск: bash install.sh\n'
  exit 0
fi
if [[ "$(uname -s)" != Linux ]] || [[ ! -r /etc/os-release ]]; then
  printf 'Запустите мастер на Ubuntu Server, не на рабочем компьютере Windows.\n' >&2
  exit 1
fi
. /etc/os-release
case "${ID:-}:${VERSION_ID:-}" in
  ubuntu:22.04|ubuntu:24.04|ubuntu:26.04) ;;
  *) printf 'Поддерживается Ubuntu Server 22.04, 24.04 или 26.04 LTS.\n' >&2; exit 1 ;;
esac
case "$(dpkg --print-architecture)" in
  amd64|arm64) ;;
  *) printf 'Поддерживаются архитектуры amd64 и arm64.\n' >&2; exit 1 ;;
esac
if (( EUID != 0 )); then
  command -v sudo >/dev/null || { echo 'Нужен sudo или запуск от root.' >&2; exit 1; }
  printf 'Для установки пакетов и запуска Docker нужны права sudo.\n'
  exec sudo bash "$ROOT/install.sh" "$@"
fi
trap 'printf "\nУстановка прервана. Данные не удалены. После устранения ошибки повторите: bash install.sh\n" >&2' ERR
missing=()
for package in python3 ca-certificates curl iproute2; do
  if ! dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -qx 'install ok installed'; then
    missing+=("$package")
  fi
done
if (( ${#missing[@]} )); then
  printf 'Установка базовых зависимостей: %s\n' "${missing[*]}"
  apt-get update
  apt-get install -y --no-install-recommends "${missing[@]}"
fi
exec python3 "$ROOT/scripts/install_wizard.py"
