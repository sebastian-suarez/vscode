/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../base/browser/dom.js';
import * as domStylesheetsJs from '../../../base/browser/domStylesheets.js';
import { ToolBar } from '../../../base/browser/ui/toolbar/toolbar.js';
import { Button } from '../../../base/browser/ui/button/button.js';
import { CountBadge } from '../../../base/browser/ui/countBadge/countBadge.js';
import { ProgressBar } from '../../../base/browser/ui/progressbar/progressbar.js';
import { disposableTimeout } from '../../../base/common/async.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, DisposableStore, dispose, MutableDisposable } from '../../../base/common/lifecycle.js';
import Severity from '../../../base/common/severity.js';
import { isString } from '../../../base/common/types.js';
import { isModifierKey } from '../../../base/common/keyCodes.js';
import { localize } from '../../../nls.js';
import { IInputBox, IInputOptions, IKeyMods, IPickOptions, IQuickInput, IQuickInputButton, IQuickNavigateConfiguration, IQuickPick, IQuickPickItem, IQuickWidget, QuickInputHideReason, QuickPickInput, QuickPickFocus, QuickInputType, IQuickTree, IQuickTreeItem, QuickInputAlignment } from '../common/quickInput.js';
import { QuickInputBox } from './quickInputBox.js';
import { QuickInputUI, Writeable, IQuickInputStyles, IQuickInputOptions, QuickPick, backButton, InputBox, Visibilities, QuickWidget, InQuickInputContextKey, QuickInputTypeContextKey, EndOfQuickInputBoxContextKey, QuickInputAlignmentContextKey } from './quickInput.js';
import { ILayoutService } from '../../layout/browser/layoutService.js';
import { mainWindow } from '../../../base/browser/window.js';
import { IInstantiationService } from '../../instantiation/common/instantiation.js';
import { IContextMenuService } from '../../contextview/browser/contextView.js';
import { QuickInputList } from './quickInputList.js';
import { IContextKey, IContextKeyService } from '../../contextkey/common/contextkey.js';
import './quickInputActions.js';
import { IObservable, autorun, observableValue } from '../../../base/common/observable.js';
import { StandardMouseEvent } from '../../../base/browser/mouseEvent.js';
import { IStorageService, StorageScope, StorageTarget } from '../../storage/common/storage.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { isMacintosh, isNative, Platform, platform, setTimeout0 } from '../../../base/common/platform.js';
import { getWindowControlsStyle, WindowControlsStyle } from '../../window/common/window.js';
import { getZoomFactor } from '../../../base/browser/browser.js';
import { TriStateCheckbox, createToggleActionViewItemProvider } from '../../../base/browser/ui/toggle/toggle.js';
import { defaultCheckboxStyles } from '../../theme/browser/defaultStyles.js';
import { QuickInputTreeController } from './tree/quickInputTreeController.js';
import { QuickTree } from './tree/quickTree.js';
import { AnchorAlignment, AnchorPosition, layout2d } from '../../../base/common/layout.js';
import { getAnchorRect, IAnchor } from '../../../base/browser/ui/contextview/contextview.js';

const $ = dom.$;

const VIEWSTATE_STORAGE_KEY = 'workbench.quickInput.viewState';

type QuickInputViewState = {
	readonly top?: number;
	readonly left?: number;
};

/**
 * The picker is a telescope panel on this platform: one wide, low pane, in the same place every
 * time it opens, with the prompt on a line the eye can learn and the results stacked over it. The
 * place is baked in - a remembered position and the drag that would set one are both off, because
 * a panel that is where it was left is a panel you have to look for.
 */
const telescopePanel = isMacintosh && isNative;

export class QuickInputController extends Disposable {
	private static readonly MAX_WIDTH = 600; // Max total width of quick input widget

	/**
	 * The telescope panel, measured off the mockup: 920 wide by 405 tall, border box, drawn in a
	 * 1280 by 859 window at left 180 and top 163. Centred across, and down the window the free
	 * height splits 36 above to 64 below - which is what the panel is anchored by, since the
	 * prompt is on its bottom edge and has to hold that line whether six results stand over it or
	 * twenty. The height is a ceiling and not a size: the panel is as tall as its contents make it,
	 * and the figure is what the split is worked out from and what the list is not allowed to grow
	 * the panel past.
	 */
	private static readonly TELESCOPE_WIDTH = 920;
	private static readonly TELESCOPE_HEIGHT = 405;
	private static readonly TELESCOPE_BOTTOM_SHARE = 0.64;

	/**
	 * What the panel is made of, top to bottom: 6px of padding, sixteen 22px rows and 6px more
	 * padding is the 364 the results column measures, and 364 with the 39px prompt strip and the
	 * container's own 1px border top and bottom is the 405 above.
	 *
	 * `layout` caps the rows and not the column - the padding is drawn outside the box the cap
	 * holds - so the figure the list is handed is the 352 the rows themselves take, and the 53
	 * between that and the panel is everything drawn around them. The sixteen row column is written
	 * down in `style.css` and not here, and an inline max-height would beat it, so the height is
	 * only ever handed over for a window too short to hold the panel.
	 *
	 * Nothing in the 53 is left for the progress bar, and nothing needs to be: the strip is drawn
	 * for every picker but stands at no height at all until there is progress to report, which is
	 * `style.css` again. A picker that is loading is 2px taller than the figure here for as long
	 * as it loads, and the bar it has grown by is the division line.
	 */
	private static readonly TELESCOPE_ROW_HEIGHT = 22;
	private static readonly TELESCOPE_LIST_CHROME = 53;

	/**
	 * The panel is taken off screen on the dismiss written in `style.css`, and the figure is said
	 * again here because the node has to go back to `display: none` at the end of it and a
	 * stylesheet cannot do that. The grace on top is for the frame the animation has finished in
	 * but not yet reported; the report is what usually ends the fade, and this is the floor under
	 * it for the times the node is hidden or reparented before it arrives.
	 */
	private static readonly TELESCOPE_DISMISS = 120;
	private static readonly TELESCOPE_DISMISS_GRACE = 40;

	private idPrefix: string;
	private ui: QuickInputUI | undefined;
	private dimension?: dom.IDimension;
	private titleBarOffset?: number;
	private enabled = true;
	private readonly onDidAcceptEmitter = this._register(new Emitter<void>());
	private readonly onDidCustomEmitter = this._register(new Emitter<void>());
	private readonly onDidTriggerButtonEmitter = this._register(new Emitter<IQuickInputButton>());
	private keyMods: Writeable<IKeyMods> = { ctrlCmd: false, alt: false, shift: false };

	private controller: IQuickInput | null = null;
	get currentQuickInput() { return this.controller ?? undefined; }

	private _container: HTMLElement;
	get container() { return this._container; }

	private styles: IQuickInputStyles;

	private onShowEmitter = this._register(new Emitter<void>());
	readonly onShow = this.onShowEmitter.event;

	private onHideEmitter = this._register(new Emitter<void>());
	readonly onHide = this.onHideEmitter.event;

	private previousFocusElement?: HTMLElement;

	/** Holds the one in-flight dismiss: the end of the fade, and the fallback that ends it anyway. */
	private readonly telescopeDismissal = this._register(new MutableDisposable<DisposableStore>());

	private viewState: QuickInputViewState | undefined;
	private dndController: QuickInputDragAndDropController | undefined;

	private readonly _alignment = observableValue<QuickInputAlignment>(this, 'top');
	readonly alignment: IObservable<QuickInputAlignment> = this._alignment;

	private readonly inQuickInputContext: IContextKey<boolean>;
	private readonly quickInputTypeContext: IContextKey<QuickInputType>;
	private readonly endOfQuickInputBoxContext: IContextKey<boolean>;

