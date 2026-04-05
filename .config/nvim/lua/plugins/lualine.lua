return {
	{
		"nvim-lualine/lualine.nvim",
		event = "VeryLazy",
		config = function()
			local function truncate_branch_name(branch)
				if not branch or branch == "" then
					return ""
				end

				local user, team, ticket_number = string.match(branch, "^(%w+)/(%w+)%-(%d+)")
				if ticket_number then
					return user .. "/" .. team .. "-" .. ticket_number
				else
					return branch
				end
			end

			local vcs_cache = { result = "", cwd = nil, pending = false }

			local function refresh_vcs_info()
				local cwd = vim.fn.getcwd()
				if vcs_cache.pending or vcs_cache.cwd == cwd then
					return
				end
				vcs_cache.pending = true

				local function update_cache(result)
					vcs_cache = { result = result, cwd = cwd, pending = false }
					vim.schedule(function()
						vim.cmd("redrawstatus")
					end)
				end

				vim.system(
					{ "git", "branch", "--show-current" },
					{ text = true, cwd = cwd },
					function(git_branch)
						local branch = vim.trim(git_branch.stdout or "")
						if git_branch.code == 0 and branch ~= "" then
							update_cache(truncate_branch_name(branch))
						else
							update_cache("")
						end
					end
				)
			end

			local function get_vcs_info()
				return vcs_cache.result
			end

			vim.api.nvim_create_autocmd({ "DirChanged", "FocusGained" }, {
				callback = function()
					vcs_cache = { result = vcs_cache.result, cwd = nil, pending = false }
					refresh_vcs_info()
				end,
			})

			-- Seed initial VCS info
			refresh_vcs_info()

			require("lualine").setup({
				options = {
					theme = "catppuccin-macchiato",
					globalstatus = true,
					component_separators = { left = "", right = "" },
					section_separators = { left = "█", right = "█" },
				},
				sections = {
					lualine_b = {
						{ get_vcs_info, icon = "" },
						"diff",
						"diagnostics",
					},
					lualine_c = {
						{ "filename", path = 1 },
					},
					lualine_x = {
						"filetype",
					},
				},
			})
		end,
	},
}
