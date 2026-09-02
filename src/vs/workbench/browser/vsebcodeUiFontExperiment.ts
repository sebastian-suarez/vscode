/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { inspectFontSize, updateDefaultSize } from '../../base/common/font.js';
import { isMacintosh, isWeb } from '../../base/common/platform.js';
import { localize } from '../../nls.js';
import { IConfigurationService } from '../../platform/configuration/common/configuration.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../platform/registry/common/platform.js';

/**
 * DEBUG -- TEMPORARY, DELETE ON RULING.
 *
 * The workbench UI font on macOS is vendored Geist (./media/geistUiFont.css). Before that is
 * final it has to be lived with next to the system face, so this switch swaps the treatment at
 * runtime -- no reload, no rebuild -- between the three candidates:
 *
 *   "geist"        the shipped default, this module stays out of the way entirely
 *   "sf-pro"       the system San Francisco face
 *   "sf-pro-light" the same face with the base UI text weight dropped to Light
 *
 * The whole experiment is three pieces: this file, the DEBUG section at the bottom of
 * ./media/geistUiFont.css, and the block marked `[VSebCode debug]` inside `updateFontFamily()`
 * in ./workbench.ts. Once the font is ruled, all three go.
 *
 * The face is only half of how the UI reads, so the size knob for the same decision --
 * {@link UI_FONT_SIZE_EXPERIMENT_SETTING} -- lives in this file too, and goes out with it.
 */

export const UI_FONT_EXPERIMENT_SETTING = 'vsebcode.uiFontExperiment';

/**
 * Toggled on the workbench container for the Light treatment; the rule it drives lives in the
 * DEBUG section of ./media/geistUiFont.css.
 */
export const UI_FONT_SF_LIGHT_CLASS = 'uifont-sf-light';

export type UiFontExperiment = 'geist' | 'sf-pro' | 'sf-pro-light';

/**
 * `-apple-system` resolves to SF Pro on macOS, so the system face costs no font files. The tail
 * mirrors the fallback stack the Geist default uses, which is the stock `--monaco-font` stack.
 */
const SF_PRO_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, sans-serif';

export interface IUiFontTreatment {

	/**
	 * The family to write as `--vscode-workbench-font-family`.
	 */
	readonly fontFamily: string;

	/**
	 * Whether the base UI text weight drops to Light through {@link UI_FONT_SF_LIGHT_CLASS}.
	 */
	readonly light: boolean;
}

/**
 * The treatment an experiment value asks for, or `undefined` for "leave the workbench alone" --
 * what `"geist"`, an unset value and an unknown value all mean: no inline family and no class,
 * so the shipped Geist default in ./media/geistUiFont.css applies untouched.
 *
 * Precedence is decided by the single caller, `updateFontFamily()` in ./workbench.ts: it asks
 * for a treatment only while `workbench.experimental.fontFamily` is unset. An explicit family
 * therefore wins over the experiment, and the experiment wins over the stylesheet default.
 */
export function resolveUiFontTreatment(experiment: UiFontExperiment | undefined): IUiFontTreatment | undefined {
	switch (experiment) {
		case 'sf-pro':
			return { fontFamily: SF_PRO_FONT_FAMILY, light: false };
		case 'sf-pro-light':
			return { fontFamily: SF_PRO_FONT_FAMILY, light: true };
		default:
			return undefined;
	}
}

/**
 * DEBUG -- TEMPORARY, DELETE ON RULING.
 *
 * The size half of the same font decision: one base size the entire workbench UI text scales
 * off, so the candidates can be judged at the size they will actually be lived with.
 *
 * It is a base, not a size for one surface. The vscodium font patch already derives every
 * surface's default from a single number at a fixed ratio (`updateDefaultSize()` in
 * ../../base/common/font.ts): side bar, secondary side bar, bottom panel and tabs at 1x, the
 * status bar at 12/13, the activity bar at 16/13. This knob feeds that primitive, so 13 is the
 * shipped workbench untouched and every other value moves all of it together.
 *
 * What moves with it beyond text: the row heights the patch derives from the same bases -- the
 * tab row is `FONT.tabsSize35`, 35/13 x the tabs base, so the stock 35px only holds at 13, and
 * the composite bar and status bar rows behave the same way. That is the patch's own design, not
 * a side effect of this knob; the editor tabs listener already relayouts for it.
 *
 * What deliberately does not move: the editor's own text, which is `editor.fontSize`; the M2
 * pill glyphs at 20px; and the inline title bar geometry, which is expressed in physical points
 * (46pt header, 24 caption, 25 breadcrumbs) and tracks the zoom level instead.
 *
 * The pieces are this section, the block marked `[VSebCode debug]` inside `updateFontSize()` in
 * ./workbench.ts, and the one `applyUiFontSizeBase()` call plus listener clause in each of the
 * six surfaces that read the shared defaults (side bar, secondary side bar, activity bar, bottom
 * panel, status bar, editor tabs). All of it goes once the font is ruled.
 */
export const UI_FONT_SIZE_EXPERIMENT_SETTING = 'vsebcode.uiFontSizeExperiment';

/**
 * The font patch's own workbench-wide base, which outranks the experiment, and the stock size
 * both of them fall back to.
 */
