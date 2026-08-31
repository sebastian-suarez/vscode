/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getZoomFactor } from '../../base/browser/browser.js';
import { CodeWindow } from '../../base/browser/window.js';
import { Emitter } from '../../base/common/event.js';

/**
 * Class set on the workbench container of every window that lays out with an inline title
 * bar, so that stylesheets can scope the geometry to it.
 */
export const INLINE_TITLE_BAR_CLASS = 'inline-titlebar';

/**
 * Height of the row that hosts the native window controls, in physical points. The controls
 * do not scale with the window zoom level, so the row is divided by the zoom factor to keep
 * the same size on screen. Kept in sync with `--titlebar-height` in `media/style.css`.
 */
export const INLINE_TITLE_BAR_HEIGHT = 46;

/**
 * Width the native window controls occupy, in physical points. Divided by the zoom factor
 * for the same reason. Kept in sync with `--traffic-lights-width` in `media/style.css`.
 */
export const INLINE_TITLE_BAR_CONTROLS_WIDTH = 86;

/**
 * Height of the caption row that a side bar title shrinks to underneath the window controls
 * row, in pixels. Unlike the row above it, neither zoom nor the workbench font size scales
 * this one: it is what is left of the height the part layout reserves for a header and a
 * title at zoom level 0.
 */
export const INLINE_TITLE_BAR_CAPTION_HEIGHT = 24;

/**
 * Height of the breadcrumbs row underneath a full height tab row, in pixels. That row carries
 * content rather than the window controls, so unlike the row above it this is a plain size
 * that the zoom level scales along with everything else.
 */
export const INLINE_TITLE_BAR_BREADCRUMBS_HEIGHT = 25;

class InlineTitleBarManager {

	static readonly INSTANCE = new InlineTitleBarManager();

	private readonly enabledWindowIds = new Set<number>();

	private readonly _onDidChange = new Emitter<number>();
	readonly onDidChange = this._onDidChange.event;

	isEnabled(targetWindow: Window): boolean {
		return this.enabledWindowIds.has(this.getWindowId(targetWindow));
	}

	setEnabled(enabled: boolean, targetWindow: Window): void {
		const targetWindowId = this.getWindowId(targetWindow);
		if (enabled === this.enabledWindowIds.has(targetWindowId)) {
			return;
		}

		if (enabled) {
			this.enabledWindowIds.add(targetWindowId);
		} else {
			this.enabledWindowIds.delete(targetWindowId);
		}

		this._onDidChange.fire(targetWindowId);
	}

	private getWindowId(targetWindow: Window): number {
		return (targetWindow as CodeWindow).vscodeWindowId;
	}
}

/**
 * Whether the target window lays out with an inline title bar, meaning the native window
 * controls sit inside the first row of the workbench instead of in a title bar of their own.
 */
export function isInlineTitleBar(targetWindow: Window): boolean {
	return InlineTitleBarManager.INSTANCE.isEnabled(targetWindow);
}

export function setInlineTitleBar(enabled: boolean, targetWindow: Window): void {
	InlineTitleBarManager.INSTANCE.setEnabled(enabled, targetWindow);
}

export const onDidChangeInlineTitleBar = InlineTitleBarManager.INSTANCE.onDidChange;

/**
 * Height of the inline title bar row in the target window, in pixels. Matches what the
 * `--titlebar-height` variable resolves to for that window.
 */
export function getInlineTitleBarHeight(targetWindow: Window): number {
	return INLINE_TITLE_BAR_HEIGHT / getZoomFactor(targetWindow);
}

/**
 * Width the native window controls take up in the target window, in pixels. Matches what the
 * `--traffic-lights-width` variable resolves to for that window.
 */
export function getInlineTitleBarControlsWidth(targetWindow: Window): number {
	return INLINE_TITLE_BAR_CONTROLS_WIDTH / getZoomFactor(targetWindow);
}
