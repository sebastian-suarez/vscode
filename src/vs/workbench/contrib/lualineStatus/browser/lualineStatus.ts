/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { ICodeEditor, getCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { localize } from '../../../../nls.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IMarkerService, MarkerStatistics } from '../../../../platform/markers/common/markers.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { IQuickDiffModelService, QuickDiffModel } from '../../scm/browser/quickDiffModel.js';
import { ChangeType, IQuickDiffService, getChangeType } from '../../scm/common/quickDiff.js';

/**
 * The two segments this fork adds to the left group, in the order the bar reads them: they
 * follow the source control entry that carries the branch name (`status.scm.0`, priority
 * 10000), the changes first and the problems after. Both are styled in `statusbarpart.css`.
 */
const DIFF_ENTRY_ID = 'status.vsebcode.diff';
const DIFF_PRIORITY = 9999;

const PROBLEMS_ENTRY_ID = 'status.vsebcode.problems';
const PROBLEMS_PRIORITY = 9998;

/**
 * The readout this fork adds to the right group, between the stock selection readout (100.5)
 * and the stock encoding readout (100.3). The indentation slot at 100.4 is dropped below, but
 * the number stays clear of it anyway.
 */
const SCROLL_ENTRY_ID = 'status.vsebcode.scroll';
const SCROLL_PRIORITY = 100.45;

/** U+2212, the typographic minus the removed count is set in - not a hyphen. */
const MINUS_SIGN = '\u2212';

/**
 * The two segments below paint their own multi-coloured DOM through `IStatusbarEntry.content`
 * and leave the stock label blank - blank, not empty: a label with no text at all is taken out
 * of the layout and marked `aria-hidden`, and that label is what carries the segment's hitbox,
 * hover feedback, focus outline and screen reader name. A blank keeps all of it alive, and
 * `statusbarpart.css` stretches the label across the segment behind the painted content.
 */
const BLANK_LABEL = ' ';

/**
 * Status bar entries the fork's composition drops, in the seed generations that added them.
 * They stay registered - so the status bar's context menu can bring any of them back - they
 * just start out hidden.
 *
 * The generations are the upgrade contract. Every profile remembers the generation it was
 * seeded at, and a boot hides only the ids from generations newer than that, so an answer the
 * owner has already given stands: a readout brought back through the context menu is never
 * dropped a second time, and one that was never offered still gets its one offer. A virgin
 * profile takes every generation in a single pass. To drop something else later, add a
 * generation with the new ids and nothing else - never extend an old one, because the profiles
 * that already passed it will not look at it again.
 *
 * Generation 1: `status.problems` is the stock markers readout, replaced by the two-tier
 * problems segment below; the rest are readouts this bar has no room for - the remote
 * indicator, the source control sync counter, the indentation picker, the notification bell
 * and the language status braces.
 *
 * Generation 2: the node auto attach chip and the cursor-on-problem text. The latter is still
 * switched on in the fork's baked defaults (`problems.showCurrentInStatus`) - it is dropped
 * from the bar the same way as everything else here, so it comes back with a right click.
 *
 * Everything the stock bar only shows in a scenario (debug session, tasks, ports, zoom, screen
 * reader, git blame, ...) is left alone and appears exactly as it does in stock.
 */
const DROPPED_ENTRY_GENERATIONS: readonly { readonly generation: number; readonly ids: readonly string[] }[] = [
	{
		generation: 1,
		ids: [
			'status.host',
			'status.scm.1',
			'status.editor.indentation',
			'status.notifications',
			'status.languageStatus',
			'status.problems'
		]
	},
	{
		generation: 2,
		ids: [
			'vscode.debug-auto-launch.status.debug.autoAttach',
			'statusbar.currentProblem'
		]
	}
];

/** The newest generation, and so the value a seeded profile stores. */
const DROP_SEED_GENERATION = DROPPED_ENTRY_GENERATIONS[DROPPED_ENTRY_GENERATIONS.length - 1].generation;

/**
 * Composes the fork's status bar: it carries each profile up to the current generation of the
 * drop set and owns the three entries the bar adds of its own. Everything else in the bar is
 * stock, restyled from CSS.
 */
export class LualineStatus extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.lualineStatus';

	/**
	 * Holds the generation of the drop set a profile has been seeded through. It sits in the
	 * same storage scope the status bar keeps its hidden entries in
	 * (`workbench.statusbar.hidden`, `StorageScope.PROFILE`), so the two travel together: the
	 * seed can never run against a hidden set it did not write.
	 *
	 * The first shape of this key was a plain boolean, written before there were generations,
	 * and it means the same thing generation 1 does.
	 */
	private static readonly SEED_STORAGE_KEY = 'workbench.statusbar.vsebcode.dropSeed';

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super();

		this.seedDroppedEntries();

		this._register(instantiationService.createInstance(DiffStatusEntry));
		this._register(instantiationService.createInstance(ProblemsStatusEntry));
		this._register(instantiationService.createInstance(ScrollStatusEntry));
	}

	private seedDroppedEntries(): void {
		const seededGeneration = this.readSeededGeneration();
		if (seededGeneration >= DROP_SEED_GENERATION) {
			return;
		}

		for (const { generation, ids } of DROPPED_ENTRY_GENERATIONS) {
			if (generation <= seededGeneration) {
				continue; // already offered to this profile, and its answer stands
			}

			for (const id of ids) {
				this.statusbarService.updateEntryVisibility(id, false);
			}
		}

		this.storageService.store(LualineStatus.SEED_STORAGE_KEY, DROP_SEED_GENERATION, StorageScope.PROFILE, StorageTarget.USER);
	}

	private readSeededGeneration(): number {
		const marker = this.storageService.get(LualineStatus.SEED_STORAGE_KEY, StorageScope.PROFILE);
		if (!marker) {
			return 0; // never seeded
		}

		const generation = parseInt(marker, 10);

		return isNaN(generation) ? 1 : generation; // the boolean the first shape wrote
	}
}

