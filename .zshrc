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

eval "$(pyenv init -)" # turn on pyenv for the shell
eval "$(direnv hook zsh)"


# sst
export PATH=/Users/minjie/.sst/bin:$PATH


# fnm
eval "$(fnm env --use-on-cd)"
FNM_PATH="/Users/minjie/Library/Application Support/fnm"
if [ -d "$FNM_PATH" ]; then
  export PATH="/Users/minjie/Library/Application Support/fnm:$PATH"
  eval "`fnm env`"
fi


# bun
[ -s "/Users/minjie/.bun/_bun" ] && source "/Users/minjie/.bun/_bun" # bun completion
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"


# homebrew
export HOMEBREW_NO_AUTO_UPDATE=1


# Open Cursor
alias c="open $1 -a \"Cursor\""


# opencode
export PATH=/Users/minjie/.opencode/bin:$PATH


# starship
eval "$(starship init zsh)"

. "$HOME/.local/bin/env"

# git setup for config files (config add .; config commit -m 'msg'; config push)
alias config='/usr/bin/git --git-dir=$HOME/.config-git/ --work-tree=$HOME'