	constructor(
		private options: IQuickInputOptions,
		@ILayoutService private readonly layoutService: ILayoutService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IStorageService private readonly storageService: IStorageService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService
	) {
		super();

		this.inQuickInputContext = InQuickInputContextKey.bindTo(contextKeyService);
		this.quickInputTypeContext = QuickInputTypeContextKey.bindTo(contextKeyService);
		this.endOfQuickInputBoxContext = EndOfQuickInputBoxContextKey.bindTo(contextKeyService);

		this.idPrefix = options.idPrefix;
		this._container = options.container;
		this.styles = options.styles;
		this._register(Event.runAndSubscribe(dom.onDidRegisterWindow, ({ window, disposables }) => this.registerKeyModsListeners(window, disposables), { window: mainWindow, disposables: this._store }));
		this._register(dom.onWillUnregisterWindow(window => {
			if (this.ui && dom.getWindow(this.ui.container) === window) {
				// The window this quick input is contained in is about to
				// close, so we have to make sure to reparent it back to an
				// existing parent to not loose functionality.
				// (https://github.com/microsoft/vscode/issues/195870)
				this.reparentUI(this.layoutService.mainContainer);
				this.layout(this.layoutService.mainContainerDimension, this.layoutService.mainContainerOffset.quickPickTop);
			}
		}));
		this.viewState = this.loadViewState();
	}

	private registerKeyModsListeners(window: Window, disposables: DisposableStore): void {
		const listener = (e: KeyboardEvent | MouseEvent) => {
			this.keyMods.ctrlCmd = e.ctrlKey || e.metaKey;
			this.keyMods.alt = e.altKey;
			this.keyMods.shift = e.shiftKey;
		};

		for (const event of [dom.EventType.KEY_DOWN, dom.EventType.KEY_UP, dom.EventType.MOUSE_DOWN]) {
			disposables.add(dom.addDisposableListener(window, event, listener, true));
		}
	}

