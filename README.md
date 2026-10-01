# config

Personal dotfiles for macOS.

## What's included

| Tool | File |
| --- | --- |
| zsh (oh-my-zsh) | `.zshrc` |
| Neovim (lazy.nvim) | `.config/nvim/` |
| Starship prompt | `.config/starship.toml` |
| Ghostty | `.config/ghostty/config` |
| AeroSpace | `.config/aerospace/aerospace.toml` |
| herdr | `.config/herdr/config.toml` |

## How to use

The repo is laid out as a mirror of `$HOME` and is managed as a bare git repo in `~/.config-git`, with `$HOME` as the work tree. A `config` alias (defined in `.zshrc`) stands in for `git` when working with it.

### Prerequisites

- git, zsh and [oh-my-zsh](https://ohmyz.sh), plus the [`zsh-autosuggestions`](https://github.com/zsh-users/zsh-autosuggestions) plugin cloned into `$ZSH_CUSTOM/plugins`
- [Starship](https://starship.rs) and [Neovim](https://neovim.io)
- Tools initialised by `.zshrc`: direnv, pyenv, fnm, bun, zoxide, yazi, and uv (which provides `~/.local/bin/env`)
- Optional: `wt`, [Ghostty](https://ghostty.org), [AeroSpace](https://github.com/nikitabobko/AeroSpace)

Missing tools will cause errors when a new shell starts.

### Install on a new machine

```sh
git clone --bare https://github.com/minjie0501/config.git "$HOME/.config-git"
alias config='/usr/bin/git --git-dir=$HOME/.config-git/ --work-tree=$HOME'
config config --local status.showUntrackedFiles no
config checkout
```

If `checkout` fails because files such as `~/.zshrc` already exist, move them out of the way and check out again. Moving them by hand works, or use this helper:

```sh
mkdir -p ~/.config-backup
config checkout 2>&1 | grep -E '^\s+' | awk '{print $1}' | \
  xargs -I{} sh -c 'mkdir -p ~/.config-backup/$(dirname {}) && mv ~/{} ~/.config-backup/{}'
config checkout
```

Then restart the shell with `exec zsh`. From here on, `.zshrc` defines the `config` alias.

### Machine-local settings

Put secrets and per-machine overrides in `~/.zshrc.local`. `.zshrc` sources it if it exists, and it is gitignored.

Some lines in `.zshrc` are specific to the original machine, namely the `/Users/minjie/...` PATH entries and the Aikido endpoint-protection CA exports. Adjust or remove them elsewhere.

### Neovim

The first time `nvim` starts, it bootstraps lazy.nvim and installs all plugins. Plugin versions are pinned in `.config/nvim/lazy-lock.json`:

- `:Lazy restore` installs the exact versions from the lockfile.
- `:Lazy update` updates plugins. Commit the changed lockfile afterwards.

### AeroSpace

After editing `.config/aerospace/aerospace.toml`, run `aero-reload` to apply the changes.

### Day-to-day

```sh
config status
config add .config/nvim/lua/plugins/new-plugin.lua
config commit -m "nvim: add new plugin"
config push
```
