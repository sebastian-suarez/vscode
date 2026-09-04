/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { disposableTimeout } from '../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore, MutableDisposable, IReference, toDisposable } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { CodeEditorWidget } from '../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { IEditorConstructionOptions } from '../../../../editor/browser/config/editorConfiguration.js';
import { IEditorOptions } from '../../../../editor/common/config/editorOptions.js';
import { IRange, Range } from '../../../../editor/common/core/range.js';
import { ScrollType } from '../../../../editor/common/editorCommon.js';
import { ITextResourceConfigurationService } from '../../../../editor/common/services/textResourceConfiguration.js';
import { IResolvedTextEditorModel, ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { IQuickInputPreview } from '../../../../platform/quickinput/browser/quickInput.js';
import { IQuickPickItem, IQuickPickItemWithResource, QuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';

const $ = dom.$;

/**
 * What the editor inside the pane is allowed to be. A preview is read and nothing else: it is not
 * clicked into, not scrolled by hand, not typed in, and the pane it sits in takes no pointer at
 * all, so everything an editor offers a pair of hands with is turned off and everything it draws a
 * file with is left alone. The metrics are not written down here - no font size, no line height -
 * because the file should read in the preview exactly as it reads in the editor, and those come
 * from the settings on the way in (`fontOptions`).
 *
 * `lineNumbers` is the one option here that is a ruling rather than a tidy-up. This build counts
 * the gutter in lines from the cursor by default (M12), which is a gutter for a file you are
 * moving around in; a preview is a file you are looking at, and it was ruled in D19 that previews
 * keep the absolute number. This is where that ruling lands, and it has to be said out loud
 * because the default underneath it says the opposite.
 *
 * The gutter is the mockup's 40px as closely as an editor's own arithmetic allows: it is
 * `lineNumbersMinChars` digits wide plus the 12px of `lineDecorationsWidth` between the number and
 * the code, and the digits are measured, not given. Three digits of the mac editor face comes out
 * near 26, so a file under a thousand lines stands at about 38 and a longer one grows a digit at a
 * time, which is what every other gutter in the product does.
 */
const previewEditorOptions: IEditorConstructionOptions = {
	readOnly: true,
	domReadOnly: true,
	tabIndex: -1,
	automaticLayout: true,
	lineNumbers: 'on',
	lineNumbersMinChars: 3,
	lineDecorationsWidth: 12,
	glyphMargin: false,
	folding: false,
	minimap: { enabled: false },
	stickyScroll: { enabled: false },
	scrollBeyondLastLine: false,
	renderLineHighlight: 'none',
	occurrencesHighlight: 'off',
	selectionHighlight: false,
	overviewRulerLanes: 0,
	overviewRulerBorder: false,
	hideCursorInOverviewRuler: true,
	scrollbar: {
		vertical: 'auto',
		horizontal: 'hidden',
		verticalScrollbarSize: 6,
		useShadows: false
	}
};

/**
 * The telescope panel's preview pane (M16). The panel asks it whether a picker's items are files -
 * that is what splits the panel - and then hands it whichever item the list is standing on; this
 * draws that item's file in a real editor beside the results.
 *
 * It is a picture and only a picture. The pane takes no pointer, nothing in it can be tabbed to,
 * and it is hidden from a screen reader, which reads the row in the list instead: the preview says
 * nothing the focused item has not already said. Interaction - scrolling the preview, opening at
 * the line it is showing - is a later question and none of it is here.
 */
export class QuickInputPreview extends Disposable implements IQuickInputPreview {

	/**
	 * How long a focused item has to stand still before its file is fetched. Holding an arrow key
	 * down walks the list faster than a file can be resolved, and every step of the walk would
	 * otherwise start a fetch that the next step throws away.
	 */
	private static readonly SETTLE = 100;

	private title: HTMLElement | undefined;
	private body: HTMLElement | undefined;

	/** The one editor, built the first time there is a file to put in it. */
	private readonly editor = this._register(new MutableDisposable<CodeEditorWidget>());
	private editorWindowId: number | undefined;

	/** The one model reference, released the moment the next one takes its place. */
	private readonly model = this._register(new MutableDisposable<IReference<IResolvedTextEditorModel>>());

	/** The settle timer and the token that calls off the fetch it started. */
	private readonly pending = this._register(new MutableDisposable<DisposableStore>());

	private shown: URI | undefined;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@ITextResourceConfigurationService private readonly textResourceConfigurationService: ITextResourceConfigurationService,
		@ILabelService private readonly labelService: ILabelService
	) {
		super();
	}

	attach(slot: HTMLElement): void {
		// Hidden from a screen reader on purpose: the pane repeats the row the list is standing on
		// and nothing in it can be reached, so there is nothing here to walk into.
		slot.setAttribute('aria-hidden', 'true');
		this.title = dom.append(slot, $('.quick-input-preview-title'));
		this.body = dom.append(slot, $('.quick-input-preview-body'));
	}

	setItems(items: readonly QuickPickItem[]): boolean {
		const split = items.some(item => !!this.resourceOf(item));
		if (!split) {
			// The panel folds back to one column, so whatever the pane was holding it is not
			// holding it for anything: the file is let go here rather than waiting for a focus
			// that may never come, since a picker offering no files has nothing to focus.
			this.pending.clear();
			this.clear();
		}

		return split;
	}

	setFocus(item: IQuickPickItem | undefined): void {
		const resource = item ? this.resourceOf(item) : undefined;
		this.pending.clear();

		if (!resource) {
			this.clear();
			return;
		}

		const range = item ? this.rangeOf(item) : undefined;
		if (this.shown && this.shown.toString() === resource.toString()) {
			this.reveal(range); // the same file: at most the place in it has moved
			return;
		}

		const store = new DisposableStore();
		const source = new CancellationTokenSource();
		store.add(toDisposable(() => source.dispose(true)));
		store.add(disposableTimeout(() => this.resolve(resource, range, source.token), QuickInputPreview.SETTLE));
		this.pending.value = store;
	}

	layout(): void {
		const editor = this.editor.value;
		if (editor && this.body) {
			editor.layout({ width: this.body.clientWidth, height: this.body.clientHeight });
		}
	}

	hide(): void {
		this.pending.clear();
		this.clear();
	}

	/**
	 * The item's file, if it has one this build can draw. `resource` is the property the pickers
	 * that deal in files all carry - the file picker's own items are typed for it - and the text
	 * model service is asked whether it could make a model of it at all, which is what keeps the
	 * pane out of schemes nothing can read. A separator has no resource and neither has a command,
	 * so the palette and the go-to-line pickers answer no here and never split the panel.
	 */
	private resourceOf(item: QuickPickItem): URI | undefined {
		const resource = (item as IQuickPickItemWithResource).resource;

		return URI.isUri(resource) && this.textModelService.canHandleResource(resource) ? resource : undefined;
	}

	/**
	 * Where in the file to stand, for the items that say. A symbol pick carries the place it was
	 * found at, and there is nothing to be gained from showing the head of a file when the item is
	 * about line four hundred of it. Read off the item rather than typed for, since the shape
	 * belongs to a picker two layers away.
	 */
	private rangeOf(item: IQuickPickItem): IRange | undefined {
		const range = (item as { range?: { selection?: IRange } | IRange }).range;
		if (!range) {
			return undefined;
		}

		const selection = (range as { selection?: IRange }).selection;

		return Range.isIRange(selection) ? selection : Range.isIRange(range) ? range : undefined;
	}

	private async resolve(resource: URI, range: IRange | undefined, token: CancellationToken): Promise<void> {
		let reference: IReference<IResolvedTextEditorModel>;
		try {
			reference = await this.textModelService.createModelReference(resource);
		} catch (error) {
			// Gone, binary, too large to hold: all of them mean the same thing here, which is that
			// there is nothing to show. The pane stays where it is and stands empty.
			if (!token.isCancellationRequested) {
				this.clear();
			}
			return;
		}

		if (token.isCancellationRequested) {
			reference.dispose();
			return;
		}

		const model = reference.object.textEditorModel;
		if (!model) {
			reference.dispose();
			this.clear();
			return;
		}

		const editor = this.getEditor();
		this.model.value = reference; // releases the file that was standing here
		this.shown = resource;
		this.renderPath(resource);
		editor.updateOptions(this.fontOptions(resource));
		editor.setModel(model);
		this.reveal(range);
	}

	private reveal(range: IRange | undefined): void {
		const editor = this.editor.value;
		if (!editor || !editor.hasModel()) {
			return;
		}

		if (range) {
			editor.revealRangeInCenter(range, ScrollType.Immediate);
		} else {
			editor.setScrollTop(0);
		}
	}

	/**
	 * The file's place in the workspace, drawn as crumbs. One line, and when there is not room for
	 * all of it the folders give their width up before the file name does: the name is the half of
	 * the path that says which of the results is being shown.
	 */
	private renderPath(resource: URI): void {
		const title = this.title;
		if (!title) {
			return;
		}

		dom.clearNode(title);
		const segments = this.labelService.getUriLabel(resource, { relative: true }).split(/[\\/]/).filter(segment => !!segment);
		for (let i = 0; i < segments.length; i++) {
			if (i > 0) {
				dom.append(title, $(`span.quick-input-preview-crumb-separator${ThemeIcon.asCSSSelector(Codicon.chevronRight)}`));
			}
			dom.append(title, $('span.quick-input-preview-crumb', undefined, segments[i]));
		}
	}

	/**
	 * The face the file is read in. An editor built by hand takes the product's own defaults and
	 * not the settings, which would leave the preview drawn in a different size and rhythm than
	 * the editor the same file opens in; these are the settings for this very file, language
	 * overrides and all, and they are the whole of what is carried across.
	 */
	private fontOptions(resource: URI): IEditorOptions {
		const configured = this.textResourceConfigurationService.getValue<IEditorOptions | undefined>(resource, 'editor');

		return {
			fontFamily: configured?.fontFamily,
			fontSize: configured?.fontSize,
			fontWeight: configured?.fontWeight,
			fontLigatures: configured?.fontLigatures,
			lineHeight: configured?.lineHeight,
			letterSpacing: configured?.letterSpacing
		};
	}

	/**
	 * The editor, built on the first file there is to show and kept afterwards. It is built again
	 * if the panel has moved to another window in the meantime: an editor measures itself against
	 * the window it was made in, and the panel does travel - it is reparented when the window that
	 * holds it goes away.
	 */
	private getEditor(): CodeEditorWidget {
		const body = this.body!;
		const windowId = dom.getWindow(body).vscodeWindowId;
		if (this.editor.value && this.editorWindowId !== windowId) {
			this.clear();
			this.editor.clear();
		}

		if (!this.editor.value) {
			this.editor.value = this.instantiationService.createInstance(
				CodeEditorWidget,
				body,
				previewEditorOptions,
				{ isSimpleWidget: true, contributions: [] }
			);
			this.editorWindowId = windowId;
		}

		return this.editor.value;
	}

	private clear(): void {
		this.shown = undefined;
		this.editor.value?.setModel(null);
		this.model.clear();
		if (this.title) {
			dom.clearNode(this.title);
		}
	}
}