	private getUI(showInActiveContainer?: boolean): QuickInputUI {
		if (this.ui) {
			// In order to support aux windows, re-parent the controller
			// if the original event is from a different document
			if (showInActiveContainer) {
				if (dom.getWindow(this._container) !== dom.getWindow(this.layoutService.activeContainer)) {
					this.reparentUI(this.layoutService.activeContainer);
					this.layout(this.layoutService.activeContainerDimension, this.layoutService.activeContainerOffset.quickPickTop);
				}
			}

			return this.ui;
		}

		const container = dom.append(this._container, $('.quick-input-widget.show-file-icons'));
		container.tabIndex = -1;
		container.style.display = 'none';

		const styleSheet = domStylesheetsJs.createStyleSheet(container);

		// The telescope panel is a sheet of two columns and the picker is the left one of them, so
		// on this platform everything the widget used to hold goes into a column of its own and the
		// widget itself holds the columns. Everywhere else the host is the widget, which is to say
		// there is no column and the DOM is built exactly as it was built before: the elements are
		// the same elements, in the same order, under the same parent.
		const host = telescopePanel ? dom.append(container, $('.quick-input-left')) : container;

		const titleBar = dom.append(host, $('.quick-input-titlebar'));

		const leftActionBar = this._register(new ToolBar(titleBar, this.contextMenuService, {
			hoverDelegate: this.options.hoverDelegate,
			actionViewItemProvider: createToggleActionViewItemProvider(this.styles.toggle),
			icon: true,
			label: false
		}));
		leftActionBar.getElement().classList.add('quick-input-left-action-bar');

		const title = dom.append(titleBar, $('.quick-input-title'));

		const rightActionBar = this._register(new ToolBar(titleBar, this.contextMenuService, {
			hoverDelegate: this.options.hoverDelegate,
			actionViewItemProvider: createToggleActionViewItemProvider(this.styles.toggle),
			icon: true,
			label: false
		}));
		rightActionBar.getElement().classList.add('quick-input-right-action-bar');

		const headerContainer = dom.append(host, $('.quick-input-header'));

		const checkAll = this._register(new TriStateCheckbox(localize('quickInput.checkAll', "Toggle all checkboxes"), false, { ...defaultCheckboxStyles, size: 15 }));
		dom.append(headerContainer, checkAll.domNode);
		this._register(checkAll.onChange(() => {
			const checked = checkAll.checked;
			list.setAllVisibleChecked(checked === true);
		}));
		this._register(dom.addDisposableListener(checkAll.domNode, dom.EventType.CLICK, e => {
			if (e.x || e.y) { // Avoid 'click' triggered by 'space'...
				inputBox.setFocus();
			}
		}));

		const description2 = dom.append(headerContainer, $('.quick-input-description'));
		const inputContainer = dom.append(headerContainer, $('.quick-input-and-message'));
		const filterContainer = dom.append(inputContainer, $('.quick-input-filter'));

		const inputBox = this._register(new QuickInputBox(filterContainer, this.styles.inputBox, this.styles.toggle));
		inputBox.setAttribute('aria-describedby', `${this.idPrefix}message`);

		const visibleCountContainer = dom.append(filterContainer, $('.quick-input-visible-count'));
		visibleCountContainer.setAttribute('aria-live', 'polite');
		visibleCountContainer.setAttribute('aria-atomic', 'true');
		const visibleCount = this._register(new CountBadge(visibleCountContainer, { countFormat: localize({ key: 'quickInput.visibleCount', comment: ['This tells the user how many items are shown in a list of items to select from. The items can be anything. Currently not visible, but read by screen readers.'] }, "{0} Results") }, this.styles.countBadge));

		const countContainer = dom.append(filterContainer, $('.quick-input-count'));
		countContainer.setAttribute('aria-live', 'polite');
		const count = this._register(new CountBadge(countContainer, { countFormat: localize({ key: 'quickInput.countSelected', comment: ['This tells the user how many items are selected in a list of items to select from. The items can be anything.'] }, "{0} Selected") }, this.styles.countBadge));

		const inlineActionBar = this._register(new ToolBar(headerContainer, this.contextMenuService, {
			hoverDelegate: this.options.hoverDelegate,
			actionViewItemProvider: createToggleActionViewItemProvider(this.styles.toggle),
			icon: true,
			label: false
		}));
		inlineActionBar.getElement().classList.add('quick-input-inline-action-bar');

		const okContainer = dom.append(headerContainer, $('.quick-input-action'));
		const ok = this._register(new Button(okContainer, this.styles.button));
		ok.label = localize('ok', "OK");
		this._register(ok.onDidClick(e => {
			this.onDidAcceptEmitter.fire();
		}));

		const customButtonContainer = dom.append(headerContainer, $('.quick-input-action'));
		const customButton = this._register(new Button(customButtonContainer, { ...this.styles.button, supportIcons: true }));
		customButton.label = localize('custom', "Custom");
		this._register(customButton.onDidClick(e => {
			this.onDidCustomEmitter.fire();
		}));

		const message = dom.append(inputContainer, $(`#${this.idPrefix}message.quick-input-message`));

		const progressBar = this._register(new ProgressBar(host, this.styles.progressBar));
		progressBar.getContainer().classList.add('quick-input-progress');

		const widget = dom.append(host, $('.quick-input-html-widget'));
		widget.tabIndex = -1;

		const description1 = dom.append(host, $('.quick-input-description'));

		// List
		const listId = this.idPrefix + 'list';
		const list = this._register(this.instantiationService.createInstance(QuickInputList, host, this.options.hoverDelegate, this.options.linkOpenerDelegate, listId, this.styles));
		inputBox.setAttribute('aria-controls', listId);
		this._register(list.onDidChangeFocus(() => {
			if (inputBox.hasFocus()) {
				const activeDescendant = list.getActiveDescendant();
				if (activeDescendant) {
					inputBox.setAttribute('aria-activedescendant', activeDescendant);
					inputBox.setListFocusMode(true);
				} else {
					inputBox.removeAttribute('aria-activedescendant');
					inputBox.setListFocusMode(false);
				}
			}
		}));
		this._register(list.onChangedAllVisibleChecked(checked => {
			// TODO: Support tri-state checkbox when we remove the .indent property that is faking tree structure.
			checkAll.checked = checked;
		}));
		this._register(list.onChangedVisibleCount(c => {
			visibleCount.setCount(c);
		}));
		this._register(list.onChangedCheckedCount(c => {
			// TODO@TylerLeonhardt: Without this setTimeout, the screen reader will not read out
			// the final count of checked items correctly. Investigate a better way
			// to do this. ref https://github.com/microsoft/vscode/issues/258617
			setTimeout0(() => count.setCount(c));
		}));
		this._register(list.onLeave(() => {
			// Defer to avoid the input field reacting to the triggering key.
			// TODO@TylerLeonhardt https://github.com/microsoft/vscode/issues/203675
			setTimeout(() => {
				if (!this.controller) {
					return;
				}
				inputBox.setFocus();
				if (this.controller instanceof QuickPick && this.controller.canSelectMany) {
					list.clearFocus();
				}
			}, 0);
		}));

		// Tree
		const tree = this._register(this.instantiationService.createInstance(
			QuickInputTreeController,
			host,
			this.options.hoverDelegate,
			this.styles
		));
		this._register(tree.tree.onDidChangeFocus(() => {
			if (inputBox.hasFocus()) {
				const activeDescendant = tree.getActiveDescendant();
				if (activeDescendant) {
					inputBox.setAttribute('aria-activedescendant', activeDescendant);
					inputBox.setListFocusMode(true);
				} else {
					inputBox.removeAttribute('aria-activedescendant');
					inputBox.setListFocusMode(false);
				}
			}
		}));
		this._register(tree.onLeave(() => {
			// Defer to avoid the input field reacting to the triggering key.
			// TODO@TylerLeonhardt https://github.com/microsoft/vscode/issues/203675
			setTimeout(() => {
				if (!this.controller) {
					return;
				}
				inputBox.setFocus();
				tree.tree.setFocus([]);
			}, 0);
		}));
		// Wire up tree's accept event to the UI's accept emitter for non-pickable items
		this._register(tree.onDidAccept(() => {
			this.onDidAcceptEmitter.fire();
		}));
		this._register(tree.tree.onDidChangeContentHeight(() => this.updateLayout()));

		// Preview pane. The panel splits into a results column and a pane beside it when the picker
		// is offering files, and the two things that stand between them are drawn here: a hairline
		// and the pane's own cell. Nothing is put in that cell from this layer - the pane is handed
		// it once and fills it, and what it fills it with is not the panel's business.
		//
		// The split is decided by the whole set of items and not by the one in focus, so a command
		// row sitting among a list of files does not fold the pane away as the eye passes over it.
		// What the pane *draws* does follow the focus, and an item it cannot draw leaves it blank.
		if (telescopePanel && this.options.previewRenderer) {
			const preview = this.options.previewRenderer;
			dom.append(container, $('.quick-input-preview-separator'));
			preview.attach(dom.append(container, $('.quick-input-preview')));

			this._register(list.onDidSetItems(items => {
				const split = preview.setItems(items);
				if (container.classList.contains('has-preview') !== split) {
					container.classList.toggle('has-preview', split);
					this.updateLayout(); // the results column has just changed width
				}
			}));
			this._register(list.onDidChangeFocus(focused => preview.setFocus(focused[0])));
		}

		const focusTracker = dom.trackFocus(container);
		this._register(focusTracker);
		this._register(dom.addDisposableListener(container, dom.EventType.FOCUS, e => {
			const ui = this.getUI();
			if (dom.isAncestor(e.relatedTarget as HTMLElement, ui.inputContainer)) {
				const value = ui.inputBox.isSelectionAtEnd();
				if (this.endOfQuickInputBoxContext.get() !== value) {
					this.endOfQuickInputBoxContext.set(value);
				}
			}
			// Ignore focus events within container
			if (dom.isAncestor(e.relatedTarget as HTMLElement, ui.container)) {
				return;
			}
			this.inQuickInputContext.set(true);
			this.previousFocusElement = dom.isHTMLElement(e.relatedTarget) ? e.relatedTarget : undefined;
		}, true));
		this._register(focusTracker.onDidBlur(() => {
			if (!this.getUI().ignoreFocusOut && !this.options.ignoreFocusOut()) {
				this.hide(QuickInputHideReason.Blur);
			}
			this.inQuickInputContext.set(false);
			this.endOfQuickInputBoxContext.set(false);
			this.previousFocusElement = undefined;
		}));
		this._register(inputBox.onKeyDown(e => {
			const value = this.getUI().inputBox.isSelectionAtEnd();
			if (this.endOfQuickInputBoxContext.get() !== value) {
				this.endOfQuickInputBoxContext.set(value);
			}
			// Allow screen readers to read what's in the input
			// Note: this works for arrow keys and selection changes,
			// but not for deletions since that often triggers a
			// change in the list.
			// Don't remove aria-activedescendant when only modifier keys are pressed
			// to prevent screen reader re-announcements when users press Ctrl to silence speech.
			// See: https://github.com/microsoft/vscode/issues/271032
			if (!isModifierKey(e.keyCode)) {
				inputBox.removeAttribute('aria-activedescendant');
				// Reset ARIA popup mode to allow normal text editing with arrow keys
				inputBox.setListFocusMode(false);
			}
		}));
		this._register(dom.addDisposableListener(container, dom.EventType.FOCUS, (e: FocusEvent) => {
			inputBox.setFocus();
		}));

		// Drag and Drop support
		this.dndController = this._register(this.instantiationService.createInstance(
			QuickInputDragAndDropController,
			this._container,
			container,
			[
				{
					node: titleBar,
					includeChildren: true,
					excludeNodes: [leftActionBar.getElement(), rightActionBar.getElement()]
				},
				{
					node: headerContainer,
					includeChildren: false
				}
			],
			this.viewState
		));

		// DnD update layout
		this._register(autorun(reader => {
			const dndViewState = this.dndController?.dndViewState.read(reader);
			if (!dndViewState) {
				return;
			}

			if (dndViewState.top !== undefined && dndViewState.left !== undefined) {
				this.viewState = {
					...this.viewState,
					top: dndViewState.top,
					left: dndViewState.left
				};
			} else {
				// Reset position/size
				this.viewState = undefined;
			}

			this.updateLayout();

			// Save position
			if (dndViewState.done) {
				this.saveViewState(this.viewState);
			}
		}));

		// Mirror DnD alignment into the stable observable
		this._register(autorun(reader => {
			this._alignment.set(this.dndController!.alignment.read(reader), undefined);
		}));

		this.ui = {
			container,
			styleSheet,
			leftActionBar,
			titleBar,
			title,
			description1,
			description2,
			widget,
			rightActionBar,
			inlineActionBar,
			checkAll,
			inputContainer,
			filterContainer,
			inputBox,
			visibleCountContainer,
			visibleCount,
			countContainer,
			count,
			okContainer,
			ok,
			message,
			customButtonContainer,
			customButton,
			list,
			tree,
			progressBar,
			onDidAccept: this.onDidAcceptEmitter.event,
			onDidCustom: this.onDidCustomEmitter.event,
			onDidTriggerButton: this.onDidTriggerButtonEmitter.event,
			ignoreFocusOut: false,
			keyMods: this.keyMods,
			show: controller => this.show(controller),
			hide: () => this.hide(),
			setVisibilities: visibilities => this.setVisibilities(visibilities),
			setEnabled: enabled => this.setEnabled(enabled),
			setContextKey: contextKey => this.options.setContextKey(contextKey),
			linkOpenerDelegate: content => this.options.linkOpenerDelegate(content)
		};
		this.updateStyles();
		return this.ui;
	}

