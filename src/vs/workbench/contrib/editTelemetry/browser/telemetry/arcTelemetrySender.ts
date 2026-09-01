/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from '../../../../../base/common/errors.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IObservable, runOnChange } from '../../../../../base/common/observable.js';
import { AnnotatedStringEdit } from '../../../../../editor/common/core/edits/stringEdit.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { EditSourceData, IDocumentWithAnnotatedEdits, createDocWithJustReason } from '../helpers/documentWithAnnotatedEdits.js';
import type { ScmRepoAdapter } from './scmAdapter.js';
import { forwardToChannelIf } from '../../../../../platform/dataChannel/browser/forwardingTelemetryService.js';
import { ArcTelemetryReporter } from './arcTelemetryReporter.js';

export class EditTelemetryReportInlineEditArcSender extends Disposable {
	constructor(
		docWithAnnotatedEdits: IDocumentWithAnnotatedEdits<EditSourceData>,
		scmRepoBridge: IObservable<ScmRepoAdapter | undefined>,
		@IInstantiationService private readonly _instantiationService: IInstantiationService
	) {
		super();

		this._register(runOnChange(docWithAnnotatedEdits.value, (_val, _prev, changes) => {
			const edit = AnnotatedStringEdit.compose(changes.map(c => c.edit));

			if (!edit.replacements.some(r => r.data.editSource.metadata.source === 'inlineCompletionAccept')) {
				return;
			}
			if (!edit.replacements.every(r => r.data.editSource.metadata.source === 'inlineCompletionAccept')) {
				onUnexpectedError(new Error('ArcTelemetrySender: Not all edits are inline completion accept edits!'));
				return;
			}
			if (edit.replacements[0].data.editSource.metadata.source !== 'inlineCompletionAccept') {
				return;
			}
			const data = edit.replacements[0].data.editSource.metadata;

			const docWithJustReason = createDocWithJustReason(docWithAnnotatedEdits, this._store);
			const reporter = this._store.add(this._instantiationService.createInstance(ArcTelemetryReporter, [0, 30, 120, 300, 600, 900].map(s => s * 1000), _prev, docWithJustReason, scmRepoBridge, edit, res => {
				res.telemetryService.publicLog2<{
					extensionId: string;
					extensionVersion: string;
					opportunityId: string;
					languageId: string;
					correlationId: string | undefined;
					didBranchChange: number;
					timeDelayMs: number;

					originalCharCount: number;
					originalLineCount: number;
					originalDeletedLineCount: number;
					arc: number;
					currentLineCount: number;
					currentDeletedLineCount: number;
				}, {
					owner: 'hediet';
					comment: 'Reports for each accepted inline suggestion (= inline completions + next edit suggestions) the accumulated retained character count after a certain time delay. This event is sent 0s, 30s, 120s, 300s, 600s and 900s after acceptance. @sentToGitHub';

					extensionId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The extension id which provided this inline suggestion.' };
					extensionVersion: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The version of the extension.' };
					opportunityId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Unique identifier for an opportunity to show an inline suggestion.' };
					languageId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The language id of the document.' };
					correlationId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The correlation id of the inline suggestion.' };

					didBranchChange: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Indicates if the branch changed in the meantime. If the branch changed (value is 1); this event should probably be ignored.' };
					timeDelayMs: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'The time delay between the user accepting the edit and measuring the survival rate.' };

					originalCharCount: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'The original character count before any edits.' };
					originalLineCount: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'The original line count before any edits.' };
					originalDeletedLineCount: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'The original deleted line count before any edits.' };
					arc: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'The accepted and retained character count.' };
					currentLineCount: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'The current line count after edits.' };
					currentDeletedLineCount: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'The current deleted line count after edits.' };
				}>('editTelemetry.reportInlineEditArc', {
					extensionId: data.$extensionId ?? '',
					extensionVersion: data.$extensionVersion ?? '',
					opportunityId: data.$$requestUuid ?? 'unknown',
					languageId: data.$$languageId,
					correlationId: data.$$correlationId,
					didBranchChange: res.didBranchChange ? 1 : 0,
					timeDelayMs: res.timeDelayMs,

					originalCharCount: res.originalCharCount,
					originalLineCount: res.originalLineCount,
					originalDeletedLineCount: res.originalDeletedLineCount,
					arc: res.arc,
					currentLineCount: res.currentLineCount,
					currentDeletedLineCount: res.currentDeletedLineCount,

					// this event was only ever forwarded to the first-party AI extension, which no longer exists
					...forwardToChannelIf(false),
				});
			}, () => {
				this._store.delete(reporter);
			}));
		}));
	}
}
