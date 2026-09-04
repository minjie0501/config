# Path to your Oh My Zsh installation.
export ZSH="$HOME/.oh-my-zsh"

# Set name of the theme to load
ZSH_THEME="robbyrussell"


# Which plugins would you like to load?
# Standard plugins can be found in $ZSH/plugins/
# Custom plugins may be added to $ZSH_CUSTOM/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
# Add wisely, as too many plugins slow down shell startup.
plugins=(git zsh-autosuggestions)

source $ZSH/oh-my-zsh.sh

# Load local, untracked secrets if present
if [ -f "$HOME/.zshrc.local" ]; then
  source "$HOME/.zshrc.local"
fi

export PATH=$PATH:/Users/minjie/bin

# Lazy-load pyenv (keep shims on PATH, defer full init until first use)
export PATH="$HOME/.pyenv/shims:$PATH"
pyenv() { unfunction pyenv; eval "$(command pyenv init -)"; pyenv "$@" }
eval "$(direnv hook zsh)"


# sst
export PATH=/Users/minjie/.sst/bin:$PATH


# fnm
eval "$(fnm env --use-on-cd)"


# bun
[ -s "/Users/minjie/.bun/_bun" ] && source "/Users/minjie/.bun/_bun" # bun completion
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"


# homebrew
export HOMEBREW_NO_AUTO_UPDATE=1


# Open VS Code
alias c="open $1 -a \"Visual Studio Code\""
# alias c="open $1 -a \"Cursor\""


# opencode
export PATH=/Users/minjie/.opencode/bin:$PATH


# starship
eval "$(starship init zsh)"

. "$HOME/.local/bin/env"

# git setup for config files (config add .; config commit -m 'msg'; config push)
alias config='/usr/bin/git --git-dir=$HOME/.config-git/ --work-tree=$HOME'

# personal aliases
alias aero-reload='aerospace reload-config && aerospace run-callback --for-every-window on-window-detected'

m() {
  if [[ "$1" = "aws" && "$2" = "login" ]]; then
    aws sso login --sso-session default
  else
    echo "Usage:"
    echo "  m aws login    # runs: aws sso login --sso-session default"
  fi
}

if command -v wt >/dev/null 2>&1; then eval "$(command wt config shell init zsh)"; fi

# zoxide
eval "$(zoxide init zsh)"

# yazi
function y() {
  local tmp="$(mktemp -t "yazi-cwd.XXXXXX")" cwd
  command yazi "$@" --cwd-file="$tmp"
  IFS= read -r -d '' cwd < "$tmp"
  [ "$cwd" != "$PWD" ] && [ -d "$cwd" ] && builtin cd -- "$cwd"
  command rm -f -- "$tmp"
}

# aikido-endpoint-pip-cert-config-start
# Allow Python package managers to trust the SafeChain MITM CA while preserving user-provided roots.
export PIP_CERT="/Library/Application Support/AikidoSecurity/EndpointProtection/run/endpoint-protection-pip-combined-ca.pem"
export REQUESTS_CA_BUNDLE="/Library/Application Support/AikidoSecurity/EndpointProtection/run/endpoint-protection-pip-combined-ca.pem"
export POETRY_CERTIFICATES_PYPI_CERT="/Library/Application Support/AikidoSecurity/EndpointProtection/run/endpoint-protection-pip-combined-ca.pem"
export UV_SYSTEM_CERTS=true
# aikido-endpoint-pip-cert-config-end
# aikido-endpoint-ruby-cert-config-start
# Allow Ruby Bundler to trust the SafeChain MITM CA while preserving public roots.
export BUNDLE_SSL_CA_CERT="/Library/Application Support/AikidoSecurity/EndpointProtection/run/endpoint-protection-ruby-combined-ca.pem"
# aikido-endpoint-ruby-cert-config-end
# aikido-endpoint-curl-cert-config-v2-start
# Allow curl and other OpenSSL-linked tools to trust the SafeChain MITM CA while preserving the system roots.
export SSL_CERT_FILE="/Library/Application Support/AikidoSecurity/EndpointProtection/run/endpoint-protection-openssl-combined-ca.pem"
export CURL_CA_BUNDLE="/Library/Application Support/AikidoSecurity/EndpointProtection/run/endpoint-protection-openssl-combined-ca.pem"
# aikido-endpoint-curl-cert-config-v2-end
# aikido-endpoint-cert-config-start
# Allow Node.js tooling to trust the SafeChain MITM CA while preserving public roots.
export NODE_EXTRA_CA_CERTS="/Library/Application Support/AikidoSecurity/EndpointProtection/run/endpoint-protection-node-combined-ca.pem"
# aikido-endpoint-cert-config-end
alias claude='claude --permission-mode auto'
# aikido-endpoint-pip-uv-legacy-start
export UV_NATIVE_TLS=true
# aikido-endpoint-pip-uv-legacy-end