	private reparentUI(container: HTMLElement): void {
		if (this.ui) {
			this._container = container;
			dom.append(this._container, this.ui.container);
			this.dndController?.reparentUI(this._container);
		}
	}

	pick<T extends IQuickPickItem, O extends IPickOptions<T>>(picks: Promise<QuickPickInput<T>[]> | QuickPickInput<T>[], options: IPickOptions<T> = {}, token: CancellationToken = CancellationToken.None): Promise<(O extends { canPickMany: true } ? T[] : T) | undefined> {
		type R = (O extends { canPickMany: true } ? T[] : T) | undefined;
		return new Promise<R>((doResolve, reject) => {
			let resolve = (result: R) => {
				resolve = doResolve;
				options.onKeyMods?.(input.keyMods);
				doResolve(result);
			};
			if (token.isCancellationRequested) {
				resolve(undefined);
				return;
			}
			const input = this.createQuickPick<T>({ useSeparators: true });
			let activeItem: T | undefined;
			const disposables = [
				input,
				input.onDidAccept(() => {
					if (input.canSelectMany) {
						resolve(<R>input.selectedItems.slice());
						input.hide();
					} else {
						const result = input.activeItems[0];
						if (result) {
							resolve(<R>result);
							input.hide();
						}
					}
				}),
				input.onDidChangeActive(items => {
					const focused = items[0];
					if (focused && options.onDidFocus) {
						options.onDidFocus(focused);
					}
				}),
				input.onDidChangeSelection(items => {
					if (!input.canSelectMany) {
						const result = items[0];
						if (result) {
							resolve(<R>result);
							input.hide();
						}
					}
				}),
				input.onDidTriggerItemButton(event => options.onDidTriggerItemButton && options.onDidTriggerItemButton({
					...event,
					removeItem: () => {
						const index = input.items.indexOf(event.item);
						if (index !== -1) {
							const items = input.items.slice();
							const removed = items.splice(index, 1);
							const activeItems = input.activeItems.filter(activeItem => activeItem !== removed[0]);
							const keepScrollPositionBefore = input.keepScrollPosition;
							input.keepScrollPosition = true;
							input.items = items;
							if (activeItems) {
								input.activeItems = activeItems;
							}
							input.keepScrollPosition = keepScrollPositionBefore;
						}
					}
				})),
				input.onDidTriggerSeparatorButton(event => options.onDidTriggerSeparatorButton?.(event)),
				input.onDidChangeValue(value => {
					if (activeItem && !value && (input.activeItems.length !== 1 || input.activeItems[0] !== activeItem)) {
						input.activeItems = [activeItem];
					}
				}),
				token.onCancellationRequested(() => {
					input.hide();
				}),
				input.onDidHide(() => {
					dispose(disposables);
					resolve(undefined);
				}),
			];
			input.title = options.title;
			if (options.value) {
				input.value = options.value;
			}
			input.canSelectMany = !!options.canPickMany;
			input.placeholder = options.placeHolder;
			input.prompt = options.prompt;
			input.ignoreFocusOut = !!options.ignoreFocusLost;
			input.matchOnDescription = !!options.matchOnDescription;
			input.matchOnDetail = !!options.matchOnDetail;
			if (options.sortByLabel !== undefined) {
				input.sortByLabel = options.sortByLabel;
			}
			input.matchOnLabel = (options.matchOnLabel === undefined) || options.matchOnLabel; // default to true
			input.quickNavigate = options.quickNavigate;
			input.hideInput = !!options.hideInput;
			input.contextKey = options.contextKey;
			input.anchor = options.anchor;
			input.anchorPosition = options.anchorPosition;
			input.busy = true;
			Promise.all([picks, options.activeItem])
				.then(([items, _activeItem]) => {
					activeItem = _activeItem;
					input.busy = false;
					input.items = items;
					if (input.canSelectMany) {
						input.selectedItems = items.filter(item => item.type !== 'separator' && item.picked) as T[];
					}
					if (activeItem) {
						input.activeItems = [activeItem];
					}
				});
			input.show();
			Promise.resolve(picks).then(undefined, err => {
				reject(err);
				input.hide();
			});
		});
	}

	private setValidationOnInput(input: IInputBox, validationResult: string | {
		content: string;
		severity: Severity;
	} | null | undefined) {
		if (validationResult && isString(validationResult)) {
			input.severity = Severity.Error;
			input.validationMessage = validationResult;
		} else if (validationResult && !isString(validationResult)) {
			input.severity = validationResult.severity;
			input.validationMessage = validationResult.content;
		} else {
			input.severity = Severity.Ignore;
			input.validationMessage = undefined;
		}
	}

	input(options: IInputOptions = {}, token: CancellationToken = CancellationToken.None): Promise<string | undefined> {
		return new Promise<string | undefined>((resolve) => {
			if (token.isCancellationRequested) {
				resolve(undefined);
				return;
			}
			const input = this.createInputBox();
			const validateInput = options.validateInput || (() => Promise.resolve(undefined));
			const onDidValueChange = Event.debounce(input.onDidChangeValue, (last, cur) => cur, 100);
			let validationValue = options.value || '';
			let validation = Promise.resolve(validateInput(validationValue));
			const disposables = [
				input,
				onDidValueChange(value => {
					if (value !== validationValue) {
						validation = Promise.resolve(validateInput(value));
						validationValue = value;
					}
					validation.then(result => {
						if (value === validationValue) {
							this.setValidationOnInput(input, result);
						}
					});
				}),
				input.onDidAccept(() => {
					const value = input.value;
					if (value !== validationValue) {
						validation = Promise.resolve(validateInput(value));
						validationValue = value;
					}
					validation.then(result => {
						if (!result || (!isString(result) && result.severity !== Severity.Error)) {
							resolve(value);
							input.hide();
						} else if (value === validationValue) {
							this.setValidationOnInput(input, result);
						}
					});
				}),
				token.onCancellationRequested(() => {
					input.hide();
				}),
				input.onDidHide(() => {
					dispose(disposables);
					resolve(undefined);
				}),
			];

			input.title = options.title;
			input.value = options.value || '';
			input.valueSelection = options.valueSelection;
			input.prompt = options.prompt;
			input.placeholder = options.placeHolder;
			input.password = !!options.password;
			input.ignoreFocusOut = !!options.ignoreFocusLost;
			input.show();
		});
	}

	backButton = backButton;

	createQuickPick<T extends IQuickPickItem>(options: { useSeparators: true }): IQuickPick<T, { useSeparators: true }>;
	createQuickPick<T extends IQuickPickItem>(options?: { useSeparators: boolean }): IQuickPick<T, { useSeparators: false }>;
	createQuickPick<T extends IQuickPickItem>(options: { useSeparators: boolean } = { useSeparators: false }): IQuickPick<T, { useSeparators: boolean }> {
		const ui = this.getUI(true);
		return new QuickPick<T, typeof options>(ui);
	}

	createInputBox(): IInputBox {
		const ui = this.getUI(true);
		return new InputBox(ui);
	}

