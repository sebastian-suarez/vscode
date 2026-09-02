/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isMacintosh, isWeb } from '../../base/common/platform.js';
import { localize } from '../../nls.js';
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
		}
	}
});
