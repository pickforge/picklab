#!/bin/sh
# PickLab installer: curl -fsSL https://pickforge.dev/picklab/install.sh | sh
# Installs @pickforge/picklab globally with bun (preferred) or npm.
# Never uses sudo.
set -eu

package_spec="@pickforge/picklab"
if [ "${PICKLAB_INSTALL_FROM_TARBALL:-}" != "" ]; then
  if [ ! -f "${PICKLAB_INSTALL_FROM_TARBALL}" ]; then
    echo "error: PICKLAB_INSTALL_FROM_TARBALL points to a missing file: ${PICKLAB_INSTALL_FROM_TARBALL}" >&2
    exit 1
  fi
  package_spec="${PICKLAB_INSTALL_FROM_TARBALL}"
fi

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

case "${runtime}" in
  bun)
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
    ;;
  npm)
    if ! command -v npm >/dev/null 2>&1; then
      echo "error: PICKLAB_INSTALL_RUNTIME=npm but npm is not installed" >&2
      exit 1
    fi
    echo "Installing ${package_spec} with npm..."
    if ! npm install --global "${package_spec}"; then
      echo "error: npm install --global failed (see output above)." >&2
      echo "If this was a permissions error, configure a user-writable prefix" >&2
      echo "(npm config set prefix ~/.npm-global) and re-run. Do not use sudo." >&2
      exit 1
    fi
    bin_dir="$(npm prefix --global)/bin"
    ;;
  *)
    echo "error: unsupported PICKLAB_INSTALL_RUNTIME \"${runtime}\" (expected bun or npm)" >&2
    exit 1
    ;;
esac

picklab_bin=""
if command -v picklab >/dev/null 2>&1; then
  picklab_bin="picklab"
elif [ -x "${bin_dir}/picklab" ]; then
  picklab_bin="${bin_dir}/picklab"
else
  echo "error: install finished but the picklab binary was not found on PATH or in ${bin_dir}" >&2
  exit 1
fi

version="$("${picklab_bin}" --version)"
echo "picklab ${version} installed."
if [ "${picklab_bin}" != "picklab" ]; then
  echo "note: ${bin_dir} is not on your PATH; add it to run \"picklab\" directly."
fi
echo "Next: run \"picklab init\" inside your project."