	setAlignment(alignment: 'top' | 'center' | { top: number; left: number }): void {
		if (this.controller?.anchor) {
			return; // anchored inputs own their own positioning
		}
		this.dndController?.setAlignment(alignment);
	}

	createQuickWidget(): IQuickWidget {
		const ui = this.getUI(true);
		return new QuickWidget(ui);
	}

	createQuickTree<T extends IQuickTreeItem>(): IQuickTree<T> {
		const ui = this.getUI(true);
		return new QuickTree<T>(ui);
	}

	private show(controller: IQuickInput) {
		const ui = this.getUI(true);
		const oldController = this.controller;
		this.controller = controller;
		oldController?.didHide();

		// Anchored controllers always render in the window that owns their anchor element.
		if (dom.isHTMLElement(controller.anchor)) {
			const anchorWindow = dom.getWindow(controller.anchor);
			if (dom.getWindow(this._container) !== anchorWindow) {
				this.reparentUI(this.layoutService.getContainer(anchorWindow));
			}
		}

		this.setEnabled(true);
		ui.leftActionBar.setActions([]);
		ui.title.textContent = '';
		ui.description1.textContent = '';
		ui.description2.textContent = '';
		dom.reset(ui.widget);
		ui.rightActionBar.setActions([]);
		ui.inlineActionBar.setActions([]);
		ui.checkAll.checked = false;
		// ui.inputBox.value = ''; Avoid triggering an event.
		ui.inputBox.placeholder = '';
		ui.inputBox.password = false;
		ui.inputBox.showDecoration(Severity.Ignore);
		ui.visibleCount.setCount(0);
		ui.count.setCount(0);
		ui.countContainer.style.right = '4px';
		dom.reset(ui.message);
		ui.progressBar.stop();
		ui.progressBar.getContainer().setAttribute('aria-hidden', 'true');
		ui.list.setElements([]);
		ui.list.matchOnDescription = false;
		ui.list.matchOnDetail = false;
		ui.list.matchOnLabel = true;
		ui.list.sortByLabel = true;
		ui.tree.updateFilterOptions({
			matchOnDescription: false,
			matchOnLabel: true
		});
		ui.tree.sortByLabel = true;
		ui.ignoreFocusOut = false;
		ui.inputBox.toggles = undefined;
		ui.inputBox.actions = undefined;

		const backKeybindingLabel = this.options.backKeybindingLabel();
		backButton.tooltip = backKeybindingLabel ? localize('quickInput.backWithKeybinding', "Back ({0})", backKeybindingLabel) : localize('quickInput.back', "Back");

		if (telescopePanel) {
			this.playTelescopeEntrance(ui.container);
		}
		ui.container.style.display = '';
		this.updateLayout();
		// Anchored inputs never took the drag, and the telescope panel does not take it either:
		// the same call is what puts the widget in `no-drag`, so the header stops offering a grab
		// cursor for a move that would be thrown away on the next layout.
		this.dndController?.setEnabled(!controller.anchor && !telescopePanel);
		this.dndController?.layoutContainer();
		if (controller.anchor) {
			// Anchored quick inputs are positioned near a specific element, not
			// at the default top location, so report them as custom-positioned.
			this._alignment.set('custom', undefined);
		} else {
			// Re-sync from DnD in case a previous anchored input left us stale.
			this._alignment.set(this.dndController?.alignment.get() ?? 'top', undefined);
		}
		this.onShowEmitter.fire();
		ui.inputBox.setFocus();
		this.quickInputTypeContext.set(controller.type);
	}

	/**
	 * A panel playing its dismiss is still on screen and is not visible. Everything the hide means
	 * has already happened by then - the controller is gone, `onHide` has fired, the focus is back
	 * where it came from - and only the picture is still standing, so the picture is not what this
	 * is allowed to answer from. Every caller wants the same thing of it and gets it: `focus`,
	 * `toggle`, `toggleHover` and `navigate` all keep their hands off a panel on its way out, the
	 * layout stops being rewritten under it, and the container swap in `quickInputService.ts` is
	 * free to re-lay it out. There is no such class off this platform and the read is the stock one.
	 */
	isVisible(): boolean {
		return !!this.ui && this.ui.container.style.display !== 'none' && !this.ui.container.classList.contains('is-hiding');
	}

	private setVisibilities(visibilities: Visibilities) {
		const ui = this.getUI();
		ui.title.style.display = visibilities.title ? '' : 'none';
		ui.description1.style.display = visibilities.description && (visibilities.inputBox || visibilities.checkAll) ? '' : 'none';
		ui.description2.style.display = visibilities.description && !(visibilities.inputBox || visibilities.checkAll) ? '' : 'none';
		ui.checkAll.domNode.style.display = visibilities.checkAll ? '' : 'none';
		ui.inputContainer.style.display = visibilities.inputBox ? '' : 'none';
		ui.filterContainer.style.display = visibilities.inputBox ? '' : 'none';
		ui.visibleCountContainer.style.display = visibilities.visibleCount ? '' : 'none';
		ui.countContainer.style.display = visibilities.count ? '' : 'none';
		ui.okContainer.style.display = visibilities.ok ? '' : 'none';
		ui.customButtonContainer.style.display = visibilities.customButton ? '' : 'none';
		ui.message.style.display = visibilities.message ? '' : 'none';
		ui.progressBar.getContainer().style.display = visibilities.progressBar ? '' : 'none';
		ui.list.displayed = !!visibilities.list;
		ui.tree.displayed = !!visibilities.tree;
		ui.container.classList.toggle('show-checkboxes', !!visibilities.checkBox);
		ui.container.classList.toggle('hidden-input', !visibilities.inputBox && !visibilities.description);
		this.updateLayout(); // TODO
	}

	private setEnabled(enabled: boolean) {
		if (enabled !== this.enabled) {
			this.enabled = enabled;
			const ui = this.getUI();
			for (let i = 0; i < ui.leftActionBar.getItemsLength(); i++) {
				const action = ui.leftActionBar.getItemAction(i);
				if (action) {
					action.enabled = enabled;
				}
			}
			for (let i = 0; i < ui.rightActionBar.getItemsLength(); i++) {
				const action = ui.rightActionBar.getItemAction(i);
				if (action) {
					action.enabled = enabled;
				}
			}
			if (enabled) {
				ui.checkAll.enable();
			} else {
				ui.checkAll.disable();
			}
			ui.inputBox.enabled = enabled;
			ui.ok.enabled = enabled;
			ui.list.enabled = enabled;
		}
	}

	hide(reason?: QuickInputHideReason) {
		const controller = this.controller;
		if (!controller) {
			return;
		}
		controller.willHide(reason);

		const container = this.ui?.container;
		const focusChanged = container && !dom.isAncestorOfActiveElement(container);
		this.controller = null;
		this.onHideEmitter.fire();
		if (container) {
			if (telescopePanel) {
				this.playTelescopeDismiss(container);
			} else {
				container.style.display = 'none';
			}
		}
		if (!focusChanged) {
			let currentElement = this.previousFocusElement;
			while (currentElement && !currentElement.offsetParent) {
				currentElement = currentElement.parentElement ?? undefined;
			}
			if (currentElement?.offsetParent) {
				currentElement.focus();
				this.previousFocusElement = undefined;
			} else {
				this.options.returnFocus();
			}
		}
		controller.didHide(reason);
	}