/**
 * `+n ~n -n`: the lines the active file has added, changed and removed against its source
 * control original, counted off the very same quick diff model the editor's gutter draws from
 * so the two can never disagree. Tiers that count zero are left out and the segment goes away
 * entirely on a file with no changes.
 */
class DiffStatusEntry extends Disposable {

	private readonly entry = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
	private readonly activeEditorListeners = this._register(new MutableDisposable<DisposableStore>());

	private readonly content = $('span.vsebcode-status-segment');

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IQuickDiffModelService private readonly quickDiffModelService: IQuickDiffModelService,
		@IQuickDiffService private readonly quickDiffService: IQuickDiffService
	) {
		super();

		this._register(this.editorService.onDidActiveEditorChange(() => this.trackActiveEditor()));
		this._register(this.quickDiffService.onDidChangeQuickDiffProviders(() => this.trackActiveEditor()));

		this.trackActiveEditor();
	}

	private trackActiveEditor(): void {
		const listeners = new DisposableStore();
		this.activeEditorListeners.value = listeners;

		const resource = getCodeEditor(this.editorService.activeTextEditorControl)?.getModel()?.uri;
		if (!resource) {
			this.render(undefined);
			return;
		}

		const modelReference = this.quickDiffModelService.createQuickDiffModelReference(resource);
		if (!modelReference) {
			this.render(undefined); // the file has no resolved text model (yet)
			return;
		}

		listeners.add(modelReference);
		listeners.add(Event.runAndSubscribe(modelReference.object.onDidChange, () => this.render(modelReference.object)));
	}

	/**
	 * Line counts per change type, filtered exactly the way `QuickDiffDecorator` filters the
	 * changes it turns into gutter decorations: quick diffs the owner has switched off do not
	 * count, and a secondary quick diff does not count where the primary one already covers
	 * the same lines.
	 */
	private countChangedLines(model: QuickDiffModel): { added: number; modified: number; deleted: number } {
		const primaryQuickDiff = model.quickDiffs.find(quickDiff => quickDiff.kind === 'primary');
		const primaryQuickDiffChanges = model.changes.filter(change => change.providerId === primaryQuickDiff?.id);

		let added = 0;
		let modified = 0;
		let deleted = 0;

		for (const change of model.changes) {
			const quickDiff = model.quickDiffs.find(quickDiff => quickDiff.id === change.providerId);
			if (!quickDiff || !this.quickDiffService.isQuickDiffProviderVisible(quickDiff.id)) {
				continue;
			}

			if (quickDiff.kind !== 'primary' && primaryQuickDiffChanges.some(c => c.change2.modified.intersectsOrTouches(change.change2.modified))) {
				continue;
			}

			const modifiedLines = change.change.modifiedEndLineNumber - change.change.modifiedStartLineNumber + 1;

			switch (getChangeType(change.change)) {
				case ChangeType.Add:
					added += modifiedLines;
					break;
				case ChangeType.Modify:
					modified += modifiedLines;
					break;
				case ChangeType.Delete:
					deleted += change.change.originalEndLineNumber - change.change.originalStartLineNumber + 1;
					break;
			}
		}

		return { added, modified, deleted };
	}

	private render(model: QuickDiffModel | undefined): void {
		const counts = model ? this.countChangedLines(model) : undefined;
		if (!counts || (counts.added === 0 && counts.modified === 0 && counts.deleted === 0)) {
			this.entry.clear();
			return;
		}

		const tiers: { readonly className: string; readonly label: string }[] = [];
		if (counts.added > 0) {
			tiers.push({ className: 'vsebcode-status-added', label: `+${counts.added}` });
		}
		if (counts.modified > 0) {
			tiers.push({ className: 'vsebcode-status-modified', label: `~${counts.modified}` });
		}
		if (counts.deleted > 0) {
			tiers.push({ className: 'vsebcode-status-deleted', label: `${MINUS_SIGN}${counts.deleted}` });
		}

		clearNode(this.content);
		for (let index = 0; index < tiers.length; index++) {
			if (index > 0) {
				append(this.content, ' ');
			}

			append(this.content, $(`span.${tiers[index].className}`, undefined, tiers[index].label));
		}

		const ariaLabel = this.getAriaLabel(counts);
		const props: IStatusbarEntry = {
			name: localize('status.vsebcode.diff', "Working Tree Changes"),
			text: BLANK_LABEL,
			ariaLabel,
			tooltip: ariaLabel,
			content: this.content
		};

		if (this.entry.value) {
			this.entry.value.update(props);
		} else {
			this.entry.value = this.statusbarService.addEntry(props, DIFF_ENTRY_ID, StatusbarAlignment.LEFT, DIFF_PRIORITY);
		}
	}

	private getAriaLabel(counts: { added: number; modified: number; deleted: number }): string {
		return [
			counts.added === 1 ? localize('1.lineAdded', "1 line added") : localize('N.linesAdded', "{0} lines added", counts.added),
			counts.modified === 1 ? localize('1.lineChanged', "1 line changed") : localize('N.linesChanged', "{0} lines changed", counts.modified),
			counts.deleted === 1 ? localize('1.lineRemoved', "1 line removed") : localize('N.linesRemoved', "{0} lines removed", counts.deleted)
		].join(', ');
	}
}

