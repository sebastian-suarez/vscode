/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getZoomFactor, onDidChangeZoomLevel } from '../../base/browser/browser.js';
import { getWindow } from '../../base/browser/dom.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { isMacintosh, isNative } from '../../base/common/platform.js';
import { IConfigurationService } from '../../platform/configuration/common/configuration.js';
import { TitleBarSetting } from '../../platform/window/common/window.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../common/contributions.js';
import { isCustomTitleBarDisabled, IWorkbenchLayoutService, LayoutSettings } from '../services/layout/browser/layoutService.js';
import { INLINE_TITLE_BAR_CLASS, setInlineTitleBar } from './inlineTitleBar.js';

/**
 * On macOS the window controls are inset into the window rather than drawn in a title bar of
 * their own (see `defaultBrowserWindowOptions`). When the workbench is configured without a
 * custom title bar on top of that, the controls end up over the first row of the workbench
 * itself, which then has to reserve room for them.
 *
 * This tracks that state on the workbench container of every window, together with the zoom
 * factor the reserved sizes are relative to: the native controls keep their size when the
 * window is zoomed, so the sizes are physical points that stylesheets divide by
 * `--zoom-factor`.
 */
export class InlineTitleBarLayout extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.inlineTitleBarLayout';

	/**
	 * The settings `isCustomTitleBarDisabled` reads on macOS. The menu settings are not
	 * among them because `hasNativeMenu` is unconditionally true on this platform.
	 */
	private static readonly TITLE_BAR_CONFIGURATIONS = [
		TitleBarSetting.TITLE_BAR_STYLE,
		TitleBarSetting.CUSTOM_TITLE_BAR_VISIBILITY,
		LayoutSettings.COMMAND_CENTER,
		LayoutSettings.ACTIVITY_BAR_LOCATION,
		LayoutSettings.EDITOR_ACTIONS_LOCATION,
		LayoutSettings.EDITOR_TABS_MODE,
		LayoutSettings.LAYOUT_ACTIONS
	];

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

		// Whether the custom title bar is configured away. Neither full screen nor the title
		// bar part's own visibility is listened to: those hide the title bar for the state
		// the window is in, and the geometry has to survive that — macOS takes the window
		// controls away in full screen, it does not move the workbench underneath them.
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (InlineTitleBarLayout.TITLE_BAR_CONFIGURATIONS.some(setting => e.affectsConfiguration(setting))) {
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

		// Configuration, not window state: every window of the session lays out the same way
		const inlineTitleBar = isCustomTitleBarDisabled(this.configurationService);
		container.classList.toggle(INLINE_TITLE_BAR_CLASS, inlineTitleBar);
		setInlineTitleBar(inlineTitleBar, targetWindow);
	}
}

registerWorkbenchContribution2(InlineTitleBarLayout.ID, InlineTitleBarLayout, WorkbenchPhase.BlockStartup);