	/**
	 * The panel comes in on the entrance written in `style.css`, and the class is what plays it. A
	 * class the node is already wearing plays nothing, and that is the whole of the rule for when
	 * the entrance is played again and when it is not. A panel that went off screen - hidden
	 * outright, or still fading out of the last dismiss - gave the class up on the way out and takes
	 * it back here, so it enters. A picker handing over to another picker never gave it up, and the
	 * panel it is already standing in holds still while its contents change, which is what a surface
	 * that is already there should do. A dismiss caught in flight is called off first, and because
	 * the two classes are exchanged in the one turn the browser sees a different animation and
	 * starts it from the top.
	 */
	private playTelescopeEntrance(container: HTMLElement): void {
		this.telescopeDismissal.clear();
		container.classList.remove('is-hiding');
		container.classList.add('is-showing');
	}

	/**
	 * The dismiss is the one thing that lingers. `hide` has done all of it by the time this is
	 * called and this is handed the picture alone: the panel keeps its box for the length of the
	 * fade with nothing able to click through to it, and goes back to `display: none` at the end.
	 * `isVisible` reads the class and says no the whole way, so nothing takes the standing node for
	 * a live panel.
	 *
	 * The end of the animation is what ordinarily ends it. `dom.EventType.ANIMATION_END` is the
	 * prefixed name on anything calling itself AppleWebKit, which this build does, and Chromium
	 * fires only the plain one - so the plain one is written out. Behind it is the timeout that ends
	 * the fade when the event never comes at all, which is what hiding or reparenting the node mid
	 * fade does to it. Both are held in the one store, and a panel shown again clears it.
	 *
	 * A hide that arrives as the controller itself is being torn down gets none of this. There is
	 * nobody left to watch the fade and nothing left to hold what it needs - the store the pair
	 * would be kept in has been disposed, and anything handed to it after that is dropped on the
	 * floor - so the panel goes off screen the way it does on every other platform.
	 *
	 * The end of the fade is also where the preview pane is told to let go of what it is holding.
	 * Not the hide itself: the pane is still on screen for the length of the dismiss and emptying
	 * it there would blank the picture halfway through its own fade.
	 */
	private playTelescopeDismiss(container: HTMLElement): void {
		if (this._store.isDisposed) {
			container.style.display = 'none';
			return;
		}

		container.classList.remove('is-showing');
		container.classList.add('is-hiding');

		const dismissal = new DisposableStore();
		const settle = () => {
			container.classList.remove('is-hiding');
			container.style.display = 'none';
			this.options.previewRenderer?.hide();
			this.telescopeDismissal.clear();
		};
		dismissal.add(dom.addDisposableListener(container, 'animationend', e => {
			if (e.target === container) {
				settle();
			}
		}));
		dismissal.add(disposableTimeout(settle, QuickInputController.TELESCOPE_DISMISS + QuickInputController.TELESCOPE_DISMISS_GRACE));
		this.telescopeDismissal.value = dismissal;
	}

	focus() {
		if (this.isVisible()) {
			const ui = this.getUI();
			if (ui.inputBox.enabled) {
				ui.inputBox.setFocus();
			} else {
				ui.list.domFocus();
			}
		}
	}

	toggle() {
		if (!this.isVisible()) {
			return;
		}
		if (this.controller instanceof QuickPick && this.controller.canSelectMany) {
			this.getUI().list.toggleCheckbox();
		} else if (this.controller instanceof QuickTree) {
			this.getUI().tree.toggleCheckbox();
		}
	}

	toggleHover() {
		if (this.isVisible() && this.controller instanceof QuickPick) {
			this.getUI().list.toggleHover();
		}
	}

	navigate(next: boolean, quickNavigate?: IQuickNavigateConfiguration) {
		if (this.isVisible() && this.getUI().list.displayed) {
			this.getUI().list.focus(next ? QuickPickFocus.Next : QuickPickFocus.Previous);
			if (quickNavigate && this.controller instanceof QuickPick) {
				this.controller.quickNavigate = quickNavigate;
			}
		}
	}

	async accept(keyMods: IKeyMods = { alt: false, ctrlCmd: false, shift: false }) {
		// When accepting the item programmatically, it is important that
		// we update `keyMods` either from the provided set or unset it
		// because the accept did not happen from mouse or keyboard
		// interaction on the list itself
		this.keyMods.alt = keyMods.alt;
		this.keyMods.ctrlCmd = keyMods.ctrlCmd;
		this.keyMods.shift = keyMods.shift;

		this.onDidAcceptEmitter.fire();
	}

	async back() {
		this.onDidTriggerButtonEmitter.fire(this.backButton);
	}

	async cancel(reason?: QuickInputHideReason) {
		this.hide(reason);
	}

	layout(dimension: dom.IDimension, titleBarOffset: number): void {
		this.dimension = dimension;
		this.titleBarOffset = titleBarOffset;
		this.updateLayout();
	}

	private updateLayout() {
		if (this.ui && this.isVisible()) {
			const style = this.ui.container.style;
			// The golden cut has no say in the telescope panel's width: it is a measured figure,
			// and the cut would hold the panel to 794px in the very window the measurement was
			// taken in. A window too narrow for it gives the panel everything but a 16px margin
			// down each side instead.
			let width = telescopePanel
				? Math.min(QuickInputController.TELESCOPE_WIDTH, this.dimension!.width - 32)
				: Math.min(this.dimension!.width * 0.62 /* golden cut */, QuickInputController.MAX_WIDTH);
			style.width = width + 'px';

			let listHeight = this.dimension && this.dimension.height * 0.4;

			// Position
			if (this.controller?.anchor) {
				const target = this.controller.anchor as HTMLElement | IAnchor;
				const isElement = dom.isHTMLElement(target);
				const anchorWindow = isElement ? dom.getWindow(target) : dom.getActiveWindow();
				const container = this.layoutService.getContainer(anchorWindow).getBoundingClientRect();
				const verticalPadding = 6 + 26 + 16; // Accounts for input box and padding

				let anchor = getAnchorRect(target);
				let preferredAnchorPosition = AnchorPosition.ABOVE;
				let listHeightRatio = 0.2;
				let maxListHeight = 200;

				if (this.controller.anchorPosition === 'overlay') {
					width = anchor.width + 12;
					listHeightRatio = 0.4;
					anchor = {
						top: anchor.top - 7,
						left: anchor.left - 7,
						width: anchor.width,
						height: 0
					};
					maxListHeight = Math.min(400, container.bottom - anchor.top - verticalPadding);
					preferredAnchorPosition = AnchorPosition.BELOW;
				} else {
					width = 380;
				}

				listHeight = this.dimension ? Math.min(this.dimension.height * listHeightRatio, maxListHeight) : maxListHeight;

				// Beware:
				// We need to add some extra pixels to the height to account for the input and padding.
				const containerHeight = Math.floor(listHeight) + verticalPadding;
				const { top, left, right, bottom, anchorAlignment, anchorPosition } = layout2d(container, { width, height: containerHeight }, anchor, { anchorPosition: preferredAnchorPosition });

				if (anchorAlignment === AnchorAlignment.RIGHT) {
					style.right = `${right}px`;
					style.left = 'initial';
				} else {
					style.left = `${left}px`;
					style.right = 'initial';
				}

				if (anchorPosition === AnchorPosition.ABOVE) {
					style.bottom = `${bottom}px`;
					style.top = 'initial';
				} else {
					style.top = `${top}px`;
					style.bottom = 'initial';
				}

				style.width = `${width}px`;
				style.height = '';
			} else if (telescopePanel) {
				// The results column is a constant and `style.css` is where it is written down, so
				// while the window has the room for the whole panel this says nothing at all and
				// lets the cap there stand - an inline max-height would beat any selector. It speaks
				// for a window too short to hold the panel, and then it hands the list what is left
				// of a window keeping a 16px margin top and bottom, the same margin the width above
				// keeps down the sides. One row is the floor: below that there is nothing to show.
				const panelHeight = Math.min(QuickInputController.TELESCOPE_HEIGHT, this.dimension!.height - 32);
				listHeight = panelHeight < QuickInputController.TELESCOPE_HEIGHT
					? Math.max(QuickInputController.TELESCOPE_ROW_HEIGHT, panelHeight - QuickInputController.TELESCOPE_LIST_CHROME)
					: undefined;

				// Held by its bottom edge, so the prompt keeps the same line however tall the list
				// standing over it happens to be. The share is worked out against the full panel and
				// not against the panel as it stands, so a two result list and a twenty result list
				// are both read off the same line.
				const freeHeight = this.dimension!.height - QuickInputController.TELESCOPE_HEIGHT;
				style.bottom = `${Math.max(0, Math.round(freeHeight * QuickInputController.TELESCOPE_BOTTOM_SHARE))}px`;
				style.top = 'initial';
				style.left = `${Math.round((this.dimension!.width * 0.5 /* center */) - (width / 2))}px`;
				style.right = '';
				style.height = '';
			} else {
				style.top = `${this.viewState?.top !== undefined ? Math.round(this.dimension!.height * this.viewState.top) : this.titleBarOffset}px`;
				style.left = `${Math.round((this.dimension!.width * (this.viewState?.left ?? 0.5 /* center */)) - (width / 2))}px`;
				style.right = '';
				style.bottom = '';
				style.height = '';
			}

			this.ui.inputBox.layout();
			this.ui.list.layout(listHeight);
			this.ui.tree.layout(listHeight);
			// The pane's cell is measured by the grid and not by anything worked out here: the
			// panel's width is divided inside it, and how tall the cell is the results column
			// beside it decides. All it is told is that the moment to measure has come.
			if (this.ui.container.classList.contains('has-preview')) {
				this.options.previewRenderer?.layout();
			}
		}
	}