const WORKBENCH_FONT_SIZE_SETTING = 'workbench.experimental.fontSize';
const UI_FONT_SIZE_STOCK = 13;

/**
 * The base UI text size the whole workbench derives from.
 *
 * Precedence mirrors the face switch: {@link WORKBENCH_FONT_SIZE_SETTING} wins whenever it is
 * explicitly set at any user or workspace layer, and otherwise the experiment answers. The
 * experiment is read as the base unconditionally rather than only while it differs from stock:
 * its registered default *is* 13, so "unset" and "set to 13" resolve to the same number and the
 * extra branch would buy nothing. Off macOS the key is not registered at all, `inspectFontSize()`
 * falls back to the same 13, and the knob is inert -- the face switch's arrangement exactly.
 *
 * Both readings are clamped to the 6..32 the font patch clamps every other size to.
 */
function resolveUiFontSizeBase(configurationService: IConfigurationService): number {
	const explicit = inspectFontSize(configurationService, WORKBENCH_FONT_SIZE_SETTING, UI_FONT_SIZE_STOCK);
	if (explicit.isUserSet) {
		return explicit.size;
	}

	return inspectFontSize(configurationService, UI_FONT_SIZE_EXPERIMENT_SETTING, UI_FONT_SIZE_STOCK).size;
}

/**
 * Write {@link resolveUiFontSizeBase} into the shared `FONT.default*Size` record that every
 * surface reads its own default from, and hand the base back. Idempotent.
 *
 * Every reader of those defaults calls this before reading, rather than trusting
 * `updateFontSize()` in ./workbench.ts to have run first, because it has not: `startup()` builds
 * the parts through `initLayout()` (./workbench.ts) and only afterwards registers the workbench's
 * own configuration listener in `registerListeners()`, while each part registers its listener as
 * it is built. The configuration emitter delivers in registration order, so on a shared event
 * every part's handler runs ahead of the workbench's and would otherwise read a stale base.
 * Making the write idempotent and shared takes the ordering out of the picture entirely.
 *
 * A surface the user has pinned keeps its own size regardless: `getFontSize()` answers with a
 * `workbench.*.experimental.fontSize` value only when that key was explicitly set, and falls back
 * to the default handed to it otherwise -- which is what this refreshes.
 */
export function applyUiFontSizeBase(configurationService: IConfigurationService): number {
	const base = resolveUiFontSizeBase(configurationService);
	updateDefaultSize(base);

	return base;
}

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	'id': 'vsebcode',
	'title': localize('vsebcodeConfigurationTitle', "VSebCode"),
	'type': 'object',
	'properties': {
		[UI_FONT_EXPERIMENT_SETTING]: {
			'type': 'string',
			'enum': ['geist', 'sf-pro', 'sf-pro-light'],
			'default': 'geist',
			'enumDescriptions': [
				localize('vsebcode.uiFontExperiment.geist', "The shipped default: vendored Geist."),
				localize('vsebcode.uiFontExperiment.sfPro', "The system San Francisco face (SF Pro), through the -apple-system family."),
				localize('vsebcode.uiFontExperiment.sfProLight', "SF Pro with the base UI text weight dropped to Light (300). Elements that state a weight of their own, such as semibold titles, keep it.")
			],
			'markdownDescription': localize({ comment: ['{0} will be a setting name rendered as a link'], key: 'vsebcode.uiFontExperiment' }, "Temporary A/B switch for the VSebCode UI font decision: Geist against SF Pro and SF Pro Light, so the three can be judged in real use. It will be removed once the font is ruled. {0} overrides it whenever it is set.", '`#workbench.experimental.fontFamily#`'),
			// Native macOS only, exactly where the Geist default speaks
			// (`.monaco-workbench.mac:not(.web)`). `included` is the gating idiom at a registration
			// site in this fork (see `workbench.editor.swipeToNavigate` in ./workbench.contribution.ts);
			// off target the key is not registered at all, so it carries no default and the writer
			// reads `undefined` -- the same inert answer as `"geist"`.
			'included': isMacintosh && !isWeb,
			'tags': ['experimental']
		},
		[UI_FONT_SIZE_EXPERIMENT_SETTING]: {
			'type': 'number',
			'default': UI_FONT_SIZE_STOCK,
			'minimum': 6,
			'maximum': 32,
			'markdownDescription': localize({ comment: ['{0} and {1} will be setting names rendered as links'], key: 'vsebcode.uiFontSizeExperiment' }, "Temporary debug knob for the VSebCode font decision: the base size the entire workbench UI text scales off, every surface at its stock ratio, so 13 is the shipped size and anything else moves side bar, activity bar, tabs, panel and status bar together. It will be removed once the font is ruled. {0} still wins whenever it is explicitly set, and so does any per-surface `workbench.*.experimental.fontSize` for its own surface. The editor's own text is not affected; that is {1}.", '`#workbench.experimental.fontSize#`', '`#editor.fontSize#`'),
			// Gated exactly like the face switch above: the two knobs answer the same question and
			// only speak where the Geist default does.
			'included': isMacintosh && !isWeb,
			'tags': ['experimental']
		}
	}
});
