/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getZoomFactor, onDidChangeFullscreen, onDidChangeZoomLevel } from '../../base/browser/browser.js';
import { getWindow } from '../../base/browser/dom.js';
import { mainWindow } from '../../base/browser/window.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { isMacintosh, isNative } from '../../base/common/platform.js';
import { IConfigurationService } from '../../platform/configuration/common/configuration.js';
import { TitleBarSetting } from '../../platform/window/common/window.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../common/contributions.js';
import { IWorkbenchLayoutService, Parts, shouldShowCustomTitleBar } from '../services/layout/browser/layoutService.js';
import { INLINE_TITLE_BAR_CLASS, setInlineTitleBar } from './inlineTitleBar.js';

/**
 * On macOS the window controls are inset into the window rather than drawn in a title bar of
 * their own (see `defaultBrowserWindowOptions`). When the workbench hides its custom title
 * bar on top of that, the controls end up over the first row of the workbench itself, which
 * then has to reserve room for them.
 *
 * This tracks that state on the workbench container of every window, together with the zoom
 * factor the reserved sizes are relative to: the native controls keep their size when the
 * window is zoomed, so the sizes are physical points that stylesheets divide by
 * `--zoom-factor`.
 */
export class InlineTitleBarLayout extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.inlineTitleBarLayout';

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();

		if (!isMacintosh || !isNative) {
			return; // window controls are only inset into the window on macOS desktop
		}

		this.registerListeners();
		this.updateContainers();
	}

	private registerListeners(): void {

		// Auxiliary windows bring their own container
		this._register(this.layoutService.onDidAddContainer(({ container }) => this.updateContainer(container)));

		// Zoom decides how much room the window controls take on screen
		this._register(onDidChangeZoomLevel(targetWindowId => {
			for (const container of this.layoutService.containers) {
				if (getWindow(container).vscodeWindowId === targetWindowId) {
					this.updateContainer(container);
				}
			}
		}));

		// Custom title bar visibility: the main window reports it as part visibility,
		// auxiliary windows and full screen transitions have to be picked up separately
		this._register(this.layoutService.onDidChangePartVisibility(e => {
			if (e.partId === Parts.TITLEBAR_PART) {
				this.updateContainers();
			}
		}));
		this._register(onDidChangeFullscreen(() => this.updateContainers()));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(TitleBarSetting.TITLE_BAR_STYLE) || e.affectsConfiguration(TitleBarSetting.CUSTOM_TITLE_BAR_VISIBILITY)) {
				this.updateContainers();
			}
		}));
	}

	private updateContainers(): void {
		for (const container of this.layoutService.containers) {
			this.updateContainer(container);
		}
	}

	private updateContainer(container: HTMLElement): void {
		const targetWindow = getWindow(container);

		container.style.setProperty('--zoom-factor', `${getZoomFactor(targetWindow)}`);

		const inlineTitleBar = !this.isCustomTitleBarVisible(targetWindow);
		container.classList.toggle(INLINE_TITLE_BAR_CLASS, inlineTitleBar);
		setInlineTitleBar(inlineTitleBar, targetWindow);
	}

	private isCustomTitleBarVisible(targetWindow: Window): boolean {
		if (targetWindow === mainWindow) {
			return this.layoutService.isVisible(Parts.TITLEBAR_PART, targetWindow);
		}

		// Auxiliary windows are not part of the workbench grid, they evaluate the same
		// predicate for their own title bar directly (see `AuxiliaryEditorPart`)
		return shouldShowCustomTitleBar(this.configurationService, targetWindow);
	}
}

registerWorkbenchContribution2(InlineTitleBarLayout.ID, InlineTitleBarLayout, WorkbenchPhase.BlockStartup);
