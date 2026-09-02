/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStringDictionary } from '../../base/common/collections.js';
import { isMacintosh, isNative } from '../../base/common/platform.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../platform/configuration/common/configurationRegistry.js';
import product from '../../platform/product/common/product.js';
import { Registry } from '../../platform/registry/common/platform.js';

/**
 * The owner's daily settings, baked in as product defaults.
 *
 * Values are copied verbatim from the hand-maintained settings file this build is made for
 * (`~/Projects/Settings/settings.json`, the daily rig); only the values travel, the comments
 * stay there. Registering them here through `registerDefaultConfigurations` puts them on the
 * same layer an extension's `configurationDefaults` contribution uses: they move the DEFAULT
 * of each setting, so the Settings editor still shows them as defaults (nothing reads as
 * modified for a virgin profile) and anything the user, the workspace or a folder writes wins
 * over them. Every single one is user-overridable.
 *
 * This is a personal macOS build, so the whole block is guarded by `isMacintosh && isNative`:
 * the web and any non-mac build keep stock defaults.
 *
 * Not every key from that file is here. Three classes are deliberately left out:
 *
 * 1. Already product code in this fork, baked at the declaration site by earlier commits, and
 *    registering them again would just duplicate the same value on a second layer:
 *    `workbench.tree.indent` and `workbench.tree.renderIndentGuides` (listService.ts),
 *    `window.titleBarStyle` and `window.customTitleBarVisibility` (desktop.contribution.ts),
 *    `workbench.activityBar.location` (workbench.contribution.ts), `editor.lineNumbers` and
 *    `editor.guides.bracketPairs` (editorOptions.ts), `window.systemColorTheme`
 *    (themeMainServiceImpl.ts + themes.contribution.ts).
 *
 * 2. Would regress this fork's own design: `workbench.colorTheme` ("Dark+" is what the daily
 *    VSCodium rig runs, this build defaults to Dark 2026), `workbench.iconTheme`
 *    ("vscode-icons" is the extension the built-in VSebCode Icons theme replaced), and the
 *    whole `workbench.colorCustomizations` block (its 1e1e1e coats are baked value-level into
 *    the 2026 palette already, and re-stating the stale hexes would fight it).
 *
 * 3. Dead or superseded: `chat.disableAIFeatures` (the setting no longer exists, it went with
 *    the AI excision), `vscode_vibrancy.*` and `custom-ui-style.*` (the injection stack M1-M3
 *    replaced with product code), and `window.zoomLevel` (0 is already stock, and the main
 *    process reads it before the workbench default layer exists).
 */