	applyStyles(styles: IQuickInputStyles) {
		this.styles = styles;
		this.updateStyles();
	}

	private updateStyles() {
		if (this.ui) {
			const {
				quickInputTitleBackground, quickInputBackground, quickInputForeground, widgetBorder,
			} = this.styles.widget;
			this.ui.titleBar.style.backgroundColor = quickInputTitleBackground ?? '';
			this.ui.container.style.backgroundColor = quickInputBackground ?? '';
			this.ui.container.style.color = quickInputForeground ?? '';
			this.ui.container.style.border = widgetBorder ? `1px solid ${widgetBorder}` : '';
			this.ui.list.style(this.styles.list);
			this.ui.tree.tree.style(this.styles.list);

			const content: string[] = [];
			if (this.styles.pickerGroup.pickerGroupBorder) {
				content.push(`.quick-input-list .quick-input-list-entry { border-top-color:  ${this.styles.pickerGroup.pickerGroupBorder}; }`);
			}
			if (this.styles.pickerGroup.pickerGroupForeground) {
				content.push(`.quick-input-list .quick-input-list-separator { color:  ${this.styles.pickerGroup.pickerGroupForeground}; }`);
			}
			if (this.styles.pickerGroup.pickerGroupForeground) {
				content.push(`.quick-input-list .quick-input-list-separator-as-item { color: var(--vscode-descriptionForeground); }`);
			}

			if (this.styles.keybindingLabel.keybindingLabelBackground ||
				this.styles.keybindingLabel.keybindingLabelBorder ||
				this.styles.keybindingLabel.keybindingLabelBottomBorder ||
				this.styles.keybindingLabel.keybindingLabelShadow ||
				this.styles.keybindingLabel.keybindingLabelForeground) {
				content.push('.quick-input-list .monaco-keybinding > .monaco-keybinding-key {');
				if (this.styles.keybindingLabel.keybindingLabelBackground) {
					content.push(`background-color: ${this.styles.keybindingLabel.keybindingLabelBackground};`);
				}
				if (this.styles.keybindingLabel.keybindingLabelBorder) {
					// Order matters here. `border-color` must come before `border-bottom-color`.
					content.push(`border-color: ${this.styles.keybindingLabel.keybindingLabelBorder};`);
				}
				if (this.styles.keybindingLabel.keybindingLabelBottomBorder) {
					content.push(`border-bottom-color: ${this.styles.keybindingLabel.keybindingLabelBottomBorder};`);
				}
				if (this.styles.keybindingLabel.keybindingLabelShadow) {
					content.push(`box-shadow: inset 0 -1px 0 ${this.styles.keybindingLabel.keybindingLabelShadow};`);
				}
				if (this.styles.keybindingLabel.keybindingLabelForeground) {
					content.push(`color: ${this.styles.keybindingLabel.keybindingLabelForeground};`);
				}
				content.push('}');
			}

			const newStyles = content.join('\n');
			if (newStyles !== this.ui.styleSheet.textContent) {
				this.ui.styleSheet.textContent = newStyles;
			}
		}
	}

	private loadViewState(): QuickInputViewState | undefined {
		if (telescopePanel) {
			return undefined; // the baked position is the only one
		}

		try {
			const data = JSON.parse(this.storageService.get(VIEWSTATE_STORAGE_KEY, StorageScope.APPLICATION, '{}'));
			if (data.top !== undefined || data.left !== undefined) {
				return data;
			}
		} catch { }

		return undefined;
	}

	private saveViewState(viewState: QuickInputViewState | undefined): void {
		if (telescopePanel) {
			return; // nothing to remember, and nothing to clear out of storage either
		}

		const isMainWindow = this.layoutService.activeContainer === this.layoutService.mainContainer;
		if (!isMainWindow) {
			return;
		}

		if (viewState !== undefined) {
			this.storageService.store(VIEWSTATE_STORAGE_KEY, JSON.stringify(viewState), StorageScope.APPLICATION, StorageTarget.MACHINE);
		} else {
			this.storageService.remove(VIEWSTATE_STORAGE_KEY, StorageScope.APPLICATION);
		}
	}
}

export interface IQuickInputControllerHost extends ILayoutService { }

class QuickInputDragAndDropController extends Disposable {
	readonly dndViewState = observableValue<{ top?: number; left?: number; done: boolean } | undefined>(this, undefined);

	private _enabled = true;

	private readonly _snapThreshold = 20;
	private readonly _snapLineHorizontalRatio = 0.25;

	private readonly _controlsOnLeft: boolean;
	private readonly _controlsOnRight: boolean;

	private readonly _quickInputAlignmentContext: IContextKey<'center' | 'top' | undefined>;
	private readonly _alignment = observableValue<QuickInputAlignment>(this, 'top');
	readonly alignment: IObservable<QuickInputAlignment> = this._alignment;

	constructor(
		private _container: HTMLElement,
		private readonly _quickInputContainer: HTMLElement,
		private _quickInputDragAreas: { node: HTMLElement; includeChildren: boolean; excludeNodes?: HTMLElement[] }[],
		initialViewState: QuickInputViewState | undefined,
		@ILayoutService private readonly _layoutService: ILayoutService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();
		this._quickInputAlignmentContext = QuickInputAlignmentContextKey.bindTo(contextKeyService);
		const customWindowControls = getWindowControlsStyle(this.configurationService) === WindowControlsStyle.CUSTOM;

		// Do not allow the widget to overflow or underflow window controls.
		// Use CSS calculations to avoid having to force layout with `.clientWidth`
		this._controlsOnLeft = customWindowControls && platform === Platform.Mac;
		this._controlsOnRight = customWindowControls && (platform === Platform.Windows || platform === Platform.Linux);
		this._registerLayoutListener();
		this.registerMouseListeners();
		this.dndViewState.set({ ...initialViewState, done: true }, undefined);
		// Initialize alignment from restored state. The exact snap alignment will
		// be refined in layoutContainer() once pixel dimensions are available.
		if (initialViewState?.top !== undefined && initialViewState?.left !== undefined) {
			this._setAlignmentState(undefined);
		}
	}

