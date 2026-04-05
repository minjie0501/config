return {
	{
		"nvim-treesitter/nvim-treesitter",
		build = ":TSUpdate",
		event = { "BufReadPost", "BufNewFile" },
		config = function()
			require("nvim-treesitter").setup({
				ensure_installed = {
					"bash",
					"css",
					"gleam",
					"go",
					"html",
					"javascript",
					"json",
					"lua",
					"markdown",
					"markdown_inline",
					"ocaml",
					"ocaml_interface",
					"rust",
					"svelte",
					"terraform",
					"tsx",
					"typescript",
					"vimdoc",
					"yaml",
				},
			})

			-- Enable treesitter highlighting for all buffers
			vim.api.nvim_create_autocmd("FileType", {
				callback = function(args)
					pcall(vim.treesitter.start, args.buf)
				end,
			})

			-- Also enable for already-loaded buffers (the one that triggered lazy load)
			for _, buf in ipairs(vim.api.nvim_list_bufs()) do
				if vim.api.nvim_buf_is_loaded(buf) and vim.bo[buf].filetype ~= "" then
					pcall(vim.treesitter.start, buf)
				end
			end
		end,
	},

	{
		"nvim-treesitter/nvim-treesitter-context",
		dependencies = { "nvim-treesitter/nvim-treesitter" },
		config = function()
			local tsc = require("treesitter-context")

			tsc.setup({
				enable = false,
				max_lines = 1,
				trim_scope = "inner",
			})
		end,
	},
}
