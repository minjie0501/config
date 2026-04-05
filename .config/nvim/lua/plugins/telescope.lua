return {
	{
		"nvim-telescope/telescope.nvim",
		branch = "master",
		cmd = { "Telescope" },
		keys = {
			{ "<leader>?", function() require("telescope.builtin").oldfiles() end, desc = "Find recently opened files" },
			{ "<leader>sb", function() require("telescope.builtin").buffers() end, desc = "Search open buffers" },
			{ "<leader>sf", function() require("telescope.builtin").find_files({ hidden = true }) end, desc = "Find files (including hidden)" },
			{ "<leader>sh", function() require("telescope.builtin").help_tags() end, desc = "Search help tags" },
			{ "<leader>sg", function() require("telescope.builtin").live_grep() end, desc = "Live grep search" },
			{ "<leader>sc", function() require("telescope.builtin").git_bcommits() end, desc = "Search buffer commits" },
			{ "<leader>/", function() require("telescope.builtin").current_buffer_fuzzy_find(require("telescope.themes").get_dropdown({ previewer = false })) end, desc = "Fuzzily search in current buffer" },
			{ "<leader>ss", function() require("telescope.builtin").spell_suggest(require("telescope.themes").get_dropdown({ previewer = false })) end, desc = "Spell suggestions search" },
		},
		dependencies = {
			"nvim-lua/plenary.nvim",
			{
				"nvim-telescope/telescope-fzf-native.nvim",
				build = "make",
				cond = vim.fn.executable("make") == 1,
			},
		},
		config = function()
			local actions = require("telescope.actions")

			require("telescope").setup({
				defaults = {
					mappings = {
						i = {
							["<C-k>"] = actions.move_selection_previous,
							["<C-j>"] = actions.move_selection_next,
							["<C-q>"] = actions.send_selected_to_qflist + actions.open_qflist,
							["<C-x>"] = actions.delete_buffer,
						},
					},
					file_ignore_patterns = {
						"node_modules",
						"yarn.lock",
						".git",
						".sl",
						"_build",
						".next",
					},
					hidden = true,
					path_display = {
						"filename_first",
					},
				},
			})

			pcall(require("telescope").load_extension, "fzf")
		end,
	},
}