	reparentUI(container: HTMLElement): void {
		this._container = container;
	}

	layoutContainer(dimension = this._layoutService.activeContainerDimension): void {
		if (!this._enabled) {
			return;
		}

		const state = this.dndViewState.get();
		const dragAreaRect = this._quickInputContainer.getBoundingClientRect();
		if (state?.top !== undefined && state?.left !== undefined) {
			const a = Math.round(state.left * 1e2) / 1e2;
			const b = dimension.width;
			const c = dragAreaRect.width;
			const d = a * b - c / 2;
			this._layout(state.top * dimension.height, d);
		}
	}

	setEnabled(enabled: boolean): void {
		this._enabled = enabled;
		this._quickInputContainer.classList.toggle('no-drag', !enabled);
	}

	private _setAlignmentState(value: 'top' | 'center' | undefined): void {
		this._quickInputAlignmentContext.set(value);
		this._alignment.set(value ?? 'custom', undefined);
	}

	setAlignment(alignment: 'top' | 'center' | { top: number; left: number }, done = true): void {
		if (alignment === 'top') {
			this.dndViewState.set({
				top: this._getTopSnapValue() / this._container.clientHeight,
				left: (this._getCenterXSnapValue() + (this._quickInputContainer.clientWidth / 2)) / this._container.clientWidth,
				done
			}, undefined);
			this._setAlignmentState('top');
		} else if (alignment === 'center') {
			this.dndViewState.set({
				top: this._getCenterYSnapValue() / this._container.clientHeight,
				left: (this._getCenterXSnapValue() + (this._quickInputContainer.clientWidth / 2)) / this._container.clientWidth,
				done
			}, undefined);
			this._setAlignmentState('center');
		} else {
			this.dndViewState.set({ top: alignment.top, left: alignment.left, done }, undefined);
			this._setAlignmentState(undefined);
		}
	}

	private _registerLayoutListener() {
		this._register(Event.filter(this._layoutService.onDidLayoutContainer, e => e.container === this._container)((e) => this.layoutContainer(e.dimension)));
	}

	private registerMouseListeners(): void {
		const dragArea = this._quickInputContainer;

		// Double click
		this._register(dom.addDisposableGenericMouseUpListener(dragArea, (event: MouseEvent) => {
			if (!this._enabled) {
				return;
			}

			const originEvent = new StandardMouseEvent(dom.getWindow(dragArea), event);
			if (originEvent.detail !== 2) {
				return;
			}

			// Ignore event if the target is not the drag area
			const area = this._quickInputDragAreas.find(({ node, includeChildren }) => includeChildren ? dom.isAncestor(originEvent.target, node) : originEvent.target === node);
			if (!area || area.excludeNodes?.some(node => dom.isAncestor(originEvent.target, node))) {
				return;
			}

			this.dndViewState.set({ top: undefined, left: undefined, done: true }, undefined);
			this._setAlignmentState('top');
		}));

		// Mouse down
		this._register(dom.addDisposableGenericMouseDownListener(dragArea, (e: MouseEvent) => {
			if (!this._enabled) {
				return;
			}

			const activeWindow = dom.getWindow(this._layoutService.activeContainer);
			const originEvent = new StandardMouseEvent(activeWindow, e);

			// Ignore event if the target is not the drag area
			const area = this._quickInputDragAreas.find(({ node, includeChildren }) => includeChildren ? dom.isAncestor(originEvent.target, node) : originEvent.target === node);
			if (!area || area.excludeNodes?.some(node => dom.isAncestor(originEvent.target, node))) {
				return;
			}

			// Mouse position offset relative to dragArea
			const dragAreaRect = this._quickInputContainer.getBoundingClientRect();
			const dragOffsetX = originEvent.browserEvent.clientX - dragAreaRect.left;
			const dragOffsetY = originEvent.browserEvent.clientY - dragAreaRect.top;

			let isMovingQuickInput = false;
			const mouseMoveListener = dom.addDisposableGenericMouseMoveListener(activeWindow, (e: MouseEvent) => {
				const mouseMoveEvent = new StandardMouseEvent(activeWindow, e);
				mouseMoveEvent.preventDefault();

				if (!isMovingQuickInput) {
					isMovingQuickInput = true;
				}

				this._layout(e.clientY - dragOffsetY, e.clientX - dragOffsetX);
			});
			const mouseUpListener = dom.addDisposableGenericMouseUpListener(activeWindow, (e: MouseEvent) => {
				if (isMovingQuickInput) {
					// Save position
					const state = this.dndViewState.get();
					this.dndViewState.set({ top: state?.top, left: state?.left, done: true }, undefined);
				}

				// Dispose listeners
				mouseMoveListener.dispose();
				mouseUpListener.dispose();
			});
		}));
	}

	private _layout(topCoordinate: number, leftCoordinate: number) {
		const snapCoordinateYTop = this._getTopSnapValue();
		const snapCoordinateY = this._getCenterYSnapValue();
		const snapCoordinateX = this._getCenterXSnapValue();
		// Make sure the quick input is not moved outside the container
		topCoordinate = Math.max(0, Math.min(topCoordinate, this._container.clientHeight - this._quickInputContainer.clientHeight));

		if (topCoordinate < this._layoutService.activeContainerOffset.top) {
			if (this._controlsOnLeft) {
				leftCoordinate = Math.max(leftCoordinate, 80 / getZoomFactor(dom.getActiveWindow()));
			} else if (this._controlsOnRight) {
				leftCoordinate = Math.min(leftCoordinate, this._container.clientWidth - this._quickInputContainer.clientWidth - (140 / getZoomFactor(dom.getActiveWindow())));
			}
		}

		const snappingToTop = Math.abs(topCoordinate - snapCoordinateYTop) < this._snapThreshold;
		topCoordinate = snappingToTop ? snapCoordinateYTop : topCoordinate;
		const snappingToCenter = Math.abs(topCoordinate - snapCoordinateY) < this._snapThreshold;
		topCoordinate = snappingToCenter ? snapCoordinateY : topCoordinate;
		const top = topCoordinate / this._container.clientHeight;

		// Make sure the quick input is not moved outside the container
		leftCoordinate = Math.max(0, Math.min(leftCoordinate, this._container.clientWidth - this._quickInputContainer.clientWidth));
		const snappingToCenterX = Math.abs(leftCoordinate - snapCoordinateX) < this._snapThreshold;
		leftCoordinate = snappingToCenterX ? snapCoordinateX : leftCoordinate;

		const b = this._container.clientWidth;
		const c = this._quickInputContainer.clientWidth;
		const d = leftCoordinate;
		const left = (d + c / 2) / b;

		this.dndViewState.set({ top, left, done: false }, undefined);
		if (snappingToCenterX) {
			if (snappingToTop) {
				this._setAlignmentState('top');
				return;
			} else if (snappingToCenter) {
				this._setAlignmentState('center');
				return;
			}
		}
		this._setAlignmentState(undefined);
	}

	private _getTopSnapValue() {
		return this._layoutService.activeContainerOffset.quickPickTop;
	}

	private _getCenterYSnapValue() {
		return Math.round(this._container.clientHeight * this._snapLineHorizontalRatio);
	}

	private _getCenterXSnapValue() {
		return Math.round(this._container.clientWidth / 2) - Math.round(this._quickInputContainer.clientWidth / 2);
	}
}
