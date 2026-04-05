vim.api.nvim_create_autocmd("FileType", {
	pattern = "oil",
	callback = function()
		vim.opt_local.colorcolumn = ""
	end,
})

return {
	{
		"stevearc/oil.nvim",
		cmd = { "Oil" },
		keys = {
			{ "<leader>e", function() require("oil").toggle_float() end, desc = "Toggle Oil file explorer" },
		},
		dependencies = { "nvim-tree/nvim-web-devicons" },
		config = function()
			require("oil").setup({
				-- use_default_keymaps = false,
				confirmation = {
					border = "rounded",
				},
				float = {
					border = "rounded",
				},
				keymaps = {
					["<C-l>"] = false,
					["<C-r>"] = "actions.refresh",
				},
				view_options = {
					show_hidden = true,
				},
			})
		end,
	},
}
