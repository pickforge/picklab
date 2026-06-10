#!/bin/sh
# PickLab installer: curl -fsSL https://pickforge.dev/picklab/install.sh | sh
# Installs @pickforge/picklab globally with bun (preferred) or npm.
# Never uses sudo.
set -eu

resolve_package_spec() {
  package_spec="@pickforge/picklab"
  if [ "${PICKLAB_INSTALL_FROM_TARBALL:-}" != "" ]; then
    if [ ! -f "${PICKLAB_INSTALL_FROM_TARBALL}" ]; then
      echo "error: PICKLAB_INSTALL_FROM_TARBALL points to a missing file: ${PICKLAB_INSTALL_FROM_TARBALL}" >&2
      exit 1
    fi
    package_spec="${PICKLAB_INSTALL_FROM_TARBALL}"
  fi
}

resolve_runtime() {
  runtime="${PICKLAB_INSTALL_RUNTIME:-}"
  if [ "${runtime}" = "" ]; then
    if command -v bun >/dev/null 2>&1; then
      runtime="bun"
    elif command -v npm >/dev/null 2>&1; then
      runtime="npm"
    else
      echo "error: PickLab needs bun or Node.js >= 20 with npm." >&2
      echo "Install one of them and re-run this script." >&2
      exit 1
    fi
  fi
}

check_node_version() {
  if ! command -v node >/dev/null 2>&1; then
    echo "error: npm installs need Node.js >= 20, but node is not on PATH" >&2
    exit 1
  fi
  node_version="$(node -v)"
  node_major="$(printf '%s' "${node_version}" | sed 's/^v//' | cut -d. -f1)"
  case "${node_major}" in
    ''|*[!0-9]*)
      echo "error: could not parse the Node.js version from \"${node_version}\"" >&2
      exit 1
      ;;
  esac
  if [ "${node_major}" -lt 20 ]; then
    echo "error: PickLab needs Node.js >= 20 (found ${node_version})" >&2
    exit 1
  fi
}

install_with_bun() {
  if ! command -v bun >/dev/null 2>&1; then
    echo "error: PICKLAB_INSTALL_RUNTIME=bun but bun is not installed" >&2
    exit 1
  fi
  echo "Installing ${package_spec} with bun..."
  if ! bun add --global "${package_spec}"; then
    echo "error: bun add --global failed (see output above)." >&2
    exit 1
  fi
  bin_dir="${BUN_INSTALL:-${HOME}/.bun}/bin"
}

install_with_npm() {
  if ! command -v npm >/dev/null 2>&1; then
    echo "error: PICKLAB_INSTALL_RUNTIME=npm but npm is not installed" >&2
    exit 1
  fi
  check_node_version
  echo "Installing ${package_spec} with npm..."
  if ! npm install --global "${package_spec}"; then
    echo "error: npm install --global failed (see output above)." >&2
    echo "If this was a permissions error, configure a user-writable prefix" >&2
    echo "(npm config set prefix ~/.npm-global) and re-run. Do not use sudo." >&2
    exit 1
  fi
  bin_dir="$(npm prefix --global)/bin"
}

verify_install() {
  picklab_bin="${bin_dir}/picklab"
  if [ ! -x "${picklab_bin}" ]; then
    echo "error: install finished but ${picklab_bin} was not found or is not executable" >&2
    exit 1
  fi
  version="$("${picklab_bin}" --version)"
  echo "picklab ${version} installed."
  if ! command -v picklab >/dev/null 2>&1; then
    echo "note: ${bin_dir} is not on your PATH; add it to run \"picklab\" directly."
  fi
  echo "Next: run \"picklab init\" inside your project."
}

main() {
  resolve_package_spec
  resolve_runtime

  case "${runtime}" in
    bun)
      install_with_bun
      ;;
    npm)
      install_with_npm
      ;;
    *)
      echo "error: unsupported PICKLAB_INSTALL_RUNTIME \"${runtime}\" (expected bun or npm)" >&2
      exit 1
      ;;
  esac

  verify_install
}

main "$@"
