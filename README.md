# config

Personal macOS dotfiles: zsh, Neovim, Ghostty, AeroSpace, herdr and Starship.

## What's inside

- `.zshrc` — zsh setup (oh-my-zsh, Starship prompt, fnm, pyenv, direnv, zoxide, aliases)
- `.config/nvim` — Neovim config using [lazy.nvim](https://github.com/folke/lazy.nvim); plugin specs live in `lua/plugins`, personal modules in `lua/minjie`
- `.config/ghostty/config` — Ghostty terminal
- `.config/aerospace/aerospace.toml` — AeroSpace window manager
- `.config/herdr/config.toml` — herdr
- `.config/starship.toml` — Starship prompt

## How to use

### Prerequisites

Required:

- [Homebrew](https://brew.sh), git and zsh
- [oh-my-zsh](https://ohmyz.sh) with the [zsh-autosuggestions](https://github.com/zsh-users/zsh-autosuggestions) custom plugin
- starship, fnm, pyenv, direnv, zoxide
- Neovim (lazy.nvim bootstraps itself on first launch)
- Ghostty, AeroSpace

Optional (referenced in `.zshrc`): bun, sst, opencode, wt, yazi.

`.zshrc` sources `$HOME/.local/bin/env` unconditionally (created by installers such as uv). Make sure that file exists, or remove the line.

### Install

The files are managed as a bare git repository whose work tree is `$HOME`, so they are checked out directly in place — no symlinks needed.

```sh
git clone --bare https://github.com/minjie0501/config.git "$HOME/.config-git"
alias config='/usr/bin/git --git-dir=$HOME/.config-git/ --work-tree=$HOME'
config checkout
config config --local status.showUntrackedFiles no
```

If `config checkout` fails because files such as `~/.zshrc` already exist, back them up (or move them out of the way) and run it again.

### Day-to-day

`.zshrc` defines the `config` alias, so after install you can manage the dotfiles like any git repo:

```sh
config status
config add ~/.config/nvim/init.lua
config commit -m "nvim: ..."
config push
```

### Local secrets

Put machine-specific settings and secrets in `~/.zshrc.local`. It is sourced by `.zshrc` when present and is listed in `.gitignore` — never commit it.

### After install

1. Restart the shell: `exec zsh`
2. Open `nvim` once so lazy.nvim installs the plugins.
3. Reload AeroSpace: `aero-reload` (or `aerospace reload-config`).
