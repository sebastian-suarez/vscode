/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { QuickInputController } from '../../../../platform/quickinput/browser/quickInputController.js';
import { QuickInputService as BaseQuickInputService } from '../../../../platform/quickinput/browser/quickInputService.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { InQuickPickContextKey } from '../../../browser/quickaccess.js';
import { QuickInputPreview } from './quickInputPreview.js';
import { isMacintosh, isNative } from '../../../../base/common/platform.js';

/**
 * The picker is a telescope panel on this platform and a telescope panel is two columns wide when
 * the picker is offering files: the results in the left one and a preview of the file in focus
 * beside them. Everywhere else there is no pane to build, so none is built and the controller is
 * handed nothing, which is the state it treats as the picker it always was.
 */
const splitPanel = isMacintosh && isNative;

export class QuickInputService extends BaseQuickInputService {

	private readonly inQuickInputContext = InQuickPickContextKey.bindTo(this.contextKeyService);

	constructor(
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@ILayoutService layoutService: ILayoutService,
	) {
		super(instantiationService, contextKeyService, themeService, layoutService, configurationService);

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.onShow(() => this.inQuickInputContext.set(true)));
		this._register(this.onHide(() => this.inQuickInputContext.set(false)));
	}

	protected override createController(): QuickInputController {
		return super.createController(this.layoutService, {
			ignoreFocusOut: () => !this.configurationService.getValue('workbench.quickOpen.closeOnFocusLost'),
			backKeybindingLabel: () => this.keybindingService.lookupKeybinding('workbench.action.quickInputBack')?.getLabel() || undefined,
			// The preview pane the telescope panel splits to show (M16). It is made here because
			// what it holds is a file drawn by an editor, and the quick input is a level of the
			// product that may not name one; it is made here rather than in the platform service
			// for the same reason. Owned here too: the controller drives it and never disposes it.
			previewRenderer: splitPanel ? this._register(this.instantiationService.createInstance(QuickInputPreview)) : undefined,
		});
	}
}

registerSingleton(IQuickInputService, QuickInputService, InstantiationType.Delayed);