/**
 * `$(error) n $(warning) n`: the workspace's problem counts, each tier in the colour the
 * markers UI gives its icon. A tier that counts zero is left out, the info tier never shows at
 * all, and the segment goes away entirely once there is neither an error nor a warning left.
 */
class ProblemsStatusEntry extends Disposable {

	private readonly entry = this._register(new MutableDisposable<IStatusbarEntryAccessor>());

	private readonly content = $('span.vsebcode-status-segment');

	constructor(
		@IMarkerService private readonly markerService: IMarkerService,
		@IStatusbarService private readonly statusbarService: IStatusbarService
	) {
		super();

		this._register(this.markerService.onMarkerChanged(() => this.render()));

		this.render();
	}

	private render(): void {
		const statistics = this.markerService.getStatistics();
		if (statistics.errors === 0 && statistics.warnings === 0) {
			this.entry.clear();
			return;
		}

		clearNode(this.content);
		if (statistics.errors > 0) {
			append(this.content, $('span.vsebcode-status-error', undefined, renderIcon(Codicon.error), ` ${this.packNumber(statistics.errors)}`));
		}
		if (statistics.warnings > 0) {
			if (statistics.errors > 0) {
				append(this.content, ' ');
			}

			append(this.content, $('span.vsebcode-status-warning', undefined, renderIcon(Codicon.warning), ` ${this.packNumber(statistics.warnings)}`));
		}

		const ariaLabel = this.getTooltip(statistics);
		const props: IStatusbarEntry = {
			name: localize('status.vsebcode.problems', "Problems"),
			text: BLANK_LABEL,
			ariaLabel,
			tooltip: ariaLabel,
			content: this.content,
			command: 'workbench.actions.view.toggleProblems'
		};

		if (this.entry.value) {
			this.entry.value.update(props);
		} else {
			this.entry.value = this.statusbarService.addEntry(props, PROBLEMS_ENTRY_ID, StatusbarAlignment.LEFT, PROBLEMS_PRIORITY);
		}
	}