const vsebcodeConfigurationDefaults: IStringDictionary<unknown> = {

	// Editor: text & formatting
	'editor.tabSize': 2,
	'editor.formatOnSave': true,
	'editor.formatOnPaste': true,
	'editor.defaultFormatter': 'esbenp.prettier-vscode',
	'editor.wordWrap': 'bounded',
	'editor.wordWrapColumn': 120,
	'editor.renderWhitespace': 'all',
	'editor.linkedEditing': true,
	'editor.foldingImportsByDefault': true,
	'editor.cursorSurroundingLines': 8,
	'editor.dragAndDrop': false,
	'editor.copyWithSyntaxHighlighting': false,
	'editor.find.autoFindInSelection': 'multiline',
	'editor.bracketPairColorization.independentColorPoolPerBracketType': true,
	'editor.autoClosingBrackets': 'always',
	'editor.autoClosingQuotes': 'always',
	'editor.wordSeparators': '`~!@#$%^&*()=+[{]}\\|;:\'",.<>/?',
	'editor.occurrencesHighlight': 'multiFile',
	'editor.showFoldingControls': 'always',
	'editor.minimap.enabled': false,
	'editor.lightbulb.enabled': 'off',
	'editor.hover.delay': 100,

	// Suggestions & inlay hints
	'editor.suggest.insertMode': 'replace',
	'editor.suggest.localityBonus': true,
	'editor.suggest.preview': true,
	'editor.suggest.showStatusBar': true,
	'editor.suggest.matchOnWordStartOnly': false,
	'editor.acceptSuggestionOnCommitCharacter': false,
	'editor.tabCompletion': 'onlySnippets',
	'editor.inlineSuggest.showToolbar': 'always',
	'editor.inlayHints.enabled': 'offUnlessPressed',
	'editor.inlayHints.fontFamily': '\'SF Pro\', -apple-system',
	'editor.inlayHints.fontSize': 12,
	'editor.inlayHints.padding': true,
	'js/ts.inlayHints.parameterNames.enabled': 'all',
	'js/ts.inlayHints.parameterNames.suppressWhenArgumentMatchesName': false,
	'js/ts.inlayHints.parameterTypes.enabled': true,
	'js/ts.inlayHints.variableTypes.enabled': true,
	'js/ts.inlayHints.variableTypes.suppressWhenTypeMatchesName': false,
	'js/ts.inlayHints.propertyDeclarationTypes.enabled': true,
	'js/ts.inlayHints.functionLikeReturnTypes.enabled': true,
	'js/ts.inlayHints.enumMemberValues.enabled': true,

	// TypeScript / JavaScript
	'js/ts.tsdk.promptToUseWorkspaceVersion': true,
	'js/ts.updateImportsOnFileMove.enabled': 'always',
	'js/ts.preferences.preferTypeOnlyAutoImports': true,
	'js/ts.tsserver.maxMemory': 4096,
	'js/ts.preferences.autoImportSpecifierExcludeRegexes': [
		'^lodash$',
		'^node:test$'
	],

	// Files
	'files.eol': '\n',
	'files.hotExit': 'onExitAndWindowClose',
	'files.associations': {
		'.env*': 'dotenv'
	},

	// Search
	'search.smartCase': true,
	'search.showLineNumbers': true,
	'search.useParentIgnoreFiles': true,
	'search.seedWithNearestWord': true,
	'search.exclude': {
		'**/pnpm-lock.yaml': true,
		'**/package-lock.json': true,
		'**/yarn.lock': true,
		'**/bun.lock': true,
		'**/.next': true,
		'**/coverage': true
	},

	// Explorer
	'explorer.confirmDelete': false,
	'explorer.confirmDragAndDrop': false,
	'explorer.compactFolders': false,
	'explorer.incrementalNaming': 'smart',
	'explorer.fileNesting.enabled': true,
	'explorer.fileNesting.expand': false,
	'explorer.fileNesting.patterns': {
		'package.json': 'package-lock.json, pnpm-lock.yaml, yarn.lock, bun.lock, bun.lockb, .npmrc, .nvmrc, .node-version, pnpm-workspace.yaml',
		'*.ts': '${capture}.js, ${capture}.d.ts, ${capture}.test.ts, ${capture}.spec.ts',
		'*.tsx': '${capture}.ts, ${capture}.test.tsx, ${capture}.spec.tsx, ${capture}.stories.tsx, ${capture}.module.css, ${capture}.module.scss',
		'.env': '.env.*',
		'next.config.*': 'next-env.d.ts',
		'docker-compose.yml': 'docker-compose.*.yml, Dockerfile*, .dockerignore',
		'Dockerfile': 'Dockerfile.*, .dockerignore',
		'Cargo.toml': 'Cargo.lock'
	},

	// Workbench & window
	'workbench.startupEditor': 'newUntitledFile',
	'workbench.editor.useModal': 'off',
	'workbench.settings.editor': 'json',
	'workbench.tips.enabled': false,
	'workbench.welcomePage.walkthroughs.openOnInstall': false,
	'workbench.editor.enablePreview': false,
	'workbench.editor.revealIfOpen': true,
	'workbench.editor.customLabels.patterns': {
		'**/app/**/page.tsx': '${dirname}/page',
		'**/app/**/layout.tsx': '${dirname}/layout',
		'**/app/**/route.ts': '${dirname}/route',
		'**/index.{ts,tsx}': '${dirname}/index'
	},
	'workbench.view.showQuietly': {
		'workbench.panel.output': true
	},
	'workbench.localHistory.maxFileEntries': 200,
	'problems.showCurrentInStatus': true,
	'update.showReleaseNotes': false,
	'window.title': '${rootName}${separator}${activeEditorMedium}${dirty}',
	'window.commandCenter': false,
	'window.newWindowProfile': 'Default',

	// Theme & fonts
	'editor.fontSize': 14,
	'editor.fontFamily': '\'Liga SFMono Nerd Font\', Menlo, Monaco, \'Courier New\', monospace',
	'editor.fontLigatures': true,
	'editor.cursorBlinking': 'smooth',
	'editor.cursorSmoothCaretAnimation': 'on',
	'editor.smoothScrolling': true,
	'workbench.list.smoothScrolling': true,
	'terminal.integrated.smoothScrolling': true,
	'terminal.integrated.gpuAcceleration': 'off',

	// Zen, diff & git
	'zenMode.hideLineNumbers': false,
	'zenMode.showTabs': 'single',
	'diffEditor.hideUnchangedRegions.enabled': true,
	'diffEditor.experimental.showMoves': true,
	'git.blame.editorDecoration.enabled': true,

	// Terminal
	'terminal.integrated.defaultProfile.osx': 'zsh',
	'terminal.integrated.defaultLocation': 'editor',
	'terminal.integrated.scrollback': 10000,
	'terminal.integrated.copyOnSelection': true,
	'terminal.integrated.enableMultiLinePasteWarning': 'never',
	'terminal.integrated.confirmOnExit': 'hasChildProcesses',
	'terminal.integrated.fontFamily': '\'Liga SFMono Nerd Font\'',

	// Debug, workspace trust & telemetry
	'debug.javascript.autoAttachFilter': 'onlyWithFlag',
	'debug.terminal.clearBeforeReusing': true,
	'security.workspace.trust.untrustedFiles': 'open',
	'telemetry.telemetryLevel': 'off',
	'workbench.enableExperiments': false,

	// Markdown
	'markdown.preview.fontFamily': '\'Helvetica Neue\'',
	'markdown.preview.fontSize': 16,
	'markdown.preview.lineHeight': 1.5,
	'markdown.preview.typographer': true,
	'markdown.validate.enabled': true,
	'markdown.updateLinksOnFileMove.enabled': 'always',
	'markdown.occurrencesHighlight.enabled': true,

	// Emmet
	'emmet.includeLanguages': {
		'javascript': 'javascriptreact'
	},
	'emmet.triggerExpansionOnTab': true,
	'emmet.showSuggestionsAsSnippets': true,
	'emmet.useInlineCompletions': true,
	'emmet.syntaxProfiles': {
		'javascriptreact': {
			'self_closing_tag': 'xhtml',
			'attr_quotes': 'double'
		},
		'typescriptreact': {
			'self_closing_tag': 'xhtml',
			'attr_quotes': 'double'
		}
	},
	'emmet.preferences': {
		'css.floatUnit': 'rem',
		'profile.allowCompactBoolean': true,
		'bem.modifierSeparator': '--'
	},

	// Dotenv Official: the extension's own auto-cloaking rule, carried over as-is.
	'editor.tokenColorCustomizations': {
		'textMateRules': [
			{
				'scope': 'keyword.other.dotenv',
				'settings': {
					'foreground': '#FF000000'
				}
			}
		]
	},

	// Per-language overrides. `registerDefaultConfigurations` takes these in exactly the shape
	// settings.json uses: an `[<languageId>]` key whose value is the settings object for that
	// language. The registry routes any key matching OVERRIDE_PROPERTY_REGEX down that path.
	'[markdown]': {
		'editor.defaultFormatter': 'DavidAnson.vscode-markdownlint'
	},
	'[rust]': {
		'editor.defaultFormatter': 'rust-lang.rust-analyzer',
		'editor.tabSize': 4,
		'editor.rulers': [100]
	},

	// Extension setting, kept even though its extension is not built in: the registry stores
	// the override whether or not a schema exists for the key, and applies it the moment the
	// extension registers one. Until then it simply sits there.
	'errorLens.fontFamily': 'Helvetica Neue'
};

if (isMacintosh && isNative) {
	Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerDefaultConfigurations([{
		overrides: vsebcodeConfigurationDefaults,
		// Attribute the moved defaults to the product, so the Settings editor can say who set
		// them instead of showing an anonymous override marker.
		source: product.nameLong
	}]);
}