	private getTooltip(statistics: MarkerStatistics): string {
		const titles: string[] = [];

		if (statistics.errors > 0) {
			titles.push(localize('totalErrors', "Errors: {0}", statistics.errors));
		}

		if (statistics.warnings > 0) {
			titles.push(localize('totalWarnings', "Warnings: {0}", statistics.warnings));
		}

		return titles.join(', ');
	}

	private packNumber(n: number): string {
		const manyProblems = localize('manyProblems', "10K+");

		return n > 9999 ? manyProblems : n > 999 ? n.toString().charAt(0) + 'K' : n.toString();
	}
}

/**
 * `N%`: how far into the file the cursor sits, on vim's ruler formula. Shows for a text editor
 * and goes away for anything else, the way the stock editor readouts next to it do.
 */
class ScrollStatusEntry extends Disposable {

	private readonly entry = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
	private readonly activeEditorListeners = this._register(new DisposableStore());

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IStatusbarService private readonly statusbarService: IStatusbarService
	) {
		super();

		this._register(this.editorService.onDidActiveEditorChange(() => this.trackActiveEditor()));

		this.trackActiveEditor();
	}

	private trackActiveEditor(): void {
		this.activeEditorListeners.clear();

		const activeEditorPane = this.editorService.activeEditorPane;
		if (activeEditorPane) {
			this.activeEditorListeners.add(activeEditorPane.onDidChangeControl(() => this.trackActiveEditor()));
		}

		const activeCodeEditor = activeEditorPane ? getCodeEditor(activeEditorPane.getControl()) ?? undefined : undefined;
		if (activeCodeEditor) {
			this.activeEditorListeners.add(Event.defer(activeCodeEditor.onDidChangeCursorPosition)(() => this.render(activeCodeEditor)));
			this.activeEditorListeners.add(Event.accumulate(activeCodeEditor.onDidChangeModelContent)(() => this.render(activeCodeEditor)));
			this.activeEditorListeners.add(activeCodeEditor.onDidChangeModel(() => this.render(activeCodeEditor)));
		}

		this.render(activeCodeEditor);
	}

	private render(activeCodeEditor: ICodeEditor | undefined): void {
		const model = activeCodeEditor?.getModel();
		const position = activeCodeEditor?.getPosition();
		if (!model || !position || model.uri.scheme === Schemas.vscodeNotebookCell) {
			this.entry.clear();
			return;
		}

		const text = `${Math.floor(position.lineNumber * 100 / model.getLineCount())}%`;
		const props: IStatusbarEntry = {
			name: localize('status.vsebcode.scroll', "Editor Scroll Position"),
			text,
			ariaLabel: localize('status.vsebcode.scroll.ariaLabel', "{0} through the file", text),
			tooltip: localize('status.vsebcode.scroll.tooltip', "Cursor Position in File")
		};

		if (this.entry.value) {
			this.entry.value.update(props);
		} else {
			this.entry.value = this.statusbarService.addEntry(props, SCROLL_ENTRY_ID, StatusbarAlignment.RIGHT, SCROLL_PRIORITY);
		}
	}
}
